/**
 * Spiegelt Adapter-/Ride-Status (OPEN vs. CLOSED) in asset_downtime_events für OEE,
 * nur während evaluierter Park-Öffnungszeit (OperationalContextService).
 */
const env = require('../config/env');
const { AssetDowntimeEvent } = require('../models');
const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const { OperationalContextService } = require('./operational-context.service');
const { AssetDowntimeService } = require('./asset-downtime.service');

const REASON = 'UNPLANNED_ADAPTER_UNAVAILABLE';
const SOURCE = 'adapter_status';

function normalizeRideStatus(s) {
  if (s == null || String(s).trim() === '') return 'OPEN';
  return String(s).trim().toUpperCase();
}

async function loadWithinScheduledHours(internalParkId, atDate) {
  const opSvc = new OperationalContextService();
  const ctx = await opSvc.getOperationalContext(internalParkId, { at: atDate });
  return ctx.operatingHours.withinScheduledOperatingHours === true;
}

async function endOpenAdapterDowntime(parkAssetId, internalParkId, atMs) {
  const downtimeService = new AssetDowntimeService();
  const openRow = await AssetDowntimeEvent.findOne({
    where: { assetId: parkAssetId, source: SOURCE, endedAt: null, reasonCode: REASON },
    order: [['startedAt', 'DESC']],
  });
  if (!openRow) return;
  const startedMs = new Date(openRow.startedAt).getTime();
  const endMs = Math.max(atMs, startedMs + 1);
  try {
    await downtimeService.patch(
      openRow.id,
      parkAssetId,
      { endedAt: new Date(endMs).toISOString() },
      { parkScopeId: internalParkId }
    );
  } catch (err) {
    logger.warn({ err, assetId: parkAssetId }, 'adapterRideAvailabilityDowntime: patch end failed');
  }
}

async function startOpenAdapterDowntimeIfNeeded(parkAssetId, internalParkId, atDate, messageType) {
  const existingOpen = await AssetDowntimeEvent.findOne({
    where: { assetId: parkAssetId, source: SOURCE, endedAt: null, reasonCode: REASON },
  });
  if (existingOpen) return;

  const downtimeService = new AssetDowntimeService();
  try {
    await downtimeService.create(
      parkAssetId,
      {
        startedAt: atDate.toISOString(),
        endedAt: null,
        planned: false,
        reasonCode: REASON,
        notes: `Adapter ${messageType || 'status'}: ride reported unavailable during scheduled park hours`,
        source: SOURCE,
      },
      { userId: null, parkScopeId: internalParkId }
    );
  } catch (err) {
    if (err instanceof AppError && err.code === 'DOWNTIME_OVERLAP') {
      logger.debug({ assetId: parkAssetId }, 'adapterRideAvailabilityDowntime: overlap on create, skip');
      return;
    }
    logger.warn({ err, assetId: parkAssetId }, 'adapterRideAvailabilityDowntime: create failed');
  }
}

/**
 * @param {object} p
 * @param {string|null} p.parkAssetId
 * @param {string|null} p.internalParkId
 * @param {string|null|undefined} p.previousStatus
 * @param {string|null|undefined} p.nextStatus
 * @param {Date} p.at
 * @param {string|null|undefined} p.messageType
 */
async function syncAdapterRideAvailabilityDowntime(p) {
  if (!env.adapterStatusMirrorOeeDowntime) return;

  const { parkAssetId, internalParkId, previousStatus, nextStatus, at, messageType } = p;
  const prev = normalizeRideStatus(previousStatus);
  const next = normalizeRideStatus(nextStatus);
  if (prev === next) return;

  if (!parkAssetId || !internalParkId) return;

  const atMs = at instanceof Date && !Number.isNaN(at.getTime()) ? at.getTime() : Date.now();
  const atDate = new Date(atMs);

  let withinScheduledOperatingHours = false;
  try {
    withinScheduledOperatingHours = await loadWithinScheduledHours(internalParkId, atDate);
  } catch (err) {
    logger.warn(
      { err, internalParkId, parkAssetId },
      'adapterRideAvailabilityDowntime: operational context failed, skip mirror'
    );
    return;
  }

  if (next === 'OPEN') {
    await endOpenAdapterDowntime(parkAssetId, internalParkId, atMs);
    return;
  }

  const unavailable = next === 'CLOSED' || next === 'MAINTENANCE';
  if (!unavailable || !withinScheduledOperatingHours) return;

  await startOpenAdapterDowntimeIfNeeded(parkAssetId, internalParkId, atDate, messageType);
}

module.exports = { syncAdapterRideAvailabilityDowntime, REASON, SOURCE };
