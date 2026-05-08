const { ThemeParksWikiAdapter } = require('../../../integrations/adapter-packages/themeparks_wiki/client');
const { slugifyName } = require('../../uns/uns-topic-generator.service');
const { AssetsRepository } = require('../../assets/assets.repository');
const {
  EXTERNAL_SOURCE,
  mapExternalEntityType,
  mapLiveStatusToAssetStatus,
  extractCommonAssetFields,
} = require('./themeparks-mapper');
const { publishMQTTState } = require('./asset-mqtt.publisher');
const { logger } = require('../../../utils/logger');
const env = require('../../../config/env');

function toArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.data)) return input.data;
  if (Array.isArray(input.children)) return input.children;
  if (Array.isArray(input.liveData)) return input.liveData;
  return [];
}

/**
 * Depth-limited walk of ThemeParks /entity/{id}/children (PARK/DESTINATION recurse).
 */
async function collectEntities(adapter, rootId, maxDepth = 6) {
  const out = [];
  const seen = new Set();

  async function walk(id, depth) {
    if (depth > maxDepth || seen.has(id)) return;
    seen.add(id);
    let raw;
    try {
      raw = await adapter.fetchEntities(id);
    } catch (e) {
      logger.warn({ err: e.message, id }, 'themeparks fetchEntities failed');
      return;
    }
    const arr = toArray(raw);
    for (const e of arr) {
      out.push(e);
      const t = String(e.entityType || '').toUpperCase();
      if (['PARK', 'DESTINATION'].includes(t) && e.id && String(e.id) !== String(id)) {
        await walk(String(e.id), depth + 1);
      }
    }
  }

  await walk(String(rootId), 0);
  return out;
}

function mapExternalEntity(raw) {
  const id = String(raw.id || '');
  const name = raw.name || 'Unnamed';
  const slug = slugifyName(raw.slug || name || id).slice(0, 128);
  const loc = raw.location && typeof raw.location === 'object' ? raw.location : null;
  const common = extractCommonAssetFields(raw);
  return {
    externalEntityId: id,
    externalParentId: raw.parentId != null && String(raw.parentId).trim() !== '' ? String(raw.parentId) : null,
    name,
    slug,
    latitude: loc && typeof loc.latitude === 'number' ? loc.latitude : null,
    longitude: loc && typeof loc.longitude === 'number' ? loc.longitude : null,
    assetTypeCode: mapExternalEntityType(raw.entityType),
    rawEntityType: String(raw.entityType || ''),
    description: common.description,
    shortName: common.shortName,
    zoneLabel: common.zoneLabel,
    raw,
  };
}

/**
 * Insert observations + optional MQTT for ThemeParks live payload (queue never written to master tables).
 * @param {import('../../assets/assets.repository').AssetsRepository} repo
 */
async function updateQueueTimes(repo, parkRow, liveItems, t) {
  let obs = 0;
  let mqtt = 0;
  const parkSlug = parkRow.slug;

  for (const l of liveItems) {
    const extId = String(l.id || l.entityId || '');
    if (!extId) continue;
    const asset = await repo.findAssetByExternal(EXTERNAL_SOURCE, extId);
    if (!asset) continue;
    const assetSlug = asset.slug;
    const ts = new Date().toISOString();
    const status = l.status != null ? String(l.status) : null;
    const standby = l.queue && typeof l.queue === 'object' ? l.queue.STANDBY : null;
    const wait = standby && typeof standby.waitTime === 'number' ? standby.waitTime : null;

    if (wait != null) {
      await repo.createObservation(
        {
          assetId: asset.assetId,
          metricCode: 'QUEUE_TIME_MIN',
          metricValue: String(wait),
          unit: 'min',
          timestamp: new Date(),
          source: EXTERNAL_SOURCE,
        },
        t
      );
      obs += 1;
      const r = await publishMQTTState({
        parkSlug,
        assetSlug,
        metricCode: 'QUEUE_TIME_MIN',
        metricValue: String(wait),
        unit: 'min',
        timestamp: ts,
      });
      if (r.published) mqtt += 1;
    }

    if (status) {
      await repo.createObservation(
        {
          assetId: asset.assetId,
          metricCode: 'STATUS',
          metricValue: status,
          unit: null,
          timestamp: new Date(),
          source: EXTERNAL_SOURCE,
        },
        t
      );
      obs += 1;
      const st = mapLiveStatusToAssetStatus(status);
      await asset.update({ status: st, openingFlag: st === 'OPEN' }, { transaction: t });
      const r2 = await publishMQTTState({
        parkSlug,
        assetSlug,
        metricCode: 'STATUS',
        metricValue: status,
        unit: null,
        timestamp: ts,
      });
      if (r2.published) mqtt += 1;
    }
  }

  return { observations: obs, mqttPublishes: mqtt };
}

/**
 * Apply ride_templates.default_profile onto ride_master_data.
 */
async function enrichRideFromTemplate(models, assetId, templateCode = 'RIDE_DEFAULT', t) {
  const repo = new AssetsRepository(models);
  const tpl = await repo.findRideTemplateByCode(templateCode);
  if (!tpl || !tpl.defaultProfile) return { applied: false };
  await repo.updateRideMasterFromProfile(assetId, tpl.defaultProfile, t);
  return { applied: true, templateCode };
}

/**
 * Best-effort fill of specialization rows from ThemeParks entity JSON (CRUD may override).
 */
function lockSet(enrichment, key) {
  const e = enrichment && typeof enrichment === 'object' ? enrichment : {};
  const locks = e.locks && typeof e.locks === 'object' ? e.locks : {};
  return new Set(Array.isArray(locks[key]) ? locks[key] : []);
}

async function applyCanonicalSpecialization(models, assetId, typeCode, raw, transaction, assetRow) {
  if (!raw || typeof raw !== 'object') return;
  const t = String(typeCode).toUpperCase();
  const enr = assetRow && typeof assetRow.get === 'function' ? assetRow.get('enrichment') : assetRow?.enrichment;
  if (t === 'RIDE') {
    const rl = lockSet(enr, 'rideMaster');
    const patch = {};
    if (!rl.has('rideCategory') && raw.rideType) patch.rideCategory = String(raw.rideType).slice(0, 80);
    const stats = raw.statistics || raw.stats;
    if (
      !rl.has('theoreticalCapacityPph') &&
      stats &&
      typeof stats === 'object' &&
      typeof stats.capacityPerHour === 'number'
    ) {
      patch.theoreticalCapacityPph = Math.round(stats.capacityPerHour);
    }
    if (Object.keys(patch).length) {
      await models.RideMasterData.update(patch, { where: { assetId }, transaction });
    }
  }
  if (t === 'SHOW') {
    const sl = lockSet(enr, 'showMaster');
    const patch = {};
    if (!sl.has('showType') && raw.entityType) patch.showType = String(raw.entityType).slice(0, 80);
    const v = raw.venue || raw.venueName || raw.locationName;
    if (!sl.has('venueName') && v) patch.venueName = String(v).slice(0, 80);
    if (!sl.has('durationMin') && typeof raw.duration === 'number') patch.durationMin = Math.round(raw.duration);
    if (!sl.has('durationMin') && typeof raw.durationMinutes === 'number') patch.durationMin = Math.round(raw.durationMinutes);
    if (Object.keys(patch).length) {
      await models.ShowMasterData.update(patch, { where: { assetId }, transaction });
    }
  }
  if (t === 'RESTAURANT') {
    const kl = lockSet(enr, 'restaurantMaster');
    const patch = {};
    if (!kl.has('restaurantType') && raw.entityType) patch.restaurantType = String(raw.entityType).slice(0, 80);
    if (Object.keys(patch).length) {
      await models.RestaurantMasterData.update(patch, { where: { assetId }, transaction });
    }
  }
}

/**
 * Upsert one canonical asset row (+ specialization shell).
 */
async function upsertSingleAsset(models, repo, parkId, zoneId, mapped, transaction) {
  const typeRow = await repo.findAssetTypeByCode(mapped.assetTypeCode);
  if (!typeRow) throw new Error(`Unknown asset type: ${mapped.assetTypeCode}`);

  let parentAssetId = null;
  if (mapped.externalParentId) {
    const p = await repo.findAssetByExternal(EXTERNAL_SOURCE, mapped.externalParentId);
    if (p) parentAssetId = p.assetId;
  }

  const asset = await repo.upsertAsset(
    {
      parkId,
      zoneId,
      parentAssetId,
      assetTypeId: typeRow.id,
      name: mapped.name,
      shortName: mapped.shortName,
      description: mapped.description,
      zoneLabel: mapped.zoneLabel,
      slug: mapped.slug,
      latitude: mapped.latitude,
      longitude: mapped.longitude,
      status: 'UNKNOWN',
      activeFlag: true,
      openingFlag: null,
      externalSource: EXTERNAL_SOURCE,
      externalEntityId: mapped.externalEntityId,
      externalParentId: mapped.externalParentId,
      rawEntity: mapped.raw,
    },
    transaction
  );

  await repo.ensureSpecialization(asset, mapped.assetTypeCode, transaction);
  await applyCanonicalSpecialization(models, asset.assetId, mapped.assetTypeCode, mapped.raw, transaction, asset);
  return asset;
}

/**
 * Second pass: wire parent_asset_id from external_parent_id when parent rows exist.
 */
async function linkParents(models, repo, parkId, transaction) {
  const assets = await models.ParkAsset.findAll({
    where: { parkId, externalSource: EXTERNAL_SOURCE },
    transaction,
  });
  let linked = 0;
  for (const a of assets) {
    if (!a.externalParentId) continue;
    const parent = await repo.findAssetByExternal(EXTERNAL_SOURCE, a.externalParentId);
    if (parent && String(parent.assetId) !== String(a.assetId)) {
      await a.update({ parentAssetId: parent.assetId }, { transaction });
      linked += 1;
    }
  }
  return linked;
}

/**
 * Full ThemeParks.wiki → canonical platform sync for one park entity UUID.
 */
async function syncParkFromThemeParks(sequelize, models, parkExternalId) {
  const adapter = new ThemeParksWikiAdapter();
  const repo = new AssetsRepository(models);

  const parkJson = await adapter.fetchEntity(parkExternalId);
  const parkName = parkJson?.name || 'Park';
  const parkSlug = slugifyName(parkJson?.slug || parkName || parkExternalId).slice(0, 128);

  const transaction = await sequelize.transaction();
  try {
    const park = await repo.findOrCreateParkFromExternal({
      name: parkName,
      slug: parkSlug,
      externalEntityId: String(parkExternalId),
      externalSource: EXTERNAL_SOURCE,
      timezone: parkJson?.timezone || null,
      rawParkJson: parkJson,
    });
    const zone = await repo.findOrCreateDefaultZone(park.id, park.slug);

    const collected = await collectEntities(adapter, parkExternalId, 6);
    const merged = [];
    const byId = new Map();
    for (const e of collected) {
      const id = String(e.id || '');
      if (!id || byId.has(id)) continue;
      byId.set(id, true);
      merged.push(e);
    }
    if (!byId.has(String(parkExternalId))) {
      merged.push({
        id: parkExternalId,
        name: parkName,
        entityType: 'PARK',
        parentId: parkJson?.parentId || null,
        location: parkJson?.location,
      });
    }

    let assetsUpserted = 0;
    for (const e of merged) {
      const mapped = mapExternalEntity(e);
      if (!mapped.externalEntityId) continue;
      await upsertSingleAsset(models, repo, park.id, zone.id, mapped, transaction);
      assetsUpserted += 1;
    }

    const linked = await linkParents(models, repo, park.id, transaction);

    let liveItems = [];
    try {
      const liveRaw = await adapter.fetchLiveData(parkExternalId);
      liveItems = toArray(liveRaw);
    } catch (e) {
      logger.warn({ err: e.message }, 'themeparks fetchLiveData failed');
    }
    const liveStats = await updateQueueTimes(repo, park, liveItems, transaction);

    await transaction.commit();

    if (env.adapterDiscoverySpyEnabled) {
      const sourceRunId = `themeparks:${parkExternalId}:${Date.now()}`;
      const entities = merged.map((e) => {
        const m = mapExternalEntity(e);
        return {
          externalId: m.externalEntityId,
          externalParentId: m.externalParentId,
          externalType: m.rawEntityType || m.assetTypeCode,
          name: m.name,
          suggestedDomain: (() => {
            const c = String(m.assetTypeCode || '').toUpperCase();
            if (c === 'RIDE') return 'rides';
            if (c === 'SHOW') return 'shows';
            if (c === 'RESTAURANT') return 'food';
            if (c === 'SHOP') return 'retail';
            if (c === 'PARK' || c === 'ZONE') return 'park';
            return 'facilities';
          })(),
          suggestedEntityType: m.assetTypeCode,
          suggestedSlug: m.slug,
          rawPayload: m.raw,
        };
      });
      const metrics = liveItems
        .map((l) => ({
          externalId: String(l.id || l.entityId || ''),
          metric: 'queue_time',
          unit: 'min',
          valueType: 'integer',
          rawPayload: l,
        }))
        .filter((x) => x.externalId);

      setImmediate(() => {
        const { analyzeAdapterOutput } = require('../../../services/uns-spy-adapter-discovery.service');
        analyzeAdapterOutput({
          provider: 'themeparks_wiki',
          adapterKey: 'themeparks_wiki',
          parkId: park.id,
          externalParkId: String(parkExternalId),
          entities,
          metrics,
          sourceRunId,
        }).catch((err) => {
          logger.warn({ err: err.message }, 'adapter discovery analyzeAdapterOutput failed');
        });
      });
    }

    return {
      parkId: park.id,
      zoneId: zone.id,
      assetsUpserted,
      parentsLinked: linked,
      observationsInserted: liveStats.observations,
      mqttPublishes: liveStats.mqttPublishes,
    };
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
}

/**
 * Live queue / status only: updates asset_observations, park_assets.status, MQTT.
 * Uses the same ThemeParks park UUID as Integration settings / full sync.
 */
async function syncThemeParksLiveOnly(sequelize, models, parkExternalId) {
  const adapter = new ThemeParksWikiAdapter();
  const repo = new AssetsRepository(models);
  let park = await repo.findParkByExternal(parkExternalId, EXTERNAL_SOURCE);
  if (!park) {
    const parkJson = await adapter.fetchEntity(parkExternalId);
    const parkName = parkJson?.name || 'Park';
    const parkSlug = slugifyName(parkJson?.slug || parkName || parkExternalId).slice(0, 128);
    park = await repo.findOrCreateParkFromExternal({
      name: parkName,
      slug: parkSlug,
      externalEntityId: String(parkExternalId),
      externalSource: EXTERNAL_SOURCE,
      timezone: parkJson?.timezone || null,
      rawParkJson: parkJson,
    });
  }
  let liveItems = [];
  try {
    const liveRaw = await adapter.fetchLiveData(parkExternalId);
    liveItems = toArray(liveRaw);
  } catch (e) {
    logger.warn({ err: e.message }, 'themeparks fetchLiveData (live-only) failed');
  }
  const t = await sequelize.transaction();
  try {
    const liveStats = await updateQueueTimes(repo, park, liveItems, t);
    await t.commit();
    return { parkId: park.id, ...liveStats };
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

/**
 * Full ThemeParks → platform sync using the park UUID saved in Integration settings.
 */
async function syncParkFromThemeParksFromSettings(sequelize, models) {
  const { getThemeparksWikiParkIdFromIntegrationSettings } = require('../../../services/themeparks-wiki-selected-park.service');
  const { AppError } = require('../../../utils/app-error');
  const id = await getThemeparksWikiParkIdFromIntegrationSettings();
  if (!id) {
    throw new AppError('No ThemeParks.wiki park selected in Integration settings (save selection first)', 422, {
      code: 'NO_SELECTED_PARK',
    });
  }
  const summary = await syncParkFromThemeParks(sequelize, models, id);
  return { ...summary, externalParkId: id };
}

module.exports = {
  syncParkFromThemeParks,
  syncThemeParksLiveOnly,
  syncParkFromThemeParksFromSettings,
  mapExternalEntity,
  upsertAsset: upsertSingleAsset,
  applyCanonicalSpecialization,
  updateQueueTimes,
  enrichRideFromTemplate,
  collectEntities,
  publishMQTTState,
  EXTERNAL_SOURCE,
};

/* Phase C3.7 — provider self-registration with the canonical-ingestion
 * post-ingest hook registry. The pipeline service requires
 * `canonical-ingestion-hooks.bootstrap.js`, which in turn requires this
 * file, so these registrations run before any sync call. The hooks
 * receive `{ sequelize, models, externalParkId }` and run the existing
 * platform master-data / live-only sync. Errors are surfaced; the
 * pipeline wraps each call in try/catch (preserves pre-C3.7 behavior:
 * the integration ingestion is never blocked by a hook failure). */
const {
  canonicalIngestionHooks,
} = require('../../integrations/orchestrator/canonical-ingestion-hooks');

canonicalIngestionHooks.registerAfterEntities('themeparks_wiki', async ({ externalParkId }) => {
  const { sequelize, ...models } = require('../../../models');
  return syncParkFromThemeParks(sequelize, models, String(externalParkId));
});

canonicalIngestionHooks.registerAfterLive('themeparks_wiki', async ({ externalParkId }) => {
  const { sequelize, ...models } = require('../../../models');
  return syncThemeParksLiveOnly(sequelize, models, String(externalParkId));
});
