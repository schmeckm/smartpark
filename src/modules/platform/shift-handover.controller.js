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

const acknowledge = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const userId = req.user?.id || null;
  const data = await svc.acknowledge(req.params.parkId, req.params.entryId, body, { userId, parkScopeId: parkScope(req) });
  res.json({ success: true, data });
});

const patchTasks = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await svc.patchTasks(req.params.parkId, req.params.entryId, body, parkScope(req));
  res.json({ success: true, data });
});

const listDueReminders = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await svc.listDueReminders(req.params.parkId, q, parkScope(req));
  res.json({ success: true, data });
});

const markReminderSent = asyncHandler(async (req, res) => {
  const data = await svc.markReminderSent(req.params.parkId, req.params.entryId, parkScope(req));
  res.json({ success: true, data });
});

const downloadPdf = asyncHandler(async (req, res) => {
  const data = await svc.getPdfPayload(req.params.parkId, req.params.entryId, parkScope(req));
  res.setHeader('Content-Type', data.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${data.fileName}"`);
  res.send(data.content);
});

module.exports = { list, create, acknowledge, patchTasks, listDueReminders, markReminderSent, downloadPdf };
