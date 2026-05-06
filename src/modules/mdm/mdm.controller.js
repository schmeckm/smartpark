const { asyncHandler } = require('../../utils/async-handler');
const { MdmService } = require('./mdm.service');

/** @type {MdmService | null} */
let svc = null;

function getService(req) {
  if (!svc) {
    const { sequelize, ...models } = require('../../models');
    svc = new MdmService(sequelize, models);
  }
  return svc;
}

const listParks = asyncHandler(async (_req, res) => {
  const data = await getService().listParks();
  res.json({ success: true, data });
});

const createPark = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().createPark(body, req.user?.id);
  res.status(201).json({ success: true, data });
});

const listZones = asyncHandler(async (req, res) => {
  const data = await getService().listZones(req.params.parkId);
  res.json({ success: true, data });
});

const createZone = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().createZone(req.params.parkId, body, req.user?.id);
  res.status(201).json({ success: true, data });
});

const listRideTypes = asyncHandler(async (_req, res) => {
  const data = await getService().listRideTypes();
  res.json({ success: true, data });
});

const listTemplates = asyncHandler(async (req, res) => {
  const data = await getService().listTemplates({ rideTypeId: req.query.rideTypeId || undefined });
  res.json({ success: true, data });
});

const getTemplate = asyncHandler(async (req, res) => {
  const data = await getService().getTemplate(req.params.id);
  if (!data) {
    const { AppError } = require('../../utils/app-error');
    throw new AppError('Template not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data });
});

const createTemplate = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().createTemplate(body, req.user?.id);
  res.status(201).json({ success: true, data });
});

const updateTemplate = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().updateTemplate(req.params.id, body, req.user?.id);
  res.json({ success: true, data });
});

const listRides = asyncHandler(async (req, res) => {
  const data = await getService().listRides({
    parkId: req.query.parkId,
    parkZoneId: req.query.parkZoneId,
    activeFlag: req.query.activeFlag,
  });
  res.json({ success: true, data });
});

const getRide = asyncHandler(async (req, res) => {
  const data = await getService().getRide(req.params.id);
  if (!data) {
    const { AppError } = require('../../utils/app-error');
    throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data });
});

const createRide = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().createRide(body, req.user?.id);
  res.status(201).json({ success: true, data });
});

const updateRide = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().updateRide(req.params.id, body, req.user?.id);
  res.json({ success: true, data });
});

const patchActive = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().setActiveFlag(req.params.id, body.activeFlag, req.user?.id);
  res.json({ success: true, data });
});

const cloneFromTemplate = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().cloneFromTemplate(req.params.templateId, body, req.user?.id);
  res.status(201).json({ success: true, data });
});

const getCapacityModel = asyncHandler(async (req, res) => {
  const data = await getService().getCapacityModel(req.params.id);
  res.json({ success: true, data });
});

const getStaffingModel = asyncHandler(async (req, res) => {
  const data = await getService().getStaffingModel(req.params.id);
  res.json({ success: true, data });
});

const assignZone = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await getService().assignZone(req.params.id, body.parkZoneId, req.user?.id);
  res.json({ success: true, data });
});

module.exports = {
  listParks,
  createPark,
  listZones,
  createZone,
  listRideTypes,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  listRides,
  getRide,
  createRide,
  updateRide,
  patchActive,
  cloneFromTemplate,
  getCapacityModel,
  getStaffingModel,
  assignZone,
};
