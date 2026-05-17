'use strict';

const { Op } = require('sequelize');
const { Park, ParkFeatureSnapshot, ParkAsset } = require('../models');
const { AppError } = require('./app-error');

const DEFAULT_PROVIDER = 'themeparks_wiki';

/**
 * Resolve external park id for a platform park (MDM external_entity_id, else latest feature snapshot).
 * @param {string} parkId
 * @param {string} [provider]
 * @returns {Promise<{ externalParkId: string, provider: string }|null>}
 */
async function resolveExternalParkForPlatformPark(parkId, provider = DEFAULT_PROVIDER) {
  const park = await Park.findByPk(parkId, {
    attributes: ['id', 'externalEntityId', 'externalSource'],
  });
  if (!park) return null;

  const ext = park.externalEntityId != null ? String(park.externalEntityId).trim() : '';
  if (ext) {
    return { externalParkId: ext, provider: normalizeProvider(provider, park.externalSource) };
  }

  const snap = await ParkFeatureSnapshot.findOne({
    where: { internalParkId: parkId, provider },
    order: [['snapshotAt', 'DESC']],
    attributes: ['externalParkId', 'provider'],
  });
  if (snap?.externalParkId) {
    return {
      externalParkId: String(snap.externalParkId),
      provider: String(snap.provider || provider),
    };
  }

  return null;
}

function normalizeProvider(requested, parkExternalSource) {
  const r = String(requested || DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
  if (r !== DEFAULT_PROVIDER) return r;
  const src = String(parkExternalSource || '').toUpperCase();
  if (src.includes('THEMEPARKS')) return DEFAULT_PROVIDER;
  return r;
}

/**
 * @param {import('express').Request} req
 * @param {string} externalParkId
 * @param {string} [provider]
 */
async function assertExternalParkMatchesContext(req, externalParkId, provider = DEFAULT_PROVIDER) {
  const parkId = req.parkContext?.id;
  if (!parkId) {
    throw new AppError('X-Park-Id header is required for this resource', 400, { code: 'PARK_CONTEXT_REQUIRED' });
  }
  const resolved = await resolveExternalParkForPlatformPark(parkId, provider);
  if (!resolved) {
    throw new AppError('No external park mapping for this park', 404, { code: 'PARK_EXTERNAL_ID_NOT_FOUND' });
  }
  const want = String(externalParkId || '').trim();
  if (want !== resolved.externalParkId) {
    throw new AppError('externalParkId does not match the active park context', 403, {
      code: 'PARK_EXTERNAL_MISMATCH',
      details: { expected: resolved.externalParkId, received: want },
    });
  }
  return resolved;
}

/**
 * @param {import('express').Request} req
 * @param {string} externalEntityId
 * @param {string} externalParkId
 */
async function assertEntityBelongsToPark(req, externalEntityId, externalParkId) {
  const parkId = req.parkContext?.id;
  if (!parkId) return;
  const extEntity = String(externalEntityId || '').trim();
  if (!extEntity) return;

  const asset = await ParkAsset.findOne({
    where: {
      parkId,
      [Op.or]: [{ externalEntityId: extEntity }, { assetId: extEntity }],
    },
    attributes: ['assetId'],
  });
  if (!asset) {
    throw new AppError('Entity does not belong to the active park', 403, {
      code: 'ENTITY_PARK_MISMATCH',
      details: { externalEntityId: extEntity, externalParkId },
    });
  }
}

module.exports = {
  DEFAULT_PROVIDER,
  resolveExternalParkForPlatformPark,
  assertExternalParkMatchesContext,
  assertEntityBelongsToPark,
};
