/**
 * Add-on Board: park (L0), zone (L1), ride (L3) aggregates from platform assets + feature snapshots + ML bridge.
 */
const { Op, fn, col } = require('sequelize');
const {
  Park,
  ParkAsset,
  ParkZone,
  AssetType,
  RideFeatureSnapshot,
  ParkFeatureSnapshot,
  RideMasterData,
  Incident,
  AssetDowntimeEvent,
} = require('../models');
const { TimeseriesService } = require('./timeseries.service');
const {
  getRideBoardMlFields,
  parkDemandIndexFromAvg60,
  meaningfulAverageForecast60,
} = require('./ml/addon-board-ml-bridge.service');
const { resolveAddonBoardThresholds } = require('./addon-board-config.service');
const { findLatestSparkplugLiveMetricRow } = require('./mqtt-sparkplug-live-buffer.service');
const {
  loadEnabledRulesByAssetIds,
  evaluatePredictiveMaintenanceForAsset,
  maybeAppendPdmEvaluationLog,
} = require('./predictive-maintenance.service');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
const env = require('../config/env');
const { operatingIntervalsForParkLocalToday } = require('./park-operating-window.service');
const {
  sumDowntimeMsInIntervals,
  availabilityPctFromDowntime,
} = require('../utils/downtime-interval-aggregate.util');

const RIDE_PAYLOAD_CACHE_TTL_MS = Number(process.env.ADDON_BOARD_CACHE_MS || 5000);
const RELIABILITY_LOOKBACK_DAYS = 30;

const timeseriesService = new TimeseriesService();

function n(v, d = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function safetyStatusFromSnapshot(snap) {
  const st = String(snap?.status || '').toUpperCase();
  if (st.includes('DOWN') || st.includes('E_STOP') || st.includes('EMERGENCY')) return 'CRITICAL';
  if (st.includes('MAINT') || st.includes('DELAY')) return 'WARNING';
  if (snap?.isOpen === false && st.includes('CLOSED')) return 'WARNING';
  return 'OK';
}

function estThroughputPph(snap, master) {
  const theo = n(
    snap?.theoreticalCapacityPph ?? master?.theoreticalCapacityPph ?? master?.capacityPph,
    null
  );
  if (theo == null) return null;
  const cf = n(snap?.capacityFactor, 0.65);
  return Math.round(theo * Math.min(1, Math.max(0.12, cf)));
}

function performancePct(snap, master) {
  const theo = n(snap?.theoreticalCapacityPph ?? master?.theoreticalCapacityPph, null);
  const act = estThroughputPph(snap, master);
  if (!theo || !act) return null;
  return Math.round(Math.min(150, (act / theo) * 100));
}

function rideOeeFromSnapshot(snap, master, availabilityPercentOverride = null) {
  let avail;
  if (availabilityPercentOverride != null && Number.isFinite(Number(availabilityPercentOverride))) {
    avail = Math.min(100, Math.max(0, Number(availabilityPercentOverride)));
  } else {
    avail = snap?.isOpen === false ? 40 : snap?.isOpen === true ? 92 : 75;
  }
  const perf = performancePct(snap, master) ?? 70;
  const qual = 95;
  return Math.round((avail * perf * qual) / 10000);
}

/** Sparkplug group id on the broker (simulator / edge) — aligns with UNS live + OEE MQTT cockpit. */
function sparkplugGroupIdForParkSlug(parkSlug) {
  const fromEnv = env.sparkplugGroupId && String(env.sparkplugGroupId).trim();
  if (fromEnv) return fromEnv;
  return slugifyName(parkSlug || 'park');
}

function mapSparkplugAssetStateToOperationalStatus(raw) {
  const s = String(raw || '').toUpperCase();
  if (!s) return null;
  if (['RUNNING', 'READY', 'LOADING', 'DISPATCHED', 'UNLOADING', 'STARTING'].includes(s)) return 'RUNNING';
  if (['FAULT', 'STOPPED', 'WEATHER_HOLD'].includes(s)) return 'DOWN';
  if (s === 'MAINTENANCE') return 'MAINTENANCE';
  if (['OFF', 'NIGHT_SHUTDOWN', 'NIGHT_MODE'].includes(s)) return 'CLOSED';
  return 'UNKNOWN';
}

function operationalStatusFromSnapshot(snap, currentWait) {
  const isOpen = snap?.isOpen ?? currentWait?.isOpen;
  const st = String(snap?.status ?? currentWait?.status ?? '').toUpperCase();
  if (isOpen === false || st.includes('CLOSED') || st.includes('NIGHT')) return 'CLOSED';
  if (st.includes('MAINT')) return 'MAINTENANCE';
  if (st.includes('DOWN') || st.includes('FAULT') || st.includes('E_STOP') || st.includes('EMERGENCY')) {
    return 'DOWN';
  }
  if (isOpen === true) return 'RUNNING';
  return 'UNKNOWN';
}

function clipOverlapMs(rangeStart, rangeEnd, winStart, winEnd) {
  const ss = Math.max(rangeStart, winStart);
  const ee = Math.min(rangeEnd, winEnd);
  return ee > ss ? ee - ss : 0;
}

/**
 * Per-ride rollups from `asset_downtime_events` (UTC day “today” + trailing reliability window).
 * @returns {Map<string, { unplannedMinToday: number, plannedMinToday: number, availabilityPctToday: number|null, mttrMinutes: number|null, mtbfHours: number|null }>}
 */
async function rideOperationsRollupByAsset(parkId, assetIds) {
  const empty = () => ({
    unplannedMinToday: 0,
    plannedMinToday: 0,
    availabilityPctToday: null,
    availabilitySourceToday: null,
    operatingWindowMinutesToday: null,
    mttrMinutes: null,
    mtbfHours: null,
  });
  const out = new Map();
  if (!assetIds.length) return out;
  for (const id of assetIds) out.set(String(id), empty());

  const now = new Date();
  let dayStart = startOfUtcDay();
  let windowEnd = now;
  let dayWindowMs = windowEnd.getTime() - dayStart.getTime();
  /** @type {Array<{ startMs: number, endMs: number }>} */
  let todayIntervals = [];
  let availabilitySourceToday = 'UTC_CALENDAR_DAY';

  try {
    const opToday = await operatingIntervalsForParkLocalToday(parkId, now);
    if (opToday.intervals.length > 0) {
      todayIntervals = opToday.intervals;
      dayStart = new Date(opToday.intervals[0].startMs);
      windowEnd = new Date(Math.min(now.getTime(), opToday.intervals[opToday.intervals.length - 1].endMs));
      dayWindowMs = opToday.operatingWindowMs;
      availabilitySourceToday = 'PARK_OPERATING_HOURS';
    }
  } catch {
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    windowEnd = now < dayEnd ? now : dayEnd;
    dayWindowMs = windowEnd.getTime() - dayStart.getTime();
  }

  const histFrom = new Date(now.getTime() - RELIABILITY_LOOKBACK_DAYS * 86400000);
  const histWindowMs = now.getTime() - histFrom.getTime();

  const rowsToday = await AssetDowntimeEvent.findAll({
    where: {
      parkId,
      assetId: { [Op.in]: [...new Set(assetIds.map(String))] },
      startedAt: { [Op.lte]: windowEnd },
      [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: dayStart } }],
    },
    attributes: ['assetId', 'startedAt', 'endedAt', 'planned'],
    limit: 8000,
  });

  if (todayIntervals.length) {
    const opMinToday = Math.round(dayWindowMs / 60000);
    for (const id of assetIds) {
      const rec = out.get(String(id));
      rec.operatingWindowMinutesToday = opMinToday;
      rec.availabilitySourceToday = availabilitySourceToday;
    }
    const byAsset = new Map();
    for (const r of rowsToday) {
      const aid = r.assetId ? String(r.assetId) : null;
      if (!aid || !out.has(aid)) continue;
      if (!byAsset.has(aid)) byAsset.set(aid, []);
      byAsset.get(aid).push(r);
    }
    for (const [aid, assetRows] of byAsset) {
      const rec = out.get(aid);
      const { plannedMs, unplannedMs } = sumDowntimeMsInIntervals(assetRows, todayIntervals, windowEnd);
      rec.plannedMinToday = plannedMs / 60000;
      rec.unplannedMinToday = unplannedMs / 60000;
      rec.operatingWindowMinutesToday = Math.round(dayWindowMs / 60000);
      rec.availabilitySourceToday = availabilitySourceToday;
      out.set(aid, rec);
    }
  } else {
    for (const r of rowsToday) {
      const aid = r.assetId ? String(r.assetId) : null;
      if (!aid || !out.has(aid)) continue;
      const rec = out.get(aid);
      const s = new Date(r.startedAt).getTime();
      const eCap = r.endedAt ? new Date(r.endedAt).getTime() : now.getTime();
      const ms = clipOverlapMs(s, eCap, dayStart.getTime(), windowEnd.getTime());
      if (ms <= 0) continue;
      if (r.planned) rec.plannedMinToday += ms / 60000;
      else rec.unplannedMinToday += ms / 60000;
      out.set(aid, rec);
    }
  }

  for (const [, rec] of out) {
    if (dayWindowMs > 0) {
      const upMs = rec.unplannedMinToday * 60000;
      rec.availabilityPctToday =
        Math.round(availabilityPctFromDowntime(dayWindowMs, upMs) * 10) / 10;
      if (!rec.availabilitySourceToday) rec.availabilitySourceToday = availabilitySourceToday;
    }
  }

  const histRows = await AssetDowntimeEvent.findAll({
    where: {
      parkId,
      assetId: { [Op.in]: [...new Set(assetIds.map(String))] },
      startedAt: { [Op.lte]: now },
      [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: histFrom } }],
    },
    attributes: ['assetId', 'startedAt', 'endedAt', 'planned'],
    limit: 12000,
  });

  /** @type {Map<string, { sumMin: number, n: number }>} */
  const mttrAgg = new Map();
  /** @type {Map<string, { unplannedMs: number, failureStarts: number }>} */
  const mtbfAgg = new Map();

  for (const r of histRows) {
    const aid = r.assetId ? String(r.assetId) : null;
    if (!aid || !out.has(aid)) continue;

    const s = new Date(r.startedAt).getTime();
    const eCap = r.endedAt ? new Date(r.endedAt).getTime() : now.getTime();
    const msUnplanned = !r.planned ? clipOverlapMs(s, eCap, histFrom.getTime(), now.getTime()) : 0;

    if (!r.planned) {
      const m = mtbfAgg.get(aid) || { unplannedMs: 0, failureStarts: 0 };
      if (msUnplanned > 0) m.unplannedMs += msUnplanned;
      if (s >= histFrom.getTime() && s <= now.getTime()) m.failureStarts += 1;
      mtbfAgg.set(aid, m);
    }

    if (!r.planned && r.endedAt && r.startedAt) {
      const durMin = (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000;
      if (durMin > 0 && s >= histFrom.getTime()) {
        const a = mttrAgg.get(aid) || { sumMin: 0, n: 0 };
        a.sumMin += durMin;
        a.n += 1;
        mttrAgg.set(aid, a);
      }
    }
  }

  for (const aid of assetIds) {
    const k = String(aid);
    const rec = out.get(k) || empty();
    const mttr = mttrAgg.get(k);
    if (mttr && mttr.n > 0) rec.mttrMinutes = Math.round((mttr.sumMin / mttr.n) * 10) / 10;
    const mb = mtbfAgg.get(k);
    if (mb && mb.failureStarts > 0 && histWindowMs > 0) {
      const uptimeMs = Math.max(0, histWindowMs - mb.unplannedMs);
      rec.mtbfHours = Math.round((uptimeMs / mb.failureStarts / 3600000) * 10) / 10;
    }
    out.set(k, rec);
  }

  return out;
}

/**
 * Latest ride metrics from in-memory Sparkplug DDATA buffer (same process as MQTT connector).
 * @param {Record<string, unknown>} assetPlain - park_assets plain row (slug, name, assetId)
 * @param {string} parkSlug - parks.slug
 * @returns {{
 *   rideOeePercent: number|null,
 *   queueOccupancy: number|null,
 *   assetStateRaw: string|null,
 *   operationalStatus: string|null,
 *   dispatchIntervalSecTarget: number|null,
 *   actualDispatchIntervalSec: number|null,
 * } | null}
 */
function liveRideMetricsFromSparkplugBuffer(assetPlain, parkSlug) {
  const groupId = sparkplugGroupIdForParkSlug(parkSlug);
  const edgeNodeId = String(env.sparkplugEdgeNode || 'park_gateway');
  const slug = assetPlain.slug != null ? String(assetPlain.slug) : '';
  const name = assetPlain.name != null ? String(assetPlain.name) : '';
  const aid = assetPlain.assetId != null ? String(assetPlain.assetId) : '';
  const candidates = [
    sparkplugDeviceTopicSegment(slug),
    sparkplugDeviceTopicSegment(name),
    sparkplugDeviceTopicSegment(aid),
  ].filter((x, i, a) => x && a.indexOf(x) === i);

  let oee01 = null;
  let queueOcc = null;
  let assetStateRaw = null;
  let operationalStatus = null;
  let dispatchIntervalSecTarget = null;
  let actualDispatchIntervalSec = null;
  for (const deviceId of candidates) {
    const oeeRow = findLatestSparkplugLiveMetricRow({
      groupId,
      edgeNodeId,
      deviceId,
      metricName: 'oee_5m',
    });
    const qRow = findLatestSparkplugLiveMetricRow({
      groupId,
      edgeNodeId,
      deviceId,
      metricName: 'queue_occupancy',
    });
    const stRow = findLatestSparkplugLiveMetricRow({
      groupId,
      edgeNodeId,
      deviceId,
      metricName: 'asset_state',
    });
    const diRow = findLatestSparkplugLiveMetricRow({
      groupId,
      edgeNodeId,
      deviceId,
      metricName: 'dispatch_interval_sec',
    });
    const adiRow = findLatestSparkplugLiveMetricRow({
      groupId,
      edgeNodeId,
      deviceId,
      metricName: 'actual_dispatch_interval_sec',
    });
    let thisOee = null;
    if (oeeRow && oeeRow.value != null && Number.isFinite(Number(oeeRow.value))) {
      const v = Number(oeeRow.value);
      thisOee = v <= 1.5 ? v : v / 100;
    }
    const thisQ =
      qRow && qRow.value != null && Number.isFinite(Number(qRow.value)) ? Number(qRow.value) : null;
    const stVal = stRow?.value != null ? String(stRow.value) : '';
    const mapped = mapSparkplugAssetStateToOperationalStatus(stVal);
    const diV =
      diRow && diRow.value != null && Number.isFinite(Number(diRow.value)) ? Number(diRow.value) : null;
    const adiV =
      adiRow && adiRow.value != null && Number.isFinite(Number(adiRow.value)) ? Number(adiRow.value) : null;

    if (mapped && !operationalStatus) {
      operationalStatus = mapped;
      assetStateRaw = stVal || null;
    }
    if (diV != null && dispatchIntervalSecTarget == null) dispatchIntervalSecTarget = diV;
    if (adiV != null && actualDispatchIntervalSec == null) actualDispatchIntervalSec = adiV;

    if (thisOee != null) {
      oee01 = thisOee;
      if (thisQ != null) queueOcc = thisQ;
      if (mapped) {
        operationalStatus = mapped;
        assetStateRaw = stVal || null;
      }
      if (diV != null) dispatchIntervalSecTarget = diV;
      if (adiV != null) actualDispatchIntervalSec = adiV;
      break;
    }
    if (thisQ != null && queueOcc == null) queueOcc = thisQ;
  }

  if (
    oee01 == null &&
    queueOcc == null &&
    !operationalStatus &&
    dispatchIntervalSecTarget == null &&
    actualDispatchIntervalSec == null
  ) {
    return null;
  }
  const rideOeePercent =
    oee01 != null ? Math.round(Math.min(1.2, Math.max(0, oee01)) * 1000) / 10 : null;
  return {
    rideOeePercent: rideOeePercent != null ? Math.min(150, rideOeePercent) : null,
    queueOccupancy: queueOcc,
    assetStateRaw,
    operationalStatus,
    dispatchIntervalSecTarget,
    actualDispatchIntervalSec,
  };
}

function severityForRide({ wait, safetyStatus, crewGap, isOpen, status }, th = {}) {
  const waitCritical = n(th.waitCriticalMinutes, 90);
  const waitHigh = n(th.waitHighMinutes, 65);
  const waitMedium = n(th.waitMediumMinutes, 45);
  const crewGapHigh = n(th.crewGapHighThreshold, -2);
  const st = String(status || '').toUpperCase();
  if (safetyStatus === 'CRITICAL') return 'CRITICAL';
  if (wait != null && wait >= waitCritical) return 'CRITICAL';
  if (wait != null && wait >= waitHigh) return 'HIGH';
  if (crewGap != null && crewGap <= crewGapHigh) return 'HIGH';
  if (safetyStatus === 'WARNING' || (isOpen === false && st && !st.includes('CLOSED'))) return 'HIGH';
  if (wait != null && wait >= waitMedium) return 'MEDIUM';
  return 'LOW';
}

function ruleAiRecommendation({ wait, crewGap, forecast60, predictionMode, thresholds }) {
  const w = n(wait, 0);
  const f60 = n(forecast60, w);
  const cg = n(crewGap, 0);
  const fc = n(thresholds?.forecastCriticalAtMinutes, 55);
  const heavyFc = Math.max(75, fc);
  if (w >= fc && cg < 0) {
    return {
      title: 'Address crew gap',
      expectedImpact: 'Stabilize throughput before adding capacity',
      confidence: 0.62,
    };
  }
  if (f60 >= heavyFc) {
    return {
      title: 'Expect heavy queue — consider guest communication',
      expectedImpact: `Forecast (${predictionMode || 'BASELINE'}) suggests sustained pressure`,
      confidence: 0.55,
    };
  }
  if (w >= 45) {
    return {
      title: 'Monitor queue and dispatch rhythm',
      expectedImpact: 'Watch throughput vs theoretical capacity in the next hour',
      confidence: 0.5,
    };
  }
  return {
    title: 'Operations nominal',
    expectedImpact: 'Maintain current staffing and dispatch pattern',
    confidence: 0.4,
  };
}

async function incidentCountsForAssetsToday(parkId, assetIds) {
  if (!assetIds.length) return new Map();
  const dayStart = startOfUtcDay();
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const list = await Incident.findAll({
    where: {
      parkId,
      createdAt: { [Op.between]: [dayStart, dayEnd] },
      status: { [Op.in]: ['OPEN', 'IN_PROGRESS'] },
      linkedEntityId: { [Op.in]: [...new Set(assetIds.map(String))] },
    },
    attributes: ['linkedEntityId'],
    limit: 3000,
  });
  const m = new Map();
  for (const row of list) {
    const k = row.linkedEntityId ? String(row.linkedEntityId) : null;
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

async function listRideAssets(parkId) {
  const rideType = await AssetType.findOne({ where: { code: 'RIDE' } });
  if (!rideType) return [];
  return ParkAsset.findAll({
    where: { parkId, assetTypeId: rideType.id, activeFlag: true },
    include: [
      { model: ParkZone, as: 'zone', required: false, attributes: ['id', 'name', 'slug'] },
      { model: RideMasterData, as: 'rideMaster', required: false },
    ],
    order: [['name', 'ASC']],
    limit: 500,
  });
}

async function latestParkFeatureSnapshot(parkId) {
  const row = await ParkFeatureSnapshot.findOne({
    where: { internalParkId: parkId },
    order: [['snapshotAt', 'DESC']],
    attributes: [
      'snapshotAt',
      'temperatureC',
      'precipitationMm',
      'windSpeedKmh',
      'weatherCondition',
      'rainProbabilityPercent',
    ],
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * Park-level strip for list payloads; ride-level merge for SWDEC cards (Phase 2 weather context).
 * @param {Record<string, unknown>|null} parkSnap
 * @param {Record<string, unknown>|null} rideSnap
 */
function buildWeatherContext(parkSnap, rideSnap) {
  const hasParkWx =
    parkSnap &&
    (parkSnap.temperatureC != null ||
      parkSnap.precipitationMm != null ||
      parkSnap.windSpeedKmh != null ||
      (parkSnap.weatherCondition != null && String(parkSnap.weatherCondition).trim() !== '') ||
      parkSnap.rainProbabilityPercent != null);
  const hasRideWx =
    rideSnap &&
    (rideSnap.temperatureC != null ||
      rideSnap.precipitationMm != null ||
      rideSnap.rainProbabilityPercent != null ||
      rideSnap.rainSensitive != null ||
      rideSnap.weatherSensitive != null ||
      rideSnap.weatherSensitivityScore != null);
  if (!hasParkWx && !hasRideWx) return null;

  const pt =
    parkSnap?.snapshotAt != null ? new Date(parkSnap.snapshotAt).toISOString() : null;
  const rt =
    rideSnap?.snapshotAt != null ? new Date(rideSnap.snapshotAt).toISOString() : null;
  let contextAsOf = pt || rt || null;
  if (pt && rt) {
    contextAsOf = new Date(Math.max(Date.parse(pt), Date.parse(rt))).toISOString();
  }

  const temp = n(parkSnap?.temperatureC, null) ?? n(rideSnap?.temperatureC, null);
  const precip = n(parkSnap?.precipitationMm, null) ?? n(rideSnap?.precipitationMm, null);
  const rainP = n(parkSnap?.rainProbabilityPercent, null) ?? n(rideSnap?.rainProbabilityPercent, null);
  const wind = parkSnap?.windSpeedKmh != null ? n(parkSnap.windSpeedKmh, null) : null;
  const condition =
    parkSnap?.weatherCondition != null && String(parkSnap.weatherCondition).trim() !== ''
      ? String(parkSnap.weatherCondition).trim()
      : null;

  /** @type {string[]} */
  const dataLayers = [];
  if (hasParkWx) dataLayers.push('park_feature_snapshot_5m');
  if (hasRideWx) dataLayers.push('ride_feature_snapshot_5m');

  return {
    contextAsOf,
    snapshotAtPark: pt,
    snapshotAtRide: rt,
    temperatureC: temp != null ? Math.round(temp * 10) / 10 : null,
    precipitationMm: precip != null ? Math.round(Number(precip) * 10000) / 10000 : null,
    windSpeedKmh: wind != null ? Math.round(wind * 10) / 10 : null,
    weatherCondition: condition,
    rainProbabilityPercent: rainP != null ? Math.round(rainP * 10) / 10 : null,
    rainSensitive: rideSnap?.rainSensitive != null ? Boolean(rideSnap.rainSensitive) : null,
    weatherSensitive: rideSnap?.weatherSensitive != null ? Boolean(rideSnap.weatherSensitive) : null,
    weatherSensitivityScore:
      rideSnap?.weatherSensitivityScore != null ? n(rideSnap.weatherSensitivityScore, null) : null,
    dataLayers,
  };
}

function parkWeatherBannerFromSnapshot(parkSnapPlain) {
  const w = buildWeatherContext(parkSnapPlain, null);
  if (!w) return null;
  return {
    contextAsOf: w.contextAsOf,
    snapshotAtPark: w.snapshotAtPark,
    temperatureC: w.temperatureC,
    precipitationMm: w.precipitationMm,
    windSpeedKmh: w.windSpeedKmh,
    weatherCondition: w.weatherCondition,
    rainProbabilityPercent: w.rainProbabilityPercent,
    scope: 'park',
    source: 'park_feature_snapshot_5m',
  };
}

function emptyVenueTriplet() {
  return { restaurants: 0, shops: 0, shows: 0 };
}

/**
 * Active RESTAURANT / SHOP / SHOW counts for the park, rolled up by zone (Phase 3 cross-asset context).
 * @param {string} parkId
 * @returns {Promise<{ parkVenues: { restaurants: number, shops: number, shows: number }, venuesByZoneId: Map<string, { restaurants: number, shops: number, shows: number }> }>}
 */
async function crossAssetVenueStatsForPark(parkId) {
  const types = await AssetType.findAll({
    where: { code: { [Op.in]: ['RESTAURANT', 'SHOP', 'SHOW'] } },
    attributes: ['id', 'code'],
  });
  if (!types.length) {
    return { parkVenues: emptyVenueTriplet(), venuesByZoneId: new Map() };
  }
  /** @type {Map<string, 'restaurants'|'shops'|'shows'>} */
  const idToKey = new Map();
  for (const t of types) {
    const c = String(t.code || '').toUpperCase();
    if (c === 'RESTAURANT') idToKey.set(String(t.id), 'restaurants');
    else if (c === 'SHOP') idToKey.set(String(t.id), 'shops');
    else if (c === 'SHOW') idToKey.set(String(t.id), 'shows');
  }
  if (!idToKey.size) {
    return { parkVenues: emptyVenueTriplet(), venuesByZoneId: new Map() };
  }
  const typeIds = [...idToKey.keys()];
  const rows = await ParkAsset.findAll({
    where: { parkId, activeFlag: true, assetTypeId: { [Op.in]: typeIds } },
    attributes: ['zoneId', 'assetTypeId'],
    limit: 8000,
  });
  const parkVenues = emptyVenueTriplet();
  const venuesByZoneId = new Map();
  for (const r of rows) {
    const key = idToKey.get(String(r.assetTypeId));
    if (!key) continue;
    parkVenues[key] += 1;
    const zid = r.zoneId != null ? String(r.zoneId) : '_unzoned';
    if (!venuesByZoneId.has(zid)) venuesByZoneId.set(zid, emptyVenueTriplet());
    const z = venuesByZoneId.get(zid);
    z[key] += 1;
  }
  return { parkVenues, venuesByZoneId };
}

function zoneVenuesForZone(venuesByZoneId, zoneId) {
  if (!venuesByZoneId || zoneId == null || zoneId === '') return emptyVenueTriplet();
  return venuesByZoneId.get(String(zoneId)) || emptyVenueTriplet();
}

/**
 * Lightweight ops hints from queue + weather + venue layout (no POS throughput).
 * @param {{
 *   wait: number|null,
 *   weatherContext: Record<string, unknown>,
 *   zoneVenues: { restaurants: number, shops: number, shows: number },
 *   parkVenues: { restaurants: number, shops: number, shows: number },
 *   thresholds: Record<string, unknown>,
 * }} p
 */
function buildCrossAssetHints({ wait, weatherContext, zoneVenues, parkVenues, thresholds }) {
  const wc = weatherContext || {};
  const rainP = n(wc.rainProbabilityPercent, null);
  const precip = n(wc.precipitationMm, null);
  const rainSensitive = wc.rainSensitive === true;
  const queueHighTh = n(thresholds?.waitHighMinutes, 65);

  const rhigh = rainP != null && rainP >= 40;
  const wet = precip != null && precip >= 0.3;

  /** @type {Array<{ code: string, severity: string }>} */
  const out = [];
  const seen = new Set();

  const push = (code, severity = 'INFO') => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, severity });
  };

  const zoneCommerce = (zoneVenues.restaurants || 0) + (zoneVenues.shops || 0);
  const parkCommerce = (parkVenues.restaurants || 0) + (parkVenues.shops || 0);

  if (wait != null && wait >= queueHighTh && zoneCommerce > 0) {
    push('CROSS_QUEUE_NEAR_COMMERCE');
  }
  if ((rhigh || wet) && rainSensitive && (zoneVenues.shows || 0) > 0) {
    push('CROSS_WEATHER_SHOW_DIVERSION');
  }
  if (wait != null && wait >= queueHighTh && zoneCommerce === 0 && parkCommerce > 0) {
    push('CROSS_QUEUE_SPARSE_ZONE_COMMERCE');
  }

  return out;
}

function crossAssetParkSummaryPayload(venueStats) {
  if (!venueStats || !venueStats.parkVenues) return null;
  const pv = venueStats.parkVenues;
  const sum = pv.restaurants + pv.shops + pv.shows;
  if (sum <= 0 && !(venueStats.venuesByZoneId && venueStats.venuesByZoneId.size)) return null;
  return {
    schemaVersion: 1,
    parkVenues: { ...pv },
    zonesWithVenues: venueStats.venuesByZoneId ? venueStats.venuesByZoneId.size : 0,
  };
}

async function latestSnapshotByAsset(parkId, assetIds) {
  if (!assetIds.length) return new Map();
  const rows = await RideFeatureSnapshot.findAll({
    where: {
      internalParkId: parkId,
      internalAssetId: { [Op.in]: assetIds },
    },
    order: [['snapshotAt', 'DESC']],
    limit: Math.min(12000, assetIds.length * 25),
  });
  const m = new Map();
  for (const row of rows) {
    const id = row.internalAssetId ? String(row.internalAssetId) : null;
    if (!id || m.has(id)) continue;
    m.set(id, row.get({ plain: true }));
  }
  return m;
}

async function runChunks(items, size, fn) {
  const res = [];
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size);
    res.push(...(await Promise.all(part.map(fn))));
  }
  return res;
}

function buildRideBoardRow(
  parkId,
  asset,
  snap,
  currentWait,
  incidentsToday,
  ml,
  thresholds,
  parkSlug,
  predictiveMaintenance,
  opsRollup,
  parkFeatureSnapPlain,
  venueStats
) {
  const plain = asset.get ? asset.get({ plain: true }) : asset;
  const rm = plain.rideMaster || {};
  const zone = plain.zone ? { id: plain.zone.id, name: plain.zone.name, slug: plain.zone.slug } : null;
  const wait = currentWait?.waitTime != null ? n(currentWait.waitTime, null) : n(snap?.currentWaitTimeMin ?? snap?.waitTime, null);
  const crewGap = n(snap?.staffingGapNormal, 0);
  const safetyStatus = safetyStatusFromSnapshot(snap || {});
  const theo = estThroughputPph(snap, rm);
  const liveMqtt = liveRideMetricsFromSparkplugBuffer(plain, parkSlug || String(parkId));
  const roll = opsRollup || {};
  const availFromDowntime = roll.availabilityPctToday != null ? n(roll.availabilityPctToday, null) : null;
  const snapshotOeePct = rideOeeFromSnapshot(snap || {}, rm, availFromDowntime);
  const opStatusMqtt = liveMqtt?.operationalStatus || null;
  const opStatusSnap = operationalStatusFromSnapshot(snap || {}, currentWait || {});
  const operationalStatus = opStatusMqtt || opStatusSnap;
  const operationalStatusSource = opStatusMqtt ? 'MQTT_SPARKPLUG' : 'SNAPSHOT';

  const dispatchTarget =
    n(rm.dispatchIntervalSec, null) ?? n(liveMqtt?.dispatchIntervalSecTarget, null) ?? null;
  const dispatchActual = n(liveMqtt?.actualDispatchIntervalSec, null);
  let dispatchEfficiencyPercent = null;
  if (dispatchTarget != null && dispatchActual != null && dispatchTarget > 0 && dispatchActual > 0) {
    dispatchEfficiencyPercent = Math.round(Math.min(150, (dispatchTarget / dispatchActual) * 100) * 10) / 10;
  }

  const availabilityPercentBoard =
    availFromDowntime != null
      ? availFromDowntime
      : snap?.isOpen === true
        ? 92
        : snap?.isOpen === false
          ? 0
          : null;

  const sev = severityForRide(
    {
      wait,
      safetyStatus,
      crewGap,
      isOpen: snap?.isOpen ?? currentWait?.isOpen,
      status: snap?.status ?? currentWait?.status,
    },
    thresholds || {}
  );

  const ai = ruleAiRecommendation({
    wait,
    crewGap,
    forecast60: ml?.forecastWaitTime60,
    predictionMode: ml?.predictionMode,
    thresholds,
  });

  const weatherContext =
    buildWeatherContext(parkFeatureSnapPlain || null, snap || null) || {
      contextAsOf: null,
      snapshotAtPark: null,
      snapshotAtRide: null,
      temperatureC: null,
      precipitationMm: null,
      windSpeedKmh: null,
      weatherCondition: null,
      rainProbabilityPercent: null,
      rainSensitive: null,
      weatherSensitive: null,
      weatherSensitivityScore: null,
      dataLayers: [],
    };

  const zoneIdForVenues = zone?.id || plain.zoneId || null;
  const mapZ = venueStats?.venuesByZoneId || new Map();
  const zoneVenues = zoneVenuesForZone(mapZ, zoneIdForVenues);
  const parkVenues = venueStats?.parkVenues || emptyVenueTriplet();
  const crossHints = buildCrossAssetHints({
    wait,
    weatherContext,
    zoneVenues,
    parkVenues,
    thresholds,
  });

  return {
    rideId: String(plain.assetId),
    rideName: plain.name,
    zone: zone?.name || plain.zoneLabel || null,
    zoneId: zone?.id || plain.zoneId || null,
    swdec: {
      safety: { status: safetyStatus, incidentsToday: incidentsToday || 0 },
      waitingTime: {
        currentWaitTimeMinutes: wait,
        trendMinutes30: n(snap?.waitTimeDelta5m, 0) * 6,
        forecastWaitTime5: ml?.forecastWaitTime5 ?? null,
        forecastWaitTime10: ml?.forecastWaitTime10 ?? null,
        forecastWaitTime15: ml?.forecastWaitTime15 ?? null,
        forecastWaitTime30: ml?.forecastWaitTime30 ?? null,
        forecastWaitTime60: ml?.forecastWaitTime60 ?? null,
        queueOccupancyLive: liveMqtt?.queueOccupancy ?? null,
      },
      delivery: {
        theoreticalCapacityPph: n(snap?.theoreticalCapacityPph ?? rm.theoreticalCapacityPph ?? rm.capacityPph, null),
        actualThroughputPph: theo,
        throughputGapPercent:
          snap?.theoreticalCapacityPph != null && theo != null
            ? Math.round(((theo - n(snap.theoreticalCapacityPph, 1)) / n(snap.theoreticalCapacityPph, 1)) * 100)
            : null,
        activeVehicles: null,
        maxVehicles: rm.trainsCount != null ? n(rm.trainsCount, null) : null,
      },
      efficiency: {
        availabilityPercent: availabilityPercentBoard,
        availabilitySource:
          availFromDowntime != null
            ? roll.availabilitySourceToday === 'PARK_OPERATING_HOURS'
              ? 'DOWNTIME_EVENTS_PARK_HOURS'
              : 'DOWNTIME_EVENTS_UTCDAY'
            : 'SNAPSHOT_HEURISTIC',
        performancePercent: performancePct(snap, rm),
        qualityPercent: 95,
        rideOeePercent: liveMqtt?.rideOeePercent ?? snapshotOeePct,
        rideOeeSource: liveMqtt?.rideOeePercent != null ? 'MQTT_SPARKPLUG' : 'SNAPSHOT_HEURISTIC',
        rideOeeSnapshotFallbackPercent: liveMqtt?.rideOeePercent != null ? snapshotOeePct : null,
      },
      rideOperations: {
        operationalStatus,
        operationalStatusSource,
        assetStateLive: liveMqtt?.assetStateRaw ?? null,
        unplannedDowntimeMinutesToday: roll.unplannedMinToday != null ? Math.round(roll.unplannedMinToday * 10) / 10 : 0,
        plannedDowntimeMinutesToday: roll.plannedMinToday != null ? Math.round(roll.plannedMinToday * 10) / 10 : 0,
        availabilityPercentToday: availFromDowntime,
        availabilitySourceToday: roll.availabilitySourceToday ?? null,
        operatingWindowMinutesToday: roll.operatingWindowMinutesToday ?? null,
        mttrMinutes: roll.mttrMinutes ?? null,
        mtbfHours: roll.mtbfHours ?? null,
        reliabilityLookbackDays: RELIABILITY_LOOKBACK_DAYS,
        dispatchIntervalTargetSec: dispatchTarget,
        dispatchIntervalActualSec: dispatchActual,
        dispatchEfficiencyPercent,
        dispatchSource: dispatchActual != null ? 'MQTT_SPARKPLUG' : null,
      },
      weatherContext,
      crossAssetContext: {
        schemaVersion: 1,
        zoneVenues,
        hints: crossHints,
      },
      costCrew: {
        plannedCrew: rm.normalStaff != null ? n(rm.normalStaff, null) : rm.minStaff != null ? n(rm.minStaff, null) : null,
        actualCrew: null,
        crewGap,
        costPerOperatingHour: null,
      },
    },
    severity: sev,
    aiRecommendation: {
      title: ai.title,
      expectedImpact: ai.expectedImpact,
      confidence: ai.confidence,
    },
    predictionMode: ml?.predictionMode ?? null,
    forecastSource: ml?.forecastSource ?? null,
    mlModelId: ml?.modelId ?? null,
    mlForecastConfidence: ml?.confidence ?? null,
    mlTopFactors: Array.isArray(ml?.topFactors) ? ml.topFactors : [],
    predictiveMaintenance: predictiveMaintenance ?? null,
  };
}

class AddonBoardService {
  constructor() {
    /** @type {Map<string, { at: number, ctx: object, rides: object[], thresholds: object }>} */
    this._ridePayloadCache = new Map();
  }

  async _loadRideContext(parkId) {
    const assets = await listRideAssets(parkId);
    const assetIds = assets.map((a) => String(a.assetId));
    const parkRow = await Park.findByPk(parkId, { attributes: ['slug', 'name', 'id'] });
    const parkSlug = parkRow?.slug || parkRow?.name || String(parkId);
    const [snapByAsset, currentWaits, incidentMap, pdmRulesByAsset, opsRollup, parkFeatureSnap, venueStats] =
      await Promise.all([
        latestSnapshotByAsset(parkId, assetIds),
        timeseriesService.getCurrentRideWaitsForPark({ parkId, hours: 6 }),
        incidentCountsForAssetsToday(parkId, assetIds),
        loadEnabledRulesByAssetIds(parkId, assetIds),
        rideOperationsRollupByAsset(parkId, assetIds),
        latestParkFeatureSnapshot(parkId),
        crossAssetVenueStatsForPark(parkId),
      ]);
    const waitByAsset = new Map(currentWaits.map((w) => [String(w.assetId), w.current]));
    return {
      assets,
      assetIds,
      snapByAsset,
      waitByAsset,
      incidentMap,
      parkSlug,
      pdmRulesByAsset,
      opsRollup,
      parkFeatureSnap,
      venueStats,
    };
  }

  async _buildAllRideRows(parkId, ctx, thresholds) {
    const {
      assets,
      snapByAsset,
      waitByAsset,
      incidentMap,
      parkSlug,
      pdmRulesByAsset,
      opsRollup,
      parkFeatureSnap,
      venueStats,
    } = ctx;
    const parkWx = parkFeatureSnap || null;
    return runChunks(assets, 8, async (a) => {
      const aid = String(a.assetId);
      const snap = snapByAsset.get(aid) || null;
      const cur = waitByAsset.get(aid);
      const inc = incidentMap.get(aid) || 0;
      let ml = null;
      try {
        ml = await getRideBoardMlFields(parkId, aid);
      } catch {
        ml = null;
      }
      const plain = a.get ? a.get({ plain: true }) : a;
      const pdmRules = pdmRulesByAsset?.get(aid) || [];
      const pdmEval = await evaluatePredictiveMaintenanceForAsset(plain, parkSlug, pdmRules);
      if (pdmEval) {
        void maybeAppendPdmEvaluationLog({
          assetId: aid,
          parkId,
          source: 'addon_board',
          evaluation: pdmEval,
        }).catch(() => {});
      }
      const roll = opsRollup?.get(aid) || null;
      return buildRideBoardRow(parkId, a, snap, cur, inc, ml, thresholds, parkSlug, pdmEval, roll, parkWx, venueStats);
    });
  }

  /**
   * One shared snapshot + ride rows for summary / list / critical / zone (short TTL).
   * @param {string} parkId
   */
  async getOrBuildRidePayload(parkId) {
    const key = String(parkId);
    const now = Date.now();
    const hit = this._ridePayloadCache.get(key);
    if (hit && now - hit.at < RIDE_PAYLOAD_CACHE_TTL_MS) {
      return hit;
    }
    const thresholds = await resolveAddonBoardThresholds(parkId);
    const ctx = await this._loadRideContext(parkId);
    const rides = await this._buildAllRideRows(parkId, ctx, thresholds);
    const entry = { at: now, ctx, rides, thresholds };
    this._ridePayloadCache.set(key, entry);
    return entry;
  }

  async listZonesWithRideCounts(parkId) {
    const rideType = await AssetType.findOne({ where: { code: 'RIDE' } });
    if (!rideType) return [];
    const zones = await ParkZone.findAll({
      where: { parkId },
      order: [['name', 'ASC']],
      attributes: ['id', 'name', 'slug'],
    });
    const countRows = await ParkAsset.findAll({
      attributes: ['zoneId', [fn('COUNT', col('asset_id')), 'rideCount']],
      where: { parkId, assetTypeId: rideType.id, activeFlag: true },
      group: ['zoneId'],
      raw: true,
    });
    /** @type {Map<string, number>} */
    const byZone = new Map();
    for (const row of countRows) {
      const zid = row.zoneId != null ? String(row.zoneId) : '_null';
      byZone.set(zid, Number(row.rideCount) || 0);
    }
    return zones.map((z) => ({
      zoneId: String(z.id),
      zoneName: z.name,
      zoneSlug: z.slug,
      rideCount: byZone.get(String(z.id)) || 0,
    }));
  }

  async getHeatmapLive(parkId) {
    const { GeoPressureEngineService } = require('./geo-pressure-engine.service');
    const engine = new GeoPressureEngineService();
    const data = await engine.buildPressurePayload(parkId, { mode: 'live', assetTypeCode: 'RIDE' });
    if (data && data.error) {
      return {
        parkId: String(parkId),
        generatedAt: new Date().toISOString(),
        error: data.error,
        park: null,
        hotspots: [],
        cells: [],
        insights: [],
      };
    }
    return {
      parkId: String(parkId),
      generatedAt: data.generatedAt,
      park: data.park ?? null,
      hotspots: data.hotspots || [],
      cells: data.cells || [],
      insights: data.insights || [],
    };
  }

  async getParkSummary(parkId) {
    const { ctx, rides, thresholds } = await this.getOrBuildRidePayload(parkId);
    const fcMin = n(thresholds.forecastCriticalAtMinutes, 55);

    let openRides = 0;
    let totalWait = 0;
    let waitN = 0;
    let criticalRides = 0;
    let throughputSum = 0;
    const forecast60Open = [];
    let forecastCriticalRides60 = 0;

    for (const row of rides) {
      const cur = ctx.waitByAsset.get(String(row.rideId));
      const isOpen = cur?.isOpen !== false;
      if (isOpen) openRides += 1;
      const w = row.swdec.waitingTime.currentWaitTimeMinutes;
      if (w != null && isOpen) {
        totalWait += w;
        waitN += 1;
      }
      if (['HIGH', 'CRITICAL'].includes(row.severity)) criticalRides += 1;
      const tp = row.swdec.delivery.actualThroughputPph;
      if (tp != null && isOpen) throughputSum += tp;
      const f60 = row.swdec.waitingTime.forecastWaitTime60;
      if (f60 != null && isOpen) {
        forecast60Open.push(Number(f60));
        if (Number(f60) >= fcMin) forecastCriticalRides60 += 1;
      }
    }

    const totalRides = rides.length;
    const averageWaitTimeMinutes = waitN ? Math.round(totalWait / waitN) : null;
    const avgWaitScore = averageWaitTimeMinutes == null ? 85 : Math.max(0, 100 - (averageWaitTimeMinutes / 90) * 100);
    const safetyScore = criticalRides > 8 ? 55 : criticalRides > 3 ? 72 : 88;
    const throughputScore = openRides ? Math.min(100, 55 + (throughputSum / Math.max(1, openRides * 800)) * 20) : 70;
    const parkHealthScore = Math.round(
      safetyScore * 0.28 + avgWaitScore * 0.28 + throughputScore * 0.22 + 72 * 0.12 + 75 * 0.1
    );
    const status =
      parkHealthScore >= 78 ? 'GREEN' : parkHealthScore >= 62 ? 'YELLOW' : 'RED';

    const avgForecast60 = meaningfulAverageForecast60(forecast60Open);
    const forecastDemandIndex = parkDemandIndexFromAvg60(avgForecast60);

    const weatherContext = parkWeatherBannerFromSnapshot(ctx.parkFeatureSnap || null);
    const crossAssetContext = crossAssetParkSummaryPayload(ctx.venueStats);

    return {
      parkId,
      timestamp: new Date().toISOString(),
      parkHealthScore,
      status,
      openRides,
      totalRides,
      averageWaitTimeMinutes,
      criticalRides,
      forecastCriticalRides60,
      forecastCriticalAtMinutes: fcMin,
      averageForecastWaitTime60: avgForecast60,
      actualThroughputPph: throughputSum || null,
      forecastDemandIndex,
      mlDataHint:
        forecastDemandIndex === 'UNKNOWN'
          ? 'NO_FORECAST_SIGNAL_CHECK_AI_PIPELINE_AND_SNAPSHOTS'
          : null,
      weatherContext,
      crossAssetContext,
    };
  }

  async getParkRides(parkId) {
    const { ctx, rides } = await this.getOrBuildRidePayload(parkId);
    return {
      parkId,
      timestamp: new Date().toISOString(),
      weatherContext: parkWeatherBannerFromSnapshot(ctx.parkFeatureSnap || null),
      crossAssetContext: crossAssetParkSummaryPayload(ctx.venueStats),
      rides,
    };
  }

  async getCriticalRides(parkId, { limit = 25 } = {}) {
    const { ctx, rides } = await this.getOrBuildRidePayload(parkId);
    const crit = rides
      .filter((r) => ['HIGH', 'CRITICAL', 'MEDIUM'].includes(r.severity))
      .sort((a, b) => {
        const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        const dr = (rank[b.severity] || 0) - (rank[a.severity] || 0);
        if (dr !== 0) return dr;
        const wa = n(a.swdec.waitingTime.currentWaitTimeMinutes, 0);
        const wb = n(b.swdec.waitingTime.currentWaitTimeMinutes, 0);
        return wb - wa;
      })
      .slice(0, limit);
    return {
      parkId,
      timestamp: new Date().toISOString(),
      weatherContext: parkWeatherBannerFromSnapshot(ctx.parkFeatureSnap || null),
      crossAssetContext: crossAssetParkSummaryPayload(ctx.venueStats),
      rides: crit,
    };
  }

  async getZoneSummary(parkId, zoneId) {
    const { ctx, rides, thresholds } = await this.getOrBuildRidePayload(parkId);
    const fcMin = n(thresholds.forecastCriticalAtMinutes, 55);
    const inZone = rides.filter((r) => r.zoneId && String(r.zoneId) === String(zoneId));
    const zone = await ParkZone.findOne({ where: { id: zoneId, parkId }, attributes: ['id', 'name', 'slug'] });
    if (!zone) {
      return { error: 'ZONE_NOT_FOUND', zoneId };
    }
    const withWait = inZone.filter((r) => {
      const cur = ctx.waitByAsset.get(String(r.rideId));
      return cur?.isOpen !== false && r.swdec.waitingTime.currentWaitTimeMinutes != null;
    });
    const avgWait = withWait.length
      ? Math.round(
          withWait.reduce((s, r) => s + n(r.swdec.waitingTime.currentWaitTimeMinutes, 0), 0) / withWait.length
        )
      : null;
    const fcOpen = inZone
      .filter((r) => {
        const cur = ctx.waitByAsset.get(String(r.rideId));
        return cur?.isOpen !== false && r.swdec.waitingTime.forecastWaitTime60 != null;
      })
      .map((r) => n(r.swdec.waitingTime.forecastWaitTime60, null))
      .filter((x) => x != null);
    const zoneForecastWaitTime60 = meaningfulAverageForecast60(fcOpen);
    const zoneForecastCriticalRides = inZone.filter((r) => {
      const cur = ctx.waitByAsset.get(String(r.rideId));
      const open = cur?.isOpen !== false;
      const f60 = n(r.swdec.waitingTime.forecastWaitTime60, null);
      return open && f60 != null && f60 >= fcMin;
    }).length;
    const health = avgWait == null ? 80 : Math.max(35, 100 - (avgWait / 85) * 100);
    const zVenues = zoneVenuesForZone(ctx.venueStats?.venuesByZoneId || new Map(), zoneId);
    const parkCross = crossAssetParkSummaryPayload(ctx.venueStats);
    const crossAssetContext =
      parkCross || zVenues.restaurants + zVenues.shops + zVenues.shows > 0
        ? {
            schemaVersion: 1,
            parkVenues: ctx.venueStats?.parkVenues || emptyVenueTriplet(),
            zoneVenues: zVenues,
            zonesWithVenues: ctx.venueStats?.venuesByZoneId?.size ?? 0,
          }
        : null;
    return {
      parkId,
      zoneId: String(zone.id),
      zoneName: zone.name,
      timestamp: new Date().toISOString(),
      zoneHealthScore: Math.round(health),
      zoneAverageWaitTimeMinutes: avgWait,
      zoneForecastWaitTime60,
      zoneForecastCriticalRides,
      forecastCriticalAtMinutes: fcMin,
      zoneDemandForecastIndex: parkDemandIndexFromAvg60(zoneForecastWaitTime60),
      ridesInZone: inZone.length,
      weatherContext: parkWeatherBannerFromSnapshot(ctx.parkFeatureSnap || null),
      crossAssetContext,
    };
  }

  async getRideDetail(parkId, rideId) {
    const asset = await ParkAsset.findOne({
      where: { parkId, assetId: rideId },
      include: [
        { model: ParkZone, as: 'zone', required: false },
        { model: RideMasterData, as: 'rideMaster', required: false },
      ],
    });
    if (!asset) return null;
    const park = await Park.findByPk(parkId, { attributes: ['id', 'name', 'slug'] });
    const parkSlug = park?.slug || park?.name || String(parkId);
    const snapMap = await latestSnapshotByAsset(parkId, [String(rideId)]);
    const snap = snapMap.get(String(rideId)) || null;
    const waits = await timeseriesService.getCurrentRideWaitsForPark({ parkId, hours: 6 });
    const cur = waits.find((w) => String(w.assetId) === String(rideId))?.current ?? null;
    const incMap = await incidentCountsForAssetsToday(parkId, [String(rideId)]);
    const inc = incMap.get(String(rideId)) || 0;
    let ml = null;
    try {
      ml = await getRideBoardMlFields(parkId, String(rideId));
    } catch {
      ml = null;
    }
    const thresholds = await resolveAddonBoardThresholds(parkId);
    const pdmMap = await loadEnabledRulesByAssetIds(parkId, [String(rideId)]);
    const pdmRules = pdmMap.get(String(rideId)) || [];
    const pdmEval = await evaluatePredictiveMaintenanceForAsset(asset.get({ plain: true }), parkSlug, pdmRules);
    if (pdmEval) {
      void maybeAppendPdmEvaluationLog({
        assetId: String(rideId),
        parkId,
        source: 'addon_board',
        evaluation: pdmEval,
      }).catch(() => {});
    }
    const opsMap = await rideOperationsRollupByAsset(parkId, [String(rideId)]);
    const roll = opsMap.get(String(rideId)) || null;
    const parkWx = await latestParkFeatureSnapshot(parkId);
    const venueStats = await crossAssetVenueStatsForPark(parkId);
    const row = buildRideBoardRow(parkId, asset, snap, cur, inc, ml, thresholds, parkSlug, pdmEval, roll, parkWx, venueStats);
    return {
      park: park ? { id: park.id, name: park.name, slug: park.slug } : null,
      ...row,
      snapshotAt: snap?.snapshotAt || null,
      crossAssetContext: crossAssetParkSummaryPayload(venueStats),
    };
  }
}

module.exports = { AddonBoardService };
