'use strict';

const { Op } = require('sequelize');
const { MlParkProfile } = require('../../models');
const { normalizeFeatureWeights } = require('./ml-feature-weight.util');

function assertPlainObject(label, v) {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) {
    const err = new Error(`${label} must be a JSON object`);
    err.statusCode = 400;
    err.code = 'INVALID_JSON_FIELD';
    throw err;
  }
  return v;
}

/**
 * @param {{ parkId: string, enabled?: boolean, profileName?: string }} filters
 */
async function listParkMlProfiles(filters) {
  const where = { parkId: String(filters.parkId) };
  if (typeof filters.enabled === 'boolean') where.enabled = filters.enabled;
  if (filters.profileName) where.profileName = { [Op.iLike]: `%${String(filters.profileName)}%` };
  const rows = await MlParkProfile.findAll({
    where,
    order: [['updatedAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * @param {string} id
 * @param {string} parkId
 */
async function getParkMlProfile(id, parkId) {
  const row = await MlParkProfile.findOne({
    where: { id: String(id), parkId: String(parkId) },
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * Create park profile (POST).
 * @param {string} parkId
 * @param {object} payload
 */
async function createParkMlProfile(parkId, payload) {
  const row = await MlParkProfile.create({
    parkId: String(parkId),
    profileName: String(payload.profileName).trim(),
    profileVersion: payload.profileVersion != null ? String(payload.profileVersion).trim() : 'v1',
    enabled: payload.enabled !== false,
    crowdProfileJson: assertPlainObject('crowdProfileJson', payload.crowdProfileJson),
    weatherProfileJson: assertPlainObject('weatherProfileJson', payload.weatherProfileJson),
    calendarProfileJson: assertPlainObject('calendarProfileJson', payload.calendarProfileJson),
    seasonalityProfileJson: assertPlainObject('seasonalityProfileJson', payload.seasonalityProfileJson),
    eventProfileJson: assertPlainObject('eventProfileJson', payload.eventProfileJson),
    visitorMixProfileJson: assertPlainObject('visitorMixProfileJson', payload.visitorMixProfileJson),
    featureWeightsJson: normalizeFeatureWeights(
      assertPlainObject('featureWeightsJson', payload.featureWeightsJson ?? {})
    ),
    notes: payload.notes != null ? String(payload.notes) : null,
  });
  return row.get({ plain: true });
}

/**
 * @param {string} parkId
 * @param {string} id
 * @param {object} payload
 */
async function updateParkMlProfile(parkId, id, payload) {
  const row = await MlParkProfile.findOne({
    where: { id: String(id), parkId: String(parkId) },
  });
  if (!row) return null;
  const patch = {};
  if (payload.profileName != null) patch.profileName = String(payload.profileName).trim();
  if (payload.profileVersion != null) patch.profileVersion = String(payload.profileVersion).trim();
  if (typeof payload.enabled === 'boolean') patch.enabled = payload.enabled;
  if (payload.crowdProfileJson !== undefined)
    patch.crowdProfileJson = assertPlainObject('crowdProfileJson', payload.crowdProfileJson);
  if (payload.weatherProfileJson !== undefined)
    patch.weatherProfileJson = assertPlainObject('weatherProfileJson', payload.weatherProfileJson);
  if (payload.calendarProfileJson !== undefined)
    patch.calendarProfileJson = assertPlainObject('calendarProfileJson', payload.calendarProfileJson);
  if (payload.seasonalityProfileJson !== undefined)
    patch.seasonalityProfileJson = assertPlainObject('seasonalityProfileJson', payload.seasonalityProfileJson);
  if (payload.eventProfileJson !== undefined)
    patch.eventProfileJson = assertPlainObject('eventProfileJson', payload.eventProfileJson);
  if (payload.visitorMixProfileJson !== undefined)
    patch.visitorMixProfileJson = assertPlainObject('visitorMixProfileJson', payload.visitorMixProfileJson);
  if (payload.featureWeightsJson !== undefined)
    patch.featureWeightsJson = normalizeFeatureWeights(
      assertPlainObject('featureWeightsJson', payload.featureWeightsJson)
    );
  if (payload.notes !== undefined) patch.notes = payload.notes != null ? String(payload.notes) : null;
  await row.update(patch);
  const fresh = await MlParkProfile.findByPk(row.id);
  return fresh ? fresh.get({ plain: true }) : row.get({ plain: true });
}

/**
 * @param {string} parkId
 * @param {object} payload — include `id` to update, omit to create
 */
async function upsertParkMlProfile(parkId, payload) {
  if (payload.id) {
    return updateParkMlProfile(parkId, payload.id, payload);
  }
  return createParkMlProfile(parkId, payload);
}

module.exports = {
  listParkMlProfiles,
  getParkMlProfile,
  createParkMlProfile,
  updateParkMlProfile,
  upsertParkMlProfile,
  assertPlainObject,
};
