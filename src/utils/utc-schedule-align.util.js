'use strict';

/**
 * Milliseconds from `now` until UTC wall-clock time is the next multiple of `multipleMinutes`
 * after the **current** bucket, plus optional trailing padding (e.g. let ingress settle).
 *
 * Example (multipleMinutes=5, padding=2000): if now is 13:03:10 UTC, the next boundary is
 * 13:05:00 UTC → return ~1m50s + padding.
 *
 * @param {number} multipleMinutes — e.g. 5 for feature-store buckets
 * @param {Date} [now]
 * @param {number} [trailingPaddingMs=0]
 * @returns {number}
 */
function msUntilNextUtcWallMultipleMinutes(multipleMinutes, now = new Date(), trailingPaddingMs = 0) {
  const m = Number(multipleMinutes);
  if (!Number.isFinite(m) || m <= 0) return 60_000;
  const periodMs = Math.round(m * 60 * 1000);
  const t = now.getTime();
  const nextBoundaryMs = Math.floor(t / periodMs) * periodMs + periodMs;
  const pad = Math.max(0, Number(trailingPaddingMs) || 0);
  return Math.max(1000, nextBoundaryMs + pad - t);
}

module.exports = {
  msUntilNextUtcWallMultipleMinutes,
};
