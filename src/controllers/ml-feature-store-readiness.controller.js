'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { getMlFeatureStoreReadiness } = require('../services/ml/ml-feature-store-readiness.service');

const getMlFeatureStoreReadinessHandler = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  const data = await getMlFeatureStoreReadiness({
    parkId,
    rideId: q.rideId ?? null,
    from: q.from ?? null,
    to: q.to ?? null,
  });
  res.json({ success: true, data });
});

module.exports = {
  getMlFeatureStoreReadiness: getMlFeatureStoreReadinessHandler,
};
