'use strict';

/**
 * Phase 9 — Operations facts (read-only): registry-first value resolution with legacy fallback.
 * Does not write MQTT, registry rows, uns_nodes, or uns_latest_states.
 */

const { Op } = require('sequelize');
const { logger } = require('../utils/logger');
const {
  ParkAsset,
  AssetType,
  RideSignalCapability,
  SignalCatalog,
  UnsRegistryTopic,
  UnsLatestState,
  CanonicalInboundMessage,
  AssetObservation,
  RideWaitTimeSample,
  RegistryPublishEvent,
  RegistrySignalDeprecation,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { buildCanonicalUnsTopic, slugifyName } = require('../modules/uns/uns-topic-generator.service');
const {
  findLatestTpunsLiveRowForTopic,
  findLatestSparkplugLiveMetricRow,
} = require('./mqtt-sparkplug-live-buffer.service');
const { sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
const env = require('../config/env');
const { resolveRideContext, preparedUnsTopicsForRide, capabilitySignalSource } = require('./ride-signal-capability.service');

const REGISTRY_SOURCE_OPERATOR = 'OPERATOR_CONFIGURED';
const REGISTRY_SOURCE_MIRRORED = 'MIRRORED_FROM_LEGACY';

/** @typedef {'REGISTRY'|'LEGACY_UNS'|'CANONICAL'|'OBSERVATION'|'MISSING'} FactSource */
/** @typedef {'HIGH'|'MEDIUM'|'LOW'} FactConfidence */

const SOURCE_RANK = { REGISTRY: 4, LEGACY_UNS: 3, CANONICAL: 2, OBSERVATION: 2, MISSING: 0 };
const CONF_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

const KPI_FIELDS = [
  'queueTime',
  'predictedWaitTime',
  'throughputActual',
  'throughputTheoretical',
  'capacityUtilization',
  'vehiclesActive',
  'staffActual',
  'downtimeMinutes',
  'status',
];

function normalizeSignalKey(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

/**
 * Map signal_catalog.signal_code → response KPI field key (null = no KPI mapping).
 * @param {string} code
 * @returns {string | null}
 */
function kpiKeyForSignalCode(code) {
  const n = normalizeSignalKey(code);
  const map = {
    queue_time: 'queueTime',
    queue_time_min: 'queueTime',
    wait_time: 'queueTime',
    predicted_wait_time: 'predictedWaitTime',
    forecast_wait_time_60: 'predictedWaitTime',
    throughput_actual: 'throughputActual',
    throughput_theoretical: 'throughputTheoretical',
    capacity_utilization: 'capacityUtilization',
    vehicles_active: 'vehiclesActive',
    staff_actual: 'staffActual',
    downtime_minutes: 'downtimeMinutes',
    ride_status: 'status',
    operating_status: 'status',
    status: 'status',
  };
  return map[n] || null;
}

function mergeCapabilityRows(rows) {
  /** @type {Map<string, import('../models').RideSignalCapability>} */
  const bySignal = new Map();
  for (const row of rows) {
    const sid = String(row.get('signalCatalogId'));
    const cur = bySignal.get(sid);
    if (!cur || row.registrySource === REGISTRY_SOURCE_OPERATOR) {
      bySignal.set(sid, row);
    }
  }
  return bySignal;
}

/** @param {string | null | undefined} raw */
function tryParseJson(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/** Extract scalar metric from UNS / registry publisher shaped payloads. */
function extractMetricValue(payload) {
  if (payload == null || typeof payload !== 'object') return undefined;
  if ('value' in payload && payload.value !== undefined) return payload.value;
  if ('v' in payload && payload.v !== undefined && typeof payload.v !== 'object') return payload.v;
  return undefined;
}

/**
 * @param {{ value: unknown, source: FactSource, confidence: FactConfidence, reason: string } | null | undefined} cur
 * @param {{ value: unknown, source: FactSource, confidence: FactConfidence, reason: string } | null | undefined} next
 */
function pickBetterResolution(cur, next) {
  if (!next || next.value === null || next.value === undefined) return cur || next;
  if (!cur || cur.value === null || cur.value === undefined) return next;
  const sr = (x) => SOURCE_RANK[x.source] ?? 0;
  const cr = (x) => CONF_RANK[x.confidence] ?? 0;
  if (sr(next) > sr(cur)) return next;
  if (sr(next) < sr(cur)) return cur;
  if (cr(next) > cr(cur)) return next;
  return cur;
}

async function latestRegistryPublishPreview(registryTopicId, rideAssetId) {
  const row = await RegistryPublishEvent.findOne({
    where: {
      registryTopicId,
      rideAssetId,
      status: { [Op.in]: ['PUBLISHED', 'DRY_RUN'] },
    },
    order: [['createdAt', 'DESC']],
    attributes: ['payloadPreview', 'createdAt'],
  });
  if (!row) return null;
  const prev = row.get('payloadPreview');
  const obj = tryParseJson(prev);
  if (!obj) return null;
  const val = extractMetricValue(obj);
  if (val === undefined || val === null) return null;
  return {
    value: val,
    source: /** @type {FactSource} */ ('REGISTRY'),
    confidence: /** @type {FactConfidence} */ ('MEDIUM'),
    reason: 'registry_publish_events.payload_preview',
  };
}

async function unsLatestValue(topicPath) {
  if (!topicPath) return null;
  const row = await UnsLatestState.findOne({ where: { topicPath } });
  if (!row) return null;
  const p = row.get('payloadJson') || {};
  const val = extractMetricValue(p);
  if (val === undefined || val === null) return null;
  return {
    value: val,
    source: /** @type {FactSource} */ ('LEGACY_UNS'),
    confidence: /** @type {FactConfidence} */ ('HIGH'),
    reason: 'uns_latest_states',
  };
}

function tpunsLiveValue(topicPath) {
  const live = findLatestTpunsLiveRowForTopic(topicPath);
  if (!live || live.value === undefined || live.value === null) return null;
  return {
    value: live.value,
    source: /** @type {FactSource} */ ('REGISTRY'),
    confidence: /** @type {FactConfidence} */ ('MEDIUM'),
    reason: 'mqtt_live_tpuns_buffer',
  };
}

function sparkplugLiveValue(ctx, signalCode) {
  const groupId = (env.sparkplugGroupId && String(env.sparkplugGroupId).trim()) || slugifyName(ctx.parkSlug);
  const edgeNodeId = String(env.sparkplugEdgeNode || 'park_gateway');
  const deviceSeg = sparkplugDeviceTopicSegment(ctx.assetId);
  const row =
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
  if (!row || row.value === undefined || row.value === null) return null;
  return {
    value: row.value,
    source: /** @type {FactSource} */ ('REGISTRY'),
    confidence: /** @type {FactConfidence} */ ('MEDIUM'),
    reason: 'mqtt_live_sparkplug_buffer',
  };
}

/**
 * REGISTRY path: active prepared topic only.
 * @param {import('../models').UnsRegistryTopic | undefined} activeTopic
 */
async function resolveRegistryPath(activeTopic, topicPath, ctx, signalCode, warnings) {
  if (!activeTopic || !topicPath) return null;

  let best = null;

  const pub = await latestRegistryPublishPreview(activeTopic.id, ctx.assetId);
  if (pub) best = pickBetterResolution(best, pub);

  const uns = await unsLatestValue(topicPath);
  if (uns) {
    best = pickBetterResolution(best, {
      ...uns,
      source: 'REGISTRY',
      confidence: 'HIGH',
      reason: 'uns_latest_states(active_registry_topic)',
    });
  }

  const live = tpunsLiveValue(topicPath);
  if (live) best = pickBetterResolution(best, live);

  const sp = sparkplugLiveValue(ctx, signalCode);
  if (sp) best = pickBetterResolution(best, sp);

  if (!best && activeTopic) {
    warnings.push(`Active registry topic for ${signalCode} but no value (publish preview / UNS / live buffer empty)`);
  }

  return best;
}

/**
 * Shared registry-path probe for health checks and diagnostics (read-only).
 * @param {import('../models').UnsRegistryTopic | undefined | null} activeTopic
 */
async function evaluateRegistryPathUsable(activeTopic, topicPath, ctx, signalCode) {
  const warnings = [];
  const resolution = await resolveRegistryPath(activeTopic, topicPath, ctx, signalCode, warnings);
  const usable = !!(resolution && resolution.value !== null && resolution.value !== undefined);
  return {
    usable,
    detail: usable
      ? 'Registry path returned a usable value'
      : warnings[0] || 'No usable value on registry path',
    resolution,
  };
}

/**
 * @param {{ legacyFallbackDisabled?: boolean } | null | undefined} deprecationPolicy
 * @param {unknown} registryResolution result of resolveRegistryPath (null when registry path has no usable value)
 */
function shouldBlockLegacyFallback(deprecationPolicy, registryResolution) {
  return !registryResolution && Boolean(deprecationPolicy?.legacyFallbackDisabled);
}

function isQueueLikeSignal(signalCode) {
  const n = normalizeSignalKey(signalCode);
  return n.includes('queue') || n.includes('wait') || n === 'predicted_wait_time';
}

async function legacyCanonicalValue(ctx, signalCode) {
  if (!isQueueLikeSignal(signalCode)) return null;
  const asset = ctx.asset;
  const park = ctx.park;
  const extEntity = asset.externalEntityId;
  const extPark = park.externalEntityId;
  if (!extEntity || !extPark) return null;

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
  if (isQueueLikeSignal(signalCode)) {
    const v =
      payload.waitTimeMinutes ?? payload.waitMinutes ?? payload.liveWaitMinutes ?? payload.queueTime ?? payload.value;
    if (v != null && Number.isFinite(Number(v))) {
      return {
        value: Number(v),
        source: /** @type {FactSource} */ ('CANONICAL'),
        confidence: /** @type {FactConfidence} */ ('MEDIUM'),
        reason: 'canonical_inbound_messages',
      };
    }
  }
  if (normalizeSignalKey(signalCode).includes('status')) {
    const v = payload.status ?? payload.entityStatus ?? payload.operatingStatus;
    if (v != null) {
      return {
        value: v,
        source: /** @type {FactSource} */ ('CANONICAL'),
        confidence: /** @type {FactConfidence} */ ('MEDIUM'),
        reason: 'canonical_inbound_messages',
      };
    }
  }
  return null;
}

async function legacyObservationValue(ctx, signalCode) {
  const row = await AssetObservation.findOne({
    where: { assetId: ctx.assetId, metricCode: signalCode },
    order: [['timestamp', 'DESC']],
  });
  if (!row || row.metricValue == null) return null;
  const raw = row.metricValue;
  const num = Number(raw);
  const value = Number.isFinite(num) && String(raw).trim() !== '' ? num : raw;
  return {
    value,
    source: /** @type {FactSource} */ ('OBSERVATION'),
    confidence: /** @type {FactConfidence} */ ('LOW'),
    reason: 'asset_observations',
  };
}

async function legacyThemeParksWaitSample(ctx) {
  const row = await RideWaitTimeSample.findOne({
    where: { parkAssetId: ctx.assetId },
    order: [['sampledAt', 'DESC']],
  });
  if (!row || row.waitTime == null) return null;
  return {
    value: row.waitTime,
    source: /** @type {FactSource} */ ('OBSERVATION'),
    confidence: /** @type {FactConfidence} */ ('LOW'),
    reason: 'ride_wait_time_samples',
  };
}

async function legacyUnsOnly(topicPath, warnings, signalCode) {
  const row = await UnsLatestState.findOne({ where: { topicPath } });
  if (!row) return null;
  const p = row.get('payloadJson') || {};
  const val = extractMetricValue(p);
  if (val === undefined || val === null) return null;
  warnings.push(`Fallback to legacy UNS for ${signalCode}`);
  return {
    value: val,
    source: /** @type {FactSource} */ ('LEGACY_UNS'),
    confidence: /** @type {FactConfidence} */ ('MEDIUM'),
    reason: 'uns_latest_states(legacy_fallback)',
  };
}

/**
 * @param {string} rideAssetId park_assets.asset_id
 */
async function getRideFacts(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const warnings = [];

  const deprecations = await RegistrySignalDeprecation.findAll({
    where: { rideAssetId: ctx.assetId },
    limit: 500,
  });
  /** @type {Map<string, import('../models').RegistrySignalDeprecation>} */
  const deprecationBySignalKey = new Map();
  for (const d of deprecations) {
    const key = String(d.get('signalKey'));
    deprecationBySignalKey.set(key, d);
    deprecationBySignalKey.set(normalizeSignalKey(key), d);
  }

  const caps = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
    include: [{ model: SignalCatalog, as: 'signal', required: true }],
  });
  const byCap = mergeCapabilityRows(caps);

  const topicsAll = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, isActive: true },
    limit: 800,
  });
  const activeMine = preparedUnsTopicsForRide(ctx, topicsAll);
  /** @type {Map<string, import('../models').UnsRegistryTopic>} */
  const activeTopicByCatalogId = new Map();
  for (const t of activeMine) {
    const sid = (t.get('payloadJson') || {}).signalCatalogId;
    if (sid) activeTopicByCatalogId.set(String(sid), t);
  }

  /** @type {Array<{ signalCode: string, resolution: ReturnType<typeof pickBetterResolution> extends infer X ? X : never, deprecationPolicy?: { registryAuthoritative: boolean, legacyPublishDisabled: boolean, legacyFallbackDisabled: boolean } | null }>} */
  const signalRows = [];

  for (const [, cap] of byCap) {
    const src = capabilitySignalSource(cap);
    if (src === 'NOT_AVAILABLE') continue;

    const cat = cap.signal;
    const signalCode = cat.get('signalCode');
    if (!signalCode) continue;

    const topicPath = buildCanonicalUnsTopic({
      parkSlug: ctx.parkSlug,
      entityType: 'ride',
      entitySlug: ctx.assetSlug,
      metric: signalCode,
    });

    const activeTopic = activeTopicByCatalogId.get(String(cap.get('signalCatalogId')));
    const depRow =
      deprecationBySignalKey.get(String(signalCode)) || deprecationBySignalKey.get(normalizeSignalKey(signalCode));
    const deprecationPolicy = depRow
      ? {
          registryAuthoritative: Boolean(depRow.get('registryAuthoritative')),
          legacyPublishDisabled: Boolean(depRow.get('legacyPublishDisabled')),
          legacyFallbackDisabled: Boolean(depRow.get('legacyFallbackDisabled')),
        }
      : null;

    let resolved = await resolveRegistryPath(activeTopic, topicPath, ctx, signalCode, warnings);

    if (!resolved) {
      if (shouldBlockLegacyFallback(deprecationPolicy, resolved)) {
        warnings.push(`Legacy fallback disabled for ${signalCode}; registry path returned no value.`);
        resolved = {
          value: null,
          source: /** @type {FactSource} */ ('MISSING'),
          confidence: /** @type {FactConfidence} */ ('LOW'),
          reason: 'legacy_fallback_disabled_no_registry',
        };
      } else {
        let leg = null;
        if (!activeTopic) {
          leg = await legacyUnsOnly(topicPath, warnings, signalCode);
        }
        if (!leg) leg = await legacyCanonicalValue(ctx, signalCode);
        if (!leg && isQueueLikeSignal(signalCode)) {
          leg = await legacyThemeParksWaitSample(ctx);
        }
        if (!leg) leg = await legacyObservationValue(ctx, signalCode);

        resolved = leg;
        if (resolved && resolved.source !== 'REGISTRY') {
          if (!warnings.some((w) => w.includes(`Fallback to legacy UNS for ${signalCode}`))) {
            warnings.push(`Fallback to legacy sources for ${signalCode}`);
          }
        }
      }
    }

    if (!resolved) {
      warnings.push(`Missing value for signal ${signalCode}`);
      resolved = {
        value: null,
        source: /** @type {FactSource} */ ('MISSING'),
        confidence: /** @type {FactConfidence} */ ('LOW'),
        reason: 'no_registry_no_legacy',
      };
    }

    signalRows.push({ signalCode, resolution: resolved, deprecationPolicy });
  }

  let registryUsed = 0;
  let legacyUsed = 0;
  let missingSignals = 0;
  for (const row of signalRows) {
    const s = row.resolution.source;
    if (s === 'REGISTRY') registryUsed += 1;
    else if (s === 'MISSING') missingSignals += 1;
    else legacyUsed += 1;
  }

  /** @type {Map<string, typeof signalRows[0]['resolution']>} */
  const perKpi = new Map();
  for (const row of signalRows) {
    const k = kpiKeyForSignalCode(row.signalCode);
    if (!k) continue;
    const prev = perKpi.get(k);
    perKpi.set(k, pickBetterResolution(prev, row.resolution));
  }

  /** @type {Record<string, { source: FactSource, confidence: FactConfidence, reason: string }>} */
  const sourceBreakdown = {};
  /** @type {Record<string, unknown>} */
  const kpi = {};

  for (const k of KPI_FIELDS) {
    const r = perKpi.get(k);
    if (!r || r.value === null || r.value === undefined) {
      kpi[k] = null;
      sourceBreakdown[k] = {
        source: 'MISSING',
        confidence: 'LOW',
        reason: r ? r.reason : 'no_mapped_signal_with_value',
      };
      if (!r) warnings.push(`Missing KPI ${k} (no mapped signal value)`);
    } else {
      kpi[k] = r.value;
      sourceBreakdown[k] = { source: r.source, confidence: r.confidence, reason: r.reason };
    }
  }

  for (const row of signalRows) {
    const k = kpiKeyForSignalCode(row.signalCode);
    if (!k || !row.deprecationPolicy) continue;
    const pol = row.deprecationPolicy;
    const cur = sourceBreakdown[k];
    if (!cur) continue;
    const merged = { ...(cur.policy || {}) };
    if (pol.registryAuthoritative) merged.registryAuthoritative = true;
    if (pol.legacyPublishDisabled) merged.legacyPublishDisabled = true;
    if (pol.legacyFallbackDisabled) merged.legacyFallbackDisabled = true;
    if (Object.keys(merged).length) {
      sourceBreakdown[k] = { ...cur, policy: merged };
    }
  }

  const asset = ctx.asset;
  const plainName = asset.name || asset.get('name');
  const plainSlug = asset.slug || asset.get('slug');
  const assetStatus = asset.status || asset.get('status');

  if (kpi.status == null && assetStatus != null) {
    kpi.status = assetStatus;
    sourceBreakdown.status = {
      source: 'OBSERVATION',
      confidence: 'LOW',
      reason: 'park_assets.status_fallback',
    };
  }

  let registryAuthoritativeSignals = 0;
  let legacyFallbackDisabledSignals = 0;
  for (const d of deprecations) {
    if (d.get('registryAuthoritative')) registryAuthoritativeSignals += 1;
    if (d.get('legacyFallbackDisabled')) legacyFallbackDisabledSignals += 1;
  }

  logger.info(
    {
      phase: 'operations_facts_layer',
      rideAssetId: ctx.assetId,
      registrySignalsUsed: registryUsed,
      legacySignalsUsed: legacyUsed,
      missingSignals,
      warningCount: warnings.length,
      registryAuthoritativeSignals,
      legacyFallbackDisabledSignals,
    },
    'operations-facts registry-first snapshot'
  );

  return {
    rideAssetId: ctx.assetId,
    parkId: ctx.parkId,
    name: plainName,
    slug: plainSlug,
    status: kpi.status,
    queueTime: kpi.queueTime,
    predictedWaitTime: kpi.predictedWaitTime,
    throughputActual: kpi.throughputActual,
    throughputTheoretical: kpi.throughputTheoretical,
    capacityUtilization: kpi.capacityUtilization,
    vehiclesActive: kpi.vehiclesActive,
    staffActual: kpi.staffActual,
    downtimeMinutes: kpi.downtimeMinutes,
    sourceBreakdown,
    warnings,
    registryAuthoritativeSignals,
    legacyFallbackDisabledSignals,
  };
}

/**
 * @param {string} parkId
 */
async function listRideFactsByPark(parkId) {
  const rows = await ParkAsset.findAll({
    where: { parkId },
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: true }],
    order: [['name', 'ASC']],
    limit: 400,
  });
  const out = [];
  for (const row of rows) {
    const code = row.assetType?.code || row.assetType?.get?.('code');
    if (String(code || '').toUpperCase() !== 'RIDE') continue;
    try {
      out.push(await getRideFacts(row.assetId));
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e), assetId: row.assetId },
        'operations-facts skip ride'
      );
    }
  }
  return out;
}

module.exports = {
  getRideFacts,
  listRideFactsByPark,
  kpiKeyForSignalCode,
  pickBetterResolution,
  KPI_FIELDS,
  evaluateRegistryPathUsable,
  shouldBlockLegacyFallback,
};
