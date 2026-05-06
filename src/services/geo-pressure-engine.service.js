'use strict';

const { Op } = require('sequelize');
const { AssetsRepository } = require('../modules/assets/assets.repository');
const { MasterDataService } = require('../modules/master-data/master-data.service');
const { AiParkForecastService } = require('./ai-park-forecast.service');
const {
  theoreticalQueuePeople,
  ridePressureScore,
  venuePressureScore,
  statusFromScore,
  distanceMeters,
  kernelWeight,
  stressFactor,
} = require('./geo-pressure-scoring');

const DEFAULT_FORECAST_PROVIDER = 'themeparks_wiki';
const MAX_FORECAST_ENTITY_CALLS = 28;
const MAX_GRID_CELLS = 360;
const MIN_GRID_STEP_DEG = 0.00018;

/** Same shape as `park-context.middleware` — avoid `findByPk(slug)` on UUID PK (Postgres 22P02). */
const PARK_PK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function models() {
  return require('../models');
}

function repo() {
  return new AssetsRepository(models());
}

/**
 * @param {string} parkKey
 */
async function resolveParkRow(parkKey) {
  const { Park } = models();
  const key = String(parkKey || '').trim();
  if (!key) return null;
  if (PARK_PK_UUID_RE.test(key)) {
    const byId = await Park.findByPk(key);
    if (byId) return byId;
  }
  const bySlug = await Park.findOne({ where: { slug: key } });
  if (bySlug) return bySlug;
  return Park.findOne({ where: { externalEntityId: key } });
}

function assetTypeCode(asset) {
  const c = asset.assetType?.code ?? asset.assetType?.dataValues?.code;
  return c != null ? String(c).toUpperCase() : '';
}

function effectiveRideCapacityPph(asset) {
  const rm = asset.rideMaster;
  if (!rm) return 600;
  const j = rm.toJSON ? rm.toJSON() : rm;
  const cap = MasterDataService.computeRideCapacity(j);
  const v = cap?.effectiveCapacityPerHour ?? cap?.theoreticalCapacityPerHour ?? cap?.capacityPerHourDerived;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

function influenceRadiusMeters(asset) {
  const code = assetTypeCode(asset);
  const rm = asset.rideMaster;
  const rmJson = rm ? (rm.toJSON ? rm.toJSON() : rm) : {};
  const cat = String(rmJson.rideCategory || '').toUpperCase();
  if (code === 'RIDE') {
    if (/(COASTER|THRILL|MAJOR|GIGA|HYPER|MEGA)/.test(cat)) return 150;
    return 80;
  }
  if (code === 'RESTAURANT') return 60;
  if (code === 'SHOP') return 55;
  if (code === 'SHOW') return 100;
  if (code === 'ENTRANCE') return 200;
  if (code === 'TOILET' || code === 'FACILITY') return 40;
  if (code === 'PARKING' || code === 'SERVICE_POINT') return 90;
  return 70;
}

/**
 * @param {string[]} assetIds
 * @param {string[]} metricCodes
 */
async function latestObservationsByAsset(assetIds, metricCodes) {
  if (!assetIds.length) return new Map();
  const { AssetObservation } = models();
  const rows = await AssetObservation.findAll({
    where: { assetId: { [Op.in]: assetIds }, metricCode: { [Op.in]: metricCodes } },
    attributes: ['assetId', 'metricCode', 'metricValue', 'timestamp'],
    order: [['timestamp', 'DESC']],
    limit: Math.min(assetIds.length * metricCodes.length * 8, 12000),
  });
  const map = new Map();
  for (const row of rows) {
    const id = String(row.assetId);
    const mc = String(row.metricCode);
    const k = `${id}::${mc}`;
    if (!map.has(k)) map.set(k, row);
  }
  return map;
}

async function openDowntimeAssetIds(parkId) {
  const { AssetDowntimeEvent } = models();
  const rows = await AssetDowntimeEvent.findAll({
    where: { parkId, endedAt: null },
    attributes: ['assetId'],
  });
  return new Set(rows.map((r) => String(r.assetId)));
}

function scoreEntity(asset, ctx) {
  const code = assetTypeCode(asset);
  const id = String(asset.assetId);
  const obs = ctx.obsMap;
  const q = obs.get(`${id}::QUEUE_TIME_MIN`);
  const waitMin = q && q.metricValue != null ? Number(q.metricValue) : null;
  const downtimeActive = ctx.downtimeSet.has(id);
  const targetWait = asset.assetTarget?.targetWaitTimeMin != null ? Number(asset.assetTarget.targetWaitTimeMin) : null;
  const rm = asset.rideMaster;
  const rmJson = rm ? (rm.toJSON ? rm.toJSON() : rm) : {};

  let pressureScore = 0;
  let theoreticalQueue = null;
  let stress = null;
  const waitUsed = waitMin != null && Number.isFinite(waitMin) ? waitMin : downtimeActive ? 45 : 0;

  if (code === 'RIDE') {
    const cap = effectiveRideCapacityPph(asset);
    theoreticalQueue = theoreticalQueuePeople(waitUsed, cap);
    stress = stressFactor(waitUsed, targetWait, cap);
    const fWait = ctx.forecastWaitByAssetId?.get(id);
    pressureScore = ridePressureScore({
      waitMin: waitUsed,
      forecastWaitMin: fWait != null ? fWait : null,
      capacityPerHour: cap,
      targetWaitMin: targetWait,
      downtimeActive,
    });
  } else if (code === 'RESTAURANT' || code === 'SHOP') {
    theoreticalQueue = null;
    stress = waitUsed > 0 ? waitUsed / 20 : 0;
    pressureScore = venuePressureScore({ waitMin: waitUsed, downtimeActive });
  } else {
    pressureScore = venuePressureScore({ waitMin: waitUsed, downtimeActive });
    stress = waitUsed > 0 ? waitUsed / 25 : 0;
  }

  return {
    assetId: id,
    entityType: code || 'UNKNOWN',
    slug: asset.slug,
    name: asset.name,
    lat: asset.latitude != null ? Number(asset.latitude) : null,
    lng: asset.longitude != null ? Number(asset.longitude) : null,
    zoneSlug: asset.zone?.slug ?? null,
    waitMinutes: waitMin != null && Number.isFinite(waitMin) ? waitMin : null,
    pressureScore,
    status: statusFromScore(pressureScore),
    theoreticalQueuePeople: theoreticalQueue != null ? Math.round(theoreticalQueue) : null,
    stressFactor: stress != null && Number.isFinite(stress) ? Math.round(stress * 100) / 100 : null,
    influenceRadiusM: influenceRadiusMeters(asset),
    downtimeActive,
    capacityPerHour: code === 'RIDE' ? effectiveRideCapacityPph(asset) : null,
    cycleTimeSec:
      code === 'RIDE' && rmJson.cycleTimeSec != null && Number.isFinite(Number(rmJson.cycleTimeSec))
        ? Number(rmJson.cycleTimeSec)
        : null,
    dispatchIntervalSec:
      code === 'RIDE' && rmJson.dispatchIntervalSec != null && Number.isFinite(Number(rmJson.dispatchIntervalSec))
        ? Number(rmJson.dispatchIntervalSec)
        : null,
  };
}

function buildGridBBox(entitiesWithCoords, padDeg = 0.0012) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const e of entitiesWithCoords) {
    minLat = Math.min(minLat, e.lat);
    maxLat = Math.max(maxLat, e.lat);
    minLng = Math.min(minLng, e.lng);
    maxLng = Math.max(maxLng, e.lng);
  }
  return {
    minLat: minLat - padDeg,
    maxLat: maxLat + padDeg,
    minLng: minLng - padDeg,
    maxLng: maxLng + padDeg,
  };
}

function generateGridCells(bbox, stepDeg) {
  const cells = [];
  for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += stepDeg) {
    for (let lng = bbox.minLng; lng <= bbox.maxLng; lng += stepDeg) {
      cells.push({ lat: lat + stepDeg / 2, lng: lng + stepDeg / 2 });
    }
  }
  return cells;
}

function aggregateCells(entities, cellCenters) {
  const out = [];
  for (const cell of cellCenters) {
    let acc = 0;
    const contributors = [];
    for (const e of entities) {
      if (e.lat == null || e.lng == null || !Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
      const d = distanceMeters(cell.lat, cell.lng, e.lat, e.lng);
      const w = kernelWeight(d, e.influenceRadiusM);
      if (w <= 0.001) continue;
      const contrib = e.pressureScore * w;
      acc += contrib;
      contributors.push({ assetId: e.assetId, slug: e.slug, name: e.name, contribution: Math.round(contrib * 10) / 10 });
    }
    contributors.sort((a, b) => b.contribution - a.contribution);
    const pressure = Math.round(Math.min(100, acc));
    out.push({
      lat: Math.round(cell.lat * 1e6) / 1e6,
      lng: Math.round(cell.lng * 1e6) / 1e6,
      pressureScore: pressure,
      status: statusFromScore(pressure),
      topContributors: contributors.slice(0, 5),
    });
  }
  return out;
}

function buildInsights(entities, topN = 6) {
  const sorted = [...entities].sort((a, b) => b.pressureScore - a.pressureScore);
  const lines = [];
  for (const e of sorted.slice(0, topN)) {
    if (e.pressureScore < 18) continue;
    const wait = e.waitMinutes != null ? `${e.waitMinutes} min wait` : e.downtimeActive ? 'downtime' : 'elevated load';
    lines.push(`${e.name}: ${wait} · score ${e.pressureScore} (${e.status}).`);
  }
  if (!lines.length) lines.push('No elevated pressure signals in the current window.');
  return lines;
}

class GeoPressureEngineService {
  constructor() {
    this.forecastSvc = new AiParkForecastService();
  }

  async loadParkAssets(parkId, { assetTypeCode } = {}) {
    return repo().listAssets({ parkId, assetTypeCode, limit: 2000, offset: 0 });
  }

  /**
   * @param {string} parkKey slug | uuid | external id
   * @param {{ assetTypeCode?: string, mode?: 'live'|'forecast', forecastProvider?: string }} opts
   */
  async buildPressurePayload(parkKey, opts = {}) {
    const park = await resolveParkRow(parkKey);
    if (!park) return { error: 'PARK_NOT_FOUND' };

    const parkId = park.id;
    const parkPlain = park.toJSON ? park.toJSON() : park;
    const externalParkId =
      parkPlain.externalEntityId != null && String(parkPlain.externalEntityId).trim() !== ''
        ? String(parkPlain.externalEntityId).trim()
        : String(parkPlain.slug || '').trim() || null;

    const mode = opts.mode === 'forecast' ? 'forecast' : 'live';
    const provider = opts.forecastProvider || DEFAULT_FORECAST_PROVIDER;

    const assets = await this.loadParkAssets(parkId, { assetTypeCode: opts.assetTypeCode });
    const assetIds = assets.map((a) => String(a.assetId));
    const obsMap = await latestObservationsByAsset(assetIds, ['QUEUE_TIME_MIN', 'STATUS']);
    const downtimeSet = await openDowntimeAssetIds(parkId);

    /** @type {Map<string, number>} */
    const forecastWaitByAssetId = new Map();
    if (mode === 'forecast' && externalParkId) {
      const rideAssets = assets.filter((a) => assetTypeCode(a) === 'RIDE' && a.externalEntityId);
      const scoredPreview = rideAssets
        .map((a) => {
          const q = obsMap.get(`${String(a.assetId)}::QUEUE_TIME_MIN`);
          const w = q && q.metricValue != null ? Number(q.metricValue) : 0;
          return { a, w: Number.isFinite(w) ? w : 0 };
        })
        .sort((x, y) => y.w - x.w)
        .slice(0, MAX_FORECAST_ENTITY_CALLS);

      for (const { a } of scoredPreview) {
        const ext = String(a.externalEntityId || '').trim();
        if (!ext) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const summary = await this.forecastSvc.getEntitySummary(ext, {
            provider,
            externalParkId,
            entityType: 'RIDE',
          });
          const f15 = summary?.forecast15Minutes;
          if (f15 != null && Number.isFinite(Number(f15))) {
            forecastWaitByAssetId.set(String(a.assetId), Number(f15));
          }
        } catch {
          /* ignore per-entity forecast failures */
        }
      }
    }

    const ctx = { obsMap, downtimeSet, forecastWaitByAssetId };
    const entities = assets.map((a) => scoreEntity(a, ctx));
    const withCoords = entities.filter((e) => e.lat != null && e.lng != null && Number.isFinite(e.lat) && Number.isFinite(e.lng));

    let cells = [];
    if (withCoords.length) {
      const bbox = buildGridBBox(withCoords);
      const spanLat = bbox.maxLat - bbox.minLat;
      const spanLng = bbox.maxLng - bbox.minLng;
      let step = MIN_GRID_STEP_DEG;
      let grid = generateGridCells(bbox, step);
      while (grid.length > MAX_GRID_CELLS && step < 0.02) {
        step *= 1.35;
        grid = generateGridCells(bbox, step);
      }
      cells = aggregateCells(withCoords, grid);
    }

    const hotspots = [...withCoords]
      .sort((a, b) => b.pressureScore - a.pressureScore)
      .slice(0, 15)
      .map((e) => ({
        assetId: e.assetId,
        slug: e.slug,
        name: e.name,
        entityType: e.entityType,
        lat: e.lat,
        lng: e.lng,
        pressureScore: e.pressureScore,
        status: e.status,
        waitMinutes: e.waitMinutes,
      }));

    return {
      park: {
        id: parkId,
        slug: parkPlain.slug,
        name: parkPlain.name,
        latitude: parkPlain.latitude ?? null,
        longitude: parkPlain.longitude ?? null,
        externalEntityId: externalParkId,
      },
      generatedAt: new Date().toISOString(),
      mode,
      forecastProvider: mode === 'forecast' ? provider : null,
      entities,
      cells,
      hotspots,
      insights: buildInsights(withCoords.length ? withCoords : entities),
      meta: {
        entityCount: entities.length,
        withCoords: withCoords.length,
        cellCount: cells.length,
        dataCompleteness: {
          ridesWithWaitObservation: entities.filter((e) => e.entityType === 'RIDE' && e.waitMinutes != null).length,
          openDowntimeAssets: downtimeSet.size,
        },
      },
    };
  }

  /**
   * @param {string} parkKey
   * @param {Record<string, { waitMin?: number; downtime?: boolean }>} overridesByAssetId
   */
  async buildSimulatedPayload(parkKey, overridesByAssetId = {}) {
    const base = await this.buildPressurePayload(parkKey, { mode: 'live' });
    if (base.error) return base;
    const ov = overridesByAssetId && typeof overridesByAssetId === 'object' ? overridesByAssetId : {};
    const patched = base.entities.map((e) => {
      const o = ov[e.assetId] || ov[e.slug];
      if (!o) return e;
      let waitMinutes = e.waitMinutes;
      if (o.waitMin != null && Number.isFinite(Number(o.waitMin))) waitMinutes = Number(o.waitMin);
      let downtimeActive = e.downtimeActive;
      if (o.downtime === true) downtimeActive = true;
      if (o.downtime === false) downtimeActive = false;
      const waitUsed = waitMinutes != null && Number.isFinite(waitMinutes) ? waitMinutes : downtimeActive ? 45 : 0;
      let pressureScore = e.pressureScore;
      if (e.entityType === 'RIDE' && e.capacityPerHour) {
        const cap = e.capacityPerHour;
        const fWait = null;
        pressureScore = ridePressureScore({
          waitMin: waitUsed,
          forecastWaitMin: fWait,
          capacityPerHour: cap,
          targetWaitMin: null,
          downtimeActive,
        });
      } else {
        pressureScore = venuePressureScore({ waitMin: waitUsed, downtimeActive });
      }
      return {
        ...e,
        waitMinutes,
        downtimeActive,
        pressureScore,
        status: statusFromScore(pressureScore),
        theoreticalQueuePeople:
          e.entityType === 'RIDE' && e.capacityPerHour
            ? Math.round(theoreticalQueuePeople(waitUsed, e.capacityPerHour))
            : e.theoreticalQueuePeople,
      };
    });
    const withCoords = patched.filter((e) => e.lat != null && e.lng != null && Number.isFinite(e.lat) && Number.isFinite(e.lng));
    let cells = [];
    if (withCoords.length) {
      const bbox = buildGridBBox(withCoords);
      let step = MIN_GRID_STEP_DEG;
      let grid = generateGridCells(bbox, step);
      while (grid.length > MAX_GRID_CELLS && step < 0.02) {
        step *= 1.35;
        grid = generateGridCells(bbox, step);
      }
      cells = aggregateCells(withCoords, grid);
    }
    return {
      ...base,
      mode: 'simulation',
      entities: patched,
      cells,
      hotspots: [...withCoords]
        .sort((a, b) => b.pressureScore - a.pressureScore)
        .slice(0, 15)
        .map((e) => ({
          assetId: e.assetId,
          slug: e.slug,
          name: e.name,
          entityType: e.entityType,
          lat: e.lat,
          lng: e.lng,
          pressureScore: e.pressureScore,
          status: e.status,
          waitMinutes: e.waitMinutes,
        })),
      insights: buildInsights(withCoords.length ? withCoords : patched),
    };
  }

  async getGeoEntities(parkKey, { assetTypeCode } = {}) {
    const p = await this.buildPressurePayload(parkKey, { mode: 'live', assetTypeCode });
    if (p.error) return p;
    return {
      park: p.park,
      generatedAt: p.generatedAt,
      entities: p.entities.map((e) => ({
        assetId: e.assetId,
        entityType: e.entityType,
        entitySlug: e.slug,
        entityName: e.name,
        lat: e.lat,
        lng: e.lng,
        zoneSlug: e.zoneSlug,
        active: true,
        capacityPerHour: e.capacityPerHour,
        cycleTimeSec: e.cycleTimeSec,
        dispatchIntervalSec: e.dispatchIntervalSec,
      })),
    };
  }
}

module.exports = {
  GeoPressureEngineService,
  resolveParkRow,
  _testing: {
    aggregateCells,
    generateGridCells,
    buildGridBBox,
    scoreEntity,
    influenceRadiusMeters,
  },
};
