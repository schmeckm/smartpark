/**
 * Direct Open-Meteo forecast/current fetch for production weather ingest.
 * @see https://open-meteo.com/en/docs
 */

const DEFAULT_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** WMO Weather interpretation codes (subset) — same mapping as weather_open_meteo adapter. */
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

function buildForecastUrl(lat, lon, timezone, baseForecastUrl) {
  let root = String(baseForecastUrl || DEFAULT_FORECAST_URL)
    .trim()
    .replace(/\/$/, '');
  if (!root.includes('/v1/forecast')) {
    root = `${root}/v1/forecast`;
  }
  const u = new URL(root);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set(
    'current',
    'temperature_2m,rain,precipitation,precipitation_probability,wind_speed_10m,weather_code'
  );
  u.searchParams.set('timezone', timezone || 'UTC');
  return u.toString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} url
 * @param {{ retries?: number, baseDelayMs?: number, fetchImpl?: typeof fetch }} opts
 */
async function fetchJsonWithRetry(url, opts = {}) {
  const retries = Math.max(1, Number(opts.retries) || 3);
  const baseDelayMs = Math.max(100, Number(opts.baseDelayMs) || 500);
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch_unavailable');
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchFn(url, {
        headers: { Accept: 'application/json' },
        signal: opts.signal,
      });
      if (!res.ok) {
        throw new Error(`open_meteo_http_${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await sleep(Math.min(delay, 8000));
      }
    }
  }
  throw lastErr || new Error('open_meteo_fetch_failed');
}

/**
 * @param {unknown} json
 * @returns {{
 *   observedAt: Date,
 *   temperatureC: number | null,
 *   rainMm: number | null,
 *   rainProbabilityPercent: number | null,
 *   windKmh: number | null,
 *   weatherCode: number | null,
 * }}
 */
function parseCurrentPayload(json) {
  const cur = json && typeof json === 'object' ? json.current : null;
  if (!cur || typeof cur !== 'object') {
    throw new Error('open_meteo_missing_current');
  }
  const rain = cur.rain != null ? Number(cur.rain) : null;
  const precip = cur.precipitation != null ? Number(cur.precipitation) : null;
  const rainMm =
    rain != null && Number.isFinite(rain)
      ? rain
      : precip != null && Number.isFinite(precip)
        ? precip
        : null;
  const prob =
    cur.precipitation_probability != null ? Number(cur.precipitation_probability) : null;
  const temp = cur.temperature_2m != null ? Number(cur.temperature_2m) : null;
  const wind = cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null;
  const code = cur.weather_code != null ? Number(cur.weather_code) : null;
  let observedAt = new Date();
  if (cur.time != null) {
    const t = new Date(String(cur.time));
    if (!Number.isNaN(t.getTime())) observedAt = t;
  }
  return {
    observedAt,
    temperatureC: temp != null && Number.isFinite(temp) ? temp : null,
    rainMm: rainMm != null && Number.isFinite(rainMm) ? rainMm : null,
    rainProbabilityPercent: prob != null && Number.isFinite(prob) ? prob : null,
    windKmh: wind != null && Number.isFinite(wind) ? wind : null,
    weatherCode: code != null && Number.isFinite(code) ? code : null,
  };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} [timezone]
 * @param {{ retries?: number, baseForecastUrl?: string }} [opts]
 */
async function fetchOpenMeteoCurrent(lat, lon, timezone, opts = {}) {
  const url = buildForecastUrl(lat, lon, timezone, opts.baseForecastUrl);
  const json = await fetchJsonWithRetry(url, {
    retries: opts.retries,
    baseDelayMs: opts.baseDelayMs,
    signal: opts.signal,
  });
  return parseCurrentPayload(json);
}

module.exports = {
  DEFAULT_FORECAST_URL,
  wmoCodeToCondition,
  buildForecastUrl,
  fetchJsonWithRetry,
  parseCurrentPayload,
  fetchOpenMeteoCurrent,
};
