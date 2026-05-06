const { asyncHandler } = require('../../utils/async-handler');
const { AssetsRepository } = require('../assets/assets.repository');

const listParkMasterRides = asyncHandler(async (req, res) => {
  const models = require('../../models');
  const repo = new AssetsRepository(models);
  const q = req.validated || req.query;
  const data = await repo.listRideMasterRows(q.parkId || undefined);
  res.json({ success: true, data });
});

module.exports = { listParkMasterRides };
