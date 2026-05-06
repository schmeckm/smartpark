'use strict';

const { sequelize } = require('../db/sequelize');
const {
  UnsDiscoveryEvent,
  ParkAsset,
  UnsRegistryEntity,
  AssetType,
} = require('../models');
const { ExternalEntityMappingRepository } = require('../repositories/external-entity-mapping.repository');
const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const env = require('../config/env');

const ADAPTER_SOURCE = 'adapter';

/** Discovery lifecycle classification for adapter-sourced rows (distinct from MQTT spy classifications). */
const ADAPTER_DISCOVERY_CLASSIFICATION = {
  NEW: 'NEW',
  MAPPED: 'MAPPED',
  CONFLICT: 'CONFLICT',
  IGNORED: 'IGNORED',
  ALREADY_KNOWN: 'ALREADY_KNOWN',
};

const PROVIDER_TP = 'THEMEPARKS_WIKI';

const mappingRepo = new ExternalEntityMappingRepository();

function syntheticTopicPath(adapterKey, externalId) {
  return `adapter:${String(adapterKey || 'unknown')}:${String(externalId || '')}`;
}

function domainFromAssetTypeCode(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'RIDE') return 'rides';
  if (c === 'SHOW') return 'shows';
  if (c === 'RESTAURANT') return 'food';
  if (c === 'SHOP') return 'retail';
  if (c === 'PARK' || c === 'ZONE') return 'park';
  return 'facilities';
}

/**
 * @param {{
 *   provider: string,
 *   adapterKey: string,
 *   parkId: string,
 *   externalParkId?: string | null,
 *   entities: Array<Record<string, unknown>>,
 *   metrics?: Array<Record<string, unknown>>,
 *   sourceRunId?: string,
 * }} input
 */
async function analyzeAdapterOutput(input) {
  const provider = String(input.provider || PROVIDER_TP).trim() || PROVIDER_TP;
  const adapterKey = String(input.adapterKey || provider).trim();
  const parkId = String(input.parkId || '').trim();
  const externalParkId = input.externalParkId != null ? String(input.externalParkId) : null;
  const sourceRunId = String(input.sourceRunId || `${adapterKey}:${Date.now()}`).trim();
  const entities = Array.isArray(input.entities) ? input.entities : [];
  const metrics = Array.isArray(input.metrics) ? input.metrics : [];

  if (!parkId) {
    throw new AppError('parkId is required for adapter discovery analysis', 422, { code: 'VALIDATION_ERROR' });
  }

  const results = { created: 0, updated: 0, items: [] };

  for (const raw of entities) {
    const externalId = String(raw.externalId || '').trim();
    if (!externalId) continue;

    const externalParentId = raw.externalParentId != null ? String(raw.externalParentId).trim() || null : null;
    const externalType = String(raw.externalType || 'ENTITY').slice(0, 80);
    const name = String(raw.name || '').trim() || 'Unnamed';
    const suggestedDomain =
      typeof raw.suggestedDomain === 'string' && raw.suggestedDomain.trim()
        ? raw.suggestedDomain.trim()
        : domainFromAssetTypeCode(raw.suggestedEntityType);
    const suggestedEntityType = String(raw.suggestedEntityType || '').slice(0, 80) || null;
    const suggestedSlug = raw.suggestedSlug != null ? String(raw.suggestedSlug).slice(0, 200) : null;
    const rawPayload = raw.rawPayload && typeof raw.rawPayload === 'object' ? raw.rawPayload : {};

    const asset = await ParkAsset.findOne({
      where: { parkId, externalSource: PROVIDER_TP, externalEntityId: externalId },
      attributes: ['assetId', 'name', 'slug', 'externalEntityId'],
    });

    const extMap = await mappingRepo.findByExternalKey({
      provider,
      externalParkId,
      externalEntityId: externalId,
    });

    const reg = await UnsRegistryEntity.findOne({
      where: { externalEntityId: externalId },
      attributes: ['id', 'legacyId', 'entityKind', 'parkId'],
    });

    let classification = ADAPTER_DISCOVERY_CLASSIFICATION.NEW;
    const reasons = [];

    if (asset && extMap && extMap.internalEntityId && String(extMap.internalEntityId) !== String(asset.assetId)) {
      classification = ADAPTER_DISCOVERY_CLASSIFICATION.CONFLICT;
      reasons.push('external_mapping_internal_id_differs_from_park_asset');
    } else if (asset && extMap && extMap.mappingStatus === 'MAPPED' && extMap.internalEntityId) {
      classification = ADAPTER_DISCOVERY_CLASSIFICATION.MAPPED;
    } else if (asset) {
      classification = ADAPTER_DISCOVERY_CLASSIFICATION.ALREADY_KNOWN;
    } else if (extMap && extMap.internalEntityId) {
      classification = ADAPTER_DISCOVERY_CLASSIFICATION.MAPPED;
    }

    const topicPath = syntheticTopicPath(adapterKey, externalId);

    const recent = await UnsDiscoveryEvent.findAll({
      where: { topicPath },
      order: [['createdAt', 'DESC']],
      limit: 8,
    });
    const prior = recent.find((r) => String((r.get('details') || {}).source || '') === ADAPTER_SOURCE) || null;

    const details = {
      source: ADAPTER_SOURCE,
      provider,
      adapterKey,
      internalParkId: parkId,
      externalParkId,
      externalEntityId: externalId,
      externalParentId,
      externalType,
      name,
      suggestedDomain,
      suggestedEntityType,
      suggestedSlug,
      sourceRunId,
      rawPayload,
      metricsSnapshot: metrics.filter((m) => String(m.externalId || '') === externalId).slice(0, 50),
      reviewStatus: prior?.details?.reviewStatus === 'IGNORED' ? 'IGNORED' : 'pending',
      registryEntityId: reg ? reg.id : null,
      assetId: asset ? asset.assetId : null,
      mappingId: extMap ? extMap.id : null,
      reasons,
      designHook: {
        mqttCapabilityEnforcement: Boolean(env.mqttEnforceCapabilities),
        note: 'Adapter discovery row; MQTT live-state enforcement unchanged in Phase 12.',
      },
    };

    if (prior && prior.details?.reviewStatus === 'IGNORED') {
      classification = ADAPTER_DISCOVERY_CLASSIFICATION.IGNORED;
    }

    if (prior) {
      await prior.update({
        classification,
        details: { ...prior.get('details'), ...details, updatedAtRun: new Date().toISOString() },
      });
      results.updated += 1;
      results.items.push({ id: prior.id, classification, externalId });
    } else {
      const row = await UnsDiscoveryEvent.create({
        classification,
        topicPath,
        mqttInboundMessageId: null,
        details,
      });
      results.created += 1;
      results.items.push({ id: row.id, classification, externalId });
    }
  }

  logger.info(
    { provider, parkId, created: results.created, updated: results.updated, sourceRunId },
    'uns-spy adapter discovery analyzeAdapterOutput'
  );

  return results;
}

function assertAdapterEvent(event) {
  const d = (typeof event?.get === 'function' ? event.get('details') : event?.details) || {};
  if (String(d.source || '') !== ADAPTER_SOURCE) {
    throw new AppError('Discovery event is not adapter-sourced', 422, { code: 'NOT_ADAPTER_EVENT' });
  }
}

/**
 * @param {string} eventId
 * @param {object} body
 * @param {{ userId?: string|null }} actor
 */
async function approveAdapterDiscoveryEvent(eventId, body, actor = {}) {
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) throw new AppError('Discovery event not found', 404, { code: 'NOT_FOUND' });
  assertAdapterEvent(event);
  const d = event.get('details') || {};
  if (String(d.reviewStatus || '') === 'APPROVED') {
    throw new AppError('Event already approved', 409, { code: 'ALREADY_APPROVED' });
  }
  if (body.createEntity === true) {
    throw new AppError('createEntity is not supported in Phase 12', 422, { code: 'NOT_SUPPORTED' });
  }

  const mapToExistingEntityId = String(body.mapToExistingEntityId || '').trim();
  if (!mapToExistingEntityId) {
    throw new AppError('mapToExistingEntityId is required', 422, { code: 'VALIDATION_ERROR' });
  }

  const asset = await ParkAsset.findByPk(mapToExistingEntityId, {
    attributes: ['assetId', 'parkId', 'name'],
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'] }],
  });
  if (!asset) throw new AppError('Target park asset not found', 404, { code: 'ASSET_NOT_FOUND' });

  const externalId = String(d.externalEntityId || '').trim();
  if (!externalId) throw new AppError('Event missing externalEntityId', 422, { code: 'INVALID_EVENT' });

  const provider = String(d.provider || PROVIDER_TP);
  const externalParkId = d.externalParkId != null ? String(d.externalParkId) : null;
  const internalType = String(asset.assetType?.code || asset.assetType?.get?.('code') || 'RIDE').slice(0, 80);

  const t = await sequelize.transaction();
  try {
    if (body.createMapping !== false) {
      await mappingRepo.upsertByExternalKey(
        { provider, externalParkId, externalEntityId: externalId },
        {
          provider,
          externalDestinationId: null,
          externalParkId,
          externalEntityId: externalId,
          externalEntityName: String(d.name || externalId).slice(0, 255),
          externalEntityType: String(d.externalType || 'ENTITY').slice(0, 80),
          internalEntityType: internalType,
          internalEntityId: asset.assetId,
          mappingStatus: 'MAPPED',
          confidence: null,
          metadata: {
            source: 'uns_spy_adapter_approval',
            discoveryEventId: event.id,
          },
        },
        { transaction: t }
      );
    }

    const nextDetails = {
      ...d,
      reviewStatus: 'APPROVED',
      approvedAt: new Date().toISOString(),
      approvedByUserId: actor.userId || null,
      mappedEntityId: String(asset.assetId),
    };
    await event.update(
      {
        classification: ADAPTER_DISCOVERY_CLASSIFICATION.MAPPED,
        details: nextDetails,
      },
      { transaction: t }
    );

    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  const templateKey = body.applyTemplateKey != null ? String(body.applyTemplateKey).trim() : '';
  const normalizedTemplate = templateKey === 'RIDE_DEFAULT_V1' ? 'RIDE_DEFAULT' : templateKey || 'RIDE_DEFAULT';
  if (templateKey) {
    const { enrichRideFromTemplate } = require('../modules/adapters/themeparks/themeparks-sync.service');
    const models = require('../models');
    const tr = await sequelize.transaction();
    try {
      await enrichRideFromTemplate(models, asset.assetId, normalizedTemplate, tr);
      await tr.commit();
    } catch (e) {
      await tr.rollback();
      logger.warn({ err: e.message, assetId: asset.assetId }, 'approveAdapterDiscoveryEvent template enrich failed');
    }
  }

  let prepared = { created: 0, updated: 0 };
  try {
    const rideCap = require('./ride-signal-capability.service');
    prepared = await rideCap.prepareUnsTopicsForRide(String(asset.assetId));
  } catch (e) {
    logger.warn({ err: e.message }, 'prepareUnsTopicsForRide after adapter approval failed');
  }

  return {
    eventId: event.id,
    mappedEntityId: String(asset.assetId),
    templateApplied: Boolean(templateKey),
    preparedUnsTopics: prepared,
  };
}

async function rejectAdapterDiscoveryEvent(eventId, actor = {}) {
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) throw new AppError('Discovery event not found', 404, { code: 'NOT_FOUND' });
  assertAdapterEvent(event);
  const d = event.get('details') || {};
  await event.update({
    details: {
      ...d,
      reviewStatus: 'REJECTED',
      rejectedAt: new Date().toISOString(),
      rejectedByUserId: actor.userId || null,
    },
  });
  return { eventId: event.id, reviewStatus: 'REJECTED' };
}

async function ignoreAdapterDiscoveryEvent(eventId, actor = {}) {
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) throw new AppError('Discovery event not found', 404, { code: 'NOT_FOUND' });
  assertAdapterEvent(event);
  const d = event.get('details') || {};
  await event.update({
    classification: ADAPTER_DISCOVERY_CLASSIFICATION.IGNORED,
    details: {
      ...d,
      reviewStatus: 'IGNORED',
      ignoredAt: new Date().toISOString(),
      ignoredByUserId: actor.userId || null,
    },
  });
  return { eventId: event.id, reviewStatus: 'IGNORED' };
}

/**
 * Scan existing ThemeParks-linked park_assets for a park and emit adapter discovery rows.
 * @param {string} internalParkId
 * @param {string} [externalParkId]
 */
async function scanParkAssetsForAdapterDiscovery(internalParkId, externalParkId = null) {
  const models = require('../models');
  const assets = await ParkAsset.findAll({
    where: { parkId: internalParkId, externalSource: PROVIDER_TP },
    attributes: ['assetId', 'name', 'slug', 'externalEntityId', 'externalParentId', 'assetTypeId'],
    limit: 5000,
  });
  const typeRows = await models.AssetType.findAll({ attributes: ['id', 'code'] });
  const typeById = new Map(typeRows.map((r) => [String(r.id), String(r.code || '').toUpperCase()]));

  const entities = [];
  for (const a of assets) {
    const typeCode = typeById.get(String(a.assetTypeId)) || 'FACILITY';
    entities.push({
      externalId: a.externalEntityId,
      externalParentId: a.externalParentId,
      externalType: typeCode,
      name: a.name,
      suggestedDomain: domainFromAssetTypeCode(typeCode),
      suggestedEntityType: typeCode,
      suggestedSlug: a.slug,
      rawPayload: { assetId: a.assetId, source: 'park_assets_scan' },
    });
  }

  return analyzeAdapterOutput({
    provider: PROVIDER_TP,
    adapterKey: 'themeparks_wiki',
    parkId: internalParkId,
    externalParkId,
    entities,
    metrics: [],
    sourceRunId: `manual-scan:${internalParkId}:${Date.now()}`,
  });
}

module.exports = {
  ADAPTER_DISCOVERY_CLASSIFICATION,
  ADAPTER_SOURCE,
  analyzeAdapterOutput,
  approveAdapterDiscoveryEvent,
  rejectAdapterDiscoveryEvent,
  ignoreAdapterDiscoveryEvent,
  scanParkAssetsForAdapterDiscovery,
};
