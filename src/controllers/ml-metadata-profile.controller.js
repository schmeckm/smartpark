'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const {
  listParkMlProfiles,
  getParkMlProfile,
  createParkMlProfile,
  updateParkMlProfile,
  archiveParkMlProfile,
} = require('../services/ml/ml-park-profile.service');
const {
  listRideMlProfiles,
  getRideMlProfile,
  createRideMlProfile,
  updateRideMlProfile,
  archiveRideMlProfile,
} = require('../services/ml/ml-ride-profile.service');
const { AuditLogService } = require('../services/audit-log.service');

const audit = new AuditLogService();

/** Parse `true`/`false` from query strings like enabled=1 or includeArchived=true */
function parseOptionalBooleanQuery(raw) {
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
    enabled: parseOptionalBooleanQuery(q.enabled),
    profileName: q.profileName,
    includeArchived: parseOptionalBooleanQuery(q.includeArchived),
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

const deleteParkProfileArchive = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await archiveParkMlProfile(parkId, id, req.user?.id || null);
  await audit.log({
    action: 'ml_park_profile.archive',
    entityType: 'MlParkProfile',
    entityId: id,
  });
  res.json({ success: true, data: row });
});

// ── Ride ─────────────────────────────────────────────────────────────────────

const getRideProfiles = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const rows = await listRideMlProfiles({
    parkId,
    enabled: parseOptionalBooleanQuery(q.enabled),
    profileName: q.profileName,
    rideId: q.rideId,
    includeArchived: parseOptionalBooleanQuery(q.includeArchived),
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

const deleteRideProfileArchive = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await archiveRideMlProfile(parkId, id, req.user?.id || null);
  await audit.log({
    action: 'ml_ride_profile.archive',
    entityType: 'MlRideProfile',
    entityId: id,
  });
  res.json({ success: true, data: row });
});

module.exports = {
  getParkProfiles,
  getParkProfileOne,
  postParkProfile,
  putParkProfile,
  deleteParkProfileArchive,
  getRideProfiles,
  getRideProfileOne,
  postRideProfile,
  putRideProfile,
  deleteRideProfileArchive,
};
