/**
 * Park-local wall clock ↔ UTC (IANA timezone). Used for operating-hour windows.
 */

function zonedYmdParts(d, timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(
      f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    return {
      y: Number(parts.year),
      m: Number(parts.month),
      day: Number(parts.day),
    };
  } catch {
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
}

function zonedHmParts(d, timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
  try {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(
      f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    return {
      h: Number(parts.hour),
      mi: Number(parts.minute),
      s: Number(parts.second),
    };
  } catch {
    return { h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
}

/** UTC instant where wall clock in `timeZone` equals y-mo-d h:mi:s. */
function utcInstantForZonedWallClock(y, mo, d, h, mi, s, timeZone) {
  const anchor = Date.UTC(y, mo - 1, d, 12, 0, 0);
  for (let deltaMin = -36 * 60; deltaMin <= 36 * 60; deltaMin += 1) {
    const t = anchor + deltaMin * 60_000;
    const zd = zonedYmdParts(new Date(t), timeZone);
    const zh = zonedHmParts(new Date(t), timeZone);
    if (zd.y === y && zd.m === mo && zd.day === d && zh.h === h && zh.mi === mi && zh.s === s) {
      return new Date(t);
    }
  }
  return null;
}

function parseHmToMinutes(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function ymdPartsFromKey(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) };
}

function startOfNextLocalDayMs(timeZone, y, mo, day) {
  const cur0 = utcInstantForZonedWallClock(y, mo, day, 0, 0, 0, timeZone);
  if (!cur0) return null;
  let t = cur0.getTime() + 3600000;
  for (let i = 0; i < 48; i += 1) {
    const p = zonedYmdParts(new Date(t), timeZone);
    if (p.y !== y || p.m !== mo || p.day !== day) {
      const n0 = utcInstantForZonedWallClock(p.y, p.m, p.day, 0, 0, 0, timeZone);
      return n0 ? n0.getTime() : null;
    }
    t += 3600000;
  }
  return null;
}

/** Distinct park-local YYYY-MM-DD keys intersecting [tStartMs, tEndMs]. */
function collectLocalDateKeys(timeZone, tStartMs, tEndMs) {
  const keys = [];
  const seen = new Set();
  let t = tStartMs;
  const step = 3 * 3600000;
  while (t <= tEndMs + step) {
    const p = zonedYmdParts(new Date(t), timeZone);
    const k = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
    t += step;
    if (seen.size > 120) break;
  }
  return keys;
}

function clipRangeMs(lo, hi, tMinMs, tMaxMs) {
  const a = Math.max(lo, tMinMs);
  const b = Math.min(hi, tMaxMs);
  return a < b ? [a, b] : null;
}

module.exports = {
  zonedYmdParts,
  zonedHmParts,
  utcInstantForZonedWallClock,
  parseHmToMinutes,
  ymdPartsFromKey,
  startOfNextLocalDayMs,
  collectLocalDateKeys,
  clipRangeMs,
};
