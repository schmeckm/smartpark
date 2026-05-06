'use strict';

const { DatabaseError } = require('sequelize');
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { resolveParkRow } = require('../services/geo-pressure-engine.service');
const { GeoFlowSimulatorService } = require('../services/geo-flow-simulator.service');

const flowSvc = new GeoFlowSimulatorService();

/** Postgres 42P01: undefined_table — common when the API DB was not migrated after pulling journey-events. */
function rethrowIfMissingJourneyTable(err) {
  if (!(err instanceof DatabaseError) || !err.parent) throw err;
  const { code, message } = err.parent;
  const text = String(message || '');
  if (code === '42P01' && text.includes('visitor_journey_events')) {
    throw new AppError(
      'Database schema is missing visitor_journey_events. Run migrations against the same database the API uses, then restart the API (e.g. docker compose restart api so entrypoint runs db:migrate).',
      503,
      { code: 'SCHEMA_MIGRATION_REQUIRED' }
    );
  }
  throw err;
}

function assertParkMatchesContext(req, park) {
  if (!req.parkContext?.id) return;
  if (String(req.parkContext.id) !== String(park.id)) {
    throw new AppError('Park does not match X-Park-Id', 400, { code: 'PARK_ID_MISMATCH' });
  }
}

const flowSimulation = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const q = req.validated || req.query || {};
  let data;
  try {
    data = await flowSvc.run(park.id, {
      mode: q.mode,
      from: q.from,
      to: q.to,
      guestCount: q.guestCount,
      transitionCount: q.transitionCount,
      maxHopM: q.maxHopM,
      seed: q.seed,
      assetTypeCode: q.assetTypeCode,
      topEdges: q.topEdges,
    });
  } catch (e) {
    rethrowIfMissingJourneyTable(e);
  }
  if (data && data.error === 'INVALID_RANGE') {
    throw new AppError(data.message || 'Invalid time range', 400, { code: 'INVALID_RANGE' });
  }
  if (data && data.error === 'PARK_NOT_FOUND') {
    throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  }
  res.json({ success: true, data });
});

const flowEventsBatch = asyncHandler(async (req, res) => {
  const park = await resolveParkRow(req.params.parkSlug);
  if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  assertParkMatchesContext(req, park);
  const body = req.validated || req.body || {};
  const events = Array.isArray(body.events) ? body.events : [];
  let out;
  try {
    out = await flowSvc.appendEvents(park.id, events);
  } catch (e) {
    rethrowIfMissingJourneyTable(e);
  }
  if (out.error === 'ASSET_NOT_IN_PARK') {
    throw new AppError('Asset not in this park', 400, { code: 'ASSET_NOT_IN_PARK', details: { assetId: out.assetId } });
  }
  res.json({ success: true, data: out });
});

module.exports = { flowSimulation, flowEventsBatch };
