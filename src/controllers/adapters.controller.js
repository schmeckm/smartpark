const { asyncHandler } = require('../utils/async-handler');
const { AdapterOperationsService } = require('../modules/integrations/adapter-framework/adapter-operations.service');

const ops = new AdapterOperationsService();

const getHealth = asyncHandler(async (_req, res) => {
  const data = await ops.getHealth();
  res.json({ success: true, data });
});

const getDashboard = asyncHandler(async (_req, res) => {
  const data = await ops.getDashboard();
  res.json({ success: true, data });
});

const listRuns = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await ops.listRuns(q);
  res.json({ success: true, data });
});

const getStatus = asyncHandler(async (req, res) => {
  const data = await ops.getAdapterStatus(req.params.adapterKey);
  res.json({ success: true, data });
});

const runNow = asyncHandler(async (req, res) => {
  const data = await ops.runAdapterNow(req.params.adapterKey);
  res.json({ success: true, data });
});

const pause = asyncHandler(async (req, res) => {
  const data = await ops.pauseAdapter(req.params.adapterKey);
  res.json({ success: true, data });
});

const activate = asyncHandler(async (req, res) => {
  const data = await ops.activateAdapter(req.params.adapterKey);
  res.json({ success: true, data });
});

const disable = asyncHandler(async (req, res) => {
  const data = await ops.disableAdapter(req.params.adapterKey);
  res.json({ success: true, data });
});

module.exports = {
  getHealth,
  getDashboard,
  listRuns,
  getStatus,
  runNow,
  pause,
  activate,
  disable,
};
