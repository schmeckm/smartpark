'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { TrafficSnapshotService } = require('../services/traffic-attendance/traffic-snapshot.service');
const { TomTomTrafficProviderError } = require('../services/traffic-attendance/tomtom-traffic.provider');

const { parkScopeId, assertParkRouteScoped } = require('../services/traffic-attendance/traffic-corridor-access');

const snapshotService = new TrafficSnapshotService();

function mapPreflightError(e) {
  if (!(e instanceof TomTomTrafficProviderError)) return null;
  if (e.code === 'TOMTOM_DISABLED') {
    return new AppError('TomTom traffic integration is disabled', 403, { code: 'TOMTOM_DISABLED' });
  }
  if (e.code === 'TOMTOM_API_KEY_MISSING') {
    return new AppError('TomTom API key is not configured', 503, { code: 'TOMTOM_API_KEY_MISSING' });
  }
  return null;
}

const postPollTrafficSnapshots = asyncHandler(async (req, res) => {
  try {
    const body = req.validated || {};
    assertParkRouteScoped(body.parkId, parkScopeId(req));
    const data = await snapshotService.pollEnabledCorridors({
      parkId: body.parkId,
      requireParkId: true,
    });
    res.json({ success: true, data });
  } catch (e) {
    const mapped = mapPreflightError(e);
    if (mapped) throw mapped;
    throw e;
  }
});

const getLatestTrafficSnapshots = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const data = await snapshotService.getLatestNormalizedSnapshots(q.parkId);
  res.json({ success: true, data });
});

module.exports = { postPollTrafficSnapshots, getLatestTrafficSnapshots };
