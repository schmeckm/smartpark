const { asyncHandler } = require('../utils/async-handler');
const { ZoneService } = require('../services/zone.service');

const zoneService = new ZoneService();

const listZones = asyncHandler(async (req, res) => {
  const zones = await zoneService.listZones();
  res.json({ success: true, data: zones });
});

const getZone = asyncHandler(async (req, res) => {
  const zone = await zoneService.getZoneById(req.params.id);
  res.json({ success: true, data: zone });
});

const createZone = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const zone = await zoneService.createZone(payload);
  res.status(201).json({ success: true, data: zone });
});

const updateZone = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const zone = await zoneService.updateZone(req.params.id, payload);
  res.json({ success: true, data: zone });
});

const deleteZone = asyncHandler(async (req, res) => {
  await zoneService.deleteZone(req.params.id);
  res.status(204).send();
});

module.exports = {
  listZones,
  getZone,
  createZone,
  updateZone,
  deleteZone,
};
