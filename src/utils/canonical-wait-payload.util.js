'use strict';

/**
 * Normalizes canonical WAIT_TIME_UPDATED payload values for storage and feature snapshots.
 * Mirrors ingest behaviour but rejects NaN (unlike bare `Number()` which can produce NaN).
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function coerceNumericWaitMinutes(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

module.exports = {
  coerceNumericWaitMinutes,
};
