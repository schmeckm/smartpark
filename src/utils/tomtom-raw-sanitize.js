'use strict';

/**
 * Best-effort redaction so persisted snapshots never echo a live API key substring.
 * @param {unknown} raw
 * @param {string} [apiKey]
 */
function sanitizeTomTomRawForPersistence(raw, apiKey) {
  if (raw == null) return raw;
  const secret = apiKey && String(apiKey).length >= 6 ? String(apiKey) : null;
  const walk = (v) => {
    if (secret && typeof v === 'string' && v.includes(secret)) {
      return v.split(secret).join('***');
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (String(k).toLowerCase() === 'key' && typeof val === 'string') {
          o[k] = '***';
        } else {
          o[k] = walk(val);
        }
      }
      return o;
    }
    return v;
  };
  try {
    return walk(JSON.parse(JSON.stringify(raw)));
  } catch {
    return null;
  }
}

module.exports = { sanitizeTomTomRawForPersistence };
