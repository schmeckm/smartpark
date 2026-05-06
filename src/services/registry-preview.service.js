'use strict';

/**
 * Phase 7: dry-run preview of what an active-registry publisher *would* emit vs legacy paths.
 * Read-only: no MQTT publish, no uns_nodes / uns_latest_states writes, no ThemeParks or dashboard changes.
 *
 * Value resolution order (per topic): uns_latest_states (live TPUNS buffer persistence) → canonical_inbound_messages → ride_feature_snapshots_5m.
 */

const { Op } = require('sequelize');
const { AppError } = require('../utils/app-error');
const {
  ParkAsset,
  Park,
  AssetType,
  UnsRegistryEntity,
  UnsRegistryTopic,
  SignalCatalog,
  UnsLatestState,
  CanonicalInboundMessage,
  RideFeatureSnapshot,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { buildCanonicalUnsTopic, slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { getSnapshot } = require('./mqtt-sparkplug-live-buffer.service');
const env = require('../config/env');

const LEGACY_PARK_ASSETS = 'park_assets';

/** @typedef {'MQTT_EDGE' | 'ADAPTER' | 'ML' | 'MANUAL'} PreviewCapabilitySource */

/**
 * @param {string} rideAssetId
 */
async function resolveRideContext(rideAssetId) {
  const id = String(rideAssetId || '').trim();
  const asset = await ParkAsset.findByPk(id, {
    include: [
      { model: Park, as: 'park', attributes: ['id', 'slug', 'name'] },
      { model: AssetType, as: 'assetType', attributes: ['code'] },
    ],
  });
  if (!asset) {
    throw new AppError('Ride asset not found', 404, { code: 'RIDE_ASSET_NOT_FOUND' });
  }
  const typeCode = asset.assetType?.code || asset.assetType?.get?.('code');
  if (String(typeCode || '').toUpperCase() !== 'RIDE') {
    throw new AppError('Signal capabilities are only supported for RIDE assets', 422, { code: 'NOT_A_RIDE_ASSET' });
  }
  const park = asset.park;
  if (!park) {
    throw new AppError('Park not loaded for asset', 500, { code: 'PARK_MISSING' });
  }
  const registryEntity = await UnsRegistryEntity.findOne({
    where: {
      legacyTable: LEGACY_PARK_ASSETS,
      legacyId: String(asset.assetId),
      entityKind: 'PLATFORM_ASSET',
    },
  });
  return {
    asset,
    park,
    registryEntityId: registryEntity ? registryEntity.id : null,
    parkSlug: park.slug || park.name || String(park.id),
    assetSlug: asset.slug,
    parkId: asset.parkId,
    assetId: asset.assetId,
  };
}

/**
 * @param {{ parkId: string; assetId: string }} ctx
 * @param {import('../models').UnsRegistryTopic[]} topics
 */
function activePreparedTopicsForRide(ctx, topics) {
  return topics.filter((t) => {
    if (String(t.get('registrySource')) !== REGISTRY_SOURCE_PREPARED_OPERATOR) return false;
    if (!t.get('isActive')) return false;
    const p = t.get('payloadJson') || {};
    if (String(p.rideAssetId || '') !== String(ctx.assetId)) return false;
    const pid = t.get('parkId');
    if (pid != null && String(pid) !== String(ctx.parkId)) return false;
    return true;
  });
}

/**
 * @param {Record<string, unknown>} payloadJson
 * @returns {unknown}
 */
function extractScalarFromTpunsPayload(payloadJson) {
  if (!payloadJson || typeof payloadJson !== 'object') return null;
  if ('value' in payloadJson && payloadJson.value != null) return payloadJson.value;
  if ('queue_time' in payloadJson && payloadJson.queue_time != null) return payloadJson.queue_time;
  if ('waitTime' in payloadJson && payloadJson.waitTime != null) return payloadJson.waitTime;
  const data = payloadJson.data;
  if (data && typeof data === 'object' && 'value' in data) return data.value;
  return null;
}

/**
 * @param {unknown} v
 */
function normalizeComparable(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function valuesEqual(a, b) {
  const na = normalizeComparable(a);
  const nb = normalizeComparable(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  if (typeof na === 'number' && typeof nb === 'number') return Math.abs(na - nb) < 1e-6;
  return String(na) === String(nb);
}

/**
 * @param {string} raw
 * @returns {PreviewCapabilitySource}
 */
function mapPayloadSourceToPreviewSource(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'MQTT_EDGE') return 'MQTT_EDGE';
  if (s === 'ADAPTER') return 'ADAPTER';
  if (s === 'ML') return 'ML';
  if (s === 'SIMULATION') return 'MANUAL';
  return 'MANUAL';
}

/**
 * uns_latest_states (TPUNS live persistence) — preferred live read.
 * @param {string} topicPath
 */
async function readFromUnsLatestState(topicPath) {
  const row = await UnsLatestState.findOne({ where: { topicPath: String(topicPath) } });
  if (!row) return { value: null, sourceLayer: 'uns_latest_states' };
  const pj = row.get('payloadJson') || {};
  const v = extractScalarFromTpunsPayload(pj);
  return { value: v != null ? v : pj, sourceLayer: 'uns_latest_states' };
}

/**
 * @param {string} externalEntityId
 * @param {string} signalKey
 */
async function readFromCanonicalMessages(externalEntityId, signalKey) {
  if (!externalEntityId) return { value: null, sourceLayer: 'canonical_inbound_messages' };
  const sk = String(signalKey || '').toLowerCase();
  const wantStatus = sk === 'status' || sk === 'status_code' || sk === 'entity_status';
  const messageType = wantStatus ? 'ENTITY_STATUS_UPDATED' : 'WAIT_TIME_UPDATED';
  const row = await CanonicalInboundMessage.findOne({
    where: {
      externalEntityId: String(externalEntityId),
      status: 'APPLIED',
      messageType,
    },
    order: [['occurredAt', 'DESC']],
  });
  if (!row) return { value: null, sourceLayer: 'canonical_inbound_messages' };
  const payload = row.get('payload') || {};
  const v = wantStatus ? payload.status : payload.waitTime;
  return { value: v != null ? v : null, sourceLayer: 'canonical_inbound_messages' };
}

/**
 * @param {string} internalAssetId
 * @param {string} signalKey
 */
async function readFromRideFeatureSnapshot(internalAssetId, signalKey) {
  const snap = await RideFeatureSnapshot.findOne({
    where: { internalAssetId },
    order: [['snapshotAt', 'DESC']],
  });
  if (!snap) return { value: null, sourceLayer: 'ride_feature_snapshots_5m' };
  const plain = snap.get({ plain: true });
  const sk = String(signalKey || '').toLowerCase();
  /** @type {Record<string, unknown>} */
  const map = {
    queue_time: plain.currentWaitTimeMin ?? plain.waitTime,
    wait_time: plain.waitTime,
    wait: plain.waitTime,
    status: plain.status,
    is_open: plain.isOpen,
    theoretical_capacity_pph: plain.theoreticalCapacityPph,
  };
  if (map[sk] != null) return { value: map[sk], sourceLayer: 'ride_feature_snapshots_5m' };
  const extras = plain.xFeaturesExtras && typeof plain.xFeaturesExtras === 'object' ? plain.xFeaturesExtras : {};
  if (extras[signalKey] != null) return { value: extras[signalKey], sourceLayer: 'ride_feature_snapshots_5m' };
  return { value: null, sourceLayer: 'ride_feature_snapshots_5m' };
}

/**
 * @param {string} topicPath
 * @param {string | null} externalEntityId
 * @param {string} internalAssetId
 * @param {string} signalKey
 */
async function readValueWithFallback(topicPath, externalEntityId, internalAssetId, signalKey) {
  const a = await readFromUnsLatestState(topicPath);
  if (a.value != null) return { ...a, used: 'uns_latest_states' };

  const b = await readFromCanonicalMessages(externalEntityId, signalKey);
  if (b.value != null) return { ...b, used: 'canonical_inbound_messages' };

  const c = await readFromRideFeatureSnapshot(internalAssetId, signalKey);
  return { ...c, used: c.value != null ? 'ride_feature_snapshots_5m' : 'none' };
}

/**
 * @param {unknown} q
 */
function normalizePreviewQuality(q) {
  const s = String(q || '').trim().toUpperCase();
  if (['GOOD', 'BAD', 'UNCERTAIN', 'ESTIMATED', 'SIMULATED'].includes(s)) return s;
  return 'GOOD';
}

/**
 * @param {Record<string, unknown>} pj
 * @param {string} signalKey
 */
function pickUnitFromPayload(pj, signalKey) {
  if (pj && typeof pj === 'object' && pj.unit != null) return String(pj.unit);
  const sk = String(signalKey || '').toLowerCase();
  if (sk.includes('wait') || sk.includes('queue_time')) return 'min';
  return null;
}

/**
 * Read-only latest scalar + metadata for Add-on Board widget preview.
 * Order: `uns_latest_states` → `canonical_inbound_messages` → `ride_feature_snapshots_5m` (same as {@link readValueWithFallback}).
 * Does not read raw MQTT / Sparkplug live buffers.
 *
 * @param {{ topicPath: string; externalEntityId: string|null; internalAssetId: string; signalKey: string }} p
 * @returns {Promise<{ value: unknown; unit: string|null; ts: Date; quality: string; source: string } | null>}
 */
async function readAddonBoardWidgetLatestValue(p) {
  const { topicPath, externalEntityId, internalAssetId, signalKey } = p;
  const tp = String(topicPath || '');
  const unsRow = await UnsLatestState.findOne({ where: { topicPath: tp } });
  if (unsRow) {
    const pj = unsRow.get('payloadJson') || {};
    const v = extractScalarFromTpunsPayload(pj);
    if (v != null) {
      return {
        value: v,
        unit: pickUnitFromPayload(pj, signalKey),
        ts: /** @type {Date} */ (unsRow.get('eventTime')),
        quality: normalizePreviewQuality(unsRow.get('quality')),
        source: 'uns_live_state',
      };
    }
  }

  const ext = externalEntityId ? String(externalEntityId) : '';
  if (ext) {
    const sk = String(signalKey || '').toLowerCase();
    const wantStatus = sk === 'status' || sk === 'status_code' || sk === 'entity_status';
    const messageType = wantStatus ? 'ENTITY_STATUS_UPDATED' : 'WAIT_TIME_UPDATED';
    const canonRow = await CanonicalInboundMessage.findOne({
      where: {
        externalEntityId: ext,
        status: 'APPLIED',
        messageType,
      },
      order: [['occurredAt', 'DESC']],
    });
    if (canonRow) {
      const payload = canonRow.get('payload') || {};
      const v = wantStatus ? payload.status : payload.waitTime;
      if (v != null) {
        const p = /** @type {Record<string, unknown>} */ (payload);
        return {
          value: v,
          unit: pickUnitFromPayload(p, signalKey) || (!wantStatus ? 'min' : null),
          ts: /** @type {Date} */ (canonRow.get('occurredAt')),
          quality: 'GOOD',
          source: 'canonical_inbound',
        };
      }
    }
  }

  const snap = await RideFeatureSnapshot.findOne({
    where: { internalAssetId: String(internalAssetId) },
    order: [['snapshotAt', 'DESC']],
  });
  if (!snap) return null;
  const plain = snap.get({ plain: true });
  const sk = String(signalKey || '').toLowerCase();
  /** @type {Record<string, unknown>} */
  const map = {
    queue_time: plain.currentWaitTimeMin ?? plain.waitTime,
    wait_time: plain.waitTime,
    wait: plain.waitTime,
    status: plain.status,
    is_open: plain.isOpen,
    theoretical_capacity_pph: plain.theoreticalCapacityPph,
  };
  let val = map[sk] != null ? map[sk] : null;
  const extras = plain.xFeaturesExtras && typeof plain.xFeaturesExtras === 'object' ? plain.xFeaturesExtras : {};
  if (val == null && extras[signalKey] != null) val = extras[signalKey];
  if (val == null) return null;
  const unitHint = sk.includes('wait') || sk.includes('queue_time') ? 'min' : null;
  return {
    value: val,
    unit: unitHint,
    ts: /** @type {Date} */ (snap.get('snapshotAt')),
    quality: 'GOOD',
    source: 'ride_feature_snapshot',
  };
}

/**
 * @param {{ parkSlug: string; assetSlug: string }} ctx
 * @param {string} signalKey
 */
function readSparkplugBufferPreview(ctx, signalKey) {
  const groupId = env.sparkplugGroupId || slugifyName(ctx.parkSlug);
  const rows = getSnapshot({ groupId, limit: 1200 });
  const dev = slugifyName(ctx.assetSlug);
  const met = String(signalKey || '');
  const hit = rows.find(
    (r) => String(r.deviceId || '').toLowerCase() === dev && String(r.metric || '') === met
  );
  if (!hit) return { value: null, topic: null };
  return { value: hit.value != null ? hit.value : hit, topic: hit.sparkplugTopic || null };
}

/**
 * @param {string} rideAssetId
 */
async function getRegistryPreviewForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const topics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, isActive: true },
    limit: 400,
  });
  const mine = activePreparedTopicsForRide(ctx, topics);
  const catalogIds = [...new Set(mine.map((t) => String((t.get('payloadJson') || {}).signalCatalogId || '')).filter(Boolean))];
  const catalogs =
    catalogIds.length > 0
      ? await SignalCatalog.findAll({ where: { id: catalogIds }, attributes: ['id', 'signalCode', 'unit'] })
      : [];
  const catById = new Map(catalogs.map((c) => [String(c.id), c.get({ plain: true })]));

  const externalEntityId = ctx.asset.get('externalEntityId') || null;
  const out = [];
  for (const row of mine) {
    const topicPath = String(row.get('topicPath') || '');
    const p = row.get('payloadJson') || {};
    const sid = p.signalCatalogId != null ? String(p.signalCatalogId) : null;
    const cat = sid ? catById.get(sid) : null;
    const signalKey = cat ? cat.signalCode : topicPath.split('/').filter(Boolean).pop() || 'unknown';
    const unit = cat?.unit != null ? String(cat.unit) : null;
    const srcRaw = typeof p.signalSource === 'string' ? p.signalSource : 'MANUAL';
    const source = mapPayloadSourceToPreviewSource(srcRaw);

    const { value, used } = await readValueWithFallback(topicPath, externalEntityId, String(ctx.assetId), signalKey);

    out.push({
      topic: topicPath,
      signalKey: String(signalKey),
      value,
      unit,
      source,
      valueResolution: used,
    });
  }
  return { rideAssetId: ctx.assetId, parkId: ctx.parkId, items: out };
}

/**
 * @param {string} rideAssetId
 */
async function getLegacyOutputForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const topics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, isActive: true },
    limit: 400,
  });
  const mine = activePreparedTopicsForRide(ctx, topics);
  const catalogIds = [...new Set(mine.map((t) => String((t.get('payloadJson') || {}).signalCatalogId || '')).filter(Boolean))];
  const catalogs =
    catalogIds.length > 0
      ? await SignalCatalog.findAll({ where: { id: catalogIds }, attributes: ['id', 'signalCode', 'unit'] })
      : [];
  const catById = new Map(catalogs.map((c) => [String(c.id), c.get({ plain: true })]));

  const externalEntityId = ctx.asset.get('externalEntityId') || null;
  const parkSlug = ctx.parkSlug;
  const assetSlug = ctx.assetSlug;
  const pSlug = slugifyName(parkSlug);
  const aSlug = slugifyName(assetSlug);

  const items = [];
  for (const row of mine) {
    const p = row.get('payloadJson') || {};
    const sid = p.signalCatalogId != null ? String(p.signalCatalogId) : null;
    const cat = sid ? catById.get(sid) : null;
    const signalKey = cat ? cat.signalCode : String(row.get('topicPath') || '').split('/').filter(Boolean).pop() || 'unknown';
    const tpunsTopic =
      cat != null
        ? buildCanonicalUnsTopic({
            parkSlug,
            entityType: 'ride',
            entitySlug: assetSlug,
            metric: cat.signalCode,
          })
        : String(row.get('topicPath') || '');

    const { value: tpunsVal, used: tpunsUsed } = await readValueWithFallback(
      tpunsTopic,
      externalEntityId,
      String(ctx.assetId),
      String(signalKey)
    );

    items.push({
      channel: 'tpuns',
      topic: tpunsTopic,
      signalKey: String(signalKey),
      value: tpunsVal,
      unit: cat?.unit != null ? String(cat.unit) : null,
      source: 'legacy_tpuns',
      valueResolution: tpunsUsed,
    });

    const smartparkBase = `smartpark/${pSlug}/assets/${aSlug}`;
    const skLower = String(signalKey).toLowerCase();
    let smartTopic = `${smartparkBase}/telemetry`;
    if (skLower.includes('queue') || skLower === 'wait_time' || skLower === 'wait') smartTopic = `${smartparkBase}/queue_time`;
    else if (skLower.includes('status')) smartTopic = `${smartparkBase}/status`;
    else if (skLower.includes('health') || skLower.includes('oee')) smartTopic = `${smartparkBase}/health`;

    const spState = await readFromUnsLatestState(smartTopic);
    items.push({
      channel: 'smartpark',
      topic: smartTopic,
      signalKey: String(signalKey),
      value: spState.value,
      unit: cat?.unit != null ? String(cat.unit) : null,
      source: 'legacy_smartpark',
      valueResolution: spState.value != null ? 'uns_latest_states' : 'none',
    });

    const buf = readSparkplugBufferPreview(ctx, String(signalKey));
    items.push({
      channel: 'sparkplug_buffer',
      topic: buf.topic || `spBv1.0/${env.sparkplugGroupId || pSlug}/DDATA/${env.sparkplugEdgeNode || 'park_gateway'}/${aSlug}`,
      signalKey: String(signalKey),
      value: buf.value,
      unit: cat?.unit != null ? String(cat.unit) : null,
      source: 'legacy_sparkplug_buffer',
      valueResolution: buf.value != null ? 'mqtt_sparkplug_live_buffer' : 'none',
    });
  }

  return { rideAssetId: ctx.assetId, parkId: ctx.parkId, items };
}

/**
 * @param {string} rideAssetId
 */
async function compareRegistryVsLegacy(rideAssetId) {
  const reg = await getRegistryPreviewForRide(rideAssetId);
  const leg = await getLegacyOutputForRide(rideAssetId);

  /** @type {Map<string, { topic: string; value: unknown; channel: string }>} */
  const legacyBySignal = new Map();
  for (const it of leg.items) {
    if (it.channel !== 'tpuns') continue;
    const k = String(it.signalKey);
    if (!legacyBySignal.has(k)) legacyBySignal.set(k, { topic: it.topic, value: it.value, channel: it.channel });
  }

  const topics = [];
  let matched = 0;
  let mismatched = 0;
  let missingLegacy = 0;
  let missingRegistry = 0;

  for (const r of reg.items) {
    const legRow = legacyBySignal.get(String(r.signalKey));
    const registryValue = r.value;
    const legacyValue = legRow ? legRow.value : null;

    let difference = false;
    /** @type {'VALUE_DIFF' | 'MISSING_IN_REGISTRY' | 'MISSING_IN_LEGACY' | 'TYPE_DIFF' | 'MATCH'} */
    let reason = 'MATCH';

    if (registryValue == null && legacyValue == null) {
      reason = 'MATCH';
      matched += 1;
    } else if (registryValue == null && legacyValue != null) {
      difference = true;
      reason = 'MISSING_IN_REGISTRY';
      missingRegistry += 1;
    } else if (registryValue != null && legacyValue == null) {
      difference = true;
      reason = 'MISSING_IN_LEGACY';
      missingLegacy += 1;
    } else if (!valuesEqual(registryValue, legacyValue)) {
      difference = true;
      reason = typeof registryValue !== typeof legacyValue ? 'TYPE_DIFF' : 'VALUE_DIFF';
      mismatched += 1;
    } else {
      matched += 1;
    }

    topics.push({
      topic: r.topic,
      signalKey: r.signalKey,
      registryValue,
      legacyValue,
      legacyTopic: legRow?.topic || null,
      difference,
      reason,
    });
  }

  const total = topics.length;
  return {
    rideAssetId: reg.rideAssetId,
    parkId: reg.parkId,
    topics,
    summary: {
      total,
      matched,
      mismatched,
      missingRegistry,
      missingLegacy,
    },
  };
}

module.exports = {
  getRegistryPreviewForRide,
  getLegacyOutputForRide,
  compareRegistryVsLegacy,
  readAddonBoardWidgetLatestValue,
};
