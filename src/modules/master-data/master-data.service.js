const { Op } = require('sequelize');
const { sequelize } = require('../../db/sequelize');
const { AppError } = require('../../utils/app-error');
const { AssetsRepository } = require('../assets/assets.repository');
const {
  flattenTypedValues,
  profileCompleteness,
  missingRequiredFieldKeys,
  computeRideDerived,
  computeShowDerived,
  computeRestaurantDerived,
  mergeTemplateDefaults,
  mergeTemplateOverride,
  mergeProfilePatch,
  validateStaffingChain,
} = require('./master-data-profile.helper');

const ASSET_ENTITY_TYPES = new Set(['rides', 'attractions', 'shows', 'restaurants', 'shops']);

function lockSetFromEnrichment(enrichment, key) {
  const e = enrichment && typeof enrichment === 'object' ? enrichment : {};
  const locks = e.locks && typeof e.locks === 'object' ? e.locks : {};
  return new Set(Array.isArray(locks[key]) ? locks[key] : []);
}

function omitLockedFields(obj, locked) {
  if (!obj || typeof obj !== 'object') return {};
  const out = { ...obj };
  for (const k of locked) delete out[k];
  return out;
}

const ASSET_TYPE_CODE = {
  rides: 'RIDE',
  attractions: 'RIDE',
  shows: 'SHOW',
  restaurants: 'RESTAURANT',
  shops: 'SHOP',
};

function normalizeEntityType(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'attraction' || s === 'attractions') return 'rides';
  return s;
}

function pagination(q) {
  const page = Math.max(0, parseInt(String(q.page ?? '0'), 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(q.pageSize ?? '25'), 10) || 25));
  const sortDir = String(q.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  let sortBy = String(q.sortBy || 'name').replace(/[^a-zA-Z0-9_]/g, '');
  return { page, pageSize, sortDir, sortBy };
}

function enrichmentStatusOf(row) {
  const e = row?.enrichment;
  if (!e || typeof e !== 'object') return 'BASIC';
  const locks = e.locks && typeof e.locks === 'object' ? e.locks : {};
  const lockKeys = Object.keys(locks).filter((k) => Array.isArray(locks[k]) && locks[k].length);
  const extra = Object.keys(e).filter((k) => k !== 'locks' && k !== 'notes' && e[k] != null && e[k] !== '');
  if (extra.length || (e.notes != null && String(e.notes).trim() !== '')) return 'ENRICHED';
  if (lockKeys.length) return 'LOCKED';
  return 'BASIC';
}

function gridRowFromPark(p) {
  const inactive = p.enrichment && p.enrichment.deactivated === true;
  const tpl = p.entityTemplate;
  const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
  const flat = { ...(p.masterProfile || {}) };
  const completeness =
    p.templateId && req.length
      ? p.enrichment?.profileCompleteness || profileCompleteness(req, flat, p)
      : null;
  const missingKeys =
    p.templateId && req.length ? missingRequiredFieldKeys(req, flat, p) : [];
  return {
    id: p.id,
    entityKind: 'park',
    name: p.name,
    slug: p.slug,
    type: 'PARK',
    parkName: p.name,
    parentName: null,
    zoneName: null,
    provider: p.externalSource,
    externalId: p.externalEntityId,
    status: inactive ? 'INACTIVE' : 'ACTIVE',
    active: inactive ? false : true,
    templateId: p.templateId || null,
    templateCode: tpl?.templateCode || null,
    templateRequiredFields: req.length ? [...req] : [],
    missingProfileFieldKeys: missingKeys,
    enrichmentStatus: completeness || enrichmentStatusOf(p),
    lastSyncedAt: p.lastSyncedAt || null,
    updatedAt: p.updatedAt || null,
  };
}

function gridRowFromZone(z) {
  const park = z.park;
  return {
    id: z.id,
    entityKind: 'zone',
    name: z.name,
    slug: z.slug,
    type: 'ZONE',
    parkName: park?.name || null,
    parentName: null,
    zoneName: z.name,
    provider: '—',
    externalId: z.externalEntityId,
    status: 'ACTIVE',
    active: true,
    templateId: null,
    templateCode: null,
    enrichmentStatus: 'BASIC',
    lastSyncedAt: null,
    updatedAt: z.updatedAt || null,
  };
}

function gridRowFromAsset(a, waitTimeMin = null) {
  const typeCode = a.assetType?.code || '—';
  const park = a.park;
  const parent = a.parentAsset;
  const tpl = a.entityTemplate;
  const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
  const rm = a.rideMaster && typeof a.rideMaster.toJSON === 'function' ? a.rideMaster.toJSON() : a.rideMaster;
  const sm = a.showMaster && typeof a.showMaster.toJSON === 'function' ? a.showMaster.toJSON() : a.showMaster;
  const rtm =
    a.restaurantMaster && typeof a.restaurantMaster.toJSON === 'function' ? a.restaurantMaster.toJSON() : a.restaurantMaster;
  const flat = flattenTypedValues(a.masterProfile, rm, sm, rtm);
  const completeness =
    a.templateId && req.length ? a.enrichment?.profileCompleteness || profileCompleteness(req, flat, null) : null;
  const missingKeys =
    a.templateId && req.length ? missingRequiredFieldKeys(req, flat, null) : [];
  return {
    id: a.assetId,
    entityKind: 'asset',
    name: a.name,
    slug: a.slug,
    type: typeCode,
    parkName: park?.name || null,
    parentName: parent?.name || null,
    zoneName: a.zone?.name || null,
    provider: a.externalSource,
    externalId: a.externalEntityId,
    status: a.activeFlag === false ? 'INACTIVE' : a.status || 'UNKNOWN',
    waitTimeMin: Number.isFinite(Number(waitTimeMin)) ? Number(waitTimeMin) : null,
    active: a.activeFlag !== false,
    templateId: a.templateId || null,
    templateCode: tpl?.templateCode || null,
    templateRequiredFields: req.length ? [...req] : [],
    missingProfileFieldKeys: missingKeys,
    enrichmentStatus: completeness || enrichmentStatusOf(a),
    lastSyncedAt: a.lastSyncedAt || null,
    updatedAt: a.updatedAt || null,
  };
}

/**
 * Patch payload suitable for POST import (same shape as PATCH /master-data/:type/:id).
 * @param {*} bundle from getById
 */
function buildExportPatchFromBundle(bundle) {
  if (bundle.entityKind === 'park') {
    const p = bundle.row.get ? bundle.row.get({ plain: true }) : bundle.row;
    const inactive = p.enrichment && p.enrichment.deactivated === true;
    return {
      name: p.name,
      slug: p.slug,
      timezone: p.timezone ?? null,
      masterProfile: p.masterProfile || {},
      enrichment: p.enrichment || {},
      templateId: p.templateId ?? null,
      active: !inactive,
    };
  }
  if (bundle.entityKind === 'zone') {
    const z = bundle.row.get ? bundle.row.get({ plain: true }) : bundle.row;
    return {
      name: z.name,
      slug: z.slug,
      sortOrder: z.sortOrder,
    };
  }
  const row = bundle.row;
  const a = row.get ? row.get({ plain: true }) : row.toJSON();
  const t = bundle.section;
  const patch = {
    masterProfile: a.masterProfile || {},
    templateId: a.templateId ?? null,
    enrichment: a.enrichment || {},
  };
  const assetPayload = {
    name: a.name,
    slug: a.slug,
    shortName: a.shortName,
    description: a.description,
    zoneLabel: a.zoneLabel,
    latitude: a.latitude,
    longitude: a.longitude,
    status: a.status,
    activeFlag: a.activeFlag,
    openingFlag: a.openingFlag,
    zoneId: a.zoneId || null,
  };
  if (String(a.externalSource || '').toUpperCase() === 'MANUAL') {
    assetPayload.externalEntityId = a.externalEntityId;
    assetPayload.externalSource = a.externalSource;
  }
  patch.asset = assetPayload;
  const rm = row.rideMaster;
  if (t === 'rides' && rm) {
    const rj = rm.toJSON ? rm.toJSON() : rm;
    const { assetId: _rid, ...rest } = rj;
    patch.rideMaster = rest;
  }
  const sm = row.showMaster;
  if (t === 'shows' && sm) {
    const sj = sm.toJSON ? sm.toJSON() : sm;
    const { assetId: _sid, ...rest } = sj || {};
    if (rest && Object.keys(rest).length) patch.showMaster = rest;
  }
  const rtm = row.restaurantMaster;
  if (t === 'restaurants' && rtm) {
    const rj = rtm.toJSON ? rtm.toJSON() : rtm;
    const { assetId: _rtid, ...rest } = rj || {};
    if (rest && Object.keys(rest).length) patch.restaurantMaster = rest;
  }
  const shopM = row.shopMaster;
  if (t === 'shops' && shopM) {
    const sj = shopM.toJSON ? shopM.toJSON() : shopM;
    const { assetId: _shid, ...rest } = sj || {};
    if (rest && Object.keys(rest).length) patch.shopMaster = rest;
  }
  const at = row.assetTarget;
  if (at && typeof at.toJSON === 'function') {
    const o = at.toJSON();
    if (o && o.targets && typeof o.targets === 'object') patch.targets = o.targets;
  }
  return patch;
}

/**
 * Clone for JSON responses / file export (breaks circular refs; BigInt → string; Date → ISO).
 * Prevents Express `res.json` / JSON.stringify from throwing on Sequelize graphs.
 */
function jsonSafeClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(obj, (_k, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Date) return value.toISOString();
        if (value !== null && typeof value === 'object') {
          if (seen.has(value)) return undefined;
          seen.add(value);
        }
        return value;
      })
    );
  }
}

function toNestedPlain(v) {
  if (v == null) return v;
  if (typeof v.toJSON === 'function') return v.toJSON();
  return v;
}

class MasterDataService {
  models() {
    return require('../../models');
  }

  repo() {
    return new AssetsRepository(this.models());
  }

  /**
   * JSON shape returned by GET /master-data/:type/:id (shared with export + controller).
   * @param {*} bundle
   */
  static serializeDetail(bundle) {
    if (!bundle) return null;
    if (bundle.entityKind === 'asset') {
      const t = bundle.section;
      return {
        entityKind: 'asset',
        asset: bundle.row.toJSON(),
        childCount: bundle.childCount,
        capacity: bundle.capacity,
        ...MasterDataService.detailPresentationForAsset(bundle.row, t, bundle.childCount),
      };
    }
    if (bundle.entityKind === 'park') {
      return {
        entityKind: 'park',
        park: bundle.row.toJSON(),
        ...MasterDataService.detailPresentationForPark(bundle.row),
      };
    }
    return {
      entityKind: 'zone',
      zone: bundle.row.toJSON(),
      ...MasterDataService.detailPresentationForZone(bundle.row),
    };
  }

  /** Resolve a park by internal UUID, slug, or external entity id. */
  async resolveParkFromKey(raw) {
    const key = String(raw || '').trim();
    if (!key) return null;
    const { Park } = this.models();
    let row = await Park.findByPk(key);
    if (row) return row;
    row = await Park.findOne({ where: { slug: key } });
    if (row) return row;
    row = await Park.findOne({ where: { externalEntityId: key } });
    return row || null;
  }

  /**
   * Zone: UUID or external entity id (slug is not unique globally).
   * @param {string} raw
   */
  async resolveZoneFromKey(raw) {
    const key = String(raw || '').trim();
    if (!key) return null;
    const { ParkZone, Park } = this.models();
    let row = await ParkZone.findByPk(key, { include: [{ model: Park, as: 'park', required: false }] });
    if (row) return row;
    row = await ParkZone.findOne({
      where: { externalEntityId: key },
      include: [{ model: Park, as: 'park', required: false }],
    });
    return row || null;
  }

  /**
   * Asset in the given master-data section: asset UUID, external entity id, or slug (scoped to type).
   * @param {string} entityType
   * @param {string} raw
   */
  async resolveAssetFromKey(entityType, raw) {
    const t = this.assertEntityType(entityType);
    if (!ASSET_ENTITY_TYPES.has(t)) return null;
    const typeCode = ASSET_TYPE_CODE[t];
    const typeRow = await this.repo().findAssetTypeByCode(typeCode);
    if (!typeRow) return null;
    const { ParkAsset } = this.models();
    const key = String(raw || '').trim();
    if (!key) return null;
    let asset = await ParkAsset.findByPk(key);
    if (asset && String(asset.assetTypeId) !== String(typeRow.id)) asset = null;
    if (asset) return asset;
    const ext = await ParkAsset.findAll({ where: { externalEntityId: key, assetTypeId: typeRow.id }, limit: 2 });
    if (ext.length > 1) {
      throw new AppError('Ambiguous external id for this asset type', 400, { code: 'AMBIGUOUS_EXTERNAL_ID' });
    }
    if (ext.length === 1) return ext[0];
    const slugs = await ParkAsset.findAll({ where: { slug: key, assetTypeId: typeRow.id }, limit: 2 });
    if (slugs.length > 1) {
      throw new AppError('Ambiguous slug for this asset type', 400, { code: 'AMBIGUOUS_SLUG' });
    }
    return slugs[0] || null;
  }

  /**
   * Enrichment routes: resolve asset id without entity-type scope (pk, then external id, then slug).
   * @param {string} raw
   * @returns {Promise<string|null>} canonical assetId
   */
  async resolveAssetIdForEnrichment(raw) {
    const key = String(raw || '').trim();
    if (!key) return null;
    const { ParkAsset } = this.models();
    const byPk = await ParkAsset.findByPk(key);
    if (byPk) return byPk.assetId;
    const ext = await ParkAsset.findAll({ where: { externalEntityId: key }, limit: 2 });
    if (ext.length > 1) throw new AppError('Ambiguous external id', 400, { code: 'AMBIGUOUS_EXTERNAL_ID' });
    if (ext.length === 1) return ext[0].assetId;
    const slugs = await ParkAsset.findAll({ where: { slug: key }, limit: 2 });
    if (slugs.length > 1) throw new AppError('Ambiguous slug', 400, { code: 'AMBIGUOUS_SLUG' });
    return slugs[0]?.assetId || null;
  }

  assertEntityType(entityType) {
    const t = normalizeEntityType(entityType);
    const allowed = new Set(['parks', 'rides', 'shows', 'restaurants', 'shops', 'zones']);
    if (!allowed.has(t)) {
      throw new AppError(`Unknown master-data entity type: ${entityType}`, 400, { code: 'INVALID_ENTITY_TYPE' });
    }
    return t;
  }

  async list(entityType, query) {
    const t = this.assertEntityType(entityType);
    const { page, pageSize, sortDir } = pagination(query);
    const search = query.search ? String(query.search).trim() : '';
    const parkKey = query.parkId ? String(query.parkId).trim() : '';
    const provider = query.provider ? String(query.provider).trim() : null;
    const status = query.status ? String(query.status).trim() : null;

    const parkRow = parkKey ? await this.resolveParkFromKey(parkKey) : null;
    const resolvedParkId = parkRow ? parkRow.id : null;
    if (parkKey && !resolvedParkId) {
      return { rows: [], total: 0, page, pageSize };
    }

    if (t === 'parks') {
      const { Park, EntityTypeTemplate } = this.models();
      const where = {};
      if (search) {
        const or = [
          { name: { [Op.iLike]: `%${search}%` } },
          { slug: { [Op.iLike]: `%${search}%` } },
          { externalEntityId: { [Op.iLike]: `%${search}%` } },
        ];
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
          or.push({ id: search });
        }
        where[Op.or] = or;
      }
      if (provider) where.externalSource = provider;
      const templateIdFilterP = query.templateId ? String(query.templateId).trim() : '';
      if (templateIdFilterP) where.templateId = templateIdFilterP;
      const pcPark = query.profileCompleteness ? String(query.profileCompleteness).toUpperCase() : '';
      if (pcPark === 'COMPLETE' || pcPark === 'INCOMPLETE') {
        const andArr = Array.isArray(where[Op.and]) ? [...where[Op.and]] : [];
        andArr.push(
          sequelize.literal(`"Park"."enrichment" @> '{"profileCompleteness":"${pcPark}"}'::jsonb`)
        );
        where[Op.and] = andArr;
      }
      const sortField = ['name', 'slug', 'updatedAt'].includes(query.sortBy) ? query.sortBy : 'name';
      const { rows, count } = await Park.findAndCountAll({
        where,
        include: [{ model: EntityTypeTemplate, as: 'entityTemplate', required: false }],
        order: [[sortField, sortDir]],
        limit: pageSize,
        offset: page * pageSize,
      });
      const list = rows.map(gridRowFromPark);
      return { rows: list, total: count, page, pageSize };
    }

    if (t === 'zones') {
      const { ParkZone, Park } = this.models();
      const where = {};
      if (resolvedParkId) where.parkId = resolvedParkId;
      if (search) {
        const zOr = [
          { name: { [Op.iLike]: `%${search}%` } },
          { slug: { [Op.iLike]: `%${search}%` } },
          { externalEntityId: { [Op.iLike]: `%${search}%` } },
        ];
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
          zOr.push({ id: search });
        }
        where[Op.or] = zOr;
      }
      const sortField = ['name', 'slug', 'updatedAt'].includes(query.sortBy) ? query.sortBy : 'name';
      const { rows, count } = await ParkZone.findAndCountAll({
        where,
        include: [{ model: Park, as: 'park', required: false }],
        order: [[sortField, sortDir]],
        limit: pageSize,
        offset: page * pageSize,
      });
      return { rows: rows.map(gridRowFromZone), total: count, page, pageSize };
    }

    const {
      ParkAsset,
      AssetType,
      Park,
      ParkAsset: ParentAsset,
      ParkZone,
      EntityTypeTemplate,
      RideMasterData,
      ShowMasterData,
      RestaurantMasterData,
      AssetObservation,
    } = this.models();
    const typeCode = ASSET_TYPE_CODE[t];
    const typeRow = await this.repo().findAssetTypeByCode(typeCode);
    if (!typeRow) throw new AppError(`Asset type not configured: ${typeCode}`, 500, { code: 'MISSING_ASSET_TYPE' });

    const where = { assetTypeId: typeRow.id };
    if (resolvedParkId) where.parkId = resolvedParkId;
    if (provider) where.externalSource = provider;
    if (status === 'INACTIVE') where.activeFlag = false;
    else if (status === 'ACTIVE') where.activeFlag = true;
    else if (status) where.status = status;
    const templateIdFilter = query.templateId ? String(query.templateId).trim() : '';
    if (templateIdFilter) where.templateId = templateIdFilter;
    const zoneIdFilter = query.zoneId ? String(query.zoneId).trim() : '';
    if (zoneIdFilter) where.zoneId = zoneIdFilter;
    const pcRaw = query.profileCompleteness ? String(query.profileCompleteness).toUpperCase() : '';
    if (pcRaw === 'COMPLETE' || pcRaw === 'INCOMPLETE') {
      const andArr = Array.isArray(where[Op.and]) ? [...where[Op.and]] : [];
      andArr.push(
        sequelize.literal(`"ParkAsset"."enrichment" @> '{"profileCompleteness":"${pcRaw}"}'::jsonb`)
      );
      where[Op.and] = andArr;
    }
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { slug: { [Op.iLike]: `%${search}%` } },
        { externalEntityId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const sortField = ['name', 'status', 'updatedAt', 'slug'].includes(query.sortBy) ? query.sortBy : 'name';
    const baseIncludes = [
      { model: AssetType, as: 'assetType', required: true },
      { model: Park, as: 'park', required: false },
      { model: ParentAsset, as: 'parentAsset', required: false },
      { model: ParkZone, as: 'zone', required: false },
      { model: EntityTypeTemplate, as: 'entityTemplate', required: false },
    ];
    if (t === 'rides') baseIncludes.push({ model: RideMasterData, as: 'rideMaster', required: false });
    if (t === 'shows') baseIncludes.push({ model: ShowMasterData, as: 'showMaster', required: false });
    if (t === 'restaurants') baseIncludes.push({ model: RestaurantMasterData, as: 'restaurantMaster', required: false });

    const { rows, count } = await ParkAsset.findAndCountAll({
      where,
      include: baseIncludes,
      order: [[sortField, sortDir]],
      limit: pageSize,
      offset: page * pageSize,
    });
    const waitByAsset = {};
    const assetIds = rows.map((r) => r.assetId).filter(Boolean);
    if (assetIds.length) {
      const queueObs = await AssetObservation.findAll({
        where: { assetId: { [Op.in]: assetIds }, metricCode: 'QUEUE_TIME_MIN' },
        attributes: ['assetId', 'metricValue', 'timestamp'],
        order: [['timestamp', 'DESC']],
      });
      for (const obs of queueObs) {
        const id = String(obs.assetId);
        if (waitByAsset[id] !== undefined) continue;
        const val = Number(obs.metricValue);
        waitByAsset[id] = Number.isFinite(val) ? val : null;
      }
    }
    const list = rows.map((r) => gridRowFromAsset(r, waitByAsset[String(r.assetId)] ?? null));
    return { rows: list, total: count, page, pageSize };
  }

  async getByAssetId(assetId) {
    const full = await this.repo().getAssetById(assetId);
    if (!full) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const code = String(full.assetType?.code || '');
    const tab = { RIDE: 'rides', SHOW: 'shows', RESTAURANT: 'restaurants', SHOP: 'shops' }[code];
    if (!tab) throw new AppError('Unknown asset type', 400, { code: 'INVALID_ASSET_TYPE' });
    const canonicalId = full.assetId;
    const childCount = await this.models().ParkAsset.count({ where: { parentAssetId: canonicalId } });
    const cap =
      tab === 'rides' && full.rideMaster
        ? MasterDataService.computeRideCapacity(full.rideMaster.toJSON ? full.rideMaster.toJSON() : full.rideMaster)
        : null;
    return { entityKind: 'asset', row: full, childCount, capacity: cap, section: tab };
  }

  async getById(entityType, id) {
    const t = this.assertEntityType(entityType);
    if (t === 'parks') {
      const resolved = await this.resolveParkFromKey(id);
      if (!resolved) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
      const { Park, EntityTypeTemplate } = this.models();
      const row = await Park.findByPk(resolved.id, {
        include: [{ model: EntityTypeTemplate, as: 'entityTemplate', required: false }],
      });
      if (!row) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
      return { entityKind: 'park', row };
    }
    if (t === 'zones') {
      const row = await this.resolveZoneFromKey(id);
      if (!row) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
      return { entityKind: 'zone', row };
    }
    const asset = await this.resolveAssetFromKey(t, id);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const canonicalId = asset.assetId;
    const full = await this.repo().getAssetById(canonicalId);
    if (!full) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const code = full.assetType?.code;
    const expected = ASSET_TYPE_CODE[t];
    if (String(code) !== expected) {
      throw new AppError('Asset type does not match section', 400, { code: 'TYPE_MISMATCH' });
    }
    const childCount = await this.models().ParkAsset.count({ where: { parentAssetId: canonicalId } });
    const cap =
      t === 'rides' && full.rideMaster
        ? MasterDataService.computeRideCapacity(full.rideMaster.toJSON ? full.rideMaster.toJSON() : full.rideMaster)
        : null;
    return { entityKind: 'asset', row: full, childCount, capacity: cap, section: t };
  }

  static computeRideCapacity(rm) {
    if (!rm || typeof rm !== 'object') return null;
    const dispatch = Number(rm.dispatchIntervalSec);
    const seats = Number(rm.seatsPerCycle);
    const vehicles = Number(rm.trainsCount);
    let derived = null;
    if (dispatch > 0 && seats > 0 && vehicles > 0) {
      derived = Math.floor((3600 / dispatch) * seats * vehicles);
    }
    const theoretical = rm.theoreticalCapacityPph != null ? Number(rm.theoreticalCapacityPph) : null;
    const target = rm.capacityPph != null ? Number(rm.capacityPph) : null;
    return {
      theoreticalCapacityPerHour: theoretical,
      capacityPerHourDerived: derived,
      effectiveCapacityPerHour: target || theoretical || derived,
    };
  }

  static detailPresentationForPark(row) {
    const p = row.get ? row.get({ plain: true }) : row;
    const raw = p.providerSnapshot?.lastEntity ?? p.providerSnapshot ?? {};
    const mp = p.masterProfile || {};
    const tpl = p.entityTemplate;
    const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
    const pc =
      p.templateId && req.length ? p.enrichment?.profileCompleteness || profileCompleteness(req, mp, p) : null;
    const missingProfileKeys =
      p.templateId && req.length ? missingRequiredFieldKeys(req, mp, p) : [];
    return {
      masterDataPresentation: {
        providerReadOnly: {
          provider: p.externalSource,
          external_entity_id: p.externalEntityId,
          external_parent_id: null,
          entity_type_raw: raw?.entityType ?? raw?.entity_type ?? null,
          source_system: p.externalSource,
          last_synced_at: p.lastSyncedAt,
        },
        raw_payload_json: raw,
        master_profile: mp,
        template: tpl ? toNestedPlain(tpl.get ? tpl.get({ plain: true }) : tpl) : null,
        calculated_fields: {},
        profile_completeness: pc,
        template_required_field_keys: [...req],
        missing_profile_field_keys: missingProfileKeys,
        parent_child: { parent: null, children: [], child_count: 0 },
      },
    };
  }

  static detailPresentationForAsset(full, t, childCount) {
    const a = full.get ? full.get({ plain: true }) : full.toJSON();
    const raw = a.providerSnapshot?.lastEntity ?? a.providerSnapshot ?? {};
    const mp = a.masterProfile || {};
    const rm = toNestedPlain(a.rideMaster) || {};
    const sm = toNestedPlain(a.showMaster) || {};
    const rtm = toNestedPlain(a.restaurantMaster) || {};
    const flat = flattenTypedValues(mp, rm, sm, rtm);
    const tpl = a.entityTemplate;
    const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
    const pc =
      a.templateId && req.length ? a.enrichment?.profileCompleteness || profileCompleteness(req, flat, null) : null;
    const missingProfileKeys =
      a.templateId && req.length ? missingRequiredFieldKeys(req, flat, null) : [];
    let calculated = {};
    if (t === 'rides') {
      calculated = { ...computeRideDerived(flat), ...MasterDataService.computeRideCapacity(rm) };
    } else if (t === 'shows') {
      calculated = computeShowDerived(flat);
    } else if (t === 'restaurants') {
      calculated = computeRestaurantDerived(flat);
    }
    const staffErr = validateStaffingChain(flat);
    if (staffErr) calculated = { ...calculated, _validationWarning: staffErr };
    return {
      masterDataPresentation: {
        providerReadOnly: {
          provider: a.externalSource,
          external_entity_id: a.externalEntityId,
          external_parent_id: a.externalParentId,
          entity_type_raw: raw?.entityType ?? raw?.entity_type ?? null,
          source_system: a.externalSource,
          last_synced_at: a.lastSyncedAt,
        },
        raw_payload_json: raw,
        master_profile: mp,
        template: tpl ? toNestedPlain(tpl) : null,
        calculated_fields: calculated,
        profile_completeness: pc,
        template_required_field_keys: [...req],
        missing_profile_field_keys: missingProfileKeys,
        parent_child: {
          parent: a.parentAsset ? { id: a.parentAsset.assetId, name: a.parentAsset.name } : null,
          children: [],
          child_count: childCount ?? 0,
        },
      },
    };
  }

  static detailPresentationForZone(row) {
    const z = row.get ? row.get({ plain: true }) : row;
    return {
      masterDataPresentation: {
        providerReadOnly: {
          provider: '—',
          external_entity_id: z.externalEntityId,
          external_parent_id: null,
          entity_type_raw: 'ZONE',
          source_system: null,
          last_synced_at: null,
        },
        raw_payload_json: {},
        master_profile: {},
        template: null,
        calculated_fields: {},
        profile_completeness: null,
        parent_child: {
          parent: z.park ? { id: z.park.id, name: z.park.name } : null,
          children: [],
          child_count: 0,
        },
      },
    };
  }

  async patch(entityType, id, body) {
    const t = this.assertEntityType(entityType);
    const {
      sequelize,
      Park,
      ParkZone,
      ParkAsset,
      RideMasterData,
      ShowMasterData,
      RestaurantMasterData,
      ShopMasterData,
      EntityTypeTemplate,
    } = this.models();

    if (t === 'parks') {
      const row = await this.resolveParkFromKey(id);
      if (!row) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
      const locks = new Set(row.enrichment?.locks?.park || []);
      const patch = {};
      if (body.name != null && !locks.has('name')) patch.name = String(body.name).slice(0, 200);
      if (body.slug != null && !locks.has('slug')) patch.slug = String(body.slug).slice(0, 128);
      if (body.timezone !== undefined && !locks.has('timezone')) patch.timezone = body.timezone;
      if (body.enrichment && typeof body.enrichment === 'object') {
        patch.enrichment = { ...(row.enrichment || {}), ...body.enrichment };
      }
      if (body.active === false) {
        patch.enrichment = { ...(row.enrichment || {}), ...(patch.enrichment || {}), deactivated: true };
      }
      if (body.active === true) {
        const e = { ...(row.enrichment || {}), ...(patch.enrichment || {}) };
        delete e.deactivated;
        patch.enrichment = e;
      }
      const mpLocks = new Set(row.enrichment?.locks?.masterProfile || []);
      if (body.masterProfile && typeof body.masterProfile === 'object') {
        patch.masterProfile = mergeProfilePatch(row.masterProfile || {}, body.masterProfile, mpLocks);
      }
      if (body.templateId !== undefined) {
        patch.templateId = body.templateId;
      }
      const mergedEnrichment = { ...(row.enrichment || {}), ...(patch.enrichment || {}) };
      const nextProfile = patch.masterProfile !== undefined ? patch.masterProfile : row.masterProfile || {};
      const nextTid = patch.templateId !== undefined ? patch.templateId : row.templateId;
      const tplRow = nextTid ? await EntityTypeTemplate.findByPk(nextTid) : null;
      const req = Array.isArray(tplRow?.requiredFieldsJson) ? tplRow.requiredFieldsJson : [];
      if (tplRow && req.length) mergedEnrichment.profileCompleteness = profileCompleteness(req, nextProfile, row);
      else delete mergedEnrichment.profileCompleteness;
      patch.enrichment = mergedEnrichment;
      await row.update(patch);
      return this.getById('parks', row.id);
    }

    if (t === 'zones') {
      const row = await this.resolveZoneFromKey(id);
      if (!row) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
      const patch = {};
      if (body.name != null) patch.name = String(body.name).slice(0, 200);
      if (body.slug != null) patch.slug = String(body.slug).slice(0, 128);
      if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder);
      if (body.parentZoneId !== undefined) patch.parentZoneId = body.parentZoneId || null;
      await row.update(patch);
      return this.getById('zones', row.id);
    }

    const asset = await this.resolveAssetFromKey(t, id);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const canonicalAssetId = asset.assetId;
    const manual = String(asset.externalSource).toUpperCase() === 'MANUAL';
    const locks = new Set(asset.enrichment?.locks?.asset || []);

    const tr = await sequelize.transaction();
    try {
      const aPatch = {};
      const mpLocksA = new Set(asset.enrichment?.locks?.masterProfile || []);
      if (body.masterProfile && typeof body.masterProfile === 'object') {
        aPatch.masterProfile = mergeProfilePatch(asset.masterProfile || {}, body.masterProfile, mpLocksA);
      }
      if (body.templateId !== undefined) {
        aPatch.templateId = body.templateId;
      }
      if (body.asset && typeof body.asset === 'object') {
        const a = body.asset;
        const canWriteExternal = manual;
        if (a.name != null && !locks.has('name')) aPatch.name = String(a.name).slice(0, 240);
        if (a.slug != null && !locks.has('slug')) aPatch.slug = String(a.slug).slice(0, 160);
        if (a.shortName !== undefined && !locks.has('shortName')) aPatch.shortName = a.shortName;
        if (a.description !== undefined && !locks.has('description')) aPatch.description = a.description;
        if (a.zoneLabel !== undefined && !locks.has('zoneLabel')) aPatch.zoneLabel = a.zoneLabel;
        if (a.latitude !== undefined && !locks.has('latitude')) aPatch.latitude = a.latitude;
        if (a.longitude !== undefined && !locks.has('longitude')) aPatch.longitude = a.longitude;
        if (a.status != null && !locks.has('status')) aPatch.status = String(a.status).slice(0, 32);
        if (a.activeFlag !== undefined && !locks.has('activeFlag')) aPatch.activeFlag = Boolean(a.activeFlag);
        if (a.openingFlag !== undefined && !locks.has('openingFlag')) aPatch.openingFlag = a.openingFlag;
        if (a.zoneId !== undefined) aPatch.zoneId = a.zoneId || null;
        if (canWriteExternal) {
          if (a.externalEntityId !== undefined) aPatch.externalEntityId = a.externalEntityId;
          if (a.externalSource !== undefined) aPatch.externalSource = String(a.externalSource).slice(0, 40);
        }
        if (body.enrichment && typeof body.enrichment === 'object') {
          aPatch.enrichment = { ...(asset.enrichment || {}), ...body.enrichment };
        }
      } else if (body.enrichment && typeof body.enrichment === 'object') {
        aPatch.enrichment = { ...(asset.enrichment || {}), ...body.enrichment };
      }
      if (Object.keys(aPatch).length) await asset.update(aPatch, { transaction: tr });

      if (t === 'rides' && body.rideMaster && typeof body.rideMaster === 'object') {
        const [rm] = await RideMasterData.findOrCreate({
          where: { assetId: canonicalAssetId },
          defaults: { assetId: canonicalAssetId },
          transaction: tr,
        });
        const filtered = omitLockedFields(body.rideMaster, lockSetFromEnrichment(asset.enrichment, 'rideMaster'));
        await rm.update(filtered, { transaction: tr });
      }
      if (t === 'shows' && body.showMaster && typeof body.showMaster === 'object') {
        const [sm] = await ShowMasterData.findOrCreate({
          where: { assetId: canonicalAssetId },
          defaults: { assetId: canonicalAssetId },
          transaction: tr,
        });
        const filtered = omitLockedFields(body.showMaster, lockSetFromEnrichment(asset.enrichment, 'showMaster'));
        await sm.update(filtered, { transaction: tr });
      }
      if (t === 'restaurants' && body.restaurantMaster && typeof body.restaurantMaster === 'object') {
        const [rm] = await RestaurantMasterData.findOrCreate({
          where: { assetId: canonicalAssetId },
          defaults: { assetId: canonicalAssetId },
          transaction: tr,
        });
        const filtered = omitLockedFields(
          body.restaurantMaster,
          lockSetFromEnrichment(asset.enrichment, 'restaurantMaster')
        );
        await rm.update(filtered, { transaction: tr });
      }
      if (t === 'shops' && body.shopMaster && typeof body.shopMaster === 'object') {
        const [sm] = await ShopMasterData.findOrCreate({
          where: { assetId: canonicalAssetId },
          defaults: { assetId: canonicalAssetId },
          transaction: tr,
        });
        const filtered = omitLockedFields(body.shopMaster, lockSetFromEnrichment(asset.enrichment, 'shopMaster'));
        await sm.update(filtered, { transaction: tr });
      }
      if (body.targets && typeof body.targets === 'object') {
        await this.repo().upsertAssetTargetsFromProfile(canonicalAssetId, body.targets, tr);
      }
      await tr.commit();
    } catch (e) {
      await tr.rollback();
      throw e;
    }
    const fresh = await this.repo().getAssetById(canonicalAssetId);
    if (fresh) {
      const rm = fresh.rideMaster?.toJSON?.() || fresh.rideMaster;
      const sm = fresh.showMaster?.toJSON?.() || fresh.showMaster;
      const rtm = fresh.restaurantMaster?.toJSON?.() || fresh.restaurantMaster;
      const flat = flattenTypedValues(fresh.masterProfile, rm, sm, rtm);
      const tpl = fresh.entityTemplate;
      const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
      const nextE = { ...fresh.enrichment };
      if (fresh.templateId && tpl && req.length) nextE.profileCompleteness = profileCompleteness(req, flat, null);
      else delete nextE.profileCompleteness;
      await fresh.update({ enrichment: nextE });
    }
    return this.getById(entityType, canonicalAssetId);
  }

  async deactivate(entityType, id) {
    const t = this.assertEntityType(entityType);
    if (t === 'parks') {
      const row = await this.resolveParkFromKey(id);
      if (!row) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
      await row.update({ enrichment: { ...(row.enrichment || {}), deactivated: true } });
      return { ok: true };
    }
    if (t === 'zones') {
      throw new AppError('Zone deactivate not supported', 400, { code: 'NOT_SUPPORTED' });
    }
    const asset = await this.resolveAssetFromKey(t, id);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    await asset.update({ activeFlag: false });
    return { ok: true };
  }

  async createManualAsset(entityType, body) {
    const t = this.assertEntityType(entityType);
    if (!ASSET_ENTITY_TYPES.has(t)) {
      throw new AppError('Manual create only for ride/show/restaurant/shop assets', 400, { code: 'INVALID_ENTITY_TYPE' });
    }
    const { parkId: parkKey, name, slug, asset } = body;
    if (!parkKey || !name) {
      throw new AppError('parkId and name are required', 422, { code: 'VALIDATION' });
    }
    const park = await this.resolveParkFromKey(parkKey);
    if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
    const parkId = park.id;
    const typeCode = ASSET_TYPE_CODE[t];
    const typeRow = await this.repo().findAssetTypeByCode(typeCode);
    if (!typeRow) throw new AppError(`Missing asset type ${typeCode}`, 500);

    const { sequelize, ParkAsset, ParkZone } = this.models();
    const zone = await ParkZone.findOne({ where: { parkId }, order: [['sortOrder', 'ASC']] });
    const zoneId = zone ? zone.id : null;
    const extId = `manual-${require('crypto').randomUUID()}`;
    const finalSlug = (slug || `${typeCode.toLowerCase()}-${extId.slice(-8)}`).slice(0, 160);

    const tr = await sequelize.transaction();
    let created;
    try {
      created = await ParkAsset.create(
        {
          parkId,
          zoneId,
          parentAssetId: null,
          assetTypeId: typeRow.id,
          name: String(name).slice(0, 240),
          slug: finalSlug,
          status: (asset && asset.status) || 'UNKNOWN',
          activeFlag: true,
          externalSource: 'MANUAL',
          externalEntityId: extId,
          externalParentId: null,
          syncManaged: false,
          providerSnapshot: {},
          enrichment: { source: 'manual' },
        },
        { transaction: tr }
      );
      await this.repo().ensureSpecialization(created, typeCode, tr);
      await tr.commit();
    } catch (e) {
      await tr.rollback();
      throw e;
    }
    return this.getById(entityType, created.assetId);
  }

  async applyTemplate(entityType, id, body) {
    const { EntityTypeTemplate } = this.models();
    const t = this.assertEntityType(entityType);
    const tpl = await EntityTypeTemplate.findByPk(body.templateId);
    if (!tpl || !tpl.activeFlag) throw new AppError('Template not found', 404, { code: 'NOT_FOUND' });
    const expectedByTab = {
      parks: 'PARK',
      rides: 'RIDE',
      shows: 'SHOW',
      restaurants: 'RESTAURANT',
      shops: 'SHOP',
    };
    const expected = expectedByTab[t];
    if (!expected || String(tpl.entityType) !== expected) {
      throw new AppError('Template entity type mismatch', 400, { code: 'TEMPLATE_TYPE_MISMATCH' });
    }
    const modeRaw = String(body.mode || 'fill_empty').toLowerCase();
    const useOverride = modeRaw === 'override';
    if (t === 'parks') {
      const row = await this.resolveParkFromKey(id);
      if (!row) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
      const nextMp = useOverride
        ? mergeTemplateOverride(row.masterProfile || {}, row.enrichment, tpl)
        : mergeTemplateDefaults(row.masterProfile || {}, row.enrichment, tpl);
      const req = Array.isArray(tpl.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
      const enr = { ...(row.enrichment || {}) };
      if (req.length) enr.profileCompleteness = profileCompleteness(req, nextMp, row);
      else delete enr.profileCompleteness;
      await row.update({ templateId: tpl.id, masterProfile: nextMp, enrichment: enr });
      return this.getById('parks', row.id);
    }
    if (t === 'zones') {
      throw new AppError('Templates not supported for zones', 400, { code: 'NOT_SUPPORTED' });
    }
    const asset = await this.resolveAssetFromKey(t, id);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const nextMp = useOverride
      ? mergeTemplateOverride(asset.masterProfile || {}, asset.enrichment, tpl)
      : mergeTemplateDefaults(asset.masterProfile || {}, asset.enrichment, tpl);
    const req = Array.isArray(tpl.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
    const full = await this.repo().getAssetById(asset.assetId);
    const rm = full?.rideMaster?.toJSON?.() || full?.rideMaster;
    const sm = full?.showMaster?.toJSON?.() || full?.showMaster;
    const rtm = full?.restaurantMaster?.toJSON?.() || full?.restaurantMaster;
    const flat = flattenTypedValues(nextMp, rm, sm, rtm);
    const enr = { ...(asset.enrichment || {}) };
    if (req.length) enr.profileCompleteness = profileCompleteness(req, flat, null);
    else delete enr.profileCompleteness;
    await asset.update({ templateId: tpl.id, masterProfile: nextMp, enrichment: enr });
    return this.getById(t, asset.assetId);
  }

  /**
   * @param {'json'|'spreadsheet'} mode json includes detail; spreadsheet adds parkId for Excel only
   */
  async _collectMasterDataExportItems(entityType, query, mode) {
    const t = this.assertEntityType(entityType);
    const MAX = 2000;
    const PAGE = 200;
    const filtersEcho = { ...(query || {}) };
    const items = [];
    let page = 0;
    while (items.length < MAX) {
      const q = {
        ...query,
        page,
        pageSize: PAGE,
        sortBy: query.sortBy || 'name',
        sortDir: query.sortDir || 'asc',
      };
      const chunk = await this.list(t, q);
      if (!chunk.rows.length) break;
      for (const row of chunk.rows) {
        if (items.length >= MAX) break;
        try {
          const bundle = await this.getById(t, row.id);
          const patchRaw = buildExportPatchFromBundle(bundle);
          const patch = jsonSafeClone(patchRaw);
          if (mode === 'json') {
            const detailRaw = MasterDataService.serializeDetail(bundle);
            items.push({
              id: row.id,
              detail: jsonSafeClone(detailRaw),
              patch,
            });
          } else {
            const plain = bundle.row.get ? bundle.row.get({ plain: true }) : bundle.row.toJSON?.();
            items.push({
              id: row.id,
              patch,
              parkId: plain?.parkId,
            });
          }
        } catch {
          /* row removed between list and get, or serialization edge case */
        }
      }
      if (chunk.rows.length < PAGE) break;
      page += 1;
    }
    return { entityType: t, filtersEcho, items, maxCap: MAX };
  }

  /**
   * Export full detail + patch rows for the same filters as the grid (max 2000 rows, paged internally).
   * @param {string} entityType
   * @param {object} query list query
   */
  async exportMasterData(entityType, query) {
    const { entityType: t, filtersEcho, items, maxCap } = await this._collectMasterDataExportItems(
      entityType,
      query,
      'json'
    );
    return {
      schemaVersion: 1,
      entityType: t,
      exportedAt: new Date().toISOString(),
      filterEcho: filtersEcho,
      totalExported: items.length,
      maxCap,
      items,
    };
  }

  /**
   * @returns {Buffer} xlsx
   */
  async exportMasterDataXlsx(entityType, query) {
    const { patchesToWorkbookBuffer } = require('./master-data-spreadsheet.helper');
    const t = this.assertEntityType(entityType);
    if (!['rides', 'shows', 'restaurants', 'shops'].includes(t)) {
      throw new AppError('Excel export is only for attractions, shows, restaurants, and shops.', 400, {
        code: 'EXCEL_ENTITY_UNSUPPORTED',
      });
    }
    const { items, filtersEcho } = await this._collectMasterDataExportItems(entityType, query, 'spreadsheet');
    return patchesToWorkbookBuffer(t, items, filtersEcho);
  }

  /**
   * @param {Buffer} buffer
   */
  async importMasterDataXlsx(entityType, buffer) {
    const { workbookBufferToPatches } = require('./master-data-spreadsheet.helper');
    const t = this.assertEntityType(entityType);
    if (!['rides', 'shows', 'restaurants', 'shops'].includes(t)) {
      throw new AppError('Excel import is only for attractions, shows, restaurants, and shops.', 400, {
        code: 'EXCEL_ENTITY_UNSUPPORTED',
      });
    }
    const items = workbookBufferToPatches(t, buffer);
    if (!items.length) {
      throw new AppError('No data rows with id found in spreadsheet', 400, { code: 'EMPTY_SPREADSHEET' });
    }
    return this.importMasterData(entityType, { schemaVersion: 1, entityType: t, items });
  }

  /**
   * Apply PATCH payloads in order; continues on errors and reports failures.
   * @param {string} entityType
   * @param {{ schemaVersion?: number, entityType?: string, items: { id: string, patch: object }[] }} body
   */
  async importMasterData(entityType, body) {
    const t = this.assertEntityType(entityType);
    if (body.schemaVersion != null && body.schemaVersion !== 1) {
      throw new AppError('Unsupported schemaVersion (expected 1)', 400, { code: 'BAD_SCHEMA' });
    }
    if (body.entityType != null && normalizeEntityType(body.entityType) !== t) {
      throw new AppError('entityType in JSON does not match URL', 400, { code: 'ENTITY_TYPE_MISMATCH' });
    }
    const appliedIds = [];
    const failed = [];
    for (const entry of body.items) {
      try {
        if (!entry || !entry.id || !entry.patch || typeof entry.patch !== 'object') {
          throw new AppError('Each item needs id and patch', 400, { code: 'VALIDATION' });
        }
        await this.patch(t, entry.id, entry.patch);
        appliedIds.push(entry.id);
      } catch (e) {
        failed.push({
          id: entry?.id,
          error: e instanceof AppError ? e.message : String(e.message || e),
          code: e instanceof AppError ? e.code : undefined,
        });
      }
    }
    return {
      entityType: t,
      appliedCount: appliedIds.length,
      appliedIds,
      failedCount: failed.length,
      failed,
    };
  }

  async getEnrichment(assetId) {
    const canonicalId = await this.resolveAssetIdForEnrichment(assetId);
    if (!canonicalId) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const asset = await this.models().ParkAsset.findByPk(canonicalId);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    return { assetId: canonicalId, enrichment: asset.enrichment || {}, locks: (asset.enrichment || {}).locks || {} };
  }

  async patchEnrichment(assetId, body) {
    const canonicalId = await this.resolveAssetIdForEnrichment(assetId);
    if (!canonicalId) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const asset = await this.models().ParkAsset.findByPk(canonicalId);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    const next = { ...(asset.enrichment || {}), ...(body.enrichment || {}) };
    if (body.locks && typeof body.locks === 'object') {
      next.locks = { ...(next.locks || {}), ...body.locks };
    }
    await asset.update({ enrichment: next });
    return this.getEnrichment(canonicalId);
  }
}

module.exports = { MasterDataService, normalizeEntityType, ASSET_TYPE_CODE };
