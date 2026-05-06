'use strict';

const { asyncHandler } = require('../utils/async-handler');
const {
  getRegistryPreviewForRide,
  getLegacyOutputForRide,
  compareRegistryVsLegacy,
} = require('../services/registry-preview.service');

const getPreviewRegistryOutput = asyncHandler(async (req, res) => {
  const data = await getRegistryPreviewForRide(req.params.id);
  res.json({ success: true, data });
});

const getCompareRegistryVsLegacy = asyncHandler(async (req, res) => {
  const data = await compareRegistryVsLegacy(req.params.id);
  res.json({ success: true, data });
});

module.exports = {
  getPreviewRegistryOutput,
  getCompareRegistryVsLegacy,
};
