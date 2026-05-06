const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yamljs');

const ADAPTER_KEY = 'calendar_school_holidays';
const PROVIDER_LABEL = 'SchoolHolidayCalendar';

/** Same school-window files as calendar_demand — no HTTP; edit YAML to change ranges. */
const PROJECT_DATA_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'calendar-holidays');

const REGION_FILES = [
  { key: 'de_bw', file: 'de_bw.yaml', label: 'DE-BW' },
  { key: 'fr_grandest', file: 'fr_grandest.yaml', label: 'FR-Grand Est' },
  { key: 'ch_bs', file: 'ch_bs.yaml', label: 'CH-BS' },
];

/** ISO weekday 1 = Monday … 7 = Sunday (matches park snapshots / ML features). */
const WEEKDAY_SHORT_TO_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Western (Gregorian) Easter Sunday as UTC noon for the given civil year.
 * @param {number} year
 * @returns {Date}
 */
function westernEasterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDaysUtc(isoYmd, deltaDays) {
  const [y, mo, d] = String(isoYmd).split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + deltaDays);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Set of YYYY-MM-DD public holidays for Baden-Württemberg (fixed + Easter-based), no network.
 * Covers federal holidays observed in BW plus BW-specific (6 Jan, Fronleichnam, Allerheiligen).
 */
function deBwPublicHolidaySet(year) {
  const set = new Set();
  const push = (iso) => set.add(iso);
  const e = westernEasterSundayUtc(year);
  const eIso = (dt) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  const e0 = eIso(e);
  push(`${year}-01-01`);
  push(`${year}-01-06`);
  push(addDaysUtc(e0, -2));
  push(addDaysUtc(e0, 1));
  push(`${year}-05-01`);
  push(addDaysUtc(e0, 39));
  push(addDaysUtc(e0, 50));
  push(addDaysUtc(e0, 60));
  push(`${year}-10-03`);
  push(`${year}-11-01`);
  push(`${year}-12-25`);
  push(`${year}-12-26`);
  return set;
}

function deBwPublicHolidayOn(isoDate) {
  const y = Number(String(isoDate).slice(0, 4));
  if (!Number.isFinite(y)) return false;
  return deBwPublicHolidaySet(y).has(isoDate);
}

function toDateAtLocalMidnight(dateText) {
  return new Date(`${dateText}T00:00:00.000`);
}

function formatLocalDateParts(date, timezone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const weekday = get('weekday');
  const isoWeekday = WEEKDAY_SHORT_TO_ISO[weekday] || null;
  return {
    isoDate: `${yyyy}-${mm}-${dd}`,
    weekday,
    isoWeekday: isoWeekday == null ? 1 : isoWeekday,
  };
}

function shiftDate(isoDate, deltaDays) {
  const d = toDateAtLocalMidnight(isoDate);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function inWindows(isoDate, windows) {
  return (windows || []).some(([start, end]) => isoDate >= start && isoDate <= end);
}

function parseWindowsFromYaml(doc) {
  const raw = doc?.windows ?? doc?.ranges ?? [];
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const w of raw) {
    if (Array.isArray(w) && w.length >= 2 && typeof w[0] === 'string' && typeof w[1] === 'string') {
      out.push([w[0].trim(), w[1].trim()]);
    } else if (w && typeof w === 'object' && w.start && w.end) {
      out.push([String(w.start).trim(), String(w.end).trim()]);
    }
  }
  return out;
}

function loadWindowsForFile(relFile) {
  const fp = path.join(PROJECT_DATA_DIR, relFile);
  if (!fs.existsSync(fp)) return { windows: [], path: fp, ok: false, error: 'file_missing' };
  try {
    const doc = YAML.load(fp);
    return { windows: parseWindowsFromYaml(doc), path: fp, ok: true, error: null };
  } catch (e) {
    return { windows: [], path: fp, ok: false, error: e?.message || String(e) };
  }
}

function loadAllRegionWindows() {
  const byKey = { de_bw: [], fr_grandest: [], ch_bs: [] };
  const reads = [];
  for (const { key, file, label } of REGION_FILES) {
    const r = loadWindowsForFile(file);
    byKey[key] = r.windows;
    reads.push({
      key,
      label,
      relPath: path.join('data', 'calendar-holidays', file),
      absPath: r.path,
      windowCount: r.windows.length,
      ok: r.ok,
      error: r.error,
    });
  }
  return { byKey, reads };
}

function calcHolidayFlags(isoDate, weekday, windowsByKey) {
  const isHolidayDeBw = inWindows(isoDate, windowsByKey.de_bw);
  const isHolidayFrGrandest = inWindows(isoDate, windowsByKey.fr_grandest);
  const isHolidayChBs = inWindows(isoDate, windowsByKey.ch_bs);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const publicHolidayDeBw = deBwPublicHolidayOn(isoDate);

  const anySchoolToday = isHolidayDeBw || isHolidayFrGrandest || isHolidayChBs;
  const prevDate = shiftDate(isoDate, -1);
  const nextDate = shiftDate(isoDate, 1);
  const anySchoolPrev =
    inWindows(prevDate, windowsByKey.de_bw) ||
    inWindows(prevDate, windowsByKey.fr_grandest) ||
    inWindows(prevDate, windowsByKey.ch_bs);
  const anySchoolNext =
    inWindows(nextDate, windowsByKey.de_bw) ||
    inWindows(nextDate, windowsByKey.fr_grandest) ||
    inWindows(nextDate, windowsByKey.ch_bs);
  const pubPrev = deBwPublicHolidayOn(prevDate);
  const pubNext = deBwPublicHolidayOn(nextDate);
  const bridgeDay =
    !isWeekend &&
    !anySchoolToday &&
    !publicHolidayDeBw &&
    (anySchoolPrev || anySchoolNext || pubPrev || pubNext);

  return {
    isHolidayDeBw,
    isHolidayFrGrandest,
    isHolidayChBs,
    isWeekend,
    isPublicHolidayDeBw: publicHolidayDeBw,
    bridgeDay,
  };
}

function calcHolidayScore(flags) {
  const score =
    (flags.isHolidayDeBw ? 0.32 : 0) +
    (flags.isHolidayFrGrandest ? 0.28 : 0) +
    (flags.isHolidayChBs ? 0.18 : 0) +
    (flags.isWeekend ? 0.1 : 0) +
    (flags.bridgeDay ? 0.05 : 0) +
    (flags.isPublicHolidayDeBw ? 0.12 : 0);
  return Number(Math.min(1, score).toFixed(3));
}

function boolAs01(v) {
  return v ? 1 : 0;
}

async function validateConfig(config) {
  const errors = [];
  if (!config?.parkSlug || String(config.parkSlug).trim() === '') {
    errors.push('parkSlug is required');
  }
  if (config?.timezone != null && String(config.timezone).trim() === '') {
    errors.push('timezone must be a non-empty string when provided');
  }
  if (config?.dateOverride != null) {
    const d = String(config.dateOverride).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      errors.push('dateOverride must be YYYY-MM-DD');
    }
  }
  return { valid: errors.length === 0, errors };
}

async function discover() {
  return [
    {
      id: 'calendar_current',
      name: 'Daily school holiday demand factors',
      entityType: 'CALENDAR_FEED',
      domain: 'calendar',
      suggestedSlug: 'current',
      metrics: [
        'is_holiday_de_bw',
        'is_holiday_fr_grandest',
        'is_holiday_ch_bs',
        'is_weekend',
        'iso_weekday',
        'is_public_holiday_de_bw',
        'bridge_day',
        'holiday_score',
      ],
    },
  ];
}

async function health(config) {
  const v = await validateConfig(config || {});
  if (!v.valid) {
    return { ok: false, message: v.errors.join('; ') };
  }
  return { ok: true, message: `${ADAPTER_KEY} config valid` };
}

async function poll(config) {
  const v = await validateConfig(config || {});
  if (!v.valid) {
    throw new Error(`Invalid config: ${v.errors.join('; ')}`);
  }

  const parkSlug = String(config.parkSlug).trim();
  const timezone = config.timezone != null && String(config.timezone).trim() !== '' ? String(config.timezone).trim() : 'Europe/Berlin';

  const { byKey: windowsByKey, reads } = loadAllRegionWindows();
  const requestAt = new Date().toISOString();
  const t0 = Date.now();

  const baseDate = config.dateOverride ? toDateAtLocalMidnight(String(config.dateOverride)) : new Date();
  const parts = formatLocalDateParts(baseDate, timezone);
  const flags = calcHolidayFlags(parts.isoDate, parts.weekday, windowsByKey);
  const holidayScore = calcHolidayScore(flags);
  const eventTime = new Date().toISOString();

  const meta = {
    parkSlug,
    date: parts.isoDate,
    timezone,
    regions: ['DE-BW', 'FR-Grand Est', 'CH-BS'],
    dataSource: 'data/calendar-holidays/*.yaml',
    publicHolidayDeBwRule: 'DE-BW fixed + Gregorian Easter chain (no HTTP)',
  };
  const rawPayload = {
    factors: {
      is_holiday_de_bw: flags.isHolidayDeBw,
      is_holiday_fr_grandest: flags.isHolidayFrGrandest,
      is_holiday_ch_bs: flags.isHolidayChBs,
      is_weekend: flags.isWeekend,
      iso_weekday: parts.isoWeekday,
      is_public_holiday_de_bw: flags.isPublicHolidayDeBw,
      bridge_day: flags.bridgeDay,
      holiday_score: holidayScore,
    },
  };

  const observations = [
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'is_holiday_de_bw',
      value: boolAs01(flags.isHolidayDeBw),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 0.95,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'is_holiday_fr_grandest',
      value: boolAs01(flags.isHolidayFrGrandest),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 0.95,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'is_holiday_ch_bs',
      value: boolAs01(flags.isHolidayChBs),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 0.95,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'is_weekend',
      value: boolAs01(flags.isWeekend),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 1,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'iso_weekday',
      value: parts.isoWeekday,
      unit: 'iso_dow',
      eventTime,
      quality: 'GOOD',
      confidence: 1,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'is_public_holiday_de_bw',
      value: boolAs01(flags.isPublicHolidayDeBw),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 0.92,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'bridge_day',
      value: boolAs01(flags.bridgeDay),
      unit: 'bool01',
      eventTime,
      quality: 'GOOD',
      confidence: 0.9,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
    {
      eventType: 'HOLIDAY_FACTOR_OBSERVED',
      domain: 'calendar',
      assetSlug: 'current',
      metric: 'holiday_score',
      value: holidayScore,
      unit: 'score',
      eventTime,
      quality: 'GOOD',
      confidence: 0.9,
      source: ADAPTER_KEY,
      provider: PROVIDER_LABEL,
      rawPayload,
      metadata: { ...meta },
    },
  ];

  const durationMs = Date.now() - t0;
  const anyReadFailed = reads.some((r) => !r.ok);
  const apiCalls = reads.map((r) => ({
    method: 'READ',
    url: r.relPath,
    status: r.ok ? 200 : null,
    durationMs: Math.round(durationMs / reads.length) || 0,
    requestAt,
    responsePreview: { label: r.label, windowCount: r.windowCount, ok: r.ok },
    responseCount: r.windowCount,
    error: r.ok ? null : r.error,
  }));

  const debug = {
    provider: PROVIDER_LABEL,
    parkId: null,
    parkName: parkSlug,
    apiCalls,
    rawInput: {
      note:
        'No external HTTP. School breaks: YAML. iso_weekday=1..7 (Mon..Sun). is_public_holiday_de_bw = BW Gesetzliche Feiertage (fest + Osterkette). For full DE/FR/CH public holidays use calendar_demand.',
      date: parts.isoDate,
      weekday: parts.weekday,
      isoWeekday: parts.isoWeekday,
      yamlReads: reads,
    },
  };

  if (anyReadFailed) {
    debug.rawInput.warning = 'One or more region YAML files failed to load; missing regions count as no holiday.';
  }

  return { observations, debug };
}

module.exports = { validateConfig, discover, poll, health };
