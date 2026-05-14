'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { getMlFeatureStoreSnapshotDebug } = require('../services/ml/ml-feature-store-snapshot-debug.service');

const getMlFeatureStoreSnapshotDebugHandler = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  const data = await getMlFeatureStoreSnapshotDebug({
    parkId,
    rideId: q.rideId,
    windowHours: q.windowHours,
  });
  res.json({ success: true, data });
});

module.exports = {
  getMlFeatureStoreSnapshotDebug: getMlFeatureStoreSnapshotDebugHandler,
};
