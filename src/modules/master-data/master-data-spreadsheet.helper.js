const XLSX = require('xlsx');
const { AppError } = require('../../utils/app-error');

const SHEET_DATA = 'Data';
const SHEET_README = 'Readme';

function normalizeEntityType(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'attraction' || s === 'attractions') return 'rides';
  return s;
}

/** @type {Set<string>} */
const SPREADSHEET_ENTITY_TYPES = new Set(['rides', 'shows', 'restaurants', 'shops']);

/** Columns that must stay strings when importing from Excel */
const STRING_VALUE_COLUMNS = new Set([
  'ride_ride_category',
  'ride_manufacturer',
  'ride_plc_type',
  'ride_maintenance_class',
  'show_show_type',
  'show_venue_name',
  'show_schedule_pattern',
  'show_first_show_time',
  'show_last_show_time',
  'show_language',
  'show_audience_rating',
  'restaurant_restaurant_type',
  'restaurant_cuisine_type',
  'restaurant_service_style',
  'shop_retail_category',
  'target_revenue_priority',
]);

function assertSpreadsheetEntity(entityType) {
  const t = normalizeEntityType(entityType);
  if (!SPREADSHEET_ENTITY_TYPES.has(t)) {
    const err = new Error('Excel is only for attractions, shows, restaurants, and shops.');
    err.statusCode = 400;
    err.code = 'EXCEL_ENTITY_UNSUPPORTED';
    throw err;
  }
  return t;
}

function camelToSnake(s) {
  return String(s).replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function snakeToCamel(s) {
  return String(s).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {unknown} v
 * @returns {boolean|undefined}
 */
function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === '' || v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return undefined;
}

/**
 * @param {unknown} v
 * @returns {number|undefined}
 */
function parseNum(v) {
  if (v === '' || v === undefined || v === null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * @param {unknown} v
 * @returns {string|undefined}
 */
function parseStr(v) {
  if (v === '' || v === undefined || v === null) return undefined;
  return String(v).trim();
}

const BASE_COLUMNS = [
  'id',
  'name',
  'slug',
  'short_name',
  'description',
  'status',
  'active_flag',
  'opening_flag',
  'zone_id',
  'latitude',
  'longitude',
  'provider',
  'external_entity_id',
  'park_id',
  'template_id',
  'master_profile_json',
];

/** ride_* → RideMasterData */
const RIDE_COLUMNS = [
  'ride_capacity_pph',
  'ride_theoretical_capacity_pph',
  'ride_dispatch_interval_sec',
  'ride_cycle_time_sec',
  'ride_seats_per_cycle',
  'ride_trains_count',
  'ride_ride_category',
  'ride_min_staff',
  'ride_normal_staff',
  'ride_peak_staff',
  'ride_weather_sensitive',
  'ride_rain_sensitive',
  'ride_wind_limit_kmh',
  'ride_min_height_cm',
  'ride_max_height_cm',
  'ride_thrill_level',
  'ride_manufacturer',
  'ride_build_year',
  'ride_plc_type',
  'ride_maintenance_class',
  'ride_max_speed_kmh',
  'ride_structure_height_m',
  'ride_track_length_m',
  'ride_virtual_line_enabled',
];

const SHOW_COLUMNS = [
  'show_show_type',
  'show_venue_name',
  'show_duration_min',
  'show_seats_capacity',
  'show_standing_capacity',
  'show_schedule_pattern',
  'show_shows_per_day',
  'show_first_show_time',
  'show_last_show_time',
  'show_performer_count',
  'show_technical_staff',
  'show_operator_staff',
  'show_language',
  'show_indoor_flag',
  'show_weather_sensitive',
  'show_audience_rating',
];

const RESTAURANT_COLUMNS = [
  'restaurant_restaurant_type',
  'restaurant_cuisine_type',
  'restaurant_indoor_seats',
  'restaurant_outdoor_seats',
  'restaurant_max_capacity',
  'restaurant_seating_capacity',
  'restaurant_avg_service_time_min',
  'restaurant_avg_table_turnover_min',
  'restaurant_kitchen_capacity_orders_h',
  'restaurant_kitchen_staff_min',
  'restaurant_service_staff_min',
  'restaurant_peak_staff',
  'restaurant_avg_basket_value',
  'restaurant_alcohol_license',
  'restaurant_mobile_ordering',
  'restaurant_service_style',
];

const SHOP_COLUMNS = ['shop_retail_category', 'shop_square_meters'];

const TARGET_COLUMNS = [
  'target_target_availability_pct',
  'target_target_wait_time_min',
  'target_target_utilization_pct',
  'target_target_oee_pct',
  'target_revenue_priority',
];

function headersForEntity(entityType) {
  const t = assertSpreadsheetEntity(entityType);
  const h = [...BASE_COLUMNS];
  if (t === 'rides') h.push(...RIDE_COLUMNS);
  if (t === 'shows') h.push(...SHOW_COLUMNS);
  if (t === 'restaurants') h.push(...RESTAURANT_COLUMNS);
  if (t === 'shops') h.push(...SHOP_COLUMNS);
  h.push(...TARGET_COLUMNS);
  return h;
}

/**
 * @param {string} entityType
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @param {string} [parkId]
 */
function patchToFlatRow(entityType, id, patch, parkId) {
  assertSpreadsheetEntity(entityType);
  const row = { id };
  const a = patch.asset && typeof patch.asset === 'object' ? patch.asset : {};
  if (a.name != null) row.name = a.name;
  if (a.slug != null) row.slug = a.slug;
  if (a.shortName != null) row.short_name = a.shortName;
  if (a.description != null) row.description = a.description;
  if (a.status != null) row.status = a.status;
  if (a.activeFlag !== undefined) row.active_flag = a.activeFlag;
  if (a.openingFlag !== undefined) row.opening_flag = a.openingFlag;
  if (a.zoneId !== undefined && a.zoneId !== null) row.zone_id = a.zoneId;
  if (a.latitude !== undefined && a.latitude !== null) row.latitude = a.latitude;
  if (a.longitude !== undefined && a.longitude !== null) row.longitude = a.longitude;
  if (a.externalSource != null) row.provider = a.externalSource;
  if (a.externalEntityId != null) row.external_entity_id = a.externalEntityId;
  if (parkId) row.park_id = parkId;
  if (patch.templateId !== undefined && patch.templateId !== null) row.template_id = patch.templateId;
  if (patch.masterProfile && typeof patch.masterProfile === 'object' && Object.keys(patch.masterProfile).length) {
    row.master_profile_json = JSON.stringify(patch.masterProfile);
  }

  function flattenMaster(prefix, obj, colList) {
    if (!obj || typeof obj !== 'object') return;
    const plain = typeof obj.toJSON === 'function' ? obj.toJSON() : obj;
    for (const col of colList) {
      const snake = col.slice(prefix.length);
      const camel = snakeToCamel(snake);
      if (Object.prototype.hasOwnProperty.call(plain, camel) && plain[camel] !== undefined && plain[camel] !== null) {
        row[col] = plain[camel];
      }
    }
  }

  const t = normalizeEntityType(entityType);
  if (t === 'rides' && patch.rideMaster) flattenMaster('ride_', patch.rideMaster, RIDE_COLUMNS);
  if (t === 'shows' && patch.showMaster) flattenMaster('show_', patch.showMaster, SHOW_COLUMNS);
  if (t === 'restaurants' && patch.restaurantMaster)
    flattenMaster('restaurant_', patch.restaurantMaster, RESTAURANT_COLUMNS);
  if (t === 'shops' && patch.shopMaster) flattenMaster('shop_', patch.shopMaster, SHOP_COLUMNS);

  const tg = patch.targets && typeof patch.targets === 'object' ? patch.targets : null;
  if (tg) {
    const map = [
      ['target_target_availability_pct', 'targetAvailabilityPct'],
      ['target_target_wait_time_min', 'targetWaitTimeMin'],
      ['target_target_utilization_pct', 'targetUtilizationPct'],
      ['target_target_oee_pct', 'targetOeePct'],
      ['target_revenue_priority', 'revenuePriority'],
    ];
    for (const [col, camel] of map) {
      if (tg[camel] !== undefined && tg[camel] !== null) row[col] = tg[camel];
    }
  }

  return row;
}

/**
 * @param {string} entityType
 * @param {Record<string, unknown>} row
 */
function flatRowToPatch(entityType, row) {
  assertSpreadsheetEntity(entityType);
  const t = normalizeEntityType(entityType);
  const patch = {};
  const asset = {};

  const name = parseStr(row.name);
  const slug = parseStr(row.slug);
  const shortName = parseStr(row.short_name);
  const description = parseStr(row.description);
  const status = parseStr(row.status);
  const zoneIdRaw = parseStr(row.zone_id);
  const lat = parseNum(row.latitude);
  const lng = parseNum(row.longitude);
  const provider = parseStr(row.provider);
  const extId = parseStr(row.external_entity_id);
  const tpl = parseStr(row.template_id);

  if (name !== undefined) asset.name = name;
  if (slug !== undefined) asset.slug = slug;
  if (shortName !== undefined) asset.shortName = shortName;
  if (description !== undefined) asset.description = description;
  if (status !== undefined) asset.status = status;
  const af = parseBool(row.active_flag);
  if (af !== undefined) asset.activeFlag = af;
  const of = parseBool(row.opening_flag);
  if (of !== undefined) asset.openingFlag = of;
  if (zoneIdRaw !== undefined) asset.zoneId = zoneIdRaw || null;
  if (lat !== undefined) asset.latitude = lat;
  if (lng !== undefined) asset.longitude = lng;
  if (provider !== undefined) asset.externalSource = provider;
  if (extId !== undefined) asset.externalEntityId = extId;

  if (Object.keys(asset).length) patch.asset = asset;
  if (tpl !== undefined) patch.templateId = tpl || null;

  const mpJson = parseStr(row.master_profile_json);
  if (mpJson !== undefined && mpJson !== '') {
    try {
      patch.masterProfile = JSON.parse(mpJson);
    } catch {
      throw new AppError('Invalid master_profile_json (must be valid JSON)', 422, {
        code: 'BAD_MASTER_PROFILE_JSON',
      });
    }
  }

  function collectPrefixed(prefix, colList) {
    const out = {};
    for (const col of colList) {
      if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
      const raw = row[col];
      if (raw === '' || raw === undefined || raw === null) continue;
      const snake = col.slice(prefix.length);
      const camel = snakeToCamel(snake);
      if (STRING_VALUE_COLUMNS.has(col)) {
        const s = parseStr(raw);
        if (s !== undefined) out[camel] = s;
        continue;
      }
      if (
        col.includes('sensitive') ||
        col.endsWith('_flag') ||
        col.includes('license') ||
        col.includes('ordering') ||
        col.endsWith('_virtual_line_enabled')
      ) {
        const b = parseBool(raw);
        if (b !== undefined) out[camel] = b;
      } else if (
        col.includes('_pct') ||
        col.includes('_pph') ||
        col.includes('_sec') ||
        col.includes('_count') ||
        col.includes('_staff') ||
        col.includes('_capacity') ||
        col.includes('_seats') ||
        col.includes('_meters') ||
        col.includes('_year') ||
        col.includes('_level') ||
        col.includes('_kmh') ||
        col.includes('structure_height_m') ||
        col.includes('track_length_m') ||
        col.includes('_day') ||
        col.includes('_value') ||
        col.includes('square_meters') ||
        col.endsWith('_min')
      ) {
        const n = parseNum(raw);
        if (n !== undefined) out[camel] = n;
      } else {
        out[camel] = raw;
      }
    }
    return out;
  }

  if (t === 'rides') {
    const rm = collectPrefixed('ride_', RIDE_COLUMNS);
    if (Object.keys(rm).length) patch.rideMaster = rm;
  }
  if (t === 'shows') {
    const sm = collectPrefixed('show_', SHOW_COLUMNS);
    if (Object.keys(sm).length) patch.showMaster = sm;
  }
  if (t === 'restaurants') {
    const rtm = collectPrefixed('restaurant_', RESTAURANT_COLUMNS);
    if (Object.keys(rtm).length) patch.restaurantMaster = rtm;
  }
  if (t === 'shops') {
    const sm = collectPrefixed('shop_', SHOP_COLUMNS);
    if (Object.keys(sm).length) patch.shopMaster = sm;
  }

  const targets = {};
  const ta = parseNum(row.target_target_availability_pct);
  const tw = parseNum(row.target_target_wait_time_min);
  const tu = parseNum(row.target_target_utilization_pct);
  const toee = parseNum(row.target_target_oee_pct);
  const rp = parseStr(row.target_revenue_priority);
  if (ta !== undefined) targets.targetAvailabilityPct = ta;
  if (tw !== undefined) targets.targetWaitTimeMin = tw;
  if (tu !== undefined) targets.targetUtilizationPct = tu;
  if (toee !== undefined) targets.targetOeePct = toee;
  if (rp !== undefined) targets.revenuePriority = rp;
  if (Object.keys(targets).length) patch.targets = targets;

  return patch;
}

/**
 * @param {string} entityType
 * @param {{ id: string, patch: Record<string, unknown>, parkId?: string }[]} items
 * @param {Record<string, unknown>} [filterEcho]
 * @returns {Buffer}
 */
function patchesToWorkbookBuffer(entityType, items, filterEcho = {}) {
  const t = assertSpreadsheetEntity(entityType);
  const headers = headersForEntity(t);
  const rows = items.map((it) => {
    const flat = patchToFlatRow(t, it.id, it.patch, it.parkId);
    const ordered = {};
    for (const h of headers) {
      if (Object.prototype.hasOwnProperty.call(flat, h)) ordered[h] = flat[h];
      else ordered[h] = '';
    }
    return ordered;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [Object.fromEntries(headers.map((h) => [h, '']))], {
    header: headers,
  });
  XLSX.utils.book_append_sheet(wb, ws, SHEET_DATA);

  const readmeLines = [
    ['Smart Park — Master data (Excel)'],
    ['Tab', t],
    ['Exported filters (echo)', JSON.stringify(filterEcho)],
    [''],
    ['Do not rename the Data sheet or column headers in row 1.'],
    ['Keep column `id` unchanged. Leave cells blank to skip updating that field.'],
    ['master_profile_json must be valid JSON or empty.'],
    ['After editing, save as .xlsx and use Upload Excel in Master data.'],
  ];
  const wsReadme = XLSX.utils.aoa_to_sheet(readmeLines);
  XLSX.utils.book_append_sheet(wb, wsReadme, SHEET_README);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * @param {string} entityType
 * @param {Buffer} buffer
 * @returns {{ id: string, patch: Record<string, unknown> }[]}
 */
function workbookBufferToPatches(entityType, buffer) {
  assertSpreadsheetEntity(entityType);
  const t = normalizeEntityType(entityType);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames.includes(SHEET_DATA) ? SHEET_DATA : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const items = [];
  for (const row of rows) {
    const id = parseStr(row.id);
    if (!id) continue;
    const patch = flatRowToPatch(t, row);
    if (!patch || typeof patch !== 'object') continue;
    /** Require at least one change besides empty object */
    const keys = Object.keys(patch);
    if (keys.length === 0) continue;
    items.push({ id, patch });
  }
  return items;
}

module.exports = {
  assertSpreadsheetEntity,
  patchesToWorkbookBuffer,
  workbookBufferToPatches,
  headersForEntity,
  SPREADSHEET_ENTITY_TYPES,
};
