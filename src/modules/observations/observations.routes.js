const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { liveObservationsQuery } = require('../platform/platform.validators');
const observationsController = require('./observations.controller');

const router = Router();

router.get('/live', requirePermission('rides', 'read'), validate(liveObservationsQuery, 'query'), observationsController.listLiveObservations);

module.exports = { observationsRouter: router };
