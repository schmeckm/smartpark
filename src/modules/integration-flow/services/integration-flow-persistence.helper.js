'use strict';

const TRUNCATE_WARNING =
  'Payload überschreitet das Log-Limit und wurde gekürzt.';

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {number} maxArrayItems
 * @param {number} maxStringLen
 * @returns {unknown}
 */
function truncateDeep(value, depth, maxArrayItems, maxStringLen) {
  if (value == null || depth <= 0) return value;
  if (typeof value === 'string') {
    return value.length > maxStringLen ? `${value.slice(0, maxStringLen)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const slice = value.slice(0, maxArrayItems).map((v) => truncateDeep(v, depth - 1, maxArrayItems, maxStringLen));
    if (value.length > maxArrayItems) {
      slice.push(`… ${value.length - maxArrayItems} weitere Einträge`);
    }
    return slice;
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  const keys = Object.keys(value).slice(0, 80);
  for (const k of keys) {
    out[k] = truncateDeep(value[k], depth - 1, maxArrayItems, maxStringLen);
  }
  if (Object.keys(value).length > keys.length) {
    out._truncatedKeys = Object.keys(value).length - keys.length;
  }
  return out;
}

/**
 * Limits JSONB step payloads before persistence (avoids pgdata bloat from liveData arrays).
 * @param {unknown} payload
 * @param {number} [maxBytes]
 * @returns {unknown}
 */
function sanitizeStepPayload(payload, maxBytes = 50000) {
  if (payload == null) return payload;
  let encoded;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    return {
      _warning: TRUNCATE_WARNING,
      _reason: 'not_json_serializable',
    };
  }
  const originalBytes = Buffer.byteLength(encoded, 'utf8');
  if (originalBytes <= maxBytes) return payload;

  let candidate = truncateDeep(payload, 6, 25, 400);
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    candidate = {
      ...candidate,
      _warning: TRUNCATE_WARNING,
      _originalBytes: originalBytes,
      _maxBytes: maxBytes,
    };
  } else {
    candidate = {
      _preview: candidate,
      _warning: TRUNCATE_WARNING,
      _originalBytes: originalBytes,
      _maxBytes: maxBytes,
    };
  }

  try {
    encoded = JSON.stringify(candidate);
    if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) return candidate;
  } catch {
    /* fall through */
  }

  return {
    _warning: TRUNCATE_WARNING,
    _originalBytes: originalBytes,
    _maxBytes: maxBytes,
    _keys:
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).slice(0, 40)
        : [],
  };
}

module.exports = { sanitizeStepPayload, truncateDeep, TRUNCATE_WARNING };
