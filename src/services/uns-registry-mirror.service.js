'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Park,
  ParkZone,
  ParkAsset,
  AssetType,
  ExternalEntityMapping,
  UnsNode,
  UnsRegistryEntity,
  UnsRegistryMapping,
  UnsRegistryTopic,
  UnsRegistryMetadata,
  SignalCatalog,
  RideSignalCapability,
  SparkplugMetricDefinition,
} = require('../models');

const REGISTRY_SOURCE_MIRRORED = 'MIRRORED_FROM_LEGACY';

/** @typedef {import('../models').UnsRegistryEntity} UnsRegistryEntityModel */

const ENTITY_KIND = {
  PLATFORM_PARK: 'PLATFORM_PARK',
  PLATFORM_ZONE: 'PLATFORM_ZONE',
  PLATFORM_ASSET: 'PLATFORM_ASSET',
  EXTERNAL_ENTITY_MAPPING: 'EXTERNAL_ENTITY_MAPPING',
  UNS_NODE: 'UNS_NODE',
};

const LEGACY = {
  PARKS: 'parks',
  PARK_ZONES: 'park_zones',
  PARK_ASSETS: 'park_assets',
  EXTERNAL_ENTITY_MAPPINGS: 'external_entity_mappings',
  UNS_NODES: 'uns_nodes',
};

const RELATION = {
  PARK_CONTAINS_ZONE: 'PARK_CONTAINS_ZONE',
  ZONE_CONTAINS_ASSET: 'ZONE_CONTAINS_ASSET',
  PARK_CONTAINS_ASSET: 'PARK_CONTAINS_ASSET',
  ZONE_PARENT_OF_ZONE: 'ZONE_PARENT_OF_ZONE',
  UNS_PARENT_OF_NODE: 'UNS_PARENT_OF_NODE',
  MAPPING_LINKS_INTERNAL: 'MAPPING_LINKS_INTERNAL',
};

function entityKey(table, id) {
  return `${table}:${String(id)}`;
}

class UnsRegistryMirrorService {
  constructor() {
    /** @type {number|null} */
    this._lastSyncMs = null;
    /** @type {Promise<void>|null} */
    this._syncInFlight = null;
    this._staleMs = Number(process.env.UNS_REGISTRY_MIRROR_STALE_MS || 120000);
  }

  /**
   * Full replace of MIRRORED_FROM_LEGACY rows (read-only projection; does not touch legacy tables).
   */
  async syncFromLegacy() {
    const now = new Date();
    const keyToRegistryId = new Map();

    await sequelize.transaction(async (t) => {
      const opts = { transaction: t };

      await RideSignalCapability.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await SparkplugMetricDefinition.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await SignalCatalog.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await UnsRegistryMetadata.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await UnsRegistryMapping.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await UnsRegistryTopic.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });
      await UnsRegistryEntity.destroy({ where: { registrySource: REGISTRY_SOURCE_MIRRORED }, ...opts });

      const parks = await Park.findAll({ transaction: t });
      const zones = await ParkZone.findAll({ transaction: t });
      const assets = await ParkAsset.findAll({
        include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: false }],
        transaction: t,
      });
      const mappings = await ExternalEntityMapping.findAll({ transaction: t });
      const unsNodes = await UnsNode.findAll({ transaction: t });

      const entityRows = [];

      for (const p of parks) {
        const plain = p.get({ plain: true });
        entityRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          entityKind: ENTITY_KIND.PLATFORM_PARK,
          legacyTable: LEGACY.PARKS,
          legacyId: String(plain.id),
          parkId: plain.id,
          slug: plain.slug,
          name: plain.name,
          externalEntityId: plain.externalEntityId ?? null,
          payloadJson: {
            timezone: plain.timezone,
            externalSource: plain.externalSource,
            externalEntityId: plain.externalEntityId,
          },
          mirroredAt: now,
        });
      }

      for (const z of zones) {
        const plain = z.get({ plain: true });
        entityRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          entityKind: ENTITY_KIND.PLATFORM_ZONE,
          legacyTable: LEGACY.PARK_ZONES,
          legacyId: String(plain.id),
          parkId: plain.parkId,
          slug: plain.slug,
          name: plain.name,
          externalEntityId: plain.externalEntityId ?? null,
          payloadJson: {
            parentZoneId: plain.parentZoneId,
            sortOrder: plain.sortOrder,
          },
          mirroredAt: now,
        });
      }

      for (const a of assets) {
        const plain = a.get({ plain: true });
        entityRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          entityKind: ENTITY_KIND.PLATFORM_ASSET,
          legacyTable: LEGACY.PARK_ASSETS,
          legacyId: String(plain.assetId),
          parkId: plain.parkId,
          slug: plain.slug,
          name: plain.name,
          externalEntityId: plain.externalEntityId ?? null,
          payloadJson: {
            assetTypeCode: plain.assetType?.code ?? null,
            zoneId: plain.zoneId,
            activeFlag: plain.activeFlag,
            status: plain.status,
          },
          mirroredAt: now,
        });
      }

      for (const m of mappings) {
        const plain = m.get({ plain: true });
        entityRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          entityKind: ENTITY_KIND.EXTERNAL_ENTITY_MAPPING,
          legacyTable: LEGACY.EXTERNAL_ENTITY_MAPPINGS,
          legacyId: String(plain.id),
          parkId: null,
          slug: null,
          name: plain.externalEntityName,
          externalEntityId: plain.externalEntityId,
          payloadJson: {
            provider: plain.provider,
            externalDestinationId: plain.externalDestinationId,
            externalParkId: plain.externalParkId,
            externalEntityType: plain.externalEntityType,
            internalEntityType: plain.internalEntityType,
            internalEntityId: plain.internalEntityId,
            mappingStatus: plain.mappingStatus,
            confidence: plain.confidence,
            metadata: plain.metadata,
          },
          mirroredAt: now,
        });
      }

      for (const n of unsNodes) {
        const plain = n.get({ plain: true });
        const parkUuid = plain.parkId && String(plain.parkId).match(/^[0-9a-f-]{36}$/i) ? plain.parkId : null;
        entityRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          entityKind: ENTITY_KIND.UNS_NODE,
          legacyTable: LEGACY.UNS_NODES,
          legacyId: String(plain.id),
          parkId: parkUuid,
          slug: plain.slug,
          name: plain.name,
          externalEntityId: null,
          payloadJson: {
            parentId: plain.parentId,
            nodeType: plain.nodeType,
            domain: plain.domain,
            metric: plain.metric,
            topicPath: plain.topicPath,
            isLeaf: plain.isLeaf,
            isActive: plain.isActive,
            entityKind: plain.entityKind,
            sparkplugEnabled: plain.sparkplugEnabled,
            sortOrder: plain.sortOrder,
          },
          mirroredAt: now,
        });
      }

      const created = await UnsRegistryEntity.bulkCreate(entityRows, { returning: true, ...opts });
      for (const row of created) {
        const p = row.get({ plain: true });
        keyToRegistryId.set(entityKey(p.legacyTable, p.legacyId), p.id);
      }

      const mappingRows = [];
      const addMap = (rel, fromKey, toKey, payload = {}) => {
        const fromId = keyToRegistryId.get(fromKey);
        const toId = keyToRegistryId.get(toKey);
        if (!fromId || !toId) return;
        mappingRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          relationKind: rel,
          fromEntityId: fromId,
          toEntityId: toId,
          payloadJson: payload,
          mirroredAt: now,
        });
      };

      for (const z of zones) {
        const zp = z.get({ plain: true });
        addMap(
          RELATION.PARK_CONTAINS_ZONE,
          entityKey(LEGACY.PARKS, zp.parkId),
          entityKey(LEGACY.PARK_ZONES, zp.id)
        );
        if (zp.parentZoneId) {
          addMap(
            RELATION.ZONE_PARENT_OF_ZONE,
            entityKey(LEGACY.PARK_ZONES, zp.parentZoneId),
            entityKey(LEGACY.PARK_ZONES, zp.id)
          );
        }
      }

      for (const a of assets) {
        const ap = a.get({ plain: true });
        if (ap.zoneId) {
          addMap(
            RELATION.ZONE_CONTAINS_ASSET,
            entityKey(LEGACY.PARK_ZONES, ap.zoneId),
            entityKey(LEGACY.PARK_ASSETS, ap.assetId)
          );
        } else {
          addMap(
            RELATION.PARK_CONTAINS_ASSET,
            entityKey(LEGACY.PARKS, ap.parkId),
            entityKey(LEGACY.PARK_ASSETS, ap.assetId)
          );
        }
      }

      for (const n of unsNodes) {
        const np = n.get({ plain: true });
        if (np.parentId) {
          addMap(
            RELATION.UNS_PARENT_OF_NODE,
            entityKey(LEGACY.UNS_NODES, np.parentId),
            entityKey(LEGACY.UNS_NODES, np.id)
          );
        }
      }

      for (const m of mappings) {
        const mp = m.get({ plain: true });
        if (!mp.internalEntityId) continue;
        const mappingKey = entityKey(LEGACY.EXTERNAL_ENTITY_MAPPINGS, mp.id);
        const internalStr = String(mp.internalEntityId);
        const assetKey = entityKey(LEGACY.PARK_ASSETS, internalStr);
        if (keyToRegistryId.has(assetKey)) {
          addMap(RELATION.MAPPING_LINKS_INTERNAL, mappingKey, assetKey, {
            internalEntityType: mp.internalEntityType,
          });
        }
      }

      if (mappingRows.length) {
        await UnsRegistryMapping.bulkCreate(mappingRows, { ...opts });
      }

      const topicRows = [];
      for (const n of unsNodes) {
        const np = n.get({ plain: true });
        if (!np.topicPath || String(np.topicPath).trim() === '') continue;
        const regId = keyToRegistryId.get(entityKey(LEGACY.UNS_NODES, np.id));
        const parkUuid = np.parkId && String(np.parkId).match(/^[0-9a-f-]{36}$/i) ? np.parkId : null;
        topicRows.push({
          registrySource: REGISTRY_SOURCE_MIRRORED,
          topicPath: String(np.topicPath).slice(0, 1000),
          unsNodeLegacyId: np.id,
          parkId: parkUuid,
          registryEntityId: regId ?? null,
          payloadJson: {
            domain: np.domain,
            metric: np.metric,
            isLeaf: np.isLeaf,
          },
          mirroredAt: now,
        });
      }
      if (topicRows.length) {
        await UnsRegistryTopic.bulkCreate(topicRows, { ignoreDuplicates: true, ...opts });
      }

      const metaRows = [];
      for (const row of created) {
        const p = row.get({ plain: true });
        const topicPath = p.payloadJson && p.payloadJson.topicPath;
        if (p.entityKind === ENTITY_KIND.UNS_NODE && topicPath) {
          metaRows.push({
            registrySource: REGISTRY_SOURCE_MIRRORED,
            registryEntityId: p.id,
            metaKey: 'uns.topic_path',
            metaValueJson: { value: topicPath },
            mirroredAt: now,
          });
        }
      }
      if (metaRows.length) {
        await UnsRegistryMetadata.bulkCreate(metaRows, { ...opts });
      }

      const metricNames = [
        ...new Set(
          unsNodes
            .map((n) => n.get('metric'))
            .filter((m) => m != null && String(m).trim() !== '')
            .map((m) => String(m).trim())
        ),
      ];

      const sparkRows = metricNames.map((metricName) => ({
        registrySource: REGISTRY_SOURCE_MIRRORED,
        metricName,
        aliasOf: null,
        dataType: null,
        description: `Mirrored from uns_nodes.metric (${REGISTRY_SOURCE_MIRRORED})`,
        isPrepared: false,
        isActive: false,
        payloadJson: {},
      }));
      if (sparkRows.length) {
        await SparkplugMetricDefinition.bulkCreate(sparkRows, { ...opts });
      }

      const signalRows = metricNames.map((signalCode) => ({
        registrySource: REGISTRY_SOURCE_MIRRORED,
        signalCode,
        label: signalCode,
        description: `Derived metric / signal from UNS node leaves (${REGISTRY_SOURCE_MIRRORED})`,
        unit: null,
        category: 'uns_metric',
        payloadJson: {},
      }));
      let signalInstances = [];
      if (signalRows.length) {
        signalInstances = await SignalCatalog.bulkCreate(signalRows, { returning: true, ...opts });
      }

      const signalByCode = new Map(signalInstances.map((s) => [s.signalCode, s.id]));
      const rideType = await AssetType.findOne({ where: { code: 'RIDE' }, transaction: t });
      const rideAssets =
        rideType != null
          ? assets.filter((a) => String(a.get('assetTypeId')) === String(rideType.id))
          : [];

      const capRows = [];
      for (const ra of rideAssets) {
        const ap = ra.get({ plain: true });
        for (const code of metricNames) {
          const sid = signalByCode.get(code);
          if (!sid) continue;
          capRows.push({
            parkId: ap.parkId,
            assetId: ap.assetId,
            signalCatalogId: sid,
            registrySource: REGISTRY_SOURCE_MIRRORED,
            capabilityJson: { mirrored: true, note: 'Phase 2 placeholder link ride ↔ metric from UNS mirror' },
            mirroredAt: now,
          });
        }
      }
      if (capRows.length) {
        await RideSignalCapability.bulkCreate(capRows, { ...opts });
      }
    });

    this._lastSyncMs = Date.now();
  }

  async syncFromLegacyIfStale() {
    const stale =
      this._lastSyncMs == null || Date.now() - this._lastSyncMs > this._staleMs;
    if (!stale) return;
    if (this._syncInFlight) {
      await this._syncInFlight;
      return;
    }
    this._syncInFlight = this.syncFromLegacy().finally(() => {
      this._syncInFlight = null;
    });
    await this._syncInFlight;
  }

  async getSummaryCounts() {
    const where = { registrySource: REGISTRY_SOURCE_MIRRORED };
    const [
      entities,
      mapCount,
      topicCount,
      metaCount,
      signals,
      rideCaps,
      sparkDefs,
    ] = await Promise.all([
      UnsRegistryEntity.count({ where }),
      UnsRegistryMapping.count({ where }),
      UnsRegistryTopic.count({ where }),
      UnsRegistryMetadata.count({ where }),
      SignalCatalog.count({ where }),
      RideSignalCapability.count({ where }),
      SparkplugMetricDefinition.count({ where }),
    ]);
    const maxMirrored = await UnsRegistryEntity.max('mirroredAt', { where });
    return {
      registrySource: REGISTRY_SOURCE_MIRRORED,
      counts: {
        entities,
        mappings: mapCount,
        topics: topicCount,
        metadata: metaCount,
        signalCatalog: signals,
        rideSignalCapabilities: rideCaps,
        sparkplugMetricDefinitions: sparkDefs,
      },
      lastMirroredAt: maxMirrored ? new Date(maxMirrored).toISOString() : null,
    };
  }

  /**
   * @param {{ parkId?: string, entityKind?: string, limit?: number, offset?: number }} q
   */
  async listEntities(q) {
    const where = { registrySource: REGISTRY_SOURCE_MIRRORED };
    if (q.parkId) where.parkId = q.parkId;
    if (q.entityKind) where.entityKind = q.entityKind;
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const { rows, count } = await UnsRegistryEntity.findAndCountAll({
      where,
      limit,
      offset,
      order: [['entityKind', 'ASC'], ['name', 'ASC']],
    });
    return {
      total: count,
      limit,
      offset,
      items: rows.map((r) => r.get({ plain: true })),
    };
  }

  /**
   * @param {{ parkId?: string, limit?: number, offset?: number }} q
   */
  async listTopics(q) {
    const where = { registrySource: REGISTRY_SOURCE_MIRRORED };
    if (q.parkId) where.parkId = q.parkId;
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const { rows, count } = await UnsRegistryTopic.findAndCountAll({
      where,
      limit,
      offset,
      order: [['topicPath', 'ASC']],
    });
    return {
      total: count,
      limit,
      offset,
      items: rows.map((r) => r.get({ plain: true })),
    };
  }
}

const unsRegistryMirrorService = new UnsRegistryMirrorService();

module.exports = {
  UnsRegistryMirrorService,
  unsRegistryMirrorService,
  REGISTRY_SOURCE_MIRRORED,
  ENTITY_KIND,
  RELATION,
};
