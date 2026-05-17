'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const {
  requireTrafficCorridorsRead,
  requireTrafficCorridorsUpdate,
} = require('../../middleware/traffic-corridors-rbac.middleware');
const { trafficPollRateLimit } = require('../../middleware/traffic-poll-rate-limit.middleware');
const { trafficSnapshotPollBody, trafficLatestQuery } = require('../../validators/traffic-snapshots.schemas');
const trafficSnapshotsController = require('../../controllers/traffic-snapshots.controller');

const trafficSnapshotsRouter = Router();

trafficSnapshotsRouter.post(
  '/snapshots/poll',
  requireTrafficCorridorsUpdate,
  requireParkContext,
  validate(trafficSnapshotPollBody),
  trafficPollRateLimit,
  trafficSnapshotsController.postPollTrafficSnapshots
);

trafficSnapshotsRouter.get(
  '/snapshots/latest',
  requireTrafficCorridorsRead,
  validate(trafficLatestQuery, 'query'),
  trafficSnapshotsController.getLatestTrafficSnapshots
);

module.exports = { trafficSnapshotsRouter };
