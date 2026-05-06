const { asyncHandler } = require('../../utils/async-handler');
const { ShiftHandoverService } = require('../../services/shift-handover.service');

const svc = new ShiftHandoverService();

function parkScope(req) {
  return req.parkContext?.id || null;
}

const list = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await svc.list(req.params.parkId, q, parkScope(req));
  res.json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const userId = req.user?.id || null;
  const data = await svc.create(req.params.parkId, body, { userId, parkScopeId: parkScope(req) });
  res.status(201).json({ success: true, data });
});

module.exports = { list, create };
