/**
 * Resolves ML factor "Current" values (L1/L2) used as multipliers in mergeMlEnterpriseLayer.
 * Priority: L2 park current_value > L1 API current_value > calculated (calendar/weather) > L1 legacy current/default.
 *
 * Calculated currents are clamped to [0, 1.5] — same ceiling as MACRO tourism normalization
 * so downstream `delta ≈ base × Current × Weight` cannot explode from a single bad reading.
 */
const { Op } = require('sequelize');
const { Park, ParkCalendarContext, WeatherObservation } = require('../models');

const DYNAMIC_FACTOR_CODES = new Set([
  'HOLIDAY_PRESSURE',
  'SCHOOL_BREAK_PRESSURE',
  'WEEKEND_UPLIFT',
  'SUMMER_SEASON_FACTOR',
  'RAIN_DEMAND_SHIFT',
  'MACRO_TOURISM_INDEX',
]);

/** Clamp resolved "Current" multipliers: non-negative, cap at 1.5 to limit worst-case forecast nudges. */
function clampCurrent(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1.5, x));
}

/**
 * Map rain amount (mm in observation window / snapshot) to discrete intensity used as Current.
 * Thresholds are operational defaults; tune with real gauge correlation later.
 */
function calculateRainCurrentFromMm(mm) {
  const x = Number(mm);
  if (!Number.isFinite(x) || x < 0.1) return 0;
  if (x < 2.5) return 0.3;
  if (x < 8) return 0.7;
  return 1.0;
}

/** Month 1–12: June–Aug full summer shoulder in May/Sep per product spec. */
function calculateSummerCurrentFromMonth(month) {
  const m = Number(month);
  if (!Number.isFinite(m)) return 0;
  if (m >= 6 && m <= 8) return 1.0;
  if (m === 5 || m === 9) return 0.5;
  return 0;
}

function calculateWeekendCurrent(isWeekend) {
  return isWeekend ? 1.0 : 0.0;
}

function calculateHolidayCurrent(isPublicHoliday) {
  return isPublicHoliday ? 1.0 : 0.0;
}

function calculateSchoolBreakCurrent(isSchoolBreak) {
  return isSchoolBreak ? 1.0 : 0.0;
}

/** MACRO neutral baseline when no API feed is active at L1. */
function calculatedMacroNeutral() {
  return 0.5;
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function hasL2CurrentOverride(parkFactorRow) {
  if (!parkFactorRow) return false;
  const v = parkFactorRow.currentValue ?? parkFactorRow.current_value;
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

function l2CurrentValue(parkFactorRow) {
  return n(parkFactorRow.currentValue ?? parkFactorRow.current_value, NaN);
}

/**
 * Pick final Current + provenance after priority chain.
 * @returns {{ current: number, currentSource: string, calculatedCurrent: number|null, manualCurrentOverride: number|null, l1ApiCurrent: number|null }}
 */
function pickEffectiveCurrent({
  calculatedCurrent,
  l1GlobalPlain,
  parkFactorPlain,
}) {
  const manualCurrentOverride = hasL2CurrentOverride(parkFactorPlain) ? clampCurrent(l2CurrentValue(parkFactorPlain)) : null;
  if (manualCurrentOverride != null && Number.isFinite(manualCurrentOverride)) {
    const st = String(parkFactorPlain.sourceType || parkFactorPlain.source_type || 'MANUAL').toUpperCase();
    return {
      current: manualCurrentOverride,
      currentSource: `L2_${st}`,
      calculatedCurrent,
      manualCurrentOverride,
      l1ApiCurrent: null,
    };
  }

  const g = l1GlobalPlain || {};
  const l1Source = String(g.sourceType || g.source_type || 'MANUAL').toUpperCase();
  const l1Cur = g.currentValue ?? g.current_value;
  if (l1Source === 'API' && l1Cur != null && l1Cur !== '') {
    const apiVal = clampCurrent(n(l1Cur, 0.5));
    return {
      current: apiVal,
      currentSource: 'API',
      calculatedCurrent,
      manualCurrentOverride: null,
      l1ApiCurrent: apiVal,
    };
  }

  if (calculatedCurrent != null && Number.isFinite(calculatedCurrent)) {
    const cc = clampCurrent(calculatedCurrent);
    return {
      current: cc,
      currentSource: 'CALCULATED',
      calculatedCurrent: cc,
      manualCurrentOverride: null,
      l1ApiCurrent: null,
    };
  }

  if (l1Cur != null && l1Cur !== '') {
    const v = clampCurrent(n(l1Cur, 1));
    return {
      current: v,
      currentSource: 'L1_CURRENT',
      calculatedCurrent: null,
      manualCurrentOverride: null,
      l1ApiCurrent: null,
    };
  }

  const def = g.defaultValue ?? g.default_value;
  if (def != null && def !== '') {
    const v = clampCurrent(n(def, 1));
    return {
      current: v,
      currentSource: 'L1_DEFAULT',
      calculatedCurrent: null,
      manualCurrentOverride: null,
      l1ApiCurrent: null,
    };
  }

  return {
    current: 1,
    currentSource: 'L1_DEFAULT',
    calculatedCurrent: null,
    manualCurrentOverride: null,
    l1ApiCurrent: null,
  };
}

function dateOnlyInTimeZone(date, timeZone) {
  const tz = timeZone && String(timeZone).trim() !== '' ? String(timeZone) : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function weekendFromTimeZone(date, timeZone) {
  const tz = timeZone && String(timeZone).trim() !== '' ? String(timeZone) : 'UTC';
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
    date instanceof Date ? date : new Date(date)
  );
  const w = wd.slice(0, 3).toLowerCase();
  return w === 'sat' || w === 'sun';
}

function monthFromTimeZone(date, timeZone) {
  const tz = timeZone && String(timeZone).trim() !== '' ? String(timeZone) : 'UTC';
  const m = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(
      date instanceof Date ? date : new Date(date)
    )
  );
  return Number.isFinite(m) ? m : null;
}

class MlFactorCurrentResolverService {
  /**
   * Resolve one factor (used by tests / tooling). Loads park TZ + calendar + weather as needed.
   */
  async resolveCurrentForFactor({ parkId, factorCode, timestamp = new Date(), parkSnap = null, globalRow = null, parkFactorRow = null }) {
    if (!parkId || !DYNAMIC_FACTOR_CODES.has(factorCode)) {
      return pickEffectiveCurrent({
        calculatedCurrent: null,
        l1GlobalPlain: globalRow,
        parkFactorPlain: parkFactorRow,
      });
    }
    const batch = await this.resolveCurrentsForMerge({
      internalParkId: parkId,
      timestamp,
      parkSnap,
      gBy: new Map([[factorCode, globalRow]]),
      pBy: new Map(parkFactorRow ? [[factorCode, parkFactorRow]] : []),
    });
    return batch.get(factorCode) || pickEffectiveCurrent({ calculatedCurrent: null, l1GlobalPlain: globalRow, parkFactorPlain: parkFactorRow });
  }

  /**
   * Batch resolve dynamic L1 factors for mergeMlEnterpriseLayer (single park TZ + calendar + weather read).
   * @param {{ internalParkId: string|null, timestamp: Date, parkSnap: object|null, gBy: Map<string, object>, pBy: Map<string, object> }} params
   * @returns {Map<string, { current: number, currentSource: string, calculatedCurrent: number|null, manualCurrentOverride: number|null, l1ApiCurrent: number|null, meta?: { rainMm: number|null } }>}
   */
  async resolveCurrentsForMerge({ internalParkId, timestamp, parkSnap, gBy, pBy }) {
    const out = new Map();
    const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const codes = [...gBy.keys()].filter((c) => DYNAMIC_FACTOR_CODES.has(c));
    if (!internalParkId || !codes.length) return out;

    const park = await Park.findByPk(internalParkId, { attributes: ['id', 'timezone'] });
    const tz = park?.timezone || parkSnap?.timezone || parkSnap?.timeZone || 'UTC';

    const localDate =
      parkSnap?.localDate ||
      parkSnap?.local_date ||
      dateOnlyInTimeZone(ts, tz) ||
      dateOnlyInTimeZone(ts, 'UTC');

    const calRow =
      localDate &&
      (await ParkCalendarContext.findOne({
        where: { parkId: internalParkId, contextDate: localDate },
      }));

    const cal = calRow ? calRow.get({ plain: true }) : null;

    const isPublicHoliday = Boolean(
      parkSnap?.isPublicHoliday ??
        parkSnap?.is_public_holiday ??
        cal?.isPublicHoliday ??
        cal?.is_public_holiday
    );
    const isSchoolBreak = Boolean(
      parkSnap?.isSchoolHoliday ??
        parkSnap?.is_school_break ??
        parkSnap?.isSchoolBreak ??
        cal?.isSchoolHoliday ??
        cal?.is_school_break ??
        cal?.isSchoolBreak
    );

    const isWeekend =
      parkSnap?.isWeekend != null || parkSnap?.is_weekend != null
        ? Boolean(parkSnap?.isWeekend ?? parkSnap?.is_weekend)
        : weekendFromTimeZone(ts, tz);

    const month =
      parkSnap?.month != null && parkSnap?.month !== ''
        ? Number(parkSnap.month)
        : monthFromTimeZone(ts, tz);

    const obs = await WeatherObservation.findOne({
      where: {
        internalParkId: internalParkId,
        observedAt: { [Op.lte]: ts },
      },
      order: [['observedAt', 'DESC']],
    });
    const obsPlain = obs ? obs.get({ plain: true }) : null;
    const rainMmObs = obsPlain?.rainMm ?? obsPlain?.rain_mm;

    const precipSnap = n(parkSnap?.precipitationMm ?? parkSnap?.precipitation_mm, NaN);

    for (const code of codes) {
      const g = gBy.get(code);
      const p = pBy.get(code);
      let calculated = null;
      /** Nearest rain mm (observation or snapshot) for RAIN_DEMAND_SHIFT bump magnitude in merge layer. */
      let rainMmForMeta = null;

      switch (code) {
        case 'HOLIDAY_PRESSURE':
          calculated = calculateHolidayCurrent(isPublicHoliday);
          break;
        case 'SCHOOL_BREAK_PRESSURE':
          calculated = calculateSchoolBreakCurrent(isSchoolBreak);
          break;
        case 'WEEKEND_UPLIFT':
          calculated = calculateWeekendCurrent(isWeekend);
          break;
        case 'SUMMER_SEASON_FACTOR':
          calculated = calculateSummerCurrentFromMonth(month);
          break;
        case 'RAIN_DEMAND_SHIFT': {
          let mm = rainMmObs;
          if (!Number.isFinite(Number(mm)) && Number.isFinite(precipSnap)) {
            mm = precipSnap;
          }
          if (Number.isFinite(Number(mm))) {
            rainMmForMeta = Number(mm);
          }
          calculated = calculateRainCurrentFromMm(mm);
          break;
        }
        case 'MACRO_TOURISM_INDEX':
          calculated = calculatedMacroNeutral();
          break;
        default:
          calculated = null;
      }

      if (calculated != null) calculated = clampCurrent(calculated);

      const picked = pickEffectiveCurrent({
        calculatedCurrent: calculated,
        l1GlobalPlain: g,
        parkFactorPlain: p,
      });
      picked.current = clampCurrent(picked.current);
      if (code === 'RAIN_DEMAND_SHIFT') {
        picked.meta = { rainMm: rainMmForMeta };
      }
      out.set(code, picked);
    }

    return out;
  }
}

module.exports = {
  MlFactorCurrentResolverService,
  DYNAMIC_FACTOR_CODES,
  clampCurrent,
  calculateRainCurrentFromMm,
  calculateSummerCurrentFromMonth,
  calculateWeekendCurrent,
  calculateHolidayCurrent,
  calculateSchoolBreakCurrent,
  calculatedMacroNeutral,
  pickEffectiveCurrent,
  dateOnlyInTimeZone,
  weekendFromTimeZone,
  monthFromTimeZone,
};
