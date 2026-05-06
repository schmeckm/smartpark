/**
 * Evaluates ThemeParks-style opening_times payloads against a 5m UTC bucket (midpoint in park TZ).
 * Payload shape: { date?, openingTime?, closingTime?, type? } from PARK_OPERATING_HOURS_UPDATED.
 */

const BUCKET_MS = 5 * 60 * 1000;

/**
 * @param {Date} utc
 * @param {string|null|undefined} ianaTz
 * @returns {number} minutes since local midnight [0, 1439]
 */
function minutesSinceMidnightInZone(utc, ianaTz) {
  const tz = ianaTz && String(ianaTz).trim() ? String(ianaTz).trim() : 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const s = fmt.format(utc);
    const [h, m] = s.split(':').map((x) => Number(x));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return Math.min(1439, Math.max(0, h * 60 + m));
  } catch {
    return utc.getUTCHours() * 60 + utc.getUTCMinutes();
  }
}

/**
 * @param {string} raw
 * @param {string|null|undefined} timezone - IANA; used when parsing full ISO timestamps
 * @returns {number|null} minutes since midnight (park-local wall time when raw is HH:mm)
 */
function parseTimeToMinutes(raw, timezone) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (hm && !s.includes('T')) {
    const hh = Number(hm[1]);
    const mm = Number(hm[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return minutesSinceMidnightInZone(d, timezone);
  }
  return null;
}

/**
 * @param {object|null|undefined} openingTimes
 * @param {Date} bucketUtc - floored 5m bucket start (UTC)
 * @param {string|null|undefined} timezone - park IANA timezone
 * @returns {{ within: boolean|null, interpretation: 'INSIDE_HOURS'|'OUTSIDE_HOURS'|'CLOSED_DAY'|'UNKNOWN' }}
 */
function evaluateScheduledOperatingHours(openingTimes, bucketUtc, timezone) {
  if (!openingTimes || typeof openingTimes !== 'object') {
    return { within: null, interpretation: 'UNKNOWN' };
  }
  const type = String(openingTimes.type || 'OPERATING').toUpperCase();
  if (type !== 'OPERATING') {
    return { within: false, interpretation: 'CLOSED_DAY' };
  }
  const openStr = openingTimes.openingTime != null ? String(openingTimes.openingTime).trim() : '';
  const closeStr = openingTimes.closingTime != null ? String(openingTimes.closingTime).trim() : '';
  if (!openStr || !closeStr) {
    return { within: null, interpretation: 'UNKNOWN' };
  }
  const openMin = parseTimeToMinutes(openStr, timezone);
  const closeMin = parseTimeToMinutes(closeStr, timezone);
  if (openMin == null || closeMin == null) {
    return { within: null, interpretation: 'UNKNOWN' };
  }

  const bucketMid = new Date(bucketUtc.getTime() + BUCKET_MS / 2);
  const nowMin = minutesSinceMidnightInZone(bucketMid, timezone);

  let within;
  if (closeMin > openMin) {
    within = nowMin >= openMin && nowMin < closeMin;
  } else {
    within = nowMin >= openMin || nowMin < closeMin;
  }

  return {
    within,
    interpretation: within ? 'INSIDE_HOURS' : 'OUTSIDE_HOURS',
  };
}

module.exports = {
  evaluateScheduledOperatingHours,
  minutesSinceMidnightInZone,
  parseTimeToMinutes,
  BUCKET_MS,
};
