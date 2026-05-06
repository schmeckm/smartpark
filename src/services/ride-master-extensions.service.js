'use strict';

const { SUPPORTED_DOMAINS } = require('../modules/uns/topic-layout/topic-layout.constants');

/**
 * Nested key on Park / ParkAsset `masterProfile` JSONB for Phase B metadata.
 * Kept separate from typed template fields (dispatch_interval_sec, etc.).
 */
const UNS_ASSET_EXTENSIONS_KEY = 'unsAssetExtensions';

const DEFAULT_EXTENSIONS = Object.freeze({
  schemaVersion: 1,
  domains: [],
  signals: {},
  capabilities: {},
});

function toPlainRecord(rideOrAsset) {
  if (rideOrAsset == null) return null;
  if (typeof rideOrAsset !== 'object') return null;
  if (typeof rideOrAsset.get === 'function') {
    try {
      const plain = rideOrAsset.get({ plain: true });
      if (plain && typeof plain === 'object') return plain;
    } catch {
      /* ignore */
    }
  }
  return rideOrAsset;
}

function getMasterProfile(record) {
  if (!record || typeof record !== 'object') return null;
  const mp = record.masterProfile ?? record.master_profile;
  if (mp && typeof mp === 'object') return mp;
  return null;
}

/**
 * Raw extension blob: either master_profile.unsAssetExtensions or mdm_rides.extensions.
 */
function getRawExtensionsFromRecord(rideOrAsset) {
  const record = toPlainRecord(rideOrAsset);
  if (!record) return null;
  const mp = getMasterProfile(record);
  if (mp && Object.hasOwn(mp, UNS_ASSET_EXTENSIONS_KEY)) {
    return mp[UNS_ASSET_EXTENSIONS_KEY];
  }
  if (Object.hasOwn(record, 'extensions')) {
    return record.extensions;
  }
  return null;
}

function coerceBool(v, defaultValue = false) {
  if (v === true || v === false) return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  if (v == null) return defaultValue;
  return defaultValue;
}

function coerceSchemaVersion(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 1;
}

function normalizeSignalEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { enabled: false, mlEligible: false, boardEligible: false, operationsEligible: true };
  }
  return {
    enabled: coerceBool(raw.enabled, false),
    mlEligible: coerceBool(raw.mlEligible, false),
    boardEligible: coerceBool(raw.boardEligible, false),
    /** Default true when omitted (Phase T.3 — Operations Facts legacy compatibility). */
    operationsEligible: raw.operationsEligible !== false,
  };
}

function normalizeCapabilities(raw) {
  const out = {
    hasQueueSignal: false,
    hasCycleSignal: false,
    hasEnergyMetering: false,
    supportsGreenOptimization: false,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(out)) {
    if (Object.hasOwn(raw, k)) {
      out[k] = coerceBool(raw[k], false);
    }
  }
  return out;
}

function normalizeDomains(arr) {
  const allowed = new Set(SUPPORTED_DOMAINS);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    const s = typeof x === 'string' ? x.trim().toLowerCase() : '';
    if (allowed.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function normalizeSignals(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    const k = key.trim();
    out[k] = normalizeSignalEntry(val);
  }
  return out;
}

/**
 * Safe parse: never throws; invalid input yields empty Phase B document.
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, domains: string[], signals: Record<string, { enabled: boolean, mlEligible: boolean, boardEligible: boolean, operationsEligible: boolean }>, capabilities: Record<string, boolean> }}
 */
function normalizeExtensions(raw) {
  try {
    if (raw == null) return { ...DEFAULT_EXTENSIONS, domains: [], signals: {}, capabilities: normalizeCapabilities({}) };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...DEFAULT_EXTENSIONS, domains: [], signals: {}, capabilities: normalizeCapabilities({}) };
    }
    const schemaVersion = coerceSchemaVersion(raw.schemaVersion);
    const domains = normalizeDomains(raw.domains);
    const signals = normalizeSignals(raw.signals);
    const capabilities = normalizeCapabilities(raw.capabilities);
    return { schemaVersion, domains, signals, capabilities };
  } catch {
    return { ...DEFAULT_EXTENSIONS, domains: [], signals: {}, capabilities: normalizeCapabilities({}) };
  }
}

function deepMergeSignalMap(baseSignals, patchSignals) {
  const out = { ...baseSignals };
  if (!patchSignals || typeof patchSignals !== 'object') return out;
  for (const [key, val] of Object.entries(patchSignals)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    const k = key.trim();
    if (val === null) {
      delete out[k];
      continue;
    }
    const prev = out[k] || normalizeSignalEntry(null);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[k] = normalizeSignalEntry({ ...prev, ...val });
    } else {
      out[k] = normalizeSignalEntry(prev);
    }
  }
  return out;
}

/**
 * Merge a partial patch into the current extensions for this record (not persisted).
 * @param {unknown} rideOrAsset
 * @param {Partial<{ schemaVersion: number, domains: string[], signals: object, capabilities: object }>} patch
 * @returns {{ schemaVersion: number, domains: string[], signals: Record<string, object>, capabilities: object }}
 */
function mergeExtensions(rideOrAsset, patch) {
  const current = getExtensions(rideOrAsset);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return normalizeExtensions(current);
  }
  const replaceSignals = patch.replaceSignals === true;
  let schemaVersion = current.schemaVersion;
  if (patch.schemaVersion != null) {
    schemaVersion = coerceSchemaVersion(patch.schemaVersion);
  }
  let domains = current.domains;
  if (Array.isArray(patch.domains)) {
    domains = normalizeDomains(patch.domains);
  }
  let signals;
  if (replaceSignals) {
    signals = normalizeSignals(patch.signals != null && typeof patch.signals === 'object' && !Array.isArray(patch.signals) ? patch.signals : {});
  } else if (patch.signals == null) {
    signals = { ...current.signals };
  } else {
    signals = deepMergeSignalMap(current.signals, patch.signals);
  }
  const capabilities =
    patch.capabilities != null && typeof patch.capabilities === 'object' && !Array.isArray(patch.capabilities)
      ? normalizeCapabilities({ ...current.capabilities, ...patch.capabilities })
      : normalizeCapabilities(current.capabilities);
  return normalizeExtensions({ schemaVersion, domains, signals, capabilities });
}

/**
 * @param {unknown} rideOrAsset
 */
function getExtensions(rideOrAsset) {
  return normalizeExtensions(getRawExtensionsFromRecord(rideOrAsset));
}

/**
 * @param {unknown} rideOrAsset
 * @returns {string[]}
 */
function getSupportedDomains(rideOrAsset) {
  return [...getExtensions(rideOrAsset).domains];
}

/**
 * @param {unknown} rideOrAsset
 * @returns {Record<string, { enabled: boolean, mlEligible: boolean, boardEligible: boolean, operationsEligible: boolean }>}
 */
function getSignals(rideOrAsset) {
  const src = getExtensions(rideOrAsset).signals;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = v && typeof v === 'object' ? { ...v } : normalizeSignalEntry(v);
  }
  return out;
}

/**
 * @param {unknown} rideOrAsset
 * @param {string} signalKey
 */
function isSignalEnabled(rideOrAsset, signalKey) {
  const key = typeof signalKey === 'string' ? signalKey.trim() : '';
  if (!key) return false;
  const s = getExtensions(rideOrAsset).signals[key];
  return Boolean(s?.enabled);
}

/**
 * @param {unknown} rideOrAsset
 * @param {string} signalKey
 */
function isSignalMlEligible(rideOrAsset, signalKey) {
  const key = typeof signalKey === 'string' ? signalKey.trim() : '';
  if (!key) return false;
  const s = getExtensions(rideOrAsset).signals[key];
  return Boolean(s?.mlEligible);
}

/**
 * @param {unknown} rideOrAsset
 * @param {string} signalKey
 */
function isSignalBoardEligible(rideOrAsset, signalKey) {
  const key = typeof signalKey === 'string' ? signalKey.trim() : '';
  if (!key) return false;
  const s = getExtensions(rideOrAsset).signals[key];
  return Boolean(s?.boardEligible);
}

/**
 * Apply merged extensions onto a master profile object (ParkAsset / Park). Does not persist.
 * @param {Record<string, unknown>|null|undefined} masterProfile
 * @param {ReturnType<typeof normalizeExtensions>} extensionsDoc
 * @returns {Record<string, unknown>}
 */
function withUnsExtensionsOnMasterProfile(masterProfile, extensionsDoc) {
  const mp = masterProfile && typeof masterProfile === 'object' && !Array.isArray(masterProfile) ? { ...masterProfile } : {};
  mp[UNS_ASSET_EXTENSIONS_KEY] = normalizeExtensions(extensionsDoc);
  return mp;
}

/**
 * Read-only API DTO for Phase C (`GET .../extensions`).
 * @param {'ride'|'park_asset'} entityType
 * @param {string} entityId
 * @param {unknown} rideOrAsset
 * @returns {{ entityType: string, entityId: string, domains: string[], signals: Record<string, { enabled: boolean, mlEligible: boolean, boardEligible: boolean, operationsEligible: boolean }>, capabilities: Record<string, boolean> }}
 */
function toReadApiPayload(entityType, entityId, rideOrAsset) {
  const ext = getExtensions(rideOrAsset);
  return {
    entityType,
    entityId: String(entityId),
    domains: [...ext.domains],
    signals: getSignals(rideOrAsset),
    capabilities: { ...ext.capabilities },
  };
}

/**
 * Persist normalized extensions document on `mdm_rides.extensions`.
 * @param {import('sequelize').Model} mdmRide
 * @param {ReturnType<typeof normalizeExtensions>} mergedDoc
 */
async function persistMdmRideExtensions(mdmRide, mergedDoc) {
  await mdmRide.update({ extensions: mergedDoc });
}

/**
 * Persist under `park_assets.master_profile.unsAssetExtensions`.
 * @param {import('sequelize').Model} parkAsset
 * @param {ReturnType<typeof normalizeExtensions>} mergedDoc
 */
async function persistParkAssetExtensions(parkAsset, mergedDoc) {
  const raw =
    typeof parkAsset.getDataValue === 'function' ? parkAsset.getDataValue('masterProfile') : parkAsset.masterProfile;
  const mp = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const next = withUnsExtensionsOnMasterProfile(mp, mergedDoc);
  await parkAsset.update({ masterProfile: next });
}

module.exports = {
  UNS_ASSET_EXTENSIONS_KEY,
  mergeExtensions,
  getExtensions,
  getSupportedDomains,
  getSignals,
  isSignalEnabled,
  isSignalMlEligible,
  isSignalBoardEligible,
  withUnsExtensionsOnMasterProfile,
  toReadApiPayload,
  persistMdmRideExtensions,
  persistParkAssetExtensions,
};
