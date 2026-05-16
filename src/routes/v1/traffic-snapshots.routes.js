'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { trafficSnapshotPollBody, trafficLatestQuery } = require('../../validators/traffic-snapshots.schemas');
const trafficSnapshotsController = require('../../controllers/traffic-snapshots.controller');

const trafficSnapshotsRouter = Router();

trafficSnapshotsRouter.post(
  '/snapshots/poll',
  requirePermission('rides', 'update'),
  validate(trafficSnapshotPollBody),
  trafficSnapshotsController.postPollTrafficSnapshots
);

trafficSnapshotsRouter.get(
  '/snapshots/latest',
  requirePermission('rides', 'read'),
  validate(trafficLatestQuery, 'query'),
  trafficSnapshotsController.getLatestTrafficSnapshots
);

module.exports = { trafficSnapshotsRouter };
