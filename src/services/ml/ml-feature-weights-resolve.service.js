'use strict';

/**
 * Resolves manual feature weights from DB profiles for trace / explainability only.
 * Does not change ridge inputs unless a future phase wires this into predictRidge.
 */

const env = require('../../config/env');
const { MlParkProfile, MlRideProfile } = require('../../models');
const { logger } = require('../../utils/logger');
const { normalizeFeatureWeights, mergeParkAndRideWeights } = require('./ml-feature-weight.util');

/**
 * @param {string} parkId
 * @param {string} rideId
 * @returns {Promise<{ merged: Record<string, number>, sources: Record<string, string> } | null>}
 */
async function loadResolvedWeightsForTrace(parkId, rideId) {
  if (!env.mlFeatureWeightsEnabled) return null;
  const pid = String(parkId || '').trim();
  const rid = String(rideId || '').trim();
  if (!pid || !rid) return null;
  try {
    const parkRow = await MlParkProfile.findOne({
      where: { parkId: pid, enabled: true },
      order: [['updatedAt', 'DESC']],
    });
    const rideRow = await MlRideProfile.findOne({
      where: { parkId: pid, rideId: rid, enabled: true },
      order: [['updatedAt', 'DESC']],
    });
    const parkPlain = parkRow ? parkRow.get({ plain: true }) : null;
    const ridePlain = rideRow ? rideRow.get({ plain: true }) : null;
    const parkW = normalizeFeatureWeights((parkPlain && parkPlain.featureWeightsJson) || {});
    const rideW = normalizeFeatureWeights((ridePlain && ridePlain.featureWeightsJson) || {});
    return mergeParkAndRideWeights(parkW, rideW);
  } catch (err) {
    logger.warn({ err, msg: 'loadResolvedWeightsForTrace failed (use unweighted trace)' });
    return null;
  }
}

module.exports = {
  loadResolvedWeightsForTrace,
};
