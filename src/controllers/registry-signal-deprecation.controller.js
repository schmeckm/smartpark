'use strict';

const { asyncHandler } = require('../utils/async-handler');
const {
  listRegistrySignalDeprecations,
  getRegistrySignalDeprecationHealth,
  deprecateRegistrySignal,
  reactivateRegistrySignal,
} = require('../services/registry-signal-deprecation.service');

const getRegistrySignalDeprecations = asyncHandler(async (req, res) => {
  const data = await listRegistrySignalDeprecations(req.params.id);
  res.json({ success: true, data });
});

const getRegistrySignalDeprecationHealthCtrl = asyncHandler(async (req, res) => {
  const data = await getRegistrySignalDeprecationHealth(req.params.id);
  res.json({ success: true, data });
});

const postRegistrySignalDeprecate = asyncHandler(async (req, res) => {
  const actorId = req.user?.id || null;
  const data = await deprecateRegistrySignal(req.params.id, req.body, actorId);
  res.json({ success: true, data });
});

const postRegistrySignalReactivate = asyncHandler(async (req, res) => {
  const actorId = req.user?.id || null;
  const data = await reactivateRegistrySignal(req.params.id, req.body, actorId);
  res.json({ success: true, data });
});

module.exports = {
  getRegistrySignalDeprecations,
  getRegistrySignalDeprecationHealthCtrl,
  postRegistrySignalDeprecate,
  postRegistrySignalReactivate,
};
