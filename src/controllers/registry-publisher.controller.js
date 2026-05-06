'use strict';

const { asyncHandler } = require('../utils/async-handler');
const {
  getRegistryPublisherStatus,
  getRegistryPublisherHealth,
  disableRegistryPublisherPilotForRide,
  listRegistryPublishEvents,
  dryRunRegistryPublishForRide,
  publishOnceRegistryPublishForRide,
} = require('../services/registry-publisher.service');

const getStatus = asyncHandler(async (_req, res) => {
  const data = await getRegistryPublisherStatus();
  res.json({ success: true, data });
});

const getHealth = asyncHandler(async (_req, res) => {
  const data = await getRegistryPublisherHealth();
  res.json({ success: true, data });
});

const listEvents = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await listRegistryPublishEvents({
    rideAssetId: q.rideAssetId,
    limit: q.limit,
  });
  res.json({ success: true, data });
});

const postDryRun = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const data = await dryRunRegistryPublishForRide(id);
  res.json({ success: true, data });
});

const postPublishOnce = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const data = await publishOnceRegistryPublishForRide(id);
  res.json({ success: true, data });
});

const postDisablePilot = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const data = await disableRegistryPublisherPilotForRide(id);
  res.json({ success: true, data });
});

module.exports = {
  getStatus,
  getHealth,
  listEvents,
  postDryRun,
  postPublishOnce,
  postDisablePilot,
};
