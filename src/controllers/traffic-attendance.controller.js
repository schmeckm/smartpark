'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { Park } = require('../models');
const { TrafficCorridorService } = require('../services/traffic-attendance/traffic-corridor.service');
const { TrafficSignalAdapter } = require('../services/traffic-attendance/traffic-signal-adapter.service');
const { ParkDemandForecastService } = require('../services/traffic-attendance/park-demand-forecast.service');

const {
  parkScopeId,
  assertParkRouteScoped,
  loadCorridorForScope,
} = require('../services/traffic-attendance/traffic-corridor-access');

const corridorService = new TrafficCorridorService();
const signalAdapter = new TrafficSignalAdapter();
const forecastService = new ParkDemandForecastService();

function formatAttendanceRiskForecastApi(row) {
  if (!row) return null;
  return {
    ...row,
    knownRegisteredDemand: row.knownRegisteredExpected,
    riskLevel: row.status,
    estimatedAdditionalDemandLow: row.additionalDemandLow,
    estimatedAdditionalDemandMid: row.additionalDemandMid,
    estimatedAdditionalDemandHigh: row.additionalDemandHigh,
    totalExpectedAttendanceLow: row.expectedAttendanceLow,
    totalExpectedAttendanceMid: row.expectedAttendanceMid,
    totalExpectedAttendanceHigh: row.expectedAttendanceHigh,
    explanation: row.explanationJson,
  };
}

async function ensurePark(parkId) {
  const park = await Park.findByPk(parkId);
  if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
  return park;
}

const listTrafficCorridors = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  assertParkRouteScoped(req.params.parkId, parkScopeId(req));
  const data = await corridorService.listByPark(req.params.parkId);
  res.json({ success: true, data });
});

const createTrafficCorridor = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  assertParkRouteScoped(req.params.parkId, parkScopeId(req));
  try {
    const data = await corridorService.create(req.params.parkId, req.validated || req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    if (e && e.code === 'COORD_PAIR_INCOMPLETE') {
      throw new AppError('Origin and destination coordinates must be provided as lat/lng pairs', 422, {
        code: 'COORD_PAIR_INCOMPLETE',
      });
    }
    if (e && e.code === 'COORD_WGS84_INVALID') {
      throw new AppError(e.message || 'Invalid WGS84 coordinates', 422, { code: 'COORD_WGS84_INVALID' });
    }
    throw e;
  }
});

const patchTrafficCorridor = asyncHandler(async (req, res) => {
  await loadCorridorForScope(req.params.corridorId, parkScopeId(req));
  try {
    const data = await corridorService.update(req.params.corridorId, req.validated || req.body);
    if (!data) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
    res.json({ success: true, data });
  } catch (e) {
    if (e && e.code === 'COORD_PAIR_INCOMPLETE') {
      throw new AppError('Origin and destination coordinates must be provided as lat/lng pairs', 422, {
        code: 'COORD_PAIR_INCOMPLETE',
      });
    }
    if (e && e.code === 'COORD_WGS84_INVALID') {
      throw new AppError(e.message || 'Invalid WGS84 coordinates', 422, { code: 'COORD_WGS84_INVALID' });
    }
    throw e;
  }
});

const deleteTrafficCorridor = asyncHandler(async (req, res) => {
  await loadCorridorForScope(req.params.corridorId, parkScopeId(req));
  const ok = await corridorService.remove(req.params.corridorId);
  if (!ok) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: { deleted: true, id: req.params.corridorId } });
});

const postManualSnapshot = asyncHandler(async (req, res) => {
  await loadCorridorForScope(req.params.corridorId, parkScopeId(req));
  const body = req.validated || req.body;
  const snap = await signalAdapter.createManualSnapshot(
    req.params.corridorId,
    body.currentTravelTimeMin,
    body.snapshotTs
  );
  if (!snap) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  res.status(201).json({ success: true, data: snap });
});

const runAttendanceRiskForecast = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  assertParkRouteScoped(req.params.parkId, parkScopeId(req));
  const raw = req.body || {};
  const body = req.validated || raw;
  const flags = {
    weatherScore: Object.prototype.hasOwnProperty.call(raw, 'weatherScore'),
    holidayScore: Object.prototype.hasOwnProperty.call(raw, 'holidayScore'),
    eventScore: Object.prototype.hasOwnProperty.call(raw, 'eventScore'),
    parkingPressureScore: Object.prototype.hasOwnProperty.call(raw, 'parkingPressureScore'),
  };
  const data = formatAttendanceRiskForecastApi(await forecastService.runForecast(req.params.parkId, body, flags));
  res.status(201).json({ success: true, data });
});

const getLatestAttendanceRiskForecast = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  assertParkRouteScoped(req.params.parkId, parkScopeId(req));
  const data = formatAttendanceRiskForecastApi(await forecastService.getLatest(req.params.parkId));
  res.json({ success: true, data });
});

const getAttendanceRiskForecastHistory = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  assertParkRouteScoped(req.params.parkId, parkScopeId(req));
  const q = req.validated || {};
  const limit = q.limit != null ? q.limit : 96;
  const rows = await forecastService.getHistory(req.params.parkId, limit);
  const data = rows.map((r) => formatAttendanceRiskForecastApi(r));
  res.json({ success: true, data });
});

const getLatestTrafficSnapshotDebug = asyncHandler(async (req, res) => {
  await loadCorridorForScope(req.params.corridorId, parkScopeId(req));
  const data = await corridorService.getLatestSnapshotDebug(req.params.corridorId);
  if (!data) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data });
});

const listTrafficCorridorSnapshots = asyncHandler(async (req, res) => {
  await loadCorridorForScope(req.params.corridorId, parkScopeId(req));
  const q = req.validated || {};
  const data = await corridorService.listSnapshotHistory(req.params.corridorId, {
    from: q.from,
    to: q.to,
    limit: q.limit,
  });
  if (!data) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data });
});

module.exports = {
  listTrafficCorridors,
  createTrafficCorridor,
  patchTrafficCorridor,
  deleteTrafficCorridor,
  postManualSnapshot,
  runAttendanceRiskForecast,
  getLatestAttendanceRiskForecast,
  getAttendanceRiskForecastHistory,
  getLatestTrafficSnapshotDebug,
  listTrafficCorridorSnapshots,
};
