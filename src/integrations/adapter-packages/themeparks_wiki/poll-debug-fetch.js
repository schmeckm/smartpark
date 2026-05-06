const BASE_URL = 'https://api.themeparks.wiki/v1';

function responsePreview(body, maxKeys = 14, maxArr = 6) {
  if (body == null) return null;
  if (Array.isArray(body)) {
    return { _type: 'array', length: body.length, sample: body.slice(0, maxArr) };
  }
  if (typeof body !== 'object') return { value: body };
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (n >= maxKeys) {
      out._truncated = true;
      break;
    }
    if (Array.isArray(v)) {
      out[k] = { _type: 'array', length: v.length, sample: v.slice(0, maxArr) };
    } else if (v && typeof v === 'object') {
      out[k] = { _type: 'object', keys: Object.keys(v).slice(0, 10) };
    } else {
      out[k] = v;
    }
    n += 1;
  }
  return out;
}

function responseCountFromBody(body) {
  if (body == null) return 0;
  if (Array.isArray(body)) return body.length;
  if (typeof body !== 'object') return 0;
  if (Array.isArray(body.liveData)) return body.liveData.length;
  if (Array.isArray(body.children)) return body.children.length;
  if (Array.isArray(body.schedule)) return body.schedule.length;
  return 1;
}

/**
 * GET ThemeParks.wiki and append one row to apiCalls (always, even on failure).
 * @param {string} pathAfterV1 e.g. `entity/<uuid>/live`
 * @param {Array<object>} apiCalls
 * @returns {Promise<any|null>} parsed JSON or null
 */
async function trackedGet(pathAfterV1, apiCalls) {
  const urlDisplay = `/v1/${pathAfterV1}`;
  const fullUrl = `${BASE_URL}/${pathAfterV1}`;
  const requestAt = new Date().toISOString();
  const t0 = Date.now();
  let status = 0;
  let body = null;
  let error = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(fullUrl, { signal: ac.signal });
    clearTimeout(timer);
    status = res.status;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      body = await res.json();
    } else {
      const txt = await res.text();
      body = { _nonJson: true, preview: txt.slice(0, 1200) };
    }
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e?.message || String(e);
  }
  const durationMs = Date.now() - t0;
  apiCalls.push({
    method: 'GET',
    url: urlDisplay,
    status: status || null,
    durationMs,
    requestAt,
    responsePreview: body ? responsePreview(body) : null,
    responseCount: responseCountFromBody(body),
    error,
  });
  return error ? null : body;
}

function truncateForDebug(value, maxArray = 120) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    if (value.length <= maxArray) return value;
    return [...value.slice(0, maxArray), { _truncated: true, total: value.length }];
  }
  return value;
}

module.exports = {
  BASE_URL,
  trackedGet,
  truncateForDebug,
};
