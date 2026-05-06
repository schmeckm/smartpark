/**
 * ThemeParks.wiki: entityType → UNS domain; entity registry (Sparkplug group × device slug);
 * persisted in app_settings. Domain is always derived from entityType — no name guessing.
 */

const { logger } = require('../../utils/logger');
const { slugifyName } = require('./uns-topic-generator.service');

const ENTITY_REGISTRY_SETTINGS_KEY = 'uns.themeParksEntityRegistry';
/** @deprecated migrated into ENTITY_REGISTRY_SETTINGS_KEY on load */
const LEGACY_DOMAIN_REGISTRY_KEY = 'uns.themeParksEntityDomainRegistry';

/** @type {Map<string, ThemeParksRegistryRow>} */
const memoryRegistry = new Map();

let persistTimer = null;

/**
 * @typedef {{
 *   domain: string,
 *   entityType: string | null,
 *   id: string | null,
 *   name: string | null,
 *   parentId: string | null,
 *   parentSlug: string | null,
 *   parkId: string | null,
 *   destinationId: string | null,
 *   externalId: string | null,
 * }} ThemeParksRegistryRow
 */

function registryStorageKey(groupId, deviceId) {
  return `${slugifyName(groupId)}::${slugifyName(deviceId)}`;
}

const ENUM_TO_DOMAIN = {
  DESTINATION: 'destinations',
  PARK: 'parks',
  ATTRACTION: 'rides',
  RIDE: 'rides',
  PLAYGROUND: 'playgrounds',
  RESTAURANT: 'restaurants',
  SHOW: 'shows',
  SHOP: 'shops',
  HOTEL: 'hotels',
  TRANSPORT: 'transport',
  SERVICE: 'services',
};

const SLUG_TO_DOMAIN = {
  restaurant: 'restaurants',
  ride: 'rides',
  attraction: 'rides',
  hotel: 'hotels',
  shop: 'shops',
  service: 'services',
  destination: 'destinations',
  park: 'parks',
  playground: 'playgrounds',
  playgrounds: 'playgrounds',
};

/**
 * @param {string | null | undefined} entityType ThemeParks enum, or UNS domain slug (e.g. from DBIRTH metric)
 * @returns {string} UNS domain segment
 */
function normalizeThemeParksEntityType(entityType) {
  const raw = String(entityType || '').trim();
  if (!raw) return 'entities';
  const t = raw.toUpperCase();
  if (ENUM_TO_DOMAIN[t]) return ENUM_TO_DOMAIN[t];
  const slug = slugifyName(raw);
  const canonicalValues = new Set([...Object.values(ENUM_TO_DOMAIN), 'playgrounds', 'entities']);
  if (canonicalValues.has(slug)) return slug;
  if (SLUG_TO_DOMAIN[slug]) return SLUG_TO_DOMAIN[slug];
  return 'entities';
}

/**
 * Domain for UNS / Sparkplug metadata from entityType only (fachliche Wahrheit).
 * @param {string | null | undefined} _entityName unused — kept for call-site compatibility
 * @param {string | null | undefined} entityType
 */
function resolveThemeParksPublicationDomain(_entityName, entityType) {
  if (entityType != null && String(entityType).trim() !== '') {
    return normalizeThemeParksEntityType(entityType);
  }
  return 'entities';
}

/**
 * @param {{ groupId: string; deviceId: string; domain: string; entityType?: string | null }} p
 */
function registerThemeParksDeviceDomain({ groupId, deviceId, domain, entityType = null }) {
  if (!groupId || !deviceId) return;
  const key = registryStorageKey(groupId, deviceId);
  const prev = memoryRegistry.get(key) || {};
  const et =
    entityType != null && String(entityType).trim() !== ''
      ? String(entityType).toUpperCase()
      : prev.entityType || null;
  /** Prefer ThemeParks enum over Sparkplug domain slug so DBIRTH cannot downgrade e.g. RESTAURANT → rides. */
  let dom;
  if (et) dom = normalizeThemeParksEntityType(et);
  else if (prev.entityType) dom = normalizeThemeParksEntityType(prev.entityType);
  else dom = slugifyName(String(domain || prev.domain || 'entities'));
  memoryRegistry.set(key, {
    ...prev,
    domain: dom,
    entityType: et || prev.entityType || null,
  });
  schedulePersistEntityDomainRegistry();
}

/**
 * @param {{ groupId: string; deviceId: string; domainSegment: string }} p
 */
function registerFromSparkplugDbirthMetric({ groupId, deviceId, domainSegment }) {
  if (!groupId || !deviceId || domainSegment == null) return;
  const raw = String(domainSegment).trim();
  const domain = normalizeThemeParksEntityType(raw);
  registerThemeParksDeviceDomain({
    groupId,
    deviceId,
    domain,
    entityType: /^[A-Z][A-Z0-9_]*$/.test(raw) ? raw : null,
  });
}

/** @returns {string | null} */
function getRegisteredEntityDomain(groupId, deviceId) {
  const row = getRegisteredEntityRow(groupId, deviceId);
  return row?.domain || null;
}

/** @returns {ThemeParksRegistryRow | null} */
function getRegisteredEntityRow(groupId, deviceId) {
  if (!groupId || !deviceId) return null;
  return memoryRegistry.get(registryStorageKey(groupId, deviceId)) || null;
}

/**
 * Sparkplug UNS Live: exact `groupId::deviceId`, then any key ending with the same device slug
 * (prefer same Sparkplug group when multiple parks share a buffer).
 * @param {string | null | undefined} groupId
 * @param {string | null | undefined} deviceId
 * @returns {ThemeParksRegistryRow | null}
 */
function getRegisteredEntityRowForSparkplugLookup(groupId, deviceId) {
  if (!deviceId) return null;
  const direct = getRegisteredEntityRow(groupId, deviceId);
  if (direct) return direct;
  const dg = groupId != null && String(groupId).trim() !== '' ? slugifyName(groupId) : '';
  const dd = slugifyName(deviceId);
  let fallback = null;
  for (const [k, row] of memoryRegistry) {
    const parts = String(k).split('::');
    if (parts.length < 2) continue;
    const kg = slugifyName(parts[0]);
    const kd = slugifyName(parts[1]);
    if (kd !== dd) continue;
    if (dg && kg === dg) return row;
    if (!fallback) fallback = row;
  }
  return fallback;
}

/**
 * Upsert registry rows from canonical messages (DESTINATION_SYNCED, PARK_SYNCED, PARK_ENTITY_SYNCED).
 * @param {{ sparkplugGroupId: string; parkExternalId?: string | null; destinationExternalId?: string | null; messages: Array<Record<string, unknown>> }} p
 */
function mergeThemeParksEntityRegistryFromMessages({ sparkplugGroupId, parkExternalId, destinationExternalId, messages }) {
  const gid = String(sparkplugGroupId || '').trim();
  if (!gid) return;
  const gidSlug = slugifyName(gid);
  const parkKey = parkExternalId != null ? String(parkExternalId) : null;
  const destKey = destinationExternalId != null ? String(destinationExternalId) : null;

  const parkEntityMsgs = (messages || []).filter((m) => m && m.messageType === 'PARK_ENTITY_SYNCED');
  const byExternalId = new Map();
  for (const m of parkEntityMsgs) {
    const p = m.payload || {};
    const id = String(m.externalEntityId || p.id || p.externalId || '').trim();
    if (!id) continue;
    const name = String(p.name ?? p.externalEntityName ?? '').trim() || id;
    const entitySlug = slugifyName(p.slug || name || id);
    const et = String(m.entityType || p.entityType || '').trim().toUpperCase() || null;
    const parentRaw = p.parentId != null ? p.parentId : p.metadata?.parentId;
    const parentId = parentRaw != null && String(parentRaw).trim() !== '' ? String(parentRaw).trim() : null;
    const rowDestinationId = p.destinationId != null && String(p.destinationId).trim() !== '' ? String(p.destinationId).trim() : null;
    const rowParkId = p.parkId != null && String(p.parkId).trim() !== '' ? String(p.parkId).trim() : null;
    byExternalId.set(id, { id, name, entitySlug, entityType: et, parentId, rowDestinationId, rowParkId });
  }

  for (const [, row] of byExternalId) {
    let parentSlug = null;
    if (row.parentId && parkKey && row.parentId === parkKey) {
      parentSlug = gidSlug;
    } else if (row.parentId) {
      const pr = byExternalId.get(row.parentId);
      if (pr) parentSlug = pr.entitySlug;
    }
    const domain = normalizeThemeParksEntityType(row.entityType);
    memoryRegistry.set(registryStorageKey(gid, row.entitySlug), {
      id: row.id,
      name: row.name,
      entityType: row.entityType,
      domain,
      parentId: row.parentId,
      parentSlug,
      parkId: row.rowParkId || parkKey,
      destinationId: row.rowDestinationId || destKey,
      externalId: row.id,
    });
  }

  for (const m of (messages || []).filter((x) => x && x.messageType === 'DESTINATION_SYNCED')) {
    const p = m.payload || {};
    const id = String(m.externalDestinationId || p.externalDestinationId || p.id || '').trim();
    if (!id) continue;
    const name = String(p.name ?? '').trim() || id;
    const entitySlug = slugifyName(p.slug || name || id);
    memoryRegistry.set(registryStorageKey(entitySlug, entitySlug), {
      id,
      name,
      entityType: 'DESTINATION',
      domain: 'destinations',
      parentId: null,
      parentSlug: null,
      parkId: null,
      destinationId: id,
      externalId: id,
    });
  }

  for (const m of (messages || []).filter((x) => x && x.messageType === 'PARK_SYNCED')) {
    const p = m.payload || {};
    const id = String(m.externalParkId || p.externalParkId || p.id || '').trim();
    if (!id) continue;
    const name = String(p.name ?? '').trim() || id;
    const entitySlug = slugifyName(p.slug || name || id);
    const parkSparkplugGid = slugifyName(name);
    const parentId =
      p.parentId != null && String(p.parentId).trim() !== ''
        ? String(p.parentId).trim()
        : m.externalDestinationId != null
          ? String(m.externalDestinationId)
          : null;
    memoryRegistry.set(registryStorageKey(parkSparkplugGid, entitySlug), {
      id,
      name,
      entityType: 'PARK',
      domain: 'parks',
      parentId,
      parentSlug: parentId ? slugifyName(parentId) : null,
      parkId: id,
      destinationId: destKey || parentId,
      externalId: id,
    });
  }

  schedulePersistEntityDomainRegistry();
}

/**
 * Upsert minimal registry rows from live canonical messages when no PARK_ENTITY_SYNCED row exists yet.
 */
function mergeThemeParksEntityRegistryFromLiveMessages({ sparkplugGroupId, parkExternalId, destinationExternalId, messages }) {
  const gid = String(sparkplugGroupId || '').trim();
  if (!gid) return;
  const parkKey = parkExternalId != null ? String(parkExternalId) : null;
  const destKey = destinationExternalId != null ? String(destinationExternalId) : null;
  const liveLike = (messages || []).filter(
    (x) => x && (x.messageType === 'WAIT_TIME_UPDATED' || x.messageType === 'ENTITY_STATUS_UPDATED')
  );
  for (const m of liveLike) {
    const p = m.payload || {};
    const id = String(m.externalEntityId || '').trim();
    if (!id) continue;
    const entitySlug = slugifyName(p.slug || p.externalEntityName || p.name || id);
    const et = String(m.entityType || p.entityType || '').trim().toUpperCase() || null;
    const key = registryStorageKey(gid, entitySlug);
    if (memoryRegistry.has(key)) continue;
    const domain = normalizeThemeParksEntityType(et);
    const rowDest = p.destinationId != null && String(p.destinationId).trim() !== '' ? String(p.destinationId).trim() : null;
    const rowPark = p.parkId != null && String(p.parkId).trim() !== '' ? String(p.parkId).trim() : null;
    memoryRegistry.set(key, {
      id,
      name: String(p.externalEntityName || p.name || '').trim() || null,
      entityType: et,
      domain,
      parentId: p.parentId != null && String(p.parentId).trim() !== '' ? String(p.parentId).trim() : null,
      parentSlug: null,
      parkId: rowPark || parkKey,
      destinationId: rowDest || destKey,
      externalId: id,
    });
  }
  if (liveLike.length) schedulePersistEntityDomainRegistry();
}

function schedulePersistEntityDomainRegistry() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const { AppSettingRepository } = require('../../repositories/app-setting.repository');
      const repo = new AppSettingRepository();
      const obj = Object.fromEntries(memoryRegistry);
      await repo.upsertValue(ENTITY_REGISTRY_SETTINGS_KEY, obj);
    } catch (e) {
      logger.warn({ err: e.message }, 'themeParksEntityRegistry persist failed');
    }
  }, 2500);
}

async function loadEntityDomainRegistry(settingRepository) {
  if (!settingRepository) return;
  try {
    const modern = await settingRepository.getValue(ENTITY_REGISTRY_SETTINGS_KEY, null);
    if (modern && typeof modern === 'object') {
      for (const [k, v] of Object.entries(modern)) {
        if (v && typeof v === 'object' && v.domain) {
          memoryRegistry.set(k, normalizeRegistryRow(v));
        }
      }
      logger.info({ entries: memoryRegistry.size }, 'themeParksEntityRegistry loaded');
      return;
    }
    const legacy = await settingRepository.getValue(LEGACY_DOMAIN_REGISTRY_KEY, null);
    if (legacy && typeof legacy === 'object') {
      for (const [k, v] of Object.entries(legacy)) {
        if (v && typeof v === 'object' && v.domain) {
          memoryRegistry.set(k, {
            domain: String(v.domain),
            entityType: v.entityType != null ? String(v.entityType) : null,
            id: null,
            name: null,
            parentId: null,
            parentSlug: null,
            parkId: null,
            destinationId: null,
            externalId: null,
          });
        }
      }
      logger.info({ entries: memoryRegistry.size }, 'themeParksEntityRegistry loaded from legacy domain map');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'themeParksEntityRegistry load failed');
  }
}

/**
 * @param {Record<string, unknown>} v
 * @returns {ThemeParksRegistryRow}
 */
function normalizeRegistryRow(v) {
  const entityType = v.entityType != null ? String(v.entityType).toUpperCase() : null;
  const domain = normalizeThemeParksEntityType(entityType || v.domain);
  return {
    domain,
    entityType,
    id: v.id != null ? String(v.id) : null,
    name: v.name != null ? String(v.name) : null,
    parentId: v.parentId != null ? String(v.parentId) : null,
    parentSlug: v.parentSlug != null ? String(v.parentSlug) : null,
    parkId: v.parkId != null ? String(v.parkId) : null,
    destinationId: v.destinationId != null ? String(v.destinationId) : null,
    externalId: v.externalId != null ? String(v.externalId) : null,
  };
}

module.exports = {
  normalizeThemeParksEntityType,
  resolveThemeParksPublicationDomain,
  registerThemeParksDeviceDomain,
  registerFromSparkplugDbirthMetric,
  getRegisteredEntityDomain,
  getRegisteredEntityRow,
  getRegisteredEntityRowForSparkplugLookup,
  mergeThemeParksEntityRegistryFromMessages,
  mergeThemeParksEntityRegistryFromLiveMessages,
  loadEntityDomainRegistry,
  ENTITY_REGISTRY_SETTINGS_KEY,
  LEGACY_DOMAIN_REGISTRY_KEY,
  /** @deprecated use ENTITY_REGISTRY_SETTINGS_KEY */
  SETTINGS_KEY: ENTITY_REGISTRY_SETTINGS_KEY,
};
