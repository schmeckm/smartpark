/**
 * Aggregated feature-store + forecast quality for the active park (X-layer inputs).
 * Reuses MlInfluenceAdminService monitor KPIs and AiParkForecastService entity summaries.
 */
const { Op } = require('sequelize');
const { Park, ParkAsset, ParkFeatureSnapshot, RideFeatureSnapshot, sequelize } = require('../models');
const { AppError } = require('../utils/app-error');
const { MlInfluenceAdminService } = require('./ml-influence-admin.service');
const { AiParkForecastService } = require('./ai-park-forecast.service');

const mlAdmin = new MlInfluenceAdminService();
const parkForecast = new AiParkForecastService();

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function parkSnapWhere(parkId, extPark) {
  return extPark
    ? { [Op.or]: [{ internalParkId: parkId }, { externalParkId: extPark, provider: 'themeparks_wiki' }] }
    : { internalParkId: parkId };
}

function parseRange(q) {
  const to = q.to ? new Date(String(q.to)) : new Date();
  const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
    const t = new Date();
    return { from: new Date(t.getTime() - 24 * 60 * 60 * 1000), to: t };
  }
  if (from.getTime() >= to.getTime()) {
    const t = new Date();
    return { from: new Date(t.getTime() - 24 * 60 * 60 * 1000), to: t };
  }
  const maxMs = 35 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    return { from: new Date(to.getTime() - maxMs), to };
  }
  return { from, to };
}

/** Strict range for admin purge (must not exceed 35 days). */
function parsePurgeRange(fromStr, toStr) {
  const to = new Date(String(toStr));
  const from = new Date(String(fromStr));
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
    throw new AppError('Invalid from/to dates', 400, { code: 'INVALID_RANGE' });
  }
  if (from.getTime() >= to.getTime()) {
    throw new AppError('from must be before to', 400, { code: 'INVALID_RANGE' });
  }
  const maxMs = 35 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    throw new AppError('Range must not exceed 35 days', 400, { code: 'RANGE_TOO_LARGE' });
  }
  return { from, to };
}

function parkWeatherMissing(p) {
  return p.temperatureC == null && p.precipitationMm == null;
}

function parkCalendarMissing(p) {
  return p.isPublicHoliday == null && p.isSchoolHoliday == null && !p.holidayName;
}

function parkTrafficMissing(p) {
  return p.trafficIndex == null;
}

function rideWeatherMissing(r) {
  return r.temperatureC == null && r.precipitationMm == null;
}

function rideCalendarMissing(r) {
  return r.isPublicHoliday == null && r.isSchoolHoliday == null;
}

function rideTrafficMissing(r) {
  return r.trafficIndex == null;
}

function rideStaffingMissing(r) {
  return r.internalAssetId && r.staffingGapNormal == null;
}

function hintsForParkRow(p) {
  const hints = [];
  if (parkWeatherMissing(p)) hints.push('Weather features missing');
  if (parkCalendarMissing(p)) hints.push('Calendar context missing');
  if (parkTrafficMissing(p)) hints.push('Traffic index missing');
  const comp = n(p.completenessScore);
  if (comp != null && comp < 0.45) hints.push('Low snapshot completeness (park)');
  return hints;
}

function hintsForRideRow(r) {
  const hints = [];
  if (rideWeatherMissing(r)) hints.push('Weather features missing');
  if (rideCalendarMissing(r)) hints.push('Calendar context missing');
  if (rideTrafficMissing(r)) hints.push('Traffic index missing');
  if (rideStaffingMissing(r)) hints.push('Staffing data incomplete');
  const comp = n(r.completenessScore);
  if (comp != null && comp < 0.45) hints.push('Low snapshot completeness (ride)');
  return hints;
}

/** Serialized park/ride row shapes from serializeParkRow / serializeRideRow. */
function matchesMissingFeature(mf, isPark, row) {
  if (!mf) return true;
  if (mf === 'weather') {
    return (row.temperatureC == null || row.temperatureC === undefined) && (row.precipitationMm == null || row.precipitationMm === undefined);
  }
  if (mf === 'calendar') {
    if (isPark) return row.isPublicHoliday == null && row.isSchoolHoliday == null && !row.holidayName;
    return row.isPublicHoliday == null && row.isSchoolHoliday == null;
  }
  if (mf === 'traffic') return row.trafficIndex == null || row.trafficIndex === undefined;
  if (mf === 'staffing') {
    if (isPark) return false;
    return Boolean(row.internalAssetId) && (row.staffingGapNormal == null || row.staffingGapNormal === undefined);
  }
  return true;
}

function matchesCompletenessMax(max, row) {
  if (max == null || max === '') return true;
  const lim = Number(max);
  if (!Number.isFinite(lim)) return true;
  const c = n(row.completenessScore);
  if (c == null) return false;
  return c < lim;
}

function serializeParkRow(p) {
  const j = p.get ? p.get({ plain: true }) : p;
  return {
    id: j.id,
    snapshotAt: j.snapshotAt || j.snapshot_at,
    completenessScore: n(j.completenessScore ?? j.completeness_score),
    temperatureC: n(j.temperatureC ?? j.temperature_c),
    precipitationMm: n(j.precipitationMm ?? j.precipitation_mm),
    trafficIndex: n(j.trafficIndex ?? j.traffic_index),
    isPublicHoliday: j.isPublicHoliday ?? j.is_public_holiday,
    isSchoolHoliday: j.isSchoolHoliday ?? j.is_school_holiday,
    holidayName: j.holidayName ?? j.holiday_name ?? null,
    parkCrowdIndex: n(j.parkCrowdIndex ?? j.park_crowd_index),
    featureDataQuality: hintsForParkRow(j),
  };
}

function serializeRideRow(r) {
  const j = r.get ? r.get({ plain: true }) : r;
  return {
    id: j.id,
    snapshotAt: j.snapshotAt || j.snapshot_at,
    externalEntityId: j.externalEntityId || j.external_entity_id,
    entityType: j.entityType || j.entity_type,
    internalAssetId: j.internalAssetId || j.internal_asset_id,
    completenessScore: n(j.completenessScore ?? j.completeness_score),
    staffingGapNormal: j.staffingGapNormal ?? j.staffing_gap_normal,
    temperatureC: n(j.temperatureC ?? j.temperature_c),
    precipitationMm: n(j.precipitationMm ?? j.precipitation_mm),
    trafficIndex: n(j.trafficIndex ?? j.traffic_index),
    mlProfileCode: j.mlProfileCode ?? j.ml_profile_code ?? null,
    featureDataQuality: hintsForRideRow(j),
  };
}

async function loadAssetsWithoutMlProfile(parkId, entityType) {
  const et = entityType && String(entityType).trim() ? String(entityType).trim().toUpperCase() : null;
  const etFilter = et ? 'AND UPPER(at.code) = :et' : '';
  const [rows] = await sequelize.query(
    `SELECT pa.asset_id AS "assetId", pa.name, pa.external_entity_id AS "externalEntityId", at.code AS "entityType"
     FROM park_assets pa
     INNER JOIN asset_types at ON at.id = pa.asset_type_id
     LEFT JOIN asset_ml_profile_assignments a ON a.asset_id = pa.asset_id AND a.active_flag = true
     WHERE pa.park_id = :parkId AND pa.active_flag = true AND a.id IS NULL
     ${etFilter}
     ORDER BY pa.name
     LIMIT 250`,
    { replacements: { parkId, ...(et ? { et } : {}) } }
  );
  return rows || [];
}

class AiFeatureDataQualityService {
  /**
   * @param {string} parkId UUID internal park id (X-Park-Id)
   * @param {Record<string, unknown>} q query
   */
  async getDashboard(parkId, q = {}) {
    const { from, to } = parseRange(q);
    const provider = q.provider ? String(q.provider) : 'themeparks_wiki';
    const entityType = q.entityType ? String(q.entityType).trim().toUpperCase() : '';
    const missingFeature = q.missingFeature ? String(q.missingFeature).trim().toLowerCase() : '';
    const completenessMax = q.completenessMax;
    const confidenceMax = q.confidenceMax != null && q.confidenceMax !== '' ? Number(q.confidenceMax) : 0.45;
    const summariesLimit = q.summariesLimit != null ? Math.min(300, Math.max(10, Number(q.summariesLimit) || 150)) : 150;

    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    const ext = park?.externalEntityId ? String(park.externalEntityId) : null;

    const monitor = await mlAdmin.getFeatureStoreMonitor(parkId);
    const wherePark = { ...parkSnapWhere(parkId, ext), snapshotAt: { [Op.between]: [from, to] } };
    const whereRide = { ...parkSnapWhere(parkId, ext), snapshotAt: { [Op.between]: [from, to] } };
    if (entityType === 'RIDE') {
      whereRide.entityType = { [Op.in]: ['RIDE', 'ATTRACTION'] };
    } else if (entityType) {
      whereRide.entityType = entityType;
    }

    const [parkRowsRaw, rideRowsRaw] = await Promise.all([
      ParkFeatureSnapshot.findAll({
        where: wherePark,
        order: [['snapshotAt', 'DESC']],
        limit: 400,
      }),
      RideFeatureSnapshot.findAll({
        where: whereRide,
        order: [['snapshotAt', 'DESC']],
        limit: 800,
      }),
    ]);

    let parkRows = parkRowsRaw.map(serializeParkRow);
    let rideRows = rideRowsRaw.map(serializeRideRow);

    parkRows = parkRows.filter((row) => matchesCompletenessMax(completenessMax, { completenessScore: row.completenessScore }));
    rideRows = rideRows.filter((row) => matchesCompletenessMax(completenessMax, { completenessScore: row.completenessScore }));

    parkRows = parkRows.filter((row) => matchesMissingFeature(missingFeature, true, row));
    rideRows = rideRows.filter((row) => matchesMissingFeature(missingFeature, false, row));

    const parkScores = parkRowsRaw.map((p) => n(p.completenessScore)).filter((x) => x != null);
    const rideScores = rideRowsRaw.map((r) => n(r.completenessScore)).filter((x) => x != null);
    const allScores = [...parkScores, ...rideScores];
    const avgCompleteness = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

    let weatherMissingCount = 0;
    let calendarMissingCount = 0;
    let trafficMissingCount = 0;
    let staffingMissingCount = 0;
    for (const r of rideRowsRaw) {
      if (rideWeatherMissing(r)) weatherMissingCount += 1;
      if (rideCalendarMissing(r)) calendarMissingCount += 1;
      if (rideTrafficMissing(r)) trafficMissingCount += 1;
      if (rideStaffingMissing(r)) staffingMissingCount += 1;
    }
    for (const p of parkRowsRaw) {
      if (parkWeatherMissing(p)) weatherMissingCount += 1;
      if (parkCalendarMissing(p)) calendarMissingCount += 1;
      if (parkTrafficMissing(p)) trafficMissingCount += 1;
    }

    const assetsMissingMl = await loadAssetsWithoutMlProfile(parkId, entityType || null);

    let lowConfidenceForecasts = [];
    let lowConfidenceCount = 0;
    if (ext) {
      const summaries = await parkForecast.getEntitySummariesForPark(ext, { provider, limit: summariesLimit });
      const lim = Number.isFinite(confidenceMax) ? confidenceMax : 0.45;
      for (const s of summaries) {
        const et = String(s.entityType || '').toUpperCase();
        if (entityType === 'RIDE') {
          if (et !== 'RIDE' && et !== 'ATTRACTION') continue;
        } else if (entityType && et !== entityType) continue;
        const conf = n(s.confidence);
        if (conf == null || conf >= lim) continue;
        lowConfidenceForecasts.push({
          externalEntityId: s.externalEntityId || null,
          entityType: s.entityType || null,
          name: s.externalEntityId || '—',
          confidence: conf,
          confidenceLevel: s.confidenceLevel || null,
          forecastSource: s.forecastSource || null,
          featureDataQuality: Array.isArray(s.featureDataQuality) ? s.featureDataQuality : [],
          snapshotCompletenessScore: s.snapshotCompletenessScore ?? null,
        });
      }
      lowConfidenceCount = lowConfidenceForecasts.length;
      lowConfidenceForecasts = lowConfidenceForecasts.slice(0, 120);
      const extIds = [...new Set(lowConfidenceForecasts.map((x) => x.externalEntityId).filter(Boolean))];
      if (extIds.length) {
        const assets = await ParkAsset.findAll({
          where: { parkId, externalEntityId: { [Op.in]: extIds } },
          attributes: ['externalEntityId', 'name'],
        });
        const nameByExt = new Map(assets.map((a) => [a.externalEntityId, a.name]));
        lowConfidenceForecasts = lowConfidenceForecasts.map((x) => ({
          ...x,
          name: nameByExt.get(x.externalEntityId) || x.name,
        }));
      }
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      monitor,
      kpis: {
        snapshotFreshnessOk: monitor.snapshotFreshnessOk,
        latestParkSnapshotAt: monitor.latestParkSnapshotAt,
        latestRideSnapshotAt: monitor.latestRideSnapshotAt,
        avgCompletenessScore: avgCompleteness,
        assetsWithoutMlProfile: monitor.assetsWithoutProfileApprox,
        assetsWithMlProfileApprox: monitor.assetsWithMlProfileApprox,
        rideAssets: monitor.rideAssets,
        missingWeatherLatest: monitor.missingWeather,
        missingCalendarLatest: monitor.missingHoliday,
        missingTrafficLatest: monitor.missingTraffic,
        snapshotsMissingWeatherCount: weatherMissingCount,
        snapshotsMissingCalendarCount: calendarMissingCount,
        snapshotsMissingTrafficCount: trafficMissingCount,
        snapshotsMissingStaffingCount: staffingMissingCount,
        lowConfidenceForecastCount: lowConfidenceCount,
      },
      parkFeatureQuality: parkRows.slice(0, 200),
      rideFeatureQuality: rideRows.slice(0, 300),
      assetsMissingMlProfile: assetsMissingMl,
      lowConfidenceForecasts,
    };
  }

  /**
   * Delete one park snapshot row if it belongs to the park (internal id or external park + provider).
   * @param {string} parkId
   * @param {string} snapshotId
   * @returns {Promise<{ deleted: number }>}
   */
  async deleteParkSnapshotById(parkId, snapshotId) {
    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
    const ext = park.externalEntityId ? String(park.externalEntityId) : null;
    const where = { id: snapshotId, ...parkSnapWhere(parkId, ext) };
    const deleted = await ParkFeatureSnapshot.destroy({ where });
    if (!deleted) throw new AppError('Park snapshot not found', 404, { code: 'NOT_FOUND' });
    return { deleted: 1 };
  }

  /**
   * Bulk-delete park snapshots in [from, to] for the park (same scope as dashboard reads).
   * @param {string} parkId
   * @param {string} fromStr ISO
   * @param {string} toStr ISO
   * @returns {Promise<{ deleted: number }>}
   */
  async purgeParkSnapshotsInRange(parkId, fromStr, toStr) {
    const { from, to } = parsePurgeRange(fromStr, toStr);
    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
    const ext = park.externalEntityId ? String(park.externalEntityId) : null;
    const where = {
      ...parkSnapWhere(parkId, ext),
      snapshotAt: { [Op.between]: [from, to] },
    };
    const deleted = await ParkFeatureSnapshot.destroy({ where });
    return { deleted };
  }

  /**
   * Bulk-delete by primary key; only rows belonging to the park are removed.
   * @param {string} parkId
   * @param {string[]} ids
   * @returns {Promise<{ deleted: number, requested: number }>}
   */
  async deleteParkSnapshotsByIds(parkId, ids) {
    const uniq = [...new Set((ids || []).map((x) => String(x).trim()).filter(Boolean))];
    if (!uniq.length) {
      throw new AppError('ids required', 400, { code: 'VALIDATION_ERROR' });
    }
    if (uniq.length > 200) {
      throw new AppError('At most 200 ids per request', 400, { code: 'TOO_MANY_IDS' });
    }
    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
    const ext = park.externalEntityId ? String(park.externalEntityId) : null;
    const where = {
      id: { [Op.in]: uniq },
      ...parkSnapWhere(parkId, ext),
    };
    const deleted = await ParkFeatureSnapshot.destroy({ where });
    return { deleted, requested: uniq.length };
  }
}

module.exports = { AiFeatureDataQualityService };
