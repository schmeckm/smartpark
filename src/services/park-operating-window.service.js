/**
 * Resolves park operating intervals (master data → ThemeParks snapshot → level0 annual)
 * and clips them to a UTC query range.
 */
const { Park } = require('../models');
const { AppError } = require('../utils/app-error');
const {
  utcInstantForZonedWallClock,
  parseHmToMinutes,
  ymdPartsFromKey,
  collectLocalDateKeys,
  clipRangeMs,
} = require('../utils/zoned-datetime.util');
const { OperationalContextService, openingHoursSummary } = require('./operational-context.service');

const SCHEDULE_PROVIDER_LABELS = {
  MASTER_DATA: 'Stammdaten (geplante Betriebszeit)',
  themeparks_wiki: 'ThemeParks-Kalender',
  LEVEL0_ANNUAL: 'Level-0-Jahresfenster',
};

/**
 * @param {string} parkId
 * @param {Date} fromD
 * @param {Date} toD
 * @returns {Promise<{
 *   timezone: string,
 *   intervals: Array<{ startMs: number, endMs: number, localDate: string }>,
 *   operatingWindowMs: number,
 *   labelDe: string | null,
 *   scheduleProvider: string | null,
 *   scheduleProviderLabelDe: string | null,
 *   localDates: string[],
 * }>}
 */
async function operatingIntervalsForPark(parkId, fromD, toD) {
  const park = await Park.findByPk(parkId, { attributes: ['id', 'timezone'] });
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });

  const tz = park.timezone || 'UTC';
  const tMin = fromD.getTime();
  const tMax = toD.getTime();
  if (tMax <= tMin) {
    return {
      timezone: tz,
      intervals: [],
      operatingWindowMs: 0,
      labelDe: null,
      scheduleProvider: null,
      scheduleProviderLabelDe: null,
      localDates: [],
    };
  }

  const dateKeys = collectLocalDateKeys(tz, tMin, tMax);
  const opSvc = new OperationalContextService();
  /** @type {Array<{ startMs: number, endMs: number, localDate: string }>} */
  const intervals = [];
  let labelDe = null;
  let scheduleProvider = null;

  for (const ymd of dateKeys) {
    const p = ymdPartsFromKey(ymd);
    if (!p) continue;
    const at = utcInstantForZonedWallClock(p.y, p.m, p.day, 12, 0, 0, tz);
    if (!at) continue;

    // eslint-disable-next-line no-await-in-loop
    const ctx = await opSvc.getOperationalContext(parkId, { at });
    const scheduleRow = ctx.operatingHours?.scheduleRow;
    const sum = openingHoursSummary(scheduleRow);
    const typ = String(scheduleRow?.type || sum?.type || 'OPERATING').toUpperCase();
    if (typ !== 'OPERATING') continue;

    const openMin = parseHmToMinutes(sum?.openingTime ?? scheduleRow?.openingTime);
    const closeMin = parseHmToMinutes(sum?.closingTime ?? scheduleRow?.closingTime);
    if (openMin == null || closeMin == null || closeMin <= openMin) continue;

    const oH = Math.floor(openMin / 60);
    const oMi = openMin % 60;
    const cH = Math.floor(closeMin / 60);
    const cMi = closeMin % 60;
    const openMs = utcInstantForZonedWallClock(p.y, p.m, p.day, oH, oMi, 0, tz)?.getTime();
    const closeMs = utcInstantForZonedWallClock(p.y, p.m, p.day, cH, cMi, 0, tz)?.getTime();
    if (openMs == null || closeMs == null || closeMs <= openMs) continue;

    const seg = clipRangeMs(openMs, closeMs, tMin, tMax);
    if (!seg) continue;
    intervals.push({ startMs: seg[0], endMs: seg[1], localDate: ymd });
    if (!labelDe && sum?.summaryDe) labelDe = sum.summaryDe;
    if (!scheduleProvider && ctx.operatingHours?.scheduleProvider) {
      scheduleProvider = ctx.operatingHours.scheduleProvider;
    }
  }

  intervals.sort((a, b) => a.startMs - b.startMs);
  const operatingWindowMs = intervals.reduce((a, iv) => a + (iv.endMs - iv.startMs), 0);

  return {
    timezone: tz,
    intervals,
    operatingWindowMs,
    labelDe,
    scheduleProvider,
    scheduleProviderLabelDe: scheduleProvider
      ? SCHEDULE_PROVIDER_LABELS[scheduleProvider] || scheduleProvider
      : null,
    localDates: [...new Set(intervals.map((i) => i.localDate))],
  };
}

/**
 * Park-local „today“ from midnight through `now`, intersected with scheduled operating hours.
 * @param {string} parkId
 * @param {Date} [now]
 */
async function operatingIntervalsForParkLocalToday(parkId, now = new Date()) {
  const park = await Park.findByPk(parkId, { attributes: ['id', 'timezone'] });
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  const tz = park.timezone || 'UTC';
  const { localCalendarParts } = require('./ai-snapshot-x-context.service');
  const { y, m, day } = (() => {
    const lp = localCalendarParts(now, tz);
    const p = ymdPartsFromKey(lp.localDate);
    return p || { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, day: now.getUTCDate() };
  })();
  const dayStart = utcInstantForZonedWallClock(y, m, day, 0, 0, 0, tz) || now;
  return operatingIntervalsForPark(parkId, dayStart, now);
}

module.exports = {
  operatingIntervalsForPark,
  operatingIntervalsForParkLocalToday,
  SCHEDULE_PROVIDER_LABELS,
};
