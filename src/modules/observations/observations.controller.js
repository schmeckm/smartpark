const { asyncHandler } = require('../../utils/async-handler');
const { AssetsRepository } = require('../assets/assets.repository');

const listLiveObservations = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const models = require('../../models');
  const repo = new AssetsRepository(models);
  const data = await repo.listRecentObservations({
    parkId: q.parkId,
    limit: q.limit,
    metricCode: q.metricCode,
  });
  res.json({ success: true, data });
});

module.exports = { listLiveObservations };
