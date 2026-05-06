'use strict';

const { Op } = require('sequelize');
const { AppError } = require('../utils/app-error');
const {
  ParkAsset,
  Park,
  AssetType,
  SignalCatalog,
  RideSignalCapability,
  UnsRegistryEntity,
  UnsRegistryTopic,
  SparkplugMetricDefinition,
  REGISTRY_SOURCE_MIRRORED,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const env = require('../config/env');

const LEGACY_PARK_ASSETS = 'park_assets';
const REGISTRY_SOURCE_OPERATOR = 'OPERATOR_CONFIGURED';

const SIGNAL_SOURCES = new Set([
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
]);

const TOPIC_SOURCES = new Set(['MANUAL', 'ADAPTER', 'SIMULATION', 'ML', 'MQTT_EDGE']);

/**
 * @param {string} rideAssetId park_assets.asset_id (UUID)
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

function mergeCapabilityRows(rows) {
  /** @type {Map<string, import('../models').RideSignalCapability>} */
  const bySignal = new Map();
  for (const row of rows) {
    const sid = String(row.get ? row.get('signalCatalogId') : row.signalCatalogId);
    const cur = bySignal.get(sid);
    if (!cur || row.registrySource === REGISTRY_SOURCE_OPERATOR) {
      bySignal.set(sid, row);
    }
  }
  return bySignal;
}

/** @param {import('../models').RideSignalCapability | undefined} capRow */
function capabilitySignalSource(capRow) {
  if (!capRow) return 'NOT_AVAILABLE';
  const cj = capRow.get ? capRow.get('capabilityJson') || {} : {};
  const s = typeof cj.signalSource === 'string' ? cj.signalSource : 'NOT_AVAILABLE';
  return SIGNAL_SOURCES.has(s) ? s : 'NOT_AVAILABLE';
}

function isActivationEligibleUns(signalSource) {
  return typeof signalSource === 'string' && TOPIC_SOURCES.has(signalSource);
}

function isActivationEligibleSparkplug(signalSource) {
  return signalSource === 'MQTT_EDGE';
}

/**
 * PREPARED_OPERATOR UNS registry topics belonging to this ride (payload + optional park guard).
 * @param {{ parkId: string, assetId: string }} ctx
 * @param {import('../models').UnsRegistryTopic[]} topics
 */
function preparedUnsTopicsForRide(ctx, topics) {
  return topics.filter((t) => {
    if (String(t.get('registrySource')) !== REGISTRY_SOURCE_PREPARED_OPERATOR) return false;
    const p = t.get('payloadJson') || {};
    if (String(p.rideAssetId || '') !== String(ctx.assetId)) return false;
    const pid = t.get('parkId');
    if (pid != null && String(pid) !== String(ctx.parkId)) return false;
    return true;
  });
}

/**
 * @param {string} rideAssetId
 */
async function getCapabilitiesForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const catalog = await SignalCatalog.findAll({
    order: [['signalCode', 'ASC']],
    limit: 500,
  });
  const caps = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
    include: [{ model: SignalCatalog, as: 'signal', required: false }],
  });
  const bySignal = mergeCapabilityRows(caps);

  const preparedTopics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
    limit: 500,
  });
  const topicsForAsset = preparedUnsTopicsForRide(ctx, preparedTopics);
  const topicByPath = new Map(topicsForAsset.map((t) => [t.topicPath, t]));

  const preparedSpark = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 300,
  });
  const sparkBySignalKey = new Map();
  for (const s of preparedSpark) {
    const sk = s.get('signalKey') ?? s.get('metricName');
    if (sk == null || String(sk).trim() === '') continue;
    sparkBySignalKey.set(String(sk).trim(), s);
  }

  const signals = catalog.map((cat) => {
    const plain = cat.get({ plain: true });
    const cap = bySignal.get(String(cat.id));
    const cj = cap ? { ...(cap.get('capabilityJson') || {}) } : {};
    const signalSource = typeof cj.signalSource === 'string' && SIGNAL_SOURCES.has(cj.signalSource) ? cj.signalSource : 'NOT_AVAILABLE';
    const valueType = typeof cj.valueType === 'string' ? cj.valueType : 'number';
    const topicPath =
      signalSource !== 'NOT_AVAILABLE' && signalSource !== 'MASTER_DATA'
        ? buildCanonicalUnsTopic({
            parkSlug: ctx.parkSlug,
            entityType: 'ride',
            entitySlug: ctx.assetSlug,
            metric: plain.signalCode,
          })
        : null;
    const unsTopicPreview = topicPath || null;
    const sparkplugMetricPreview =
      signalSource === 'MQTT_EDGE' ? `Sparkplug metric: ${plain.signalCode}` : null;
    const topicRow = topicPath ? topicByPath.get(topicPath) : null;
    const sparkRow = sparkBySignalKey.get(String(plain.signalCode));
    return {
      signalCatalogId: plain.id,
      signalCode: plain.signalCode,
      label: plain.label,
      description: plain.description,
      unit: plain.unit,
      valueType,
      signalSource,
      unsTopicPreview,
      sparkplugMetricPreview,
      capabilityId: cap ? cap.id : null,
      registrySource: cap ? cap.registrySource : null,
      isPreparedTopic: Boolean(topicRow?.isPrepared),
      isActiveTopic: Boolean(topicRow?.isActive),
      topicRowId: topicRow?.id ?? null,
      isPreparedSparkplug: Boolean(sparkRow?.isPrepared),
      isActiveSparkplug: Boolean(sparkRow?.isActive),
      sparkplugRowId: sparkRow?.id ?? null,
    };
  });

  return {
    rideAssetId: ctx.assetId,
    registryEntityId: ctx.registryEntityId,
    parkId: ctx.parkId,
    signals,
  };
}

/**
 * @param {string} rideAssetId
 * @param {{ capabilities: Array<{ signalCatalogId: string, signalSource: string, valueType?: string }> }} body
 */
async function upsertCapabilitiesForRide(rideAssetId, body) {
  const ctx = await resolveRideContext(rideAssetId);
  const now = new Date();
  const incoming = Array.isArray(body.capabilities) ? body.capabilities : [];
  if (!incoming.length) {
    throw new AppError('capabilities array required', 422, { code: 'VALIDATION_ERROR' });
  }

  await RideSignalCapability.destroy({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: REGISTRY_SOURCE_OPERATOR,
    },
  });

  const rows = [];
  for (const item of incoming) {
    if (!item?.signalCatalogId) continue;
    const sig = await SignalCatalog.findByPk(item.signalCatalogId);
    if (!sig) {
      throw new AppError(`Unknown signal_catalog id ${item.signalCatalogId}`, 422, { code: 'UNKNOWN_SIGNAL' });
    }
    const src = String(item.signalSource || '').trim();
    if (!SIGNAL_SOURCES.has(src)) {
      throw new AppError(`Invalid signalSource: ${src}`, 422, { code: 'INVALID_SIGNAL_SOURCE' });
    }
    rows.push({
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      signalCatalogId: item.signalCatalogId,
      registrySource: REGISTRY_SOURCE_OPERATOR,
      capabilityJson: {
        signalSource: src,
        valueType: item.valueType || 'number',
        updatedBy: 'ride_signal_capability.service',
      },
      mirroredAt: now,
    });
  }
  if (rows.length) {
    await RideSignalCapability.bulkCreate(rows);
  }
  return getCapabilitiesForRide(rideAssetId);
}

/**
 * @param {string} rideAssetId
 */
async function prepareUnsTopicsForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const caps = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
  });
  const bySignal = mergeCapabilityRows(caps);
  const now = new Date();
  let created = 0;
  let updated = 0;

  for (const cap of bySignal.values()) {
    const cat = await SignalCatalog.findByPk(cap.signalCatalogId);
    if (!cat) continue;
    const cj = cap.get('capabilityJson') || {};
    const signalSource = typeof cj.signalSource === 'string' ? cj.signalSource : 'NOT_AVAILABLE';
    if (!TOPIC_SOURCES.has(signalSource)) continue;

    const topicPath = buildCanonicalUnsTopic({
      parkSlug: ctx.parkSlug,
      entityType: 'ride',
      entitySlug: ctx.assetSlug,
      metric: cat.signalCode,
    });

    const [row, wasCreated] = await UnsRegistryTopic.findOrCreate({
      where: {
        registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR,
        topicPath,
      },
      defaults: {
        unsNodeLegacyId: null,
        parkId: ctx.parkId,
        registryEntityId: ctx.registryEntityId,
        payloadJson: {
          rideAssetId: String(ctx.assetId),
          signalCatalogId: String(cat.id),
          signalSource,
          phase: 'PREPARED_INACTIVE',
        },
        mirroredAt: now,
        isPrepared: true,
        isActive: false,
      },
    });
    if (!wasCreated) {
      await row.update({
        registryEntityId: ctx.registryEntityId,
        payloadJson: {
          ...(row.get('payloadJson') || {}),
          rideAssetId: String(ctx.assetId),
          signalCatalogId: String(cat.id),
          signalSource,
          phase: 'PREPARED_INACTIVE',
        },
        mirroredAt: now,
        isPrepared: true,
        isActive: false,
      });
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { created, updated, rideAssetId: ctx.assetId };
}

/**
 * @param {string} rideAssetId
 */
async function prepareSparkplugMetricsForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const caps = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
  });
  const bySignal = mergeCapabilityRows(caps);
  let created = 0;
  let updated = 0;
  const edgeNodeId = String(env.sparkplugEdgeNode || 'park_gateway').slice(0, 128);
  const deviceId = String(ctx.assetId).slice(0, 128);

  for (const cap of bySignal.values()) {
    const cj = cap.get('capabilityJson') || {};
    const signalSource = typeof cj.signalSource === 'string' ? cj.signalSource : 'NOT_AVAILABLE';
    if (signalSource !== 'MQTT_EDGE') continue;

    const cat = await SignalCatalog.findByPk(cap.signalCatalogId);
    if (!cat) continue;
    const scopeWhere = preparedSparkplugScopeWhere(ctx, cat.signalCode);
    const [row, wasCreated] = await SparkplugMetricDefinition.findOrCreate({
      where: scopeWhere,
      defaults: {
        metricName: cat.signalCode,
        aliasOf: null,
        dataType: cj.valueType || 'number',
        description: cat.description || `Prepared for ride ${ctx.assetId} (${cat.signalCode})`,
        registryEntityId: ctx.registryEntityId,
        rideAssetId: ctx.assetId,
        parkId: ctx.parkId,
        edgeNodeId,
        deviceId,
        signalKey: scopeWhere.signalKey,
        isPrepared: true,
        isActive: false,
        payloadJson: {
          rideAssetId: String(ctx.assetId),
          signalCatalogId: String(cat.id),
          phase: 'PREPARED_INACTIVE',
        },
      },
    });
    if (!wasCreated) {
      await row.update({
        metricName: cat.signalCode,
        description: cat.description || row.get('description'),
        dataType: cj.valueType || row.get('dataType'),
        registryEntityId: ctx.registryEntityId ?? row.get('registryEntityId'),
        parkId: ctx.parkId,
        rideAssetId: ctx.assetId,
        edgeNodeId,
        deviceId,
        signalKey: scopeWhere.signalKey,
        isPrepared: true,
        isActive: false,
        payloadJson: {
          ...(row.get('payloadJson') || {}),
          rideAssetId: String(ctx.assetId),
          signalCatalogId: String(cat.id),
          phase: 'PREPARED_INACTIVE',
        },
      });
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { created, updated, rideAssetId: ctx.assetId };
}

async function loadMergedCapabilityMap(ctx) {
  const caps = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
  });
  return mergeCapabilityRows(caps);
}

/**
 * @param {string} rideAssetId
 * @param {string | null} [activatedByUserId]
 */
async function activatePreparedUnsTopicsForRide(rideAssetId, activatedByUserId) {
  const ctx = await resolveRideContext(rideAssetId);
  const bySignal = await loadMergedCapabilityMap(ctx);
  const topics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
    limit: 600,
  });
  const mine = preparedUnsTopicsForRide(ctx, topics);

  const now = new Date();
  let activated = 0;
  let skipped = 0;
  for (const row of mine) {
    const p = row.get('payloadJson') || {};
    const sid = p.signalCatalogId != null ? String(p.signalCatalogId) : null;
    if (!sid) {
      skipped += 1;
      continue;
    }
    const cap = bySignal.get(sid);
    const src = capabilitySignalSource(cap);
    if (!isActivationEligibleUns(src)) {
      skipped += 1;
      continue;
    }
    await row.update({
      isPrepared: true,
      isActive: true,
      activatedAt: now,
      activatedBy: activatedByUserId || null,
    });
    activated += 1;
  }
  return { activated, skipped, rideAssetId: ctx.assetId };
}

/**
 * @param {string} rideAssetId
 */
async function deactivatePreparedUnsTopicsForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const topics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
    limit: 600,
  });
  const mine = preparedUnsTopicsForRide(ctx, topics);
  let deactivated = 0;
  for (const row of mine) {
    await row.update({ isActive: false, isPrepared: true });
    deactivated += 1;
  }
  return { deactivated, rideAssetId: ctx.assetId };
}

/**
 * @param {string} rideAssetId
 * @param {string | null} [activatedByUserId]
 */
async function activatePreparedSparkplugMetricsForRide(rideAssetId, activatedByUserId) {
  const ctx = await resolveRideContext(rideAssetId);
  const bySignal = await loadMergedCapabilityMap(ctx);
  const rows = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 300,
  });

  const now = new Date();
  let activated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (String(row.get('rideAssetId') || '') !== String(ctx.assetId)) {
      skipped += 1;
      continue;
    }
    const p = row.get('payloadJson') || {};
    const sid = p.signalCatalogId != null ? String(p.signalCatalogId) : null;
    const cap = sid ? bySignal.get(sid) : null;
    const src = capabilitySignalSource(cap);
    if (!isActivationEligibleSparkplug(src)) {
      skipped += 1;
      continue;
    }
    await row.update({
      isPrepared: true,
      isActive: true,
      activatedAt: now,
      activatedBy: activatedByUserId || null,
    });
    activated += 1;
  }
  return { activated, skipped, rideAssetId: ctx.assetId };
}

/**
 * @param {string} rideAssetId
 */
async function deactivatePreparedSparkplugMetricsForRide(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const rows = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 300,
  });
  let deactivated = 0;
  for (const row of rows) {
    await row.update({ isActive: false, isPrepared: true });
    deactivated += 1;
  }
  return { deactivated, rideAssetId: ctx.assetId };
}

/**
 * Pilot activation summary for one ride (registry mirror only).
 *
 * @param {string} rideAssetId
 */
async function getTopicActivationStatus(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const topics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
    limit: 600,
  });
  const mineTopics = preparedUnsTopicsForRide(ctx, topics);

  const sparks = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 300,
  });

  const preparedUnsTopicCount = mineTopics.filter((t) => Boolean(t.get('isPrepared'))).length;
  const activeUnsTopicCount = mineTopics.filter((t) => Boolean(t.get('isActive'))).length;
  const preparedSparkplugMetricCount = sparks.filter((s) => Boolean(s.get('isPrepared'))).length;
  const activeSparkplugMetricCount = sparks.filter((s) => Boolean(s.get('isActive'))).length;

  const activeCatalogIds = new Set();
  for (const t of mineTopics) {
    if (!t.get('isActive')) continue;
    const sid = (t.get('payloadJson') || {}).signalCatalogId;
    if (sid) activeCatalogIds.add(String(sid));
  }
  for (const s of sparks) {
    if (!s.get('isActive')) continue;
    const sid = (s.get('payloadJson') || {}).signalCatalogId;
    if (sid) activeCatalogIds.add(String(sid));
  }

  const catalogs =
    activeCatalogIds.size > 0
      ? await SignalCatalog.findAll({
          where: { id: [...activeCatalogIds] },
          attributes: ['id', 'signalCode'],
        })
      : [];
  const codeById = new Map(catalogs.map((c) => [String(c.id), c.signalCode]));
  const activeSignalKeys = [...activeCatalogIds].map((id) => codeById.get(id) || id).sort((a, b) => String(a).localeCompare(String(b)));

  /** @type {{ code: string, message: string }[]} */
  const warnings = [];
  if (!ctx.registryEntityId) {
    warnings.push({
      code: 'NO_REGISTRY_ENTITY',
      message:
        'No UNS registry entity for this park asset; registry linkage and Sparkplug scope may be incomplete.',
    });
  }

  for (const s of sparks) {
    if (!s.get('isPrepared')) continue;
    const missing = [];
    if (!s.get('parkId')) missing.push('parkId');
    if (!s.get('rideAssetId')) missing.push('rideAssetId');
    if (!s.get('signalKey')) missing.push('signalKey');
    if (!s.get('edgeNodeId')) missing.push('edgeNodeId');
    if (missing.length) {
      warnings.push({
        code: 'SPARKPLUG_SCOPE_INCOMPLETE',
        message: `Prepared Sparkplug row (${s.get('metricName') || s.id}) missing: ${missing.join(', ')}`,
      });
    }
  }

  const bySignal = await loadMergedCapabilityMap(ctx);
  const activeUnsOnly = mineTopics.filter((t) => t.get('isActive'));
  const warnCatalogIds = [...new Set(activeUnsOnly.map((t) => String((t.get('payloadJson') || {}).signalCatalogId || '')).filter(Boolean))];
  const catsForWarn =
    warnCatalogIds.length > 0
      ? await SignalCatalog.findAll({ where: { id: warnCatalogIds }, attributes: ['id', 'signalCode'] })
      : [];
  const catById = new Map(catsForWarn.map((c) => [String(c.id), c]));

  for (const t of activeUnsOnly) {
    const sid = String((t.get('payloadJson') || {}).signalCatalogId || '');
    if (!sid) continue;
    const src = capabilitySignalSource(bySignal.get(sid));
    if (src !== 'MQTT_EDGE') continue;
    const cat = catById.get(sid);
    const code = cat ? cat.signalCode : sid;
    const spark = sparks.find(
      (sp) =>
        String(sp.get('signalKey') || '') === String(code) || String(sp.get('metricName') || '') === String(code)
    );
    if (spark && !spark.get('isActive')) {
      warnings.push({
        code: 'MQTT_EDGE_UNS_ACTIVE_BUT_SPARKPLUG_INACTIVE',
        message: `Signal ${code}: UNS registry topic is active but Sparkplug metric is not active.`,
      });
    }
  }

  const capsList = await RideSignalCapability.findAll({
    where: {
      parkId: ctx.parkId,
      assetId: ctx.assetId,
      registrySource: { [Op.in]: [REGISTRY_SOURCE_OPERATOR, REGISTRY_SOURCE_MIRRORED] },
    },
    limit: 500,
  });
  if (capsList.length === 0) {
    warnings.push({
      code: 'NO_RIDE_SIGNAL_CAPABILITIES',
      message: 'No ride signal capability rows for this asset; activate after configuring capabilities.',
    });
  }

  return {
    rideAssetId: ctx.assetId,
    parkId: ctx.parkId,
    preparedUnsTopicCount,
    activeUnsTopicCount,
    preparedSparkplugMetricCount,
    activeSparkplugMetricCount,
    activeSignalKeys,
    warnings,
  };
}

/**
 * Partial unique index (PREPARED_OPERATOR): registry_source + park_id + ride_asset_id + signal_key.
 * Exported for unit tests documenting the scope contract.
 *
 * @param {{ parkId: string, assetId: string }} ctx
 * @param {string} signalCode signal_catalog.signal_code
 */
function preparedSparkplugScopeWhere(ctx, signalCode) {
  const signalKey = String(signalCode || '').trim();
  return {
    registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR,
    parkId: ctx.parkId,
    rideAssetId: ctx.assetId,
    signalKey,
  };
}

module.exports = {
  getCapabilitiesForRide,
  upsertCapabilitiesForRide,
  prepareUnsTopicsForRide,
  prepareSparkplugMetricsForRide,
  activatePreparedUnsTopicsForRide,
  deactivatePreparedUnsTopicsForRide,
  activatePreparedSparkplugMetricsForRide,
  deactivatePreparedSparkplugMetricsForRide,
  getTopicActivationStatus,
  preparedSparkplugScopeWhere,
  isActivationEligibleUns,
  isActivationEligibleSparkplug,
  resolveRideContext,
  preparedUnsTopicsForRide,
  loadMergedCapabilityMap,
  capabilitySignalSource,
  REGISTRY_SOURCE_OPERATOR,
  SIGNAL_SOURCES: [...SIGNAL_SOURCES],
  TOPIC_SOURCES: [...TOPIC_SOURCES],
};
