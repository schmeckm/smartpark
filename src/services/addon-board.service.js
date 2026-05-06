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
  RideMasterData,
  Incident,
} = require('../models');
const { TimeseriesService } = require('./timeseries.service');
const {
  getRideBoardMlFields,
  parkDemandIndexFromAvg60,
  meaningfulAverageForecast60,
} = require('./ml/addon-board-ml-bridge.service');
const { resolveAddonBoardThresholds } = require('./addon-board-config.service');

const RIDE_PAYLOAD_CACHE_TTL_MS = Number(process.env.ADDON_BOARD_CACHE_MS || 5000);

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

function rideOeeFromSnapshot(snap, master) {
  const avail = snap?.isOpen === false ? 40 : snap?.isOpen === true ? 92 : 75;
  const perf = performancePct(snap, master) ?? 70;
  const qual = 95;
  return Math.round((avail * perf * qual) / 10000);
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

function buildRideBoardRow(parkId, asset, snap, currentWait, incidentsToday, ml, thresholds) {
  const plain = asset.get ? asset.get({ plain: true }) : asset;
  const rm = plain.rideMaster || {};
  const zone = plain.zone ? { id: plain.zone.id, name: plain.zone.name, slug: plain.zone.slug } : null;
  const wait = currentWait?.waitTime != null ? n(currentWait.waitTime, null) : n(snap?.currentWaitTimeMin ?? snap?.waitTime, null);
  const crewGap = n(snap?.staffingGapNormal, 0);
  const safetyStatus = safetyStatusFromSnapshot(snap || {});
  const theo = estThroughputPph(snap, rm);
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
        forecastWaitTime15: ml?.forecastWaitTime15 ?? null,
        forecastWaitTime30: ml?.forecastWaitTime30 ?? null,
        forecastWaitTime60: ml?.forecastWaitTime60 ?? null,
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
        availabilityPercent: snap?.isOpen === true ? 92 : snap?.isOpen === false ? 0 : null,
        performancePercent: performancePct(snap, rm),
        qualityPercent: 95,
        rideOeePercent: rideOeeFromSnapshot(snap || {}, rm),
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
    const [snapByAsset, currentWaits, incidentMap] = await Promise.all([
      latestSnapshotByAsset(parkId, assetIds),
      timeseriesService.getCurrentRideWaitsForPark({ parkId, hours: 6 }),
      incidentCountsForAssetsToday(parkId, assetIds),
    ]);
    const waitByAsset = new Map(currentWaits.map((w) => [String(w.assetId), w.current]));
    return { assets, assetIds, snapByAsset, waitByAsset, incidentMap };
  }

  async _buildAllRideRows(parkId, ctx, thresholds) {
    const { assets, snapByAsset, waitByAsset, incidentMap } = ctx;
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
      return buildRideBoardRow(parkId, a, snap, cur, inc, ml, thresholds);
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
    };
  }

  async getParkRides(parkId) {
    const { rides } = await this.getOrBuildRidePayload(parkId);
    return {
      parkId,
      timestamp: new Date().toISOString(),
      rides,
    };
  }

  async getCriticalRides(parkId, { limit = 25 } = {}) {
    const { rides } = await this.getOrBuildRidePayload(parkId);
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
    return { parkId, timestamp: new Date().toISOString(), rides: crit };
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
    const row = buildRideBoardRow(parkId, asset, snap, cur, inc, ml, thresholds);
    const park = await Park.findByPk(parkId, { attributes: ['id', 'name', 'slug'] });
    return {
      park: park ? { id: park.id, name: park.name, slug: park.slug } : null,
      ...row,
      snapshotAt: snap?.snapshotAt || null,
    };
  }
}

module.exports = { AddonBoardService };
