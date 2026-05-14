const ADAPTER_KEY = 'macro_tourism_index';
const PROVIDER_LABEL = 'MacroTourism';

const DEFAULT_PARK_SLUG = 'europapark';
const DEFAULT_TIMEZONE = 'Europe/Berlin';
const DEFAULT_JSON_PATH = 'data.index';

function effectiveInstall(config, context) {
  const cfg = config && typeof config === 'object' ? config : {};
  const ctx = context && typeof context === 'object' ? context : {};
  return { ...ctx, ...cfg };
}

function resolveParkSlug(eff) {
  const s = eff?.parkSlug != null ? String(eff.parkSlug).trim() : '';
  return s || DEFAULT_PARK_SLUG;
}

function resolveTimezone(eff) {
  const s = eff?.timezone != null ? String(eff.timezone).trim() : '';
  return s || DEFAULT_TIMEZONE;
}

function numOrNull(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function parseJsonPath(pathExpr) {
  const p = String(pathExpr || DEFAULT_JSON_PATH).trim();
  return p.split('.').filter(Boolean);
}

function pickPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object' || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function resolveBounds(eff) {
  const min = numOrNull(eff?.minIndex);
  const max = numOrNull(eff?.maxIndex);
  const lo = min == null ? 0 : min;
  const hi = max == null ? 1 : max;
  if (hi <= lo) return { min: 0, max: 1 };
  return { min: lo, max: hi };
}

async function validateConfig(config, context) {
  const eff = effectiveInstall(config, context);
  const errors = [];
  if (!resolveParkSlug(eff)) errors.push('parkSlug is required');
  if (eff.apiUrl != null && String(eff.apiUrl).trim() !== '') {
    try {
      // eslint-disable-next-line no-new
      new URL(String(eff.apiUrl).trim());
    } catch {
      errors.push('apiUrl must be a valid URL');
    }
  }
  const method = String(eff.apiMethod || 'GET').trim().toUpperCase();
  if (!['GET', 'POST'].includes(method)) errors.push('apiMethod must be GET or POST');
  const bounds = resolveBounds(eff);
  if (!(bounds.max > bounds.min)) errors.push('maxIndex must be greater than minIndex');
  return { valid: errors.length === 0, errors };
}

async function health(config, context) {
  const v = await validateConfig(config, context);
  if (!v.valid) return { ok: false, message: v.errors.join('; ') };
  const eff = effectiveInstall(config, context);
  const mode = eff.apiUrl ? 'API' : 'FALLBACK';
  return { ok: true, message: `${ADAPTER_KEY} config valid (${mode} mode)` };
}

async function discover() {
  return [
    {
      id: 'macro_tourism_index_current',
      name: 'Macro tourism demand index',
      entityType: 'DEMAND_FEED',
      domain: 'demand',
      suggestedSlug: 'macro',
      metrics: ['macro_tourism_index'],
    },
  ];
}

async function fetchIndexFromApi(eff) {
  const apiUrl = String(eff.apiUrl || '').trim();
  if (!apiUrl) return { value: null, debug: { mode: 'FALLBACK', reason: 'apiUrl_not_configured' } };
  const method = String(eff.apiMethod || 'GET').trim().toUpperCase();
  const token = String(eff.apiToken || '').trim();
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const requestAt = new Date().toISOString();
  const started = Date.now();
  let res;
  try {
    res = await fetch(apiUrl, { method, headers });
  } catch (e) {
    return {
      value: null,
      debug: {
        mode: 'API',
        requestAt,
        url: apiUrl,
        method,
        durationMs: Date.now() - started,
        error: `network: ${e.message}`,
      },
    };
  }
  const durationMs = Date.now() - started;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return {
      value: null,
      debug: {
        mode: 'API',
        requestAt,
        url: apiUrl,
        method,
        durationMs,
        status: res.status,
        error: txt || res.statusText,
      },
    };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return {
      value: null,
      debug: {
        mode: 'API',
        requestAt,
        url: apiUrl,
        method,
        durationMs,
        status: res.status,
        error: 'response_not_json',
      },
    };
  }
  const segments = parseJsonPath(eff.jsonPath);
  const raw = pickPath(body, segments);
  return {
    value: numOrNull(raw),
    debug: {
      mode: 'API',
      requestAt,
      url: apiUrl,
      method,
      durationMs,
      status: res.status,
      jsonPath: segments.join('.'),
      rawValue: raw,
    },
  };
}

async function poll(config, context) {
  const eff = effectiveInstall(config, context);
  const v = await validateConfig(config, context);
  if (!v.valid) throw new Error(`Invalid config: ${v.errors.join('; ')}`);

  const parkSlug = resolveParkSlug(eff);
  const timezone = resolveTimezone(eff);
  const bounds = resolveBounds(eff);
  const fallback = numOrNull(eff.defaultIndex);
  const fallbackValue = fallback == null ? 0.5 : fallback;
  const api = await fetchIndexFromApi(eff);
  const selectedRaw = api.value == null ? fallbackValue : api.value;
  const value = clamp(selectedRaw, bounds.min, bounds.max);
  const eventTime = new Date().toISOString();

  const rawPayload = {
    index: value,
    source: api.value == null ? 'fallback' : 'api',
    apiDebug: api.debug,
  };

  const observations = [
    {
      eventType: 'MACRO_TOURISM_INDEX_OBSERVED',
      domain: 'demand',
      assetSlug: 'macro',
      metric: 'macro_tourism_index',
      value,
      unit: 'index',
      eventTime,
      quality: api.value == null ? 'ESTIMATED' : 'GOOD',
      confidence: api.value == null ? 0.6 : 0.9,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      metadata: {
        parkSlug,
        timezone,
        minIndex: bounds.min,
        maxIndex: bounds.max,
      },
      rawPayload,
    },
  ];

  const debug = {
    provider: PROVIDER_LABEL,
    parkName: parkSlug,
    apiCalls: [
      {
        method: api.debug.method || 'GET',
        url: api.debug.url || String(eff.apiUrl || ''),
        status: api.debug.status ?? null,
        durationMs: api.debug.durationMs ?? 0,
        requestAt: api.debug.requestAt || new Date().toISOString(),
        responsePreview: { mode: api.debug.mode, rawValue: api.debug.rawValue, value },
        responseCount: 1,
        error: api.debug.error || null,
      },
    ],
    rawInput: {
      mode: api.debug.mode,
      jsonPath: api.debug.jsonPath || parseJsonPath(eff.jsonPath).join('.'),
      usedFallback: api.value == null,
      fallbackValue,
      clampedValue: value,
    },
  };

  return { observations, debug };
}

module.exports = { validateConfig, discover, poll, health };
