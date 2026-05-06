'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { GeoPressureEngineService, resolveParkRow } = require('../services/geo-pressure-engine.service');

const engine = new GeoPressureEngineService();

function assertParkMatchesContext(req, park) {
  if (!req.parkContext?.id) return;
  if (String(req.parkContext.id) !== String(park.id)) {
    throw new AppError('Park does not match X-Park-Id', 400, { code: 'PARK_ID_MISMATCH' });
  }
}

const pressureLive = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const q = req.validated || req.query || {};
  const data = await engine.buildPressurePayload(park.id, {
    mode: 'live',
    assetTypeCode: q.assetTypeCode,
  });
  res.json({ success: true, data });
});

const pressureForecast = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const q = req.validated || req.query || {};
  const data = await engine.buildPressurePayload(park.id, {
    mode: 'forecast',
    assetTypeCode: q.assetTypeCode,
    forecastProvider: q.provider,
  });
  res.json({ success: true, data });
});

const geoEntities = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const q = req.validated || req.query || {};
  const data = await engine.getGeoEntities(park.id, { assetTypeCode: q.assetTypeCode });
  res.json({ success: true, data });
});

const hotspots = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const q = req.validated || req.query || {};
  const full = await engine.buildPressurePayload(park.id, { mode: 'live', assetTypeCode: q.assetTypeCode });
  if (full.error) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  const limit = q.limit != null ? Math.min(50, Math.max(1, Number(q.limit) || 10)) : 10;
  res.json({
    success: true,
    data: {
      park: full.park,
      generatedAt: full.generatedAt,
      hotspots: full.hotspots.slice(0, limit),
      insights: full.insights,
    },
  });
});

const pressureSimulate = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const body = req.validated || req.body || {};
  const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  const data = await engine.buildSimulatedPayload(park.id, overrides);
  if (data.error) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  res.json({ success: true, data });
});

module.exports = {
  pressureLive,
  pressureForecast,
  geoEntities,
  hotspots,
  pressureSimulate,
};
