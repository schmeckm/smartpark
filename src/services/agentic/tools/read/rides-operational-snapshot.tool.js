'use strict';

const { AddonBoardService } = require('../../../addon-board.service');

const addonBoardService = new AddonBoardService();

function operationalStatusOfRow(r) {
  return String(r?.swdec?.rideOperations?.operationalStatus || '').toUpperCase();
}

function slimRide(r) {
  const op = operationalStatusOfRow(r);
  return {
    rideId: r?.rideId != null ? String(r.rideId) : null,
    rideName: r?.rideName != null ? String(r.rideName) : null,
    zoneId: r?.zoneId != null ? String(r.zoneId) : null,
    zone: r?.zone != null ? String(r.zone) : null,
    boardSeverity: r?.severity != null ? String(r.severity) : null,
    operationalStatus: op || null,
    operationalStatusSource: r?.swdec?.rideOperations?.operationalStatusSource ?? null,
    assetStateLive: r?.swdec?.rideOperations?.assetStateLive ?? null,
  };
}

/**
 * Park ride operational snapshot from Add-on Board payload (MQTT Sparkplug + snapshot heuristic).
 */
const ridesOperationalSnapshotTool = {
  name: 'read.rides_operational_snapshot',
  description:
    'Lists rides in the park with operational DOWN (and MAINTENANCE for context) from Add-on Board aggregation.',
  schema: {
    type: 'object',
    properties: {
      focusRideId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;
    const focusRideId = args.focusRideId != null ? String(args.focusRideId).trim() : '';

    const full = await addonBoardService.getParkRides(parkId);
    const rides = Array.isArray(full.rides) ? full.rides : [];

    /** @type {ReturnType<typeof slimRide>[]} */
    const downRides = [];
    /** @type {ReturnType<typeof slimRide>[]} */
    const maintenanceRides = [];

    for (const r of rides) {
      const op = operationalStatusOfRow(r);
      const row = slimRide(r);
      if (op === 'DOWN') downRides.push(row);
      else if (op === 'MAINTENANCE') maintenanceRides.push(row);
    }

    let focusRide = null;
    if (focusRideId) {
      const hit = rides.find((x) => String(x?.rideId || '') === focusRideId);
      focusRide = hit
        ? { ...slimRide(hit), found: true }
        : {
            rideId: focusRideId,
            found: false,
            rideName: null,
            zoneId: null,
            zone: null,
            boardSeverity: null,
            operationalStatus: null,
            operationalStatusSource: null,
            assetStateLive: null,
          };
    }

    return {
      parkId,
      timestamp: full.timestamp || new Date().toISOString(),
      totalRides: rides.length,
      downRides,
      maintenanceRides,
      downCount: downRides.length,
      maintenanceCount: maintenanceRides.length,
      focusRide,
      hint: 'Operational status from Add-on Board (Sparkplug live overrides snapshot heuristic when present).',
    };
  },
};

module.exports = { ridesOperationalSnapshotTool };
