'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  corridorIdParams,
  trafficCorridorPatchBody,
  manualTrafficSnapshotBody,
} = require('../../validators/traffic-attendance.schemas');
const trafficAttendance = require('../../controllers/traffic-attendance.controller');

const trafficCorridorsGlobalRouter = Router();

trafficCorridorsGlobalRouter.patch(
  '/:corridorId',
  requirePermission('rides', 'update'),
  validate(corridorIdParams, 'params'),
  validate(trafficCorridorPatchBody),
  trafficAttendance.patchTrafficCorridor
);

trafficCorridorsGlobalRouter.delete(
  '/:corridorId',
  requirePermission('rides', 'update'),
  validate(corridorIdParams, 'params'),
  trafficAttendance.deleteTrafficCorridor
);

trafficCorridorsGlobalRouter.post(
  '/:corridorId/snapshots/manual',
  requirePermission('rides', 'update'),
  validate(corridorIdParams, 'params'),
  validate(manualTrafficSnapshotBody),
  trafficAttendance.postManualSnapshot
);

module.exports = { trafficCorridorsGlobalRouter };
