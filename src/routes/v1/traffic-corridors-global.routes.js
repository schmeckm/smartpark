'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const {
  requireTrafficCorridorsRead,
  requireTrafficCorridorsUpdate,
} = require('../../middleware/traffic-corridors-rbac.middleware');
const {
  corridorIdParams,
  trafficCorridorPatchBody,
  manualTrafficSnapshotBody,
  trafficCorridorSnapshotHistoryQuery,
} = require('../../validators/traffic-attendance.schemas');
const trafficAttendance = require('../../controllers/traffic-attendance.controller');

const trafficCorridorsGlobalRouter = Router();

trafficCorridorsGlobalRouter.patch(
  '/:corridorId',
  requireTrafficCorridorsUpdate,
  requireParkContext,
  validate(corridorIdParams, 'params'),
  validate(trafficCorridorPatchBody),
  trafficAttendance.patchTrafficCorridor
);

trafficCorridorsGlobalRouter.delete(
  '/:corridorId',
  requireTrafficCorridorsUpdate,
  requireParkContext,
  validate(corridorIdParams, 'params'),
  trafficAttendance.deleteTrafficCorridor
);

trafficCorridorsGlobalRouter.post(
  '/:corridorId/snapshots/manual',
  requireTrafficCorridorsUpdate,
  requireParkContext,
  validate(corridorIdParams, 'params'),
  validate(manualTrafficSnapshotBody),
  trafficAttendance.postManualSnapshot
);

trafficCorridorsGlobalRouter.get(
  '/:corridorId/snapshots',
  requireTrafficCorridorsRead,
  requireParkContext,
  validate(corridorIdParams, 'params'),
  validate(trafficCorridorSnapshotHistoryQuery, 'query'),
  trafficAttendance.listTrafficCorridorSnapshots
);

trafficCorridorsGlobalRouter.get(
  '/:corridorId/snapshots/latest/debug',
  requireTrafficCorridorsRead,
  requireParkContext,
  validate(corridorIdParams, 'params'),
  trafficAttendance.getLatestTrafficSnapshotDebug
);

module.exports = { trafficCorridorsGlobalRouter };
