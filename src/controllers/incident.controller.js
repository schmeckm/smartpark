const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { IncidentService } = require('../services/incident.service');

const incidentService = new IncidentService();

const listIncidents = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const { items, total } = await incidentService.listForPark(parkId, {
    status: q.status,
    limit: q.limit,
    offset: q.offset,
    linkedEntityType: q.linkedEntityType,
    linkedEntityId: q.linkedEntityId,
    createdFrom: q.createdFrom,
    createdTo: q.createdTo,
  });
  res.json({
    success: true,
    data: { items, total, limit: q.limit, offset: q.offset },
  });
});

const getIncident = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const row = await incidentService.getByIdForPark(req.params.id, parkId);
  if (!row) throw new AppError('Incident not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const createIncident = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  const data = await incidentService.create(parkId, req.user, body);
  res.status(201).json({ success: true, data });
});

const patchIncident = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  const data = await incidentService.patch(req.params.id, parkId, req.user, body);
  res.json({ success: true, data });
});

const deleteIncident = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await incidentService.delete(req.params.id, parkId, req.user);
  res.json({ success: true, data });
});

module.exports = {
  listIncidents,
  getIncident,
  createIncident,
  patchIncident,
  deleteIncident,
};
