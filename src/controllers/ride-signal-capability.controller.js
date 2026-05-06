'use strict';

const { asyncHandler } = require('../utils/async-handler');
const {
  getCapabilitiesForRide,
  upsertCapabilitiesForRide,
  prepareUnsTopicsForRide,
  prepareSparkplugMetricsForRide,
  activatePreparedUnsTopicsForRide,
  deactivatePreparedUnsTopicsForRide,
  activatePreparedSparkplugMetricsForRide,
  deactivatePreparedSparkplugMetricsForRide,
  getTopicActivationStatus,
} = require('../services/ride-signal-capability.service');

const getRideSignalCapabilities = asyncHandler(async (req, res) => {
  const data = await getCapabilitiesForRide(req.params.id);
  res.json({ success: true, data });
});

const putRideSignalCapabilities = asyncHandler(async (req, res) => {
  const data = await upsertCapabilitiesForRide(req.params.id, req.body);
  res.json({ success: true, data });
});

const postPrepareUnsTopics = asyncHandler(async (req, res) => {
  const data = await prepareUnsTopicsForRide(req.params.id);
  res.json({ success: true, data });
});

const postPrepareSparkplugMetrics = asyncHandler(async (req, res) => {
  const data = await prepareSparkplugMetricsForRide(req.params.id);
  res.json({ success: true, data });
});

const getRideTopicActivationStatus = asyncHandler(async (req, res) => {
  const data = await getTopicActivationStatus(req.params.id);
  res.json({ success: true, data });
});

const postActivatePreparedUnsTopics = asyncHandler(async (req, res) => {
  const actorId = req.user?.id || null;
  const data = await activatePreparedUnsTopicsForRide(req.params.id, actorId);
  res.json({ success: true, data });
});

const postDeactivatePreparedUnsTopics = asyncHandler(async (req, res) => {
  const data = await deactivatePreparedUnsTopicsForRide(req.params.id);
  res.json({ success: true, data });
});

const postActivatePreparedSparkplugMetrics = asyncHandler(async (req, res) => {
  const actorId = req.user?.id || null;
  const data = await activatePreparedSparkplugMetricsForRide(req.params.id, actorId);
  res.json({ success: true, data });
});

const postDeactivatePreparedSparkplugMetrics = asyncHandler(async (req, res) => {
  const data = await deactivatePreparedSparkplugMetricsForRide(req.params.id);
  res.json({ success: true, data });
});

module.exports = {
  getRideSignalCapabilities,
  putRideSignalCapabilities,
  postPrepareUnsTopics,
  postPrepareSparkplugMetrics,
  getRideTopicActivationStatus,
  postActivatePreparedUnsTopics,
  postDeactivatePreparedUnsTopics,
  postActivatePreparedSparkplugMetrics,
  postDeactivatePreparedSparkplugMetrics,
};
