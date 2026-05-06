const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { operationsFactsService } = require('../services/operations/operations-facts.service');
const operationsFactsLayer = require('../services/operations-facts.service');

function assertParkRouteMatchesContext(req) {
  const { parkId } = req.params;
  if (String(parkId) !== String(req.parkContext?.id)) {
    throw new AppError('Park id does not match authenticated park context', 403, {
      code: 'PARK_CONTEXT_MISMATCH',
    });
  }
}

/** HTTP responses omit internal `_flat` projection used by board services. */
function publicRideFactsEnvelope(doc) {
  if (!doc) return null;
  const { parkId, rideId, timestamp, facts } = doc;
  return { parkId, rideId, timestamp, facts };
}

function publicZoneOrParkPayload(doc) {
  if (!doc) return null;
  const rides = Array.isArray(doc.rides) ? doc.rides.map((r) => publicRideFactsEnvelope(r)) : [];
  if (doc.zoneId != null) {
    return { parkId: doc.parkId, zoneId: doc.zoneId, timestamp: doc.timestamp, rides };
  }
  return { parkId: doc.parkId, timestamp: doc.timestamp, rides };
}

const getParkFacts = asyncHandler(async (req, res) => {
  assertParkRouteMatchesContext(req);
  const { parkId } = req.params;
  const doc = await operationsFactsService.getParkFacts({ parkId });
  res.json({ success: true, data: publicZoneOrParkPayload(doc) });
});

const getZoneFacts = asyncHandler(async (req, res) => {
  assertParkRouteMatchesContext(req);
  const { parkId, zoneId } = req.params;
  const doc = await operationsFactsService.getZoneFacts({ parkId, zoneId });
  res.json({ success: true, data: publicZoneOrParkPayload(doc) });
});

const getRideFacts = asyncHandler(async (req, res) => {
  assertParkRouteMatchesContext(req);
  const { parkId, rideId } = req.params;
  const doc = await operationsFactsService.getRideFacts({ parkId, rideId });
  if (!doc) {
    throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  res.json({ success: true, data: publicRideFactsEnvelope(doc) });
});

function assertQueryParkMatchesContext(req) {
  const parkId = req.validated?.parkId ?? req.query?.parkId;
  if (String(parkId || '') !== String(req.parkContext?.id || '')) {
    throw new AppError('parkId must match X-Park-Id park context', 403, { code: 'PARK_CONTEXT_MISMATCH' });
  }
}

/** Phase 9 — registry-first ride facts (read-only aggregation). */
const listRideFactsRegistryFirst = asyncHandler(async (req, res) => {
  assertQueryParkMatchesContext(req);
  const parkId = String(req.validated?.parkId ?? req.query?.parkId ?? '').trim();
  const data = await operationsFactsLayer.listRideFactsByPark(parkId);
  res.json({ success: true, data });
});

const getRideFactsRegistryFirst = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const doc = await operationsFactsLayer.getRideFacts(id);
  if (String(doc.parkId) !== String(req.parkContext?.id || '')) {
    throw new AppError('Ride not in scoped park', 403, { code: 'PARK_CONTEXT_MISMATCH' });
  }
  res.json({ success: true, data: doc });
});

module.exports = {
  getParkFacts,
  getZoneFacts,
  getRideFacts,
  listRideFactsRegistryFirst,
  getRideFactsRegistryFirst,
};
