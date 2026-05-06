'use strict';

const { Op } = require('sequelize');
const env = require('../config/env');
const { sequelize } = require('../db/sequelize');
const {
  Park,
  ParkAsset,
  AssetType,
  SignalCatalog,
  RideSignalCapability,
  UnsRegistryTopic,
  MqttInboundMessage,
  UnsDiscoveryEvent,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
  SPY_CLASSIFICATION,
} = require('../models');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const { buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { capabilitySignalSource } = require('./ride-signal-capability.service');
const { parseSparkplugTopic, resolveCanonicalDomainForLiveRow } = require('./mqtt-sparkplug-live-buffer.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DECISION_RANK = { ALLOW: 0, WARN: 1, BLOCK: 2, SKIP: -1 };

function normalizeMode(m) {
  const v = String(m || 'off').trim().toLowerCase();
  if (v === 'warn_only' || v === 'enforce') return v;
  return 'off';
}

function parseAllowedRideIds() {
  const raw = String(env.mqttCapabilityGuardAllowedRideIds || '').trim();
  if (!raw) return new Set();
  const set = new Set();
  for (const part of raw.split(',')) {
    const id = String(part || '').trim();
    if (UUID_RE.test(id)) set.add(id.toLowerCase());
  }
  return set;
}

function maxDecision(a, b) {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/**
 * Phase T.2: When guard mode is `enforce`, only `ALLOW` may drive TPUNS/Sparkplug live
 * side-effects in the MQTT connector (live buffers, canonical ingestion, UNS latest state,
 * UNS socket events). Raw inbound rows are still recorded first via the topic observer.
 * `warn_only` and `off` do not quarantine here (WARN/BLOCK/SKIP keep prior live behavior).
 * @param {string} mode
 * @param {string} decision
 * @returns {boolean}
 */
function shouldQuarantineLiveMqttPersistence(mode, decision) {
  return normalizeMode(mode) === 'enforce' && String(decision || '') !== 'ALLOW';
}

/**
 * @returns {Promise<{ parkId: string; assetId: string } | null>}
 */
async function resolveRideByParkAndAssetSlug(parkSlug, assetSlug) {
  const ps = String(parkSlug || '').trim();
  const as = String(assetSlug || '').trim();
  if (!ps || !as) return null;
  const park = await Park.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('slug')), ps.toLowerCase()),
    attributes: ['id'],
  });
  if (!park) return null;
  const rideType = await AssetType.findOne({ where: { code: 'ride' }, attributes: ['id'] });
  if (!rideType) return null;
  const asset = await ParkAsset.findOne({
    where: {
      [Op.and]: [
        { parkId: park.id, assetTypeId: rideType.id },
        sequelize.where(sequelize.fn('lower', sequelize.col('slug')), as.toLowerCase()),
      ],
    },
    attributes: ['assetId', 'parkId'],
  });
  if (!asset) return null;
  return { parkId: String(asset.parkId), assetId: String(asset.assetId) };
}

/**
 * @returns {Promise<Array<{ canonicalUnsTopic: string; signalKey: string | null; ride: { parkId: string; assetId: string } | null; empty?: boolean }>>}
 */
async function sparkplugMetricRowsForGuard(topic, bodyStr) {
  const base = parseSparkplugTopic(topic);
  if (!base) return [];
  let obj = null;
  try {
    obj = JSON.parse(bodyStr);
  } catch {
    return [];
  }
  const metrics = Array.isArray(obj?.metrics) ? obj.metrics : [];
  if (!metrics.length) {
    return [{ canonicalUnsTopic: '', signalKey: null, ride: null, empty: true }];
  }
  const entDomain = resolveCanonicalDomainForLiveRow(base);
  const ride = await resolveRideByParkAndAssetSlug(base.groupId, base.deviceId);
  const out = [];
  for (const m of metrics) {
    const name = m?.name != null ? String(m.name) : null;
    const canonicalUnsTopic =
      base.groupId && base.deviceId && name
        ? buildCanonicalUnsTopic({
            parkSlug: String(base.groupId),
            entityType: entDomain,
            entitySlug: String(base.deviceId),
            metric: name,
          })
        : '';
    out.push({ canonicalUnsTopic, signalKey: name, ride });
  }
  return out;
}

/**
 * @param {string} topicPath
 * @param {string} rideAssetId
 * @param {string} signalKey
 * @param {string} parkId
 */
async function evaluateRegistryAndCapability(topicPath, rideAssetId, signalKey, parkId) {
  const path = String(topicPath || '').trim();
  const sig = String(signalKey || '').trim();
  if (!path || !sig) {
    return { ok: false, reason: 'missing_topic_or_signal' };
  }

  const reg = await UnsRegistryTopic.findOne({
    where: {
      topicPath: path,
      registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR,
      isActive: true,
    },
    attributes: ['id', 'parkId'],
  });
  if (!reg) {
    return { ok: false, reason: 'no_active_prepared_registry_topic' };
  }
  if (reg.parkId && parkId && String(reg.parkId) !== String(parkId)) {
    return { ok: false, reason: 'registry_topic_park_mismatch' };
  }

  const catalog = await SignalCatalog.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('signal_code')), sig.toLowerCase()),
    attributes: ['id'],
  });
  if (!catalog) {
    return { ok: false, reason: 'signal_not_in_catalog', registryTopicId: reg.id };
  }

  const cap = await RideSignalCapability.findOne({
    where: {
      parkId,
      assetId: rideAssetId,
      signalCatalogId: catalog.id,
      registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR,
    },
  });
  const src = capabilitySignalSource(cap);
  if (src === 'NOT_AVAILABLE') {
    return { ok: false, reason: 'capability_not_available', registryTopicId: reg.id, capabilitySource: src };
  }
  if (src !== 'MQTT_EDGE') {
    return {
      ok: false,
      reason: 'capability_source_not_mqtt_edge',
      registryTopicId: reg.id,
      capabilitySource: src,
    };
  }

  return { ok: true, reason: 'allowed', registryTopicId: reg.id, capabilitySource: src };
}

/**
 * @param {'ok'|'issue'} internal
 * @param {string} mode
 */
function decisionFromInternal(internal, mode) {
  if (internal === 'ok') return 'ALLOW';
  if (mode === 'warn_only') return 'WARN';
  return 'BLOCK';
}

/**
 * @param {string} mode
 * @param {Set<string>} allowedSet
 */
async function decisionForCanonicalRow(mode, allowedSet, canonicalUnsTopic, ride, signalKey) {
  if (!canonicalUnsTopic || !signalKey) {
    return { decision: decisionFromInternal('issue', mode), evaluation: { ok: false, reason: 'missing_topic_or_signal' } };
  }
  if (!ride) {
    return { decision: decisionFromInternal('issue', mode), evaluation: { ok: false, reason: 'unresolved_ride' } };
  }
  if (allowedSet.size && !allowedSet.has(ride.assetId.toLowerCase())) {
    return {
      decision: 'ALLOW',
      evaluation: { ok: true, reason: 'pilot_allow_list_excluded' },
    };
  }
  const evaluation = await evaluateRegistryAndCapability(canonicalUnsTopic, ride.assetId, signalKey, ride.parkId);
  return {
    decision: decisionFromInternal(evaluation.ok ? 'ok' : 'issue', mode),
    evaluation,
  };
}

/**
 * @param {{ topic: string; payloadJson?: object|null; receivedAt?: string }} params
 */
async function evaluateInboundMqttCapability(params) {
  const mode = normalizeMode(env.mqttCapabilityGuardMode);
  const topic = String(params.topic || '');
  const receivedAt = params.receivedAt || new Date().toISOString();
  const baseOut = {
    mode,
    topic,
    rideAssetId: null,
    signalKey: null,
    registryTopicId: null,
    capabilitySource: null,
    reason: null,
    details: { receivedAt },
  };

  if (mode === 'off') {
    return { ...baseOut, decision: 'SKIP', reason: 'guard_off' };
  }

  if (!topic.startsWith('tpuns/') && !topic.startsWith('spBv1.0/')) {
    return { ...baseOut, decision: 'SKIP', reason: 'topic_not_in_scope' };
  }

  const allowedSet = parseAllowedRideIds();

  try {
    if (topic.startsWith('tpuns/')) {
      let parsed;
      try {
        parsed = parseTopic(topic);
      } catch (e) {
        return {
          ...baseOut,
          decision: decisionFromInternal('issue', mode),
          reason: 'invalid_tpuns_topic',
          details: { ...baseOut.details, error: e.message },
        };
      }
      const ride = await resolveRideByParkAndAssetSlug(parsed.parkSlug, parsed.assetSlug);
      baseOut.rideAssetId = ride ? ride.assetId : null;
      baseOut.signalKey = parsed.metric;
      if (ride && allowedSet.size && !allowedSet.has(ride.assetId.toLowerCase())) {
        return {
          ...baseOut,
          decision: 'ALLOW',
          reason: 'pilot_allow_list_excluded',
          details: { ...baseOut.details, pilot: true },
        };
      }
      const { decision, evaluation } = await decisionForCanonicalRow(
        mode,
        allowedSet,
        topic,
        ride,
        parsed.metric
      );
      baseOut.registryTopicId = evaluation.registryTopicId ? String(evaluation.registryTopicId) : null;
      baseOut.capabilitySource = evaluation.capabilitySource || null;
      baseOut.reason = evaluation.ok ? 'allowed' : evaluation.reason;
      baseOut.details = { ...baseOut.details, parsed, evaluation };
      return { ...baseOut, decision };
    }

    const bodyStr =
      params.payloadJson != null && typeof params.payloadJson === 'object'
        ? JSON.stringify(params.payloadJson)
        : String(params.payloadJson ?? '');
    const metricRows = await sparkplugMetricRowsForGuard(topic, bodyStr);
    if (!metricRows.length) {
      return {
        ...baseOut,
        decision: decisionFromInternal('issue', mode),
        reason: 'sparkplug_unparsed',
      };
    }

    let worst = 'ALLOW';
    const perMetric = [];
    for (const row of metricRows) {
      if (row.empty) {
        worst = maxDecision(worst, decisionFromInternal('issue', mode));
        perMetric.push({ reason: 'no_metrics' });
        // eslint-disable-next-line no-continue
        continue;
      }
      const { decision, evaluation } = await decisionForCanonicalRow(
        mode,
        allowedSet,
        row.canonicalUnsTopic,
        row.ride,
        row.signalKey
      );
      worst = maxDecision(worst, decision);
      perMetric.push({
        canonicalUnsTopic: row.canonicalUnsTopic,
        signalKey: row.signalKey,
        decision,
        evaluation,
      });
      if (!baseOut.rideAssetId && row.ride) baseOut.rideAssetId = row.ride.assetId;
      if (!baseOut.signalKey && row.signalKey) baseOut.signalKey = row.signalKey;
      if (!baseOut.registryTopicId && evaluation.registryTopicId) {
        baseOut.registryTopicId = String(evaluation.registryTopicId);
      }
      if (!baseOut.capabilitySource && evaluation.capabilitySource) {
        baseOut.capabilitySource = evaluation.capabilitySource;
      }
    }
    const firstBad = perMetric.find((p) => p.evaluation && p.evaluation.ok === false);
    baseOut.reason = worst === 'ALLOW' ? 'allowed' : firstBad?.evaluation?.reason || 'sparkplug_metric_issue';
    baseOut.details = { ...baseOut.details, perMetric };
    return { ...baseOut, decision: worst };
  } catch (e) {
    return {
      ...baseOut,
      decision: 'SKIP',
      reason: 'guard_internal_error',
      details: { ...baseOut.details, error: e.message },
    };
  }
}

const MS_24H = 24 * 60 * 60 * 1000;

async function getCapabilityGuardStatus() {
  const mode = normalizeMode(env.mqttCapabilityGuardMode);
  const allowed = parseAllowedRideIds();
  const since = new Date(Date.now() - MS_24H);
  const baseWhere = { createdAt: { [Op.gte]: since } };

  const [blockedLast24h, warnedLast24h, allowedLast24h] = await Promise.all([
    MqttInboundMessage.count({
      where: { ...baseWhere, capabilityGuardDecision: 'BLOCK' },
    }),
    MqttInboundMessage.count({
      where: { ...baseWhere, capabilityGuardDecision: 'WARN' },
    }),
    MqttInboundMessage.count({
      where: { ...baseWhere, capabilityGuardDecision: 'ALLOW' },
    }),
  ]);

  const lastBlocked = await MqttInboundMessage.findOne({
    where: { capabilityGuardDecision: 'BLOCK' },
    order: [['createdAt', 'DESC']],
    attributes: ['createdAt'],
  });

  return {
    mode,
    allowedRideCount: allowed.size,
    lastBlockedAt: lastBlocked?.createdAt ? lastBlocked.createdAt.toISOString() : null,
    blockedLast24h,
    warnedLast24h,
    allowedLast24h,
  };
}

/**
 * @param {import('../models').MqttInboundMessage} mqttRow
 * @param {Record<string, unknown>} guardResult
 */
async function recordCapabilityGuardBlockDiscovery(mqttRow, guardResult) {
  await UnsDiscoveryEvent.create({
    classification: SPY_CLASSIFICATION.CAPABILITY_GUARD_BLOCK,
    topicPath: String(mqttRow.topic),
    mqttInboundMessageId: mqttRow.id,
    details: {
      source: 'mqtt_capability_guard',
      reason: guardResult.reason,
      mode: guardResult.mode,
      decision: guardResult.decision,
      rideAssetId: guardResult.rideAssetId,
      signalKey: guardResult.signalKey,
      registryTopicId: guardResult.registryTopicId,
      capabilitySource: guardResult.capabilitySource,
      guardDetails: guardResult.details || {},
    },
  });
}

module.exports = {
  evaluateInboundMqttCapability,
  getCapabilityGuardStatus,
  recordCapabilityGuardBlockDiscovery,
  normalizeMode,
  parseAllowedRideIds,
  shouldQuarantineLiveMqttPersistence,
};
