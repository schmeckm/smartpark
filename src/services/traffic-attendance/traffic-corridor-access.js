'use strict';

const { AppError } = require('../../utils/app-error');
const { TrafficCorridor } = require('../../models');

function parkScopeId(req) {
  return req?.parkContext?.id || null;
}

/**
 * @param {string} parkId route param park id
 * @param {string|null} scopeId from X-Park-Id
 */
function assertParkRouteScoped(parkId, scopeId) {
  if (scopeId && String(parkId) !== String(scopeId)) {
    throw new AppError('Park scope mismatch', 403, { code: 'PARK_SCOPE_MISMATCH' });
  }
}

/**
 * Load corridor and enforce optional X-Park-Id scope.
 * @param {string} corridorId
 * @param {string|null} scopeId
 * @returns {Promise<import('sequelize').Model>}
 */
async function loadCorridorForScope(corridorId, scopeId) {
  const row = await TrafficCorridor.findByPk(corridorId);
  if (!row) {
    throw new AppError('Traffic corridor not found', 404, { code: 'NOT_FOUND' });
  }
  if (scopeId && String(row.parkId) !== String(scopeId)) {
    throw new AppError('Traffic corridor not in scoped park', 403, { code: 'PARK_SCOPE_MISMATCH' });
  }
  return row;
}

module.exports = { parkScopeId, assertParkRouteScoped, loadCorridorForScope };
