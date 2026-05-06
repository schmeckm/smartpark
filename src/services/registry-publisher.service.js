'use strict';

const { Op } = require('sequelize');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/app-error');
const {
  UnsRegistryTopic,
  SparkplugMetricDefinition,
  SignalCatalog,
  UnsLatestState,
  AssetObservation,
  CanonicalInboundMessage,
  RegistryPublishEvent,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { publishMqtt } = require('./mqtt-connector.service');
const {
  findLatestTpunsLiveRowForTopic,
  findLatestSparkplugLiveMetricRow,
} = require('./mqtt-sparkplug-live-buffer.service');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const {
  resolveRideContext,
  preparedUnsTopicsForRide,
  loadMergedCapabilityMap,
  capabilitySignalSource,
  isActivationEligibleUns,
  isActivationEligibleSparkplug,
  deactivatePreparedUnsTopicsForRide,
  deactivatePreparedSparkplugMetricsForRide,
} = require('./ride-signal-capability.service');
const { predictRideWaitTimes } = require('./ml/ride-prediction.service');
const { buildSparkplugTopic, sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
const {
  buildJsonPayload,
  buildProtobufReadyPayload,
  groupMetricsByDdataTopic,
} = require('./sparkplug-payload-builder.service');

const UNS_PREVIEW_MAX = 4000;
const SPARK_NAME_PREFIX = 'rides/';

/** @param {string} raw */
function parseAllowedRideIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s));
}

function getRegistryPublisherConfig() {
  const allowedRideAssetIds = parseAllowedRideIds(env.registryPublishAllowedRideIds);
  return {
    registryPublishEnabled: Boolean(env.registryPublishEnabled),
    registryPublishMode: env.registryPublishMode === 'parallel' ? 'parallel' : 'dry_run',
    registrySparkplugFormat: env.registrySparkplugFormat === 'protobuf_ready' ? 'protobuf_ready' : 'json',
    allowedRideAssetIds,
  };
}

function assertRideOnPilotAllowList(rideAssetId) {
  const cfg = getRegistryPublisherConfig();
  const id = String(rideAssetId || '').trim().toLowerCase();
  const ok = cfg.allowedRideAssetIds.some((x) => String(x).trim().toLowerCase() === id);
  if (!ok) {
    throw new AppError('Ride is not on REGISTRY_PUBLISH_ALLOWED_RIDE_IDS pilot list', 403, {
      code: 'REGISTRY_PUBLISH_RIDE_NOT_ALLOWED',
    });
  }
}

function assertRealtimePublishEnabled() {
  const cfg = getRegistryPublisherConfig();
  if (!cfg.registryPublishEnabled) {
    throw new AppError('Registry publisher realtime publish is disabled (REGISTRY_PUBLISH_ENABLED)', 403, {
      code: 'REGISTRY_PUBLISH_DISABLED',
    });
  }
}

/** @param {unknown} v */
function truncatePreview(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s.length > UNS_PREVIEW_MAX ? `${s.slice(0, UNS_PREVIEW_MAX)}…` : s;
}

/** @param {string} signalCode */
function mlHorizonMinutesFromSignalCode(signalCode) {
  const m = String(signalCode || '').match(/(\d{1,3})/g);
  if (!m || !m.length) return 60;
  const nums = m.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0 && n <= 180);
  return nums.length ? nums[nums.length - 1] : 60;
}

/**
 * @param {string} q
 * @param {'GOOD'|'ESTIMATED'|'BAD'} fallback
 */
function normalizeQuality(q, fallback = 'GOOD') {
  const u = String(q || '').toUpperCase();
  if (u === 'GOOD' || u === 'ESTIMATED' || u === 'BAD') return u;
  if (u === 'SIMULATED') return 'ESTIMATED';
  return fallback;
}

/** @param {import('../modules/assets/platform.models').ParkAsset} asset @param {import('../modules/assets/platform.models').Park} park */
async function resolveAdapterCanonicalObservation(ctx, signalCode) {
  const asset = ctx.asset;
  const park = ctx.park;
  const extEntity = asset.externalEntityId;
  const extPark = park.externalEntityId;
  if (!extEntity || !extPark) return null;

  const obs = await AssetObservation.findOne({
    where: { assetId: ctx.assetId, metricCode: signalCode },
    order: [['timestamp', 'DESC']],
  });
  if (obs && obs.metricValue != null && String(obs.metricValue).trim() !== '') {
    const raw = obs.metricValue;
    const num = Number(raw);
    const value = Number.isFinite(num) && String(raw).trim() !== '' ? num : raw;
    return { value, quality: 'GOOD', note: 'asset_observation' };
  }

  const row = await CanonicalInboundMessage.findOne({
    where: {
      status: 'APPLIED',
      externalEntityId: String(extEntity),
      externalParkId: String(extPark),
      messageType: { [Op.in]: ['WAIT_TIME_UPDATED', 'ENTITY_STATUS_UPDATED'] },
    },
    order: [['occurredAt', 'DESC']],
  });
  if (!row) return null;
  const payload = row.get('payload') || {};
  const code = String(signalCode || '').toLowerCase();
  if (code.includes('wait') || code.includes('queue') || code.includes('forecast')) {
    const v =
      payload.waitTimeMinutes ?? payload.waitMinutes ?? payload.liveWaitMinutes ?? payload.queueTime ?? payload.value;
    if (v != null && Number.isFinite(Number(v))) return { value: Number(v), quality: 'GOOD', note: 'canonical_message' };
  }
  if (code.includes('status')) {
    const v = payload.status ?? payload.entityStatus ?? payload.operatingStatus;
    if (v != null) return { value: v, quality: 'GOOD', note: 'canonical_message' };
  }
  return null;
}

/**
 * @param {{ ctx: Awaited<ReturnType<typeof resolveRideContext>>, sourceType: string, topicPath: string, signalCode: string, mlCache: Map<string, unknown> }} args
 */
async function resolveTelemetryValue(args) {
  const { ctx, sourceType, topicPath, signalCode, mlCache } = args;
  const st = String(sourceType || '').toUpperCase();

  if (st === 'MQTT_EDGE') {
    const latest = await UnsLatestState.findOne({ where: { topicPath } });
    if (latest) {
      const p = latest.get('payloadJson') || {};
      const v = p.value != null ? p.value : p.v;
      if (v !== undefined && v !== null) {
        return {
          value: v,
          quality: normalizeQuality(latest.get('quality'), 'GOOD'),
          used: 'uns_latest_state',
        };
      }
    }
    const liveRow = findLatestTpunsLiveRowForTopic(topicPath);
    if (liveRow && liveRow.value !== undefined && liveRow.value !== null) {
      return {
        value: liveRow.value,
        quality: normalizeQuality(liveRow.quality, 'GOOD'),
        used: 'mqtt_live_tpuns',
      };
    }
    const groupId = (env.sparkplugGroupId && String(env.sparkplugGroupId).trim()) || slugifyName(ctx.parkSlug);
    const edgeNodeId = String(env.sparkplugEdgeNode || 'park_gateway');
    const deviceSeg = sparkplugDeviceTopicSegment(ctx.assetId);
    const sp =
      findLatestSparkplugLiveMetricRow({
        groupId,
        edgeNodeId,
        deviceId: deviceSeg,
        metricName: signalCode,
      }) ||
      findLatestSparkplugLiveMetricRow({
        groupId,
        edgeNodeId,
        deviceId: String(ctx.assetId),
        metricName: signalCode,
      });
    if (sp && sp.value !== undefined && sp.value !== null) {
      return {
        value: sp.value,
        quality: normalizeQuality(sp.quality, 'GOOD'),
        used: 'mqtt_live_sparkplug',
      };
    }
    return null;
  }

  if (st === 'ADAPTER') {
    const r = await resolveAdapterCanonicalObservation(ctx, signalCode);
    if (!r) return null;
    return { value: r.value, quality: r.quality, used: r.note };
  }

  if (st === 'MANUAL') {
    const latest = await UnsLatestState.findOne({ where: { topicPath } });
    if (!latest) return null;
    const p = latest.get('payloadJson') || {};
    const v = p.value != null ? p.value : p.v;
    if (v === undefined || v === null) return null;
    return { value: v, quality: normalizeQuality(latest.get('quality'), 'GOOD'), used: 'uns_latest_manual' };
  }

  if (st === 'SIMULATION') {
    const liveRow = findLatestTpunsLiveRowForTopic(topicPath);
    if (liveRow && String(liveRow.quality || '').toUpperCase() === 'SIMULATED' && liveRow.value != null) {
      return { value: liveRow.value, quality: 'ESTIMATED', used: 'mqtt_live_simulated' };
    }
    const simObs = await AssetObservation.findOne({
      where: {
        assetId: ctx.assetId,
        metricCode: signalCode,
        source: { [Op.iLike]: '%SIM%' },
      },
      order: [['timestamp', 'DESC']],
    });
    if (!simObs) {
      const o2 = await AssetObservation.findOne({
        where: {
          assetId: ctx.assetId,
          metricCode: signalCode,
          source: { [Op.iLike]: '%OEE%' },
        },
        order: [['timestamp', 'DESC']],
      });
      if (o2 && o2.metricValue != null) {
        const num = Number(o2.metricValue);
        return { value: Number.isFinite(num) ? num : o2.metricValue, quality: 'ESTIMATED', used: 'asset_observation_sim' };
      }
      return null;
    }
    const num = Number(simObs.metricValue);
    return {
      value: Number.isFinite(num) ? num : simObs.metricValue,
      quality: 'ESTIMATED',
      used: 'asset_observation_sim',
    };
  }

  if (st === 'ML') {
    const cacheKey = `${ctx.parkId}:${ctx.assetId}`;
    let pred = mlCache.get(cacheKey);
    if (!pred) {
      pred = await predictRideWaitTimes({
        parkId: ctx.parkId,
        rideId: ctx.assetId,
        horizons: [15, 30, 45, 60, 90, 120],
      });
      mlCache.set(cacheKey, pred);
    }
    const horizon = mlHorizonMinutesFromSignalCode(signalCode);
    const preds = Array.isArray(pred.predictions) ? pred.predictions : [];
    let pick = preds.find((p) => Number(p.horizonMinutes) === horizon);
    if (!pick && preds.length) {
      pick = preds.reduce((best, cur) => {
        const bh = Math.abs(Number(best.horizonMinutes) - horizon);
        const ch = Math.abs(Number(cur.horizonMinutes) - horizon);
        return ch < bh ? cur : best;
      }, preds[0]);
    }
    if (!pick || pick.value == null || !Number.isFinite(Number(pick.value))) return null;
    return {
      value: Number(pick.value),
      quality: 'ESTIMATED',
      used: `ml_prediction_${pred.predictionMode || 'UNKNOWN'}`,
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} args
 */
function buildTpunsPayload(args) {
  const ts =
    args.ts instanceof Date ? args.ts.toISOString() : String(args.ts || new Date().toISOString());
  return {
    v: args.value,
    ts,
    domain: String(args.domain),
    assetSlug: String(args.assetSlug),
    metric: String(args.metric),
    unit: args.unit ?? null,
    quality: args.quality,
    source: 'REGISTRY_PUBLISHER',
    sourceType: String(args.sourceType),
    registryTopicId: String(args.registryTopicId),
    rideAssetId: String(args.rideAssetId),
  };
}

/** @param {string} valueType */
function sparkplugTypeFromValueType(valueType) {
  const vt = String(valueType || '').toLowerCase();
  if (vt === 'boolean' || vt === 'bool') return 'Boolean';
  if (vt === 'string' || vt === 'text') return 'String';
  if (vt === 'integer' || vt === 'int' || vt === 'int32') return 'Int32';
  return 'Float';
}

async function appendAuditRow(fields) {
  return RegistryPublishEvent.create({
    rideAssetId: fields.rideAssetId,
    registryTopicId: fields.registryTopicId ?? null,
    sparkplugMetricDefinitionId: fields.sparkplugMetricDefinitionId ?? null,
    topic: fields.topic,
    payloadPreview: fields.payloadPreview ?? null,
    publishMode: fields.publishMode,
    publishFormat: fields.publishFormat,
    status: fields.status,
    reason: fields.reason ?? null,
    publishedAt: fields.publishedAt ?? null,
  });
}

async function getRegistryPublisherStatus() {
  const cfg = getRegistryPublisherConfig();
  const { getMqttState } = require('./mqtt-connector.service');
  let mqttConnected = false;
  try {
    const mqtt = getMqttState();
    mqttConnected = Boolean(mqtt && mqtt.connected);
  } catch {
    mqttConnected = false;
  }
  return {
    ...cfg,
    mqttConnected,
    mqttEnabled: Boolean(env.mqttEnabled),
  };
}

/** ISO timestamp or null from Sequelize Date */
function toIso(d) {
  if (!d) return null;
  try {
    const x = d instanceof Date ? d : new Date(d);
    return Number.isNaN(x.getTime()) ? null : x.toISOString();
  } catch {
    return null;
  }
}

/**
 * Operational summary for SRE (aggregates `registry_publish_events`; does not publish MQTT).
 */
async function getRegistryPublisherHealth() {
  const cfg = getRegistryPublisherConfig();
  const status = await getRegistryPublisherStatus();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [failedEventsLast24h, skippedEventsLast24h, publishedEventsLast24h] = await Promise.all([
    RegistryPublishEvent.count({ where: { createdAt: { [Op.gte]: since }, status: 'FAILED' } }),
    RegistryPublishEvent.count({ where: { createdAt: { [Op.gte]: since }, status: 'SKIPPED' } }),
    RegistryPublishEvent.count({ where: { createdAt: { [Op.gte]: since }, status: 'PUBLISHED' } }),
  ]);

  const lastDryRow = await RegistryPublishEvent.findOne({
    where: { status: 'DRY_RUN' },
    order: [['createdAt', 'DESC']],
    attributes: ['createdAt'],
  });

  const lastPubRow = await RegistryPublishEvent.findOne({
    where: { status: 'PUBLISHED' },
    order: [['createdAt', 'DESC']],
    attributes: ['createdAt', 'publishedAt'],
  });

  const lastDryRunAt = lastDryRow ? toIso(lastDryRow.get('createdAt')) : null;
  let lastPublishAt = null;
  if (lastPubRow) {
    lastPublishAt = toIso(lastPubRow.get('publishedAt')) || toIso(lastPubRow.get('createdAt'));
  }

  return {
    registryPublishEnabled: cfg.registryPublishEnabled,
    registryPublishMode: cfg.registryPublishMode,
    allowedRideCount: cfg.allowedRideAssetIds.length,
    mqttConnected: status.mqttConnected,
    mqttEnabled: status.mqttEnabled,
    lastDryRunAt,
    lastPublishAt,
    failedEventsLast24h,
    skippedEventsLast24h,
    publishedEventsLast24h,
  };
}

/**
 * Rollback guard: deactivate PREPARED_OPERATOR UNS + Sparkplug pilot rows for this ride only (registry mirror).
 * Writes audit row; no MQTT; does not touch legacy UNS nodes/topics outside registry publisher scope.
 *
 * @param {string} rideAssetId
 */
async function disableRegistryPublisherPilotForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const uns = await deactivatePreparedUnsTopicsForRide(rideAssetId);
  const spark = await deactivatePreparedSparkplugMetricsForRide(rideAssetId);

  const preview = {
    rollback: 'disable_pilot',
    rideAssetId: ctx.assetId,
    unsDeactivated: uns.deactivated,
    sparkplugDeactivated: spark.deactivated,
  };

  await appendAuditRow({
    rideAssetId: ctx.assetId,
    registryTopicId: null,
    sparkplugMetricDefinitionId: null,
    topic: 'rollback:disable_pilot',
    payloadPreview: truncatePreview(preview),
    publishMode: 'none',
    publishFormat: 'rollback',
    status: 'DISABLE_PILOT',
    reason: 'registry_publisher_disable_pilot',
    publishedAt: null,
  });

  logger.info({ rideAssetId: ctx.assetId, uns, spark }, 'registry publisher pilot disabled (rollback audit)');

  return {
    rideAssetId: ctx.assetId,
    unsDeactivated: uns.deactivated,
    sparkplugDeactivated: spark.deactivated,
  };
}

async function listRegistryPublishEvents({ rideAssetId, limit = 50 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const where = {};
  if (rideAssetId && String(rideAssetId).trim()) {
    where.rideAssetId = String(rideAssetId).trim();
  }
  const rows = await RegistryPublishEvent.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: lim,
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * @param {string} rideAssetId
 * @param {{ forceMode?: 'dry_run'|'parallel' }} [opts]
 */
async function runRegistryPublishForRide(rideAssetId, opts = {}) {
  assertRideOnPilotAllowList(rideAssetId);
  const cfg = getRegistryPublisherConfig();
  const mode = opts.forceMode || cfg.registryPublishMode;
  const parallel = mode === 'parallel';
  if (parallel) assertRealtimePublishEnabled();

  const ctx = await resolveRideContext(rideAssetId);
  const capMap = await loadMergedCapabilityMap(ctx);

  const topicsAll = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, isActive: true },
    limit: 800,
  });
  const mineTopics = preparedUnsTopicsForRide(ctx, topicsAll).filter((t) => Boolean(t.get('isActive')));

  /** @type {{ warnings: string[], previews: unknown[], unsPublished: number, sparkPublished: number, skipped: number, failed: number }} */
  const summary = { warnings: [], previews: [], unsPublished: 0, sparkPublished: 0, skipped: 0, failed: 0 };
  const mlCache = new Map();
  const groupId = (env.sparkplugGroupId && String(env.sparkplugGroupId).trim()) || slugifyName(ctx.parkSlug);

  for (const trow of mineTopics) {
    const p = trow.get('payloadJson') || {};
    const sid = p.signalCatalogId != null ? String(p.signalCatalogId) : null;
    if (!sid) {
      summary.warnings.push(`UNS registry topic ${trow.id}: missing signalCatalogId`);
      summary.skipped += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: trow.get('topicPath'),
        payloadPreview: null,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'SKIPPED',
        reason: 'missing_signal_catalog_id',
      });
      continue;
    }
    const cap = capMap.get(sid);
    const src = capabilitySignalSource(cap);
    if (!isActivationEligibleUns(src)) {
      summary.warnings.push(`UNS topic ${trow.get('topicPath')}: capability source ${src} not eligible`);
      summary.skipped += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: trow.get('topicPath'),
        payloadPreview: null,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'SKIPPED',
        reason: `ineligible_capability_source:${src}`,
      });
      continue;
    }

    const cat = await SignalCatalog.findByPk(sid);
    const signalCode = cat ? cat.signalCode : null;
    const topicPath = trow.get('topicPath');
    if (!signalCode || !topicPath) {
      summary.skipped += 1;
      continue;
    }

    let parsed;
    try {
      parsed = parseTopic(topicPath);
    } catch (e) {
      summary.warnings.push(`Invalid UNS topic on registry row ${trow.id}: ${e.message}`);
      summary.skipped += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: String(topicPath),
        payloadPreview: null,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'SKIPPED',
        reason: 'invalid_topic_path',
      });
      continue;
    }

    const resolved = await resolveTelemetryValue({
      ctx,
      sourceType: src,
      topicPath,
      signalCode,
      mlCache,
    });
    if (!resolved) {
      summary.warnings.push(`No value for ${topicPath} (source ${src})`);
      summary.skipped += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: String(topicPath),
        payloadPreview: null,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'SKIPPED',
        reason: `no_value:${src}`,
      });
      continue;
    }

    const payload = buildTpunsPayload({
      value: resolved.value,
      ts: new Date(),
      domain: parsed.domain,
      assetSlug: parsed.assetSlug,
      metric: parsed.metric,
      unit: cat?.unit ?? null,
      quality: resolved.quality,
      sourceType: src,
      registryTopicId: String(trow.id),
      rideAssetId: String(ctx.assetId),
    });
    const preview = truncatePreview(payload);
    summary.previews.push({ kind: 'uns', topic: topicPath, payload });

    if (!parallel || cfg.registryPublishEnabled !== true) {
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: String(topicPath),
        payloadPreview: preview,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'DRY_RUN',
        reason: resolved.used,
      });
      continue;
    }

    try {
      const pub = await publishMqtt(topicPath, payload);
      if (!pub.published) {
        summary.failed += 1;
        await appendAuditRow({
          rideAssetId: ctx.assetId,
          registryTopicId: trow.id,
          sparkplugMetricDefinitionId: null,
          topic: String(topicPath),
          payloadPreview: preview,
          publishMode: mode,
          publishFormat: 'uns_json',
          status: 'FAILED',
          reason: String(pub.reason || 'mqtt_publish_failed'),
        });
        logger.warn({ topic: topicPath, reason: pub.reason }, 'registry publisher UNS MQTT publish failed');
      } else {
        summary.unsPublished += 1;
        await appendAuditRow({
          rideAssetId: ctx.assetId,
          registryTopicId: trow.id,
          sparkplugMetricDefinitionId: null,
          topic: String(topicPath),
          payloadPreview: preview,
          publishMode: mode,
          publishFormat: 'uns_json',
          status: 'PUBLISHED',
          reason: resolved.used,
          publishedAt: new Date(),
        });
        logger.info({ topic: topicPath, registryTopicId: trow.id }, 'registry publisher UNS MQTT published');
      }
    } catch (e) {
      summary.failed += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: trow.id,
        sparkplugMetricDefinitionId: null,
        topic: String(topicPath),
        payloadPreview: preview,
        publishMode: mode,
        publishFormat: 'uns_json',
        status: 'FAILED',
        reason: e.message,
      });
      logger.warn({ err: e.message, topic: topicPath }, 'registry publisher UNS MQTT threw');
    }
  }

  /** Sparkplug pilot metrics */
  const sparks = await SparkplugMetricDefinition.findAll({
    where: {
      registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR,
      rideAssetId: ctx.assetId,
      isActive: true,
    },
    limit: 400,
  });

  const sparkRows = [];
  for (const sdef of sparks) {
    const pj = sdef.get('payloadJson') || {};
    const sid = pj.signalCatalogId != null ? String(pj.signalCatalogId) : null;
    const cap = sid ? capMap.get(sid) : null;
    const src = capabilitySignalSource(cap);
    if (!isActivationEligibleSparkplug(src)) continue;

    const cat = sid ? await SignalCatalog.findByPk(sid) : null;
    const signalCode = cat?.signalCode || sdef.get('signalKey') || sdef.get('metricName');
    if (!signalCode) continue;

    const resolved = await resolveTelemetryValue({
      ctx,
      sourceType: src,
      topicPath: '', // MQTT_EDGE uses UNS/sparkplug paths only
      signalCode: String(signalCode),
      mlCache,
    });
    if (!resolved) {
      summary.warnings.push(`No Sparkplug value for ${signalCode} (MQTT_EDGE)`);
      summary.skipped += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: null,
        sparkplugMetricDefinitionId: sdef.id,
        topic: `(sparkplug/${signalCode})`,
        payloadPreview: null,
        publishMode: mode,
        publishFormat: cfg.registrySparkplugFormat,
        status: 'SKIPPED',
        reason: 'no_value:MQTT_EDGE',
      });
      continue;
    }

    const edgeNodeId = String(sdef.get('edgeNodeId') || env.sparkplugEdgeNode || 'park_gateway');
    const deviceId = String(sdef.get('deviceId') || ctx.assetId);
    const metricName = `${SPARK_NAME_PREFIX}${slugifyName(ctx.assetSlug)}/${slugifyName(signalCode)}`;
    const cj = cap?.get?.('capabilityJson') || {};
    const sparkType = sparkplugTypeFromValueType(cj.valueType || sdef.get('dataType'));

    sparkRows.push({
      groupId,
      edgeNodeId,
      deviceId,
      name: metricName,
      type: sparkType,
      value: resolved.value,
      unit: cat?.unit ?? null,
      sdef,
      signalCode: String(signalCode),
      resolved,
    });
  }

  const byTopic = groupMetricsByDdataTopic(
    sparkRows.map((r) => ({
      groupId: r.groupId,
      edgeNodeId: r.edgeNodeId,
      deviceId: r.deviceId,
      name: r.name,
      type: r.type,
      value: r.value,
      unit: r.unit,
    }))
  );

  let seqBase = Date.now() % 100000;
  for (const [topic, bundle] of byTopic.entries()) {
    seqBase += 1;
    const head = sparkRows.find((r) => {
      const t = buildSparkplugTopic({
        groupId: r.groupId,
        messageType: 'DDATA',
        edgeNodeId: r.edgeNodeId,
        deviceId: r.deviceId,
      });
      return t === topic;
    });
    const sparkFormat = cfg.registrySparkplugFormat;

    if (sparkFormat === 'protobuf_ready') {
      const wrapper = buildProtobufReadyPayload(bundle.metrics, bundle, { seq: seqBase });
      const preview = truncatePreview(wrapper);
      summary.previews.push({ kind: 'sparkplug_protobuf_ready', topic, wrapper });
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: null,
        sparkplugMetricDefinitionId: head?.sdef?.id ?? null,
        topic,
        payloadPreview: preview,
        publishMode: mode,
        publishFormat: 'protobuf_ready',
        status: 'SKIPPED',
        reason: 'protobuf_ready_no_wire_encode',
      });
      summary.warnings.push(`Sparkplug protobuf_ready: not publishing MQTT for ${topic} (adapter stub)`);
      continue;
    }

    const jsonBody = buildJsonPayload(bundle.metrics, { seq: seqBase, timestamp: Date.now() });
    const preview = truncatePreview(jsonBody);

    if (!parallel || cfg.registryPublishEnabled !== true) {
      summary.previews.push({ kind: 'sparkplug_json', topic, payload: jsonBody });
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: null,
        sparkplugMetricDefinitionId: head?.sdef?.id ?? null,
        topic,
        payloadPreview: preview,
        publishMode: mode,
        publishFormat: 'json',
        status: 'DRY_RUN',
        reason: head?.resolved?.used ?? null,
      });
      continue;
    }

    try {
      const pub = await publishMqtt(topic, jsonBody);
      if (!pub.published) {
        summary.failed += 1;
        await appendAuditRow({
          rideAssetId: ctx.assetId,
          registryTopicId: null,
          sparkplugMetricDefinitionId: head?.sdef?.id ?? null,
          topic,
          payloadPreview: preview,
          publishMode: mode,
          publishFormat: 'json',
          status: 'FAILED',
          reason: String(pub.reason || 'mqtt_publish_failed'),
        });
        logger.warn({ topic, reason: pub.reason }, 'registry publisher Sparkplug MQTT publish failed');
      } else {
        summary.sparkPublished += 1;
        await appendAuditRow({
          rideAssetId: ctx.assetId,
          registryTopicId: null,
          sparkplugMetricDefinitionId: head?.sdef?.id ?? null,
          topic,
          payloadPreview: preview,
          publishMode: mode,
          publishFormat: 'json',
          status: 'PUBLISHED',
          reason: head?.resolved?.used ?? null,
          publishedAt: new Date(),
        });
        logger.info({ topic, metricCount: bundle.metrics.length }, 'registry publisher Sparkplug MQTT published');
      }
    } catch (e) {
      summary.failed += 1;
      await appendAuditRow({
        rideAssetId: ctx.assetId,
        registryTopicId: null,
        sparkplugMetricDefinitionId: head?.sdef?.id ?? null,
        topic,
        payloadPreview: preview,
        publishMode: mode,
        publishFormat: 'json',
        status: 'FAILED',
        reason: e.message,
      });
      logger.warn({ err: e.message, topic }, 'registry publisher Sparkplug MQTT threw');
    }
  }

  return {
    rideAssetId: ctx.assetId,
    mode,
    sparkplugFormat: cfg.registrySparkplugFormat,
    ...summary,
  };
}

async function dryRunRegistryPublishForRide(rideAssetId) {
  return runRegistryPublishForRide(rideAssetId, { forceMode: 'dry_run' });
}

async function publishOnceRegistryPublishForRide(rideAssetId) {
  assertRealtimePublishEnabled();
  return runRegistryPublishForRide(rideAssetId, { forceMode: 'parallel' });
}

module.exports = {
  parseAllowedRideIds,
  getRegistryPublisherConfig,
  getRegistryPublisherStatus,
  getRegistryPublisherHealth,
  disableRegistryPublisherPilotForRide,
  listRegistryPublishEvents,
  dryRunRegistryPublishForRide,
  publishOnceRegistryPublishForRide,
  runRegistryPublishForRide,
  assertRideOnPilotAllowList,
  assertRealtimePublishEnabled,
  buildTpunsPayload,
};
