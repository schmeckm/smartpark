'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { Park } = require('../models');
const { TrafficCorridorService } = require('../services/traffic-attendance/traffic-corridor.service');
const { TrafficSignalAdapter } = require('../services/traffic-attendance/traffic-signal-adapter.service');
const { ParkDemandForecastService } = require('../services/traffic-attendance/park-demand-forecast.service');

const corridorService = new TrafficCorridorService();
const signalAdapter = new TrafficSignalAdapter();
const forecastService = new ParkDemandForecastService();

async function ensurePark(parkId) {
  const park = await Park.findByPk(parkId);
  if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
  return park;
}

const listTrafficCorridors = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  const data = await corridorService.listByPark(req.params.parkId);
  res.json({ success: true, data });
});

const createTrafficCorridor = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  try {
    const data = await corridorService.create(req.params.parkId, req.validated || req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    if (e && e.code === 'COORD_PAIR_INCOMPLETE') {
      throw new AppError('Origin and destination coordinates must be provided as lat/lng pairs', 422, {
        code: 'COORD_PAIR_INCOMPLETE',
      });
    }
    throw e;
  }
});

const patchTrafficCorridor = asyncHandler(async (req, res) => {
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
    throw e;
  }
});

const deleteTrafficCorridor = asyncHandler(async (req, res) => {
  const ok = await corridorService.remove(req.params.corridorId);
  if (!ok) throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: { deleted: true, id: req.params.corridorId } });
});

const postManualSnapshot = asyncHandler(async (req, res) => {
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
  const raw = req.body || {};
  const body = req.validated || raw;
  const flags = {
    weatherScore: Object.prototype.hasOwnProperty.call(raw, 'weatherScore'),
    holidayScore: Object.prototype.hasOwnProperty.call(raw, 'holidayScore'),
    eventScore: Object.prototype.hasOwnProperty.call(raw, 'eventScore'),
    parkingPressureScore: Object.prototype.hasOwnProperty.call(raw, 'parkingPressureScore'),
  };
  const data = await forecastService.runForecast(req.params.parkId, body, flags);
  res.status(201).json({ success: true, data });
});

const getLatestAttendanceRiskForecast = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  const data = await forecastService.getLatest(req.params.parkId);
  res.json({ success: true, data });
});

const getAttendanceRiskForecastHistory = asyncHandler(async (req, res) => {
  await ensurePark(req.params.parkId);
  const q = req.validated || {};
  const limit = q.limit != null ? q.limit : 96;
  const data = await forecastService.getHistory(req.params.parkId, limit);
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
};
