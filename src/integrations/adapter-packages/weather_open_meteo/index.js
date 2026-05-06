/**
 * Open-Meteo weather adapter — park-level GPS only.
 * @see https://open-meteo.com/en/docs
 */

const ADAPTER_KEY = 'weather_open_meteo';
const PROVIDER_LABEL = 'Open-Meteo';

/** Same defaults as manifest.json when install omits coords (YAML often has empty configJson). */
const DEFAULT_LATITUDE = 48.2661;
const DEFAULT_LONGITUDE = 7.7225;
/** Same default as manifest `configSchema.properties.parkSlug.default`. */
const DEFAULT_PARK_SLUG = 'europa_park';

/**
 * Merge install context + config (config wins). Matches server `mergeAdapterInstallConfig`.
 * @param {object} [config]
 * @param {object} [context]
 */
function effectiveInstall(config, context) {
  const cfg = config && typeof config === 'object' ? config : {};
  const ctx = context && typeof context === 'object' ? context : {};
  return { ...ctx, ...cfg };
}

/**
 * @param {unknown} raw
 * @param {string} label
 * @param {number} min
 * @param {number} max
 * @param {number} defaultVal
 * @param {string[]} errors
 * @returns {number | null}
 */
function resolveAxis(raw, label, min, max, defaultVal, errors) {
  if (raw == null || raw === '') return defaultVal;
  let primitive = raw;
  if (typeof raw === 'object' && raw !== null) {
    if (raw instanceof Number) {
      primitive = Number(raw.valueOf());
    } else {
      errors.push(`${label} must be a finite number`);
      return null;
    }
  }
  const n =
    typeof primitive === 'number'
      ? primitive
      : Number(String(primitive).trim().replace(/,/g, '.'));
  if (!Number.isFinite(n)) {
    errors.push(`${label} must be a finite number`);
    return null;
  }
  if (n < min || n > max) {
    errors.push(`${label} out of range [${min}, ${max}]`);
    return null;
  }
  return n;
}

/**
 * @param {object} [config]
 * @returns {{ lat: number | null, lon: number | null, errors: string[] }}
 */
function resolveCoordinates(config) {
  const errors = [];
  const lat = resolveAxis(config?.latitude, 'latitude', -90, 90, DEFAULT_LATITUDE, errors);
  const lon = resolveAxis(config?.longitude, 'longitude', -180, 180, DEFAULT_LONGITUDE, errors);
  return { lat, lon, errors };
}

function resolveParkSlug(config) {
  const s = config?.parkSlug != null ? String(config.parkSlug).trim() : '';
  return s || DEFAULT_PARK_SLUG;
}

/** WMO Weather interpretation codes (subset) — https://open-meteo.com/en/docs */
function wmoCodeToCondition(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'unknown';
  if (c === 0) return 'clear';
  if (c <= 3) return 'mainly_clear_to_overcast';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain_showers';
  if (c >= 85 && c <= 86) return 'snow_showers';
  if (c >= 95 && c <= 99) return 'thunderstorm';
  return `wmo_${c}`;
}

function buildForecastUrl(lat, lon, timezone) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set(
    'current',
    'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code'
  );
  u.searchParams.set('timezone', timezone || 'UTC');
  return u.toString();
}

/**
 * @param {object} config
 * @param {object} _context
 */
async function validateConfig(config, context) {
  const errors = [];
  const eff = effectiveInstall(config, context);
  const geo = resolveCoordinates(eff);
  errors.push(...geo.errors);
  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} config
 * @param {object} _context
 */
async function health(config, context) {
  const v = await validateConfig(config || {}, context);
  if (!v.valid) {
    return { ok: false, message: v.errors.join('; ') };
  }
  return { ok: true, message: `${ADAPTER_KEY} config valid (lat/lon/parkSlug)` };
}

/**
 * @param {object} _config
 * @param {object} _context
 */
async function discover(_config, _context) {
  return [
    {
      id: 'weather_current',
      name: 'Park weather (current)',
      entityType: 'WEATHER_STATION',
      domain: 'weather',
      suggestedSlug: 'current',
      metrics: ['temperature', 'rain_probability', 'rain_mm', 'wind_speed', 'weather_condition'],
    },
  ];
}

/**
 * @param {object} config
 * @param {object} _context
 */
async function poll(config, context) {
  const eff = effectiveInstall(config, context);
  const v = await validateConfig(config || {}, context);
  if (!v.valid) {
    throw new Error(`Invalid config: ${v.errors.join('; ')}`);
  }

  const parkSlug = resolveParkSlug(eff);
  const { lat, lon } = resolveCoordinates(eff);
  if (lat == null || lon == null) {
    throw new Error('Invalid config: latitude/longitude resolution failed');
  }
  const timezone =
    eff.timezone != null && String(eff.timezone).trim() !== '' ? String(eff.timezone).trim() : 'Europe/Berlin';

  const url = buildForecastUrl(lat, lon, timezone);
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error(`Open-Meteo fetch failed (network): ${e.message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Open-Meteo HTTP ${res.status}: ${txt || res.statusText}`);
  }

  const body = await res.json();
  const cur = body?.current;
  if (!cur || typeof cur !== 'object') {
    throw new Error('Open-Meteo response missing current');
  }

  const eventTime = (() => {
    if (cur.time == null || String(cur.time).trim() === '') return new Date().toISOString();
    const d = new Date(cur.time);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();
  const metaBase = {
    parkSlug,
    latitude: lat,
    longitude: lon,
    timezone,
  };
  const rawPayload = {
    openMeteo: {
      latitude: body.latitude,
      longitude: body.longitude,
      timezone: body.timezone,
      current: cur,
    },
  };

  const wmo = cur.weather_code;
  const condition = wmoCodeToCondition(wmo);

  const observations = [
    {
      eventType: 'WEATHER_OBSERVED',
      domain: 'weather',
      assetSlug: 'current',
      metric: 'temperature',
      value: cur.temperature_2m != null ? Number(cur.temperature_2m) : null,
      unit: '°C',
      eventTime,
      quality: 'GOOD',
      confidence: 0.95,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: { ...metaBase },
      rawPayload,
    },
    {
      eventType: 'WEATHER_OBSERVED',
      domain: 'weather',
      assetSlug: 'current',
      metric: 'rain_probability',
      value: cur.precipitation_probability != null ? Number(cur.precipitation_probability) : null,
      unit: '%',
      eventTime,
      quality: 'GOOD',
      confidence: 0.9,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: { ...metaBase },
      rawPayload,
    },
    {
      eventType: 'WEATHER_OBSERVED',
      domain: 'weather',
      assetSlug: 'current',
      metric: 'rain_mm',
      value: cur.precipitation != null ? Number(cur.precipitation) : null,
      unit: 'mm',
      eventTime,
      quality: 'GOOD',
      confidence: 0.85,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: { ...metaBase },
      rawPayload,
    },
    {
      eventType: 'WEATHER_OBSERVED',
      domain: 'weather',
      assetSlug: 'current',
      metric: 'wind_speed',
      value: cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null,
      unit: 'km/h',
      eventTime,
      quality: 'GOOD',
      confidence: 0.9,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: { ...metaBase },
      rawPayload,
    },
    {
      eventType: 'WEATHER_OBSERVED',
      domain: 'weather',
      assetSlug: 'current',
      metric: 'weather_condition',
      value: condition,
      unit: null,
      eventTime,
      quality: 'GOOD',
      confidence: 0.85,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: { ...metaBase, weatherCode: wmo },
      rawPayload,
    },
  ];

  return observations;
}

module.exports = { validateConfig, discover, poll, health };
