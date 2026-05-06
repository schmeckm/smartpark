const { asyncHandler } = require('../../utils/async-handler');
const { AssetDowntimeService } = require('../../services/asset-downtime.service');
const { OEE_REASON_CODES, OEE_REASON_LABELS_DE } = require('../../constants/oee-reason-codes');

const svc = new AssetDowntimeService();

function parkScope(req) {
  return req.parkContext?.id || null;
}

const listReasonCodes = asyncHandler(async (_req, res) => {
  const codes = OEE_REASON_CODES.map((code) => ({
    code,
    labelDe: OEE_REASON_LABELS_DE[code] || code,
  }));
  res.json({ success: true, data: codes });
});

const listDowntimeEvents = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await svc.list(req.params.assetId, q, parkScope(req));
  res.json({ success: true, data });
});

const createDowntimeEvent = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const userId = req.user?.id || null;
  const data = await svc.create(req.params.assetId, body, { userId, parkScopeId: parkScope(req) });
  res.status(201).json({ success: true, data });
});

const patchDowntimeEvent = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await svc.patch(req.params.eventId, req.params.assetId, body, { parkScopeId: parkScope(req) });
  res.json({ success: true, data });
});

const deleteDowntimeEvent = asyncHandler(async (req, res) => {
  await svc.delete(req.params.eventId, req.params.assetId, parkScope(req));
  res.status(204).send();
});

const availabilitySummary = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await svc.availabilitySummary(req.params.assetId, q, parkScope(req));
  res.json({ success: true, data });
});

const downtimeReasonPareto = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const raw = await svc.paretoByReason(req.params.assetId, q, parkScope(req));
  const items = raw.items.map((row) => ({
    ...row,
    labelDe: OEE_REASON_LABELS_DE[row.reasonCode] || row.reasonCode,
  }));
  res.json({ success: true, data: { ...raw, items } });
});

module.exports = {
  listReasonCodes,
  listDowntimeEvents,
  createDowntimeEvent,
  patchDowntimeEvent,
  deleteDowntimeEvent,
  availabilitySummary,
  downtimeReasonPareto,
};
