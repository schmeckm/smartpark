'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const {
  listParkMlProfiles,
  getParkMlProfile,
  createParkMlProfile,
  updateParkMlProfile,
} = require('../services/ml/ml-park-profile.service');
const {
  listRideMlProfiles,
  getRideMlProfile,
  createRideMlProfile,
  updateRideMlProfile,
} = require('../services/ml/ml-ride-profile.service');

function parseQueryEnabled(raw) {
  if (raw === true || raw === false) return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

// ── Park ─────────────────────────────────────────────────────────────────────

const getParkProfiles = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const rows = await listParkMlProfiles({
    parkId,
    enabled: parseQueryEnabled(q.enabled),
    profileName: q.profileName,
  });
  res.json({ success: true, data: rows });
});

const getParkProfileOne = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await getParkMlProfile(id, parkId);
  if (!row) throw new AppError('Park ML profile not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const postParkProfile = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  try {
    const row = await createParkMlProfile(parkId, body);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('Profile with this name and version already exists for this park', 409, {
        code: 'DUPLICATE_PROFILE',
      });
    }
    if (e.statusCode === 400) {
      throw new AppError(e.message, 400, { code: e.code || 'VALIDATION_ERROR' });
    }
    throw e;
  }
});

const putParkProfile = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const v = req.validated || {};
  const { id, ...body } = v;
  try {
    const row = await updateParkMlProfile(parkId, id, body);
    if (!row) throw new AppError('Park ML profile not found', 404, { code: 'NOT_FOUND' });
    res.json({ success: true, data: row });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('Profile with this name and version already exists for this park', 409, {
        code: 'DUPLICATE_PROFILE',
      });
    }
    if (e.statusCode === 400) {
      throw new AppError(e.message, 400, { code: e.code || 'VALIDATION_ERROR' });
    }
    throw e;
  }
});

// ── Ride ─────────────────────────────────────────────────────────────────────

const getRideProfiles = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const rows = await listRideMlProfiles({
    parkId,
    enabled: parseQueryEnabled(q.enabled),
    profileName: q.profileName,
    rideId: q.rideId,
  });
  res.json({ success: true, data: rows });
});

const getRideProfileOne = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await getRideMlProfile(id, parkId);
  if (!row) throw new AppError('Ride ML profile not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const postRideProfile = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  try {
    const row = await createRideMlProfile(parkId, body);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(
        'Profile with this name and version already exists for this park and ride',
        409,
        { code: 'DUPLICATE_PROFILE' }
      );
    }
    if (e.statusCode === 400) {
      throw new AppError(e.message, 400, { code: e.code || 'VALIDATION_ERROR' });
    }
    throw e;
  }
});

const putRideProfile = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const v = req.validated || {};
  const { id, ...body } = v;
  try {
    const row = await updateRideMlProfile(parkId, id, body);
    if (!row) throw new AppError('Ride ML profile not found', 404, { code: 'NOT_FOUND' });
    res.json({ success: true, data: row });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(
        'Profile with this name and version already exists for this park and ride',
        409,
        { code: 'DUPLICATE_PROFILE' }
      );
    }
    if (e.statusCode === 400) {
      throw new AppError(e.message, 400, { code: e.code || 'VALIDATION_ERROR' });
    }
    throw e;
  }
});

module.exports = {
  getParkProfiles,
  getParkProfileOne,
  postParkProfile,
  putParkProfile,
  getRideProfiles,
  getRideProfileOne,
  postRideProfile,
  putRideProfile,
};
