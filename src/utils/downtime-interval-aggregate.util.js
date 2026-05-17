/**
 * Clip downtime events to intervals and sum planned / unplanned overlap.
 */

function clipOverlapMs(rangeStart, rangeEnd, winStart, winEnd) {
  const ss = Math.max(rangeStart, winStart);
  const ee = Math.min(rangeEnd, winEnd);
  return ee > ss ? ee - ss : 0;
}

/**
 * @param {Array<{ startedAt: Date|string, endedAt?: Date|string|null, planned: boolean }>} rows
 * @param {Array<{ startMs: number, endMs: number }>} intervals — disjoint recommended
 * @param {Date} rangeEndCap — clip open-ended events
 * @returns {{ plannedMs: number, unplannedMs: number }}
 */
function sumDowntimeMsInIntervals(rows, intervals, rangeEndCap) {
  const cap = rangeEndCap.getTime();
  let plannedMs = 0;
  let unplannedMs = 0;
  if (!intervals.length) return { plannedMs, unplannedMs };

  for (const r of rows) {
    const s = new Date(r.startedAt).getTime();
    const eCap = r.endedAt ? new Date(r.endedAt).getTime() : cap;
    for (const iv of intervals) {
      const ms = clipOverlapMs(s, eCap, iv.startMs, iv.endMs);
      if (ms <= 0) continue;
      if (r.planned) plannedMs += ms;
      else unplannedMs += ms;
    }
  }
  return { plannedMs, unplannedMs };
}

function totalIntervalMs(intervals) {
  return intervals.reduce((acc, iv) => acc + (iv.endMs - iv.startMs), 0);
}

function availabilityPctFromDowntime(operatingMs, unplannedMs) {
  if (operatingMs <= 0) return null;
  return Math.max(0, Math.min(100, ((operatingMs - unplannedMs) / operatingMs) * 100));
}

module.exports = {
  clipOverlapMs,
  sumDowntimeMsInIntervals,
  totalIntervalMs,
  availabilityPctFromDowntime,
};
