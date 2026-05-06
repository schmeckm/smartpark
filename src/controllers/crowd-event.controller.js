const { asyncHandler } = require('../utils/async-handler');
const { CrowdEventService } = require('../services/crowd-event.service');

const crowdEventService = new CrowdEventService();

const listEvents = asyncHandler(async (req, res) => {
  const events = await crowdEventService.listEvents();
  res.json({ success: true, data: events });
});

const createEvent = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const result = await crowdEventService.createEvent(payload);
  res.status(201).json({ success: true, data: result.event, recommendations: result.recommendations });
});

module.exports = {
  listEvents,
  createEvent,
};
