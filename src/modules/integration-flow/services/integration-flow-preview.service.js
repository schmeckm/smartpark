'use strict';

const { sanitizeStepPayload } = require('./integration-flow-persistence.helper');

/** UI-oriented preview cap (smaller than full step JSONB persistence). */
const PREVIEW_MAX_BYTES = 12000;
const PREVIEW_MAX_ROWS = 8;
const ARRAY_ROW_KEYS = ['items', 'liveData', 'canonicalMessages', 'observations', 'rows', 'data', 'results'];

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function estimateRowCount(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== 'object') return null;
  for (const key of ARRAY_ROW_KEYS) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  const live = value.debug?.rawInput?.live;
  if (live && Array.isArray(live.liveData)) return live.liveData.length;
  return null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function countFields(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 1;
}

/**
 * @param {unknown} value
 * @param {number} maxRows
 * @returns {{ body: unknown, rowCount: number|null, truncated: boolean }}
 */
function shrinkForPreview(value, maxRows = PREVIEW_MAX_ROWS) {
  if (value == null) return { body: value, rowCount: null, truncated: false };

  if (Array.isArray(value)) {
    const rowCount = value.length;
    const truncated = rowCount > maxRows;
    return {
      body: truncated ? value.slice(0, maxRows) : value,
      rowCount,
      truncated,
    };
  }

  if (typeof value !== 'object') {
    return { body: value, rowCount: null, truncated: false };
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  let truncated = false;
  let rowCount = estimateRowCount(value);

  for (const [k, v] of Object.entries(value)) {
    if (ARRAY_ROW_KEYS.includes(k) && Array.isArray(v)) {
      const rc = v.length;
      rowCount = rowCount ?? rc;
      if (rc > maxRows) {
        out[k] = v.slice(0, maxRows);
        truncated = true;
      } else {
        out[k] = v;
      }
      continue;
    }
    if (k === 'debug' && v && typeof v === 'object' && !Array.isArray(v)) {
      const live = v.rawInput?.live;
      if (live && Array.isArray(live.liveData)) {
        const rc = live.liveData.length;
        rowCount = rowCount ?? rc;
        const slice = rc > maxRows ? live.liveData.slice(0, maxRows) : live.liveData;
        if (rc > maxRows) truncated = true;
        out.debug = {
          ...v,
          rawInput: {
            ...v.rawInput,
            live: { ...live, liveData: slice },
          },
        };
        continue;
      }
    }
    out[k] = v;
  }

  return { body: out, rowCount, truncated };
}

/**
 * Build a lightweight preview object for UI debugging (then sanitized for DB).
 * @param {unknown} value
 * @param {{ maxBytes?: number, maxRows?: number }} [options]
 * @returns {unknown|null}
 */
function buildPreviewPayload(value, options = {}) {
  if (value === undefined) return null;
  const maxBytes = options.maxBytes ?? PREVIEW_MAX_BYTES;
  const maxRows = options.maxRows ?? PREVIEW_MAX_ROWS;

  let originalBytes = 0;
  try {
    originalBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return sanitizeStepPayload(
      {
        _preview: true,
        _truncated: true,
        _reason: 'not_json_serializable',
      },
      maxBytes
    );
  }

  const { body, rowCount, truncated } = shrinkForPreview(value, maxRows);
  const fieldCount = countFields(body);

  /** @type {Record<string, unknown>} */
  const preview = {
    _preview: true,
    _truncated: truncated || originalBytes > maxBytes,
    _originalBytes: originalBytes,
    _fieldCount: fieldCount,
  };
  if (rowCount != null) preview._rowCount = rowCount;

  if (body != null && typeof body === 'object' && !Array.isArray(body)) {
    Object.assign(preview, body);
  } else if (body !== undefined) {
    preview.value = body;
  }

  return sanitizeStepPayload(preview, maxBytes);
}

/**
 * Step input preview: upstream payload + compact config keys.
 * @param {{ nodeConfig?: object, upstreamPayload?: unknown }} stepInputRecord
 * @returns {unknown|null}
 */
function buildStepInputPreview(stepInputRecord) {
  if (stepInputRecord == null || typeof stepInputRecord !== 'object') {
    return buildPreviewPayload(stepInputRecord);
  }
  const upstream = stepInputRecord.upstreamPayload;
  const cfg = stepInputRecord.nodeConfig;
  const base = buildPreviewPayload(upstream);
  if (!base || typeof base !== 'object' || Array.isArray(base)) return base;
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    const keys = Object.keys(cfg);
    if (keys.length) {
      return { ...base, _nodeConfigKeys: keys };
    }
  }
  return base;
}

/**
 * @param {unknown} outputValue
 * @returns {unknown|null}
 */
function buildStepOutputPreview(outputValue) {
  if (outputValue === undefined || outputValue === null) return null;
  return buildPreviewPayload(outputValue);
}

module.exports = {
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_ROWS,
  buildPreviewPayload,
  buildStepInputPreview,
  buildStepOutputPreview,
  estimateRowCount,
};
