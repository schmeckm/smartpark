'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { MdmRide, ParkAsset } = require('../models');
const {
  mergeExtensions,
  toReadApiPayload,
  persistMdmRideExtensions,
  persistParkAssetExtensions,
} = require('../services/ride-master-extensions.service');

const getMdmRideExtensions = asyncHandler(async (req, res) => {
  const ride = await MdmRide.findByPk(req.params.id);
  if (!ride) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: toReadApiPayload('ride', ride.id, ride) });
});

const getParkAssetExtensions = asyncHandler(async (req, res) => {
  const asset = await ParkAsset.findByPk(req.params.assetId);
  if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: toReadApiPayload('park_asset', asset.assetId, asset) });
});

const patchMdmRideExtensions = asyncHandler(async (req, res) => {
  const patch = req.validated;
  const ride = await MdmRide.findByPk(req.params.id);
  if (!ride) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
  const merged = mergeExtensions(ride, patch);
  await persistMdmRideExtensions(ride, merged);
  await ride.reload();
  res.json({ success: true, data: toReadApiPayload('ride', ride.id, ride) });
});

const patchParkAssetExtensions = asyncHandler(async (req, res) => {
  const patch = req.validated;
  const asset = await ParkAsset.findByPk(req.params.assetId);
  if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  const merged = mergeExtensions(asset, patch);
  await persistParkAssetExtensions(asset, merged);
  await asset.reload();
  res.json({ success: true, data: toReadApiPayload('park_asset', asset.assetId, asset) });
});

module.exports = {
  getMdmRideExtensions,
  getParkAssetExtensions,
  patchMdmRideExtensions,
  patchParkAssetExtensions,
};
