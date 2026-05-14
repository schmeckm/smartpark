/**
 * Resolves calendar / weather / traffic (mock) / staffing signals for a 5m feature bucket.
 * All wall-clock interpretations use the park IANA timezone when set; snapshot_at stays UTC.
 * @see docs/adr/0001-forecast-architecture.md (UTC buckets, UI TZ separate)
 */
const { Op, fn, col } = require('sequelize');
const {
  Park,
  WeatherObservation,
  ParkCalendarContext,
  ParkZone,
  Staff,
  ParkAsset,
  RideMasterData,
  RideFeatureSnapshot,
  RideWaitTimeSample,
} = require('../models');

function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function seasonFromMonth(m) {
  if (m >= 3 && m <= 5) return 1;
  if (m >= 6 && m <= 8) return 2;
  if (m >= 9 && m <= 11) return 3;
  return 4;
}

/**
 * @param {Date} utc
 * @param {string} [ianaTz]
 */
function localCalendarParts(utc, ianaTz) {
  const tz = ianaTz && ianaTz.trim() ? ianaTz.trim() : 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(utc);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const mo = Number(parts.find((p) => p.type === 'month')?.value);
    const da = Number(parts.find((p) => p.type === 'day')?.value);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const wdStr = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = wdMap[wdStr.slice(0, 3)] ?? utc.getUTCDay();
    const localDate = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    return { localDate, localHour: hour, dayOfWeek, month: mo, season: seasonFromMonth(mo), isWeekend };
  } catch {
    const d = utc;
    return {
      localDate: d.toISOString().slice(0, 10),
      localHour: d.getUTCHours(),
      dayOfWeek: d.getUTCDay(),
      month: d.getUTCMonth() + 1,
      season: seasonFromMonth(d.getUTCMonth() + 1),
      isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    };
  }
}

const BUCKET_MS = 5 * 60 * 1000;

/**
 * Latest observation for this 5m snapshot bucket. Uses observedAt within [−∞, bucketEnd] where
 * bucketEnd is the exclusive end of the bucket (bucketUtc + 5m). Open-Meteo `current.time` often
 * falls after the floored bucket start; filtering only `<= bucketUtc` incorrectly dropped those rows.
 * Matches internal UUID, park_id equal to that UUID (legacy), or park_id equal to ThemeParks external park id.
 */
async function latestWeatherNearBucket(internalParkId, bucketUtc, externalParkId = null) {
  if (!internalParkId && !externalParkId) return null;
  const or = [];
  if (internalParkId) {
    or.push({ internalParkId }, { parkId: String(internalParkId) });
  }
  if (externalParkId && String(externalParkId).trim()) {
    or.push({ parkId: String(externalParkId).trim() });
  }
  const bucketEnd = new Date(bucketUtc.getTime() + BUCKET_MS);
  const w = await WeatherObservation.findOne({
    where: {
      [Op.or]: or,
      observedAt: { [Op.lt]: bucketEnd },
    },
    order: [['observedAt', 'DESC']],
  });
  return w ? w.get({ plain: true }) : null;
}

async function calendarForLocalDate(parkId, localDate) {
  if (!parkId || !localDate) return null;
  return ParkCalendarContext.findOne({
    where: { parkId, contextDate: localDate },
  });
}

async function staffingGapApprox(parkId) {
  if (!parkId) return null;
  const zones = await ParkZone.findAll({ where: { parkId }, attributes: ['id'] });
  const zids = zones.map((z) => z.id);
  if (!zids.length) return 0;
  const onDuty = await Staff.count({ where: { currentZoneId: { [Op.in]: zids } } });
  return Math.max(0, 20 - onDuty);
}

/**
 * @param {object} opts
 * @param {import('../modules/assets/platform.models').Park|{ id: string, timezone?: string|null }|null} opts.park
 * @param {Date} opts.bucketUtc
 * @param {string} opts.externalParkId
 * @param {number|null} opts.avgWait
 * @param {number} opts.ridesReporting
 */
async function buildParkXLayer(opts) {
  const { park, bucketUtc, externalParkId, avgWait, ridesReporting } = opts;
  const tz = park?.timezone || null;
  const cal = localCalendarParts(bucketUtc, tz || undefined);
  let isPublicHoliday = false;
  let isSchoolHoliday = false;
  let holidayName = null;
  let calendarRowPresent = false;
  if (park?.id && cal.localDate) {
    const calRow = await calendarForLocalDate(park.id, cal.localDate);
    if (calRow) {
      calendarRowPresent = true;
      isPublicHoliday = Boolean(calRow.isPublicHoliday);
      isSchoolHoliday = Boolean(calRow.isSchoolBreak);
      holidayName = calRow.holidayName || null;
    }
  }
  const wx = await latestWeatherNearBucket(park?.id, bucketUtc, externalParkId);
  const temperatureC = wx ? num(wx.temperatureC, null) : null;
  const precipitationMm = wx ? num(wx.rainMm, null) : null;
  const rainProbabilityPercent = wx ? num(wx.rainProbabilityPercent, null) : null;
  const windSpeedKmh = wx ? num(wx.windKmh, null) : null;
  const weatherCondition = wx?.condition || null;

  const parkCrowdIndex =
    avgWait != null && Number.isFinite(Number(avgWait)) ? Math.max(0, Math.min(100, Math.round(Number(avgWait)))) : null;

  const fieldsPresent = [
    temperatureC != null,
    precipitationMm != null || rainProbabilityPercent != null,
    park?.id != null,
    cal.localDate != null,
  ].filter(Boolean).length;
  const completenessScore = Math.min(1, fieldsPresent / 4 + (ridesReporting > 0 ? 0.25 : 0));

  return {
    internalParkId: park?.id || null,
    timezone: tz,
    localDate: cal.localDate,
    localHour: cal.localHour,
    dayOfWeek: cal.dayOfWeek,
    month: cal.month,
    season: cal.season,
    isWeekend: cal.isWeekend,
    isPublicHoliday,
    isSchoolHoliday,
    holidayName,
    temperatureC,
    precipitationMm,
    rainProbabilityPercent,
    windSpeedKmh,
    weatherCondition,
    trafficIndex: null,
    specialEventFlag: false,
    parkCrowdIndex,
    completenessScore,
    targetWaitTime15m: null,
    targetWaitTime60m: null,
    targetWaitTime120m: null,
    // Traffic: no provider integration in this codebase yet — always not_configured until wired.
    xFeaturesExtras: {
      traffic: 'not_configured',
      events: calendarRowPresent ? 'configured' : 'not_configured',
      externalParkId,
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.provider
 * @param {import('../modules/assets/platform.models').Park|null} opts.park
 * @param {Date} opts.bucketUtc
 * @param {string} opts.externalParkId
 * @param {string} opts.externalEntityId
 * @param {number|null} opts.waitTime
 * @param {object|null} opts.parkX
 * @param {object|null} opts.previousRideSnapshotPlain
 */
/**
 * Rolling mean wait from canonical samples (no NaN; null if no rows).
 * @param {string} provider
 * @param {string} externalEntityId
 * @param {Date} bucketUtc
 * @param {number} windowMinutes
 */
async function avgWaitSamplesInWindow(provider, externalEntityId, bucketUtc, windowMinutes) {
  if (!provider || !externalEntityId || !bucketUtc) return null;
  const to = new Date(bucketUtc);
  const from = new Date(to.getTime() - windowMinutes * 60 * 1000);
  const row = await RideWaitTimeSample.findOne({
    attributes: [[fn('AVG', col('wait_time')), 'avgWait']],
    where: {
      provider: String(provider),
      externalEntityId: String(externalEntityId),
      sampledAt: { [Op.gt]: from, [Op.lte]: to },
      waitTime: { [Op.ne]: null },
    },
    raw: true,
  });
  const raw = row?.avgWait;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

async function buildRideXLayer(opts) {
  const {
    provider,
    park,
    bucketUtc,
    externalParkId,
    externalEntityId,
    waitTime,
    parkX,
    previousRideSnapshotPlain,
  } = opts;
  let asset = null;
  let rideMaster = null;
  if (park?.id) {
    asset = await ParkAsset.findOne({
      where: { parkId: park.id, externalEntityId: String(externalEntityId) },
      attributes: ['assetId', 'parkId', 'zoneId'],
    });
    if (asset) {
      rideMaster = await RideMasterData.findByPk(asset.assetId, { attributes: ['theoreticalCapacityPph', 'normalStaff'] });
    }
  }
  const prevWt = previousRideSnapshotPlain?.waitTime != null ? num(previousRideSnapshotPlain.waitTime, null) : null;
  const prevCur =
    previousRideSnapshotPlain?.currentWaitTimeMin != null
      ? num(previousRideSnapshotPlain.currentWaitTimeMin, null)
      : null;
  const prev = prevWt ?? prevCur;
  const cur = waitTime != null ? num(waitTime, null) : null;
  const staffingGap = park?.id ? await staffingGapApprox(park.id) : null;

  let roll15 = null;
  let roll60 = null;
  if (provider && externalEntityId) {
    const [a15, a60] = await Promise.all([
      avgWaitSamplesInWindow(provider, externalEntityId, bucketUtc, 15),
      avgWaitSamplesInWindow(provider, externalEntityId, bucketUtc, 60),
    ]);
    roll15 = a15;
    roll60 = a60;
  }

  /** Prefer live bucket wait; else recent sample rollups (stabilizes ENTITY_STATUS-only buckets). */
  const effectiveCur = cur ?? roll15 ?? roll60;
  const delta = effectiveCur != null && prev != null ? effectiveCur - prev : null;

  const inherited = parkX || {};
  const fieldsPresent = [
    effectiveCur != null,
    inherited.temperatureC != null || inherited.temperature_c != null,
    inherited.isPublicHoliday != null,
    asset != null,
  ].filter(Boolean).length;
  const completenessScore = Math.min(1, fieldsPresent / 4);

  return {
    internalParkId: park?.id || null,
    internalAssetId: asset?.assetId || null,
    currentWaitTimeMin: effectiveCur,
    previousWaitTimeMin: prev,
    waitTimeDelta5m: delta,
    rollingAvgWait15m: roll15,
    rollingAvgWait60m: roll60,
    theoreticalCapacityPph: rideMaster?.theoreticalCapacityPph != null ? Number(rideMaster.theoreticalCapacityPph) : null,
    staffingGapNormal: staffingGap,
    rainSensitive: true,
    weatherSensitive: true,
    parkCrowdIndex: inherited.parkCrowdIndex ?? inherited.park_crowd_index ?? null,
    temperatureC: inherited.temperatureC ?? inherited.temperature_c ?? null,
    precipitationMm: inherited.precipitationMm ?? inherited.precipitation_mm ?? null,
    rainProbabilityPercent:
      inherited.rainProbabilityPercent ?? inherited.rain_probability_percent ?? null,
    isPublicHoliday: inherited.isPublicHoliday ?? inherited.is_public_holiday ?? null,
    isSchoolHoliday: inherited.isSchoolHoliday ?? inherited.is_school_holiday ?? null,
    trafficIndex: inherited.trafficIndex ?? inherited.traffic_index ?? null,
    specialEventFlag: inherited.specialEventFlag ?? inherited.special_event_flag ?? false,
    completenessScore,
    xFeaturesExtras: {
      externalParkId,
      externalEntityId,
      bucketUtc: bucketUtc.toISOString(),
    },
  };
}

async function resolveParkByExternalExternalId(externalParkId) {
  if (!externalParkId) return null;
  return Park.findOne({ where: { externalEntityId: String(externalParkId) } });
}

async function findPreviousRideSnapshot(provider, externalParkId, externalEntityId, beforeBucket) {
  return RideFeatureSnapshot.findOne({
    where: {
      provider,
      externalParkId: String(externalParkId),
      externalEntityId: String(externalEntityId),
      snapshotAt: { [Op.lt]: beforeBucket },
    },
    order: [['snapshotAt', 'DESC']],
  });
}

module.exports = {
  buildParkXLayer,
  buildRideXLayer,
  resolveParkByExternalExternalId,
  findPreviousRideSnapshot,
  localCalendarParts,
};
