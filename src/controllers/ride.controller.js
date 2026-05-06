const { asyncHandler } = require('../utils/async-handler');
const { RideService } = require('../services/ride.service');

const rideService = new RideService();

const listRides = asyncHandler(async (req, res) => {
  const rides = await rideService.listRides();
  res.json({ success: true, data: rides });
});

const getRide = asyncHandler(async (req, res) => {
  const ride = await rideService.getRideById(req.params.id);
  res.json({ success: true, data: ride });
});

const createRide = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const ride = await rideService.createRide(payload);
  res.status(201).json({ success: true, data: ride });
});

const updateRide = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const ride = await rideService.updateRide(req.params.id, payload);
  res.json({ success: true, data: ride });
});

const deleteRide = asyncHandler(async (req, res) => {
  await rideService.deleteRide(req.params.id);
  res.status(204).send();
});

module.exports = {
  listRides,
  getRide,
  createRide,
  updateRide,
  deleteRide,
};
