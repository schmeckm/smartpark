const EXTERNAL_SOURCE = 'THEMEPARKS_WIKI';

const TYPE_MAP = {
  PARK: 'PARK',
  ATTRACTION: 'RIDE',
  RIDE: 'RIDE',
  SHOW: 'SHOW',
  RESTAURANT: 'RESTAURANT',
  SHOP: 'SHOP',
  HOTEL: 'HOTEL',
  FACILITY: 'FACILITY',
  TOILET: 'TOILET',
  ENTRANCE: 'ENTRANCE',
  PARKING: 'PARKING',
  SERVICE: 'SERVICE_POINT',
  TRANSPORT: 'SERVICE_POINT',
  PLAYGROUND: 'FACILITY',
  DESTINATION: 'PARK',
};

/**
 * Map ThemeParks.wiki entityType to internal asset_types.code
 * @param {string | null | undefined} entityType
 * @returns {string}
 */
function mapExternalEntityType(entityType) {
  const k = String(entityType || '')
    .toUpperCase()
    .trim();
  if (TYPE_MAP[k]) return TYPE_MAP[k];
  return 'FACILITY';
}

/**
 * Map ThemeParks live status string to park_assets.status (operational rollup, not queue).
 * @param {string | null | undefined} status
 * @returns {string}
 */
function mapLiveStatusToAssetStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'OPERATING') return 'OPEN';
  if (['CLOSED', 'REFURBISHMENT', 'DOWN', 'CLOSED_FOR_SEASON'].includes(s)) return 'CLOSED';
  if (!s) return 'UNKNOWN';
  return s.length > 32 ? s.slice(0, 32) : s;
}

/**
 * ThemeParks / canonical entity payload → shared park_assets columns (CRUD may refine).
 * @param {Record<string, unknown>} raw
 * @returns {{ description: string | null, shortName: string | null, zoneLabel: string | null }}
 */
function extractCommonAssetFields(raw) {
  if (!raw || typeof raw !== 'object') {
    return { description: null, shortName: null, zoneLabel: null };
  }
  let description = null;
  const d = raw.description;
  if (typeof d === 'string') description = d;
  else if (d && typeof d === 'object') {
    if (typeof d.markdown === 'string') description = d.markdown;
    else if (typeof d.body === 'string') description = d.body;
  }
  const name = String(raw.name || '').trim() || 'Unnamed';
  const sn = raw.shortName != null && String(raw.shortName).trim() !== '' ? String(raw.shortName).trim() : null;
  const shortName = sn && sn !== name ? sn.slice(0, 120) : name.length > 60 ? `${name.slice(0, 57)}…` : null;
  let zoneLabel = null;
  const land = raw.land;
  if (land && typeof land === 'object' && land.name) zoneLabel = String(land.name);
  else if (typeof land === 'string' && land.trim()) zoneLabel = land.trim();
  if (!zoneLabel && raw.area && typeof raw.area === 'string') zoneLabel = raw.area.trim();
  return {
    description: description ? String(description).slice(0, 20000) : null,
    shortName: shortName ? shortName.slice(0, 120) : null,
    zoneLabel: zoneLabel ? zoneLabel.slice(0, 200) : null,
  };
}

module.exports = {
  EXTERNAL_SOURCE,
  mapExternalEntityType,
  mapLiveStatusToAssetStatus,
  extractCommonAssetFields,
};
