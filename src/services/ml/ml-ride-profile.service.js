'use strict';

const { Op } = require('sequelize');
const { MlRideProfile } = require('../../models');
const { assertPlainObject } = require('./ml-park-profile.service');
const { normalizeFeatureWeights } = require('./ml-feature-weight.util');

/**
 * @param {{ parkId: string, rideId?: string, enabled?: boolean, profileName?: string }} filters
 */
async function listRideMlProfiles(filters) {
  const where = { parkId: String(filters.parkId) };
  if (filters.rideId) where.rideId = String(filters.rideId);
  if (typeof filters.enabled === 'boolean') where.enabled = filters.enabled;
  if (filters.profileName) where.profileName = { [Op.iLike]: `%${String(filters.profileName)}%` };
  const rows = await MlRideProfile.findAll({
    where,
    order: [
      ['rideId', 'ASC'],
      ['updatedAt', 'DESC'],
    ],
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * @param {string} id
 * @param {string} parkId
 */
async function getRideMlProfile(id, parkId) {
  const row = await MlRideProfile.findOne({
    where: { id: String(id), parkId: String(parkId) },
  });
  return row ? row.get({ plain: true }) : null;
}

async function createRideMlProfile(parkId, payload) {
  const row = await MlRideProfile.create({
    parkId: String(parkId),
    rideId: String(payload.rideId),
    profileName: String(payload.profileName).trim(),
    profileVersion: payload.profileVersion != null ? String(payload.profileVersion).trim() : 'v1',
    enabled: payload.enabled !== false,
    rideType: payload.rideType != null ? String(payload.rideType) : null,
    capacityProfileJson: assertPlainObject('capacityProfileJson', payload.capacityProfileJson),
    popularityProfileJson: assertPlainObject('popularityProfileJson', payload.popularityProfileJson),
    queueBehaviorProfileJson: assertPlainObject('queueBehaviorProfileJson', payload.queueBehaviorProfileJson),
    weatherSensitivityJson: assertPlainObject('weatherSensitivityJson', payload.weatherSensitivityJson),
    downtimeSensitivityJson: assertPlainObject('downtimeSensitivityJson', payload.downtimeSensitivityJson),
    staffingDependencyJson: assertPlainObject('staffingDependencyJson', payload.staffingDependencyJson),
    throughputProfileJson: assertPlainObject('throughputProfileJson', payload.throughputProfileJson),
    featureWeightsJson: normalizeFeatureWeights(
      assertPlainObject('featureWeightsJson', payload.featureWeightsJson ?? {})
    ),
    notes: payload.notes != null ? String(payload.notes) : null,
  });
  return row.get({ plain: true });
}

async function updateRideMlProfile(parkId, id, payload) {
  const row = await MlRideProfile.findOne({
    where: { id: String(id), parkId: String(parkId) },
  });
  if (!row) return null;
  const patch = {};
  if (payload.rideId != null) patch.rideId = String(payload.rideId);
  if (payload.profileName != null) patch.profileName = String(payload.profileName).trim();
  if (payload.profileVersion != null) patch.profileVersion = String(payload.profileVersion).trim();
  if (typeof payload.enabled === 'boolean') patch.enabled = payload.enabled;
  if (payload.rideType !== undefined) patch.rideType = payload.rideType != null ? String(payload.rideType) : null;
  if (payload.capacityProfileJson !== undefined)
    patch.capacityProfileJson = assertPlainObject('capacityProfileJson', payload.capacityProfileJson);
  if (payload.popularityProfileJson !== undefined)
    patch.popularityProfileJson = assertPlainObject('popularityProfileJson', payload.popularityProfileJson);
  if (payload.queueBehaviorProfileJson !== undefined)
    patch.queueBehaviorProfileJson = assertPlainObject(
      'queueBehaviorProfileJson',
      payload.queueBehaviorProfileJson
    );
  if (payload.weatherSensitivityJson !== undefined)
    patch.weatherSensitivityJson = assertPlainObject('weatherSensitivityJson', payload.weatherSensitivityJson);
  if (payload.downtimeSensitivityJson !== undefined)
    patch.downtimeSensitivityJson = assertPlainObject('downtimeSensitivityJson', payload.downtimeSensitivityJson);
  if (payload.staffingDependencyJson !== undefined)
    patch.staffingDependencyJson = assertPlainObject('staffingDependencyJson', payload.staffingDependencyJson);
  if (payload.throughputProfileJson !== undefined)
    patch.throughputProfileJson = assertPlainObject('throughputProfileJson', payload.throughputProfileJson);
  if (payload.featureWeightsJson !== undefined)
    patch.featureWeightsJson = normalizeFeatureWeights(
      assertPlainObject('featureWeightsJson', payload.featureWeightsJson)
    );
  if (payload.notes !== undefined) patch.notes = payload.notes != null ? String(payload.notes) : null;
  await row.update(patch);
  const fresh = await MlRideProfile.findByPk(row.id);
  return fresh ? fresh.get({ plain: true }) : row.get({ plain: true });
}

async function upsertRideMlProfile(parkId, payload) {
  if (payload.id) {
    return updateRideMlProfile(parkId, payload.id, payload);
  }
  return createRideMlProfile(parkId, payload);
}

module.exports = {
  listRideMlProfiles,
  getRideMlProfile,
  createRideMlProfile,
  updateRideMlProfile,
  upsertRideMlProfile,
};
