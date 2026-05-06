const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { parkRidesQuery } = require('../platform/platform.validators');
const { listParkMasterRides } = require('./park-master-rides.controller');

const router = Router();

router.get('/', requirePermission('rides', 'read'), validate(parkRidesQuery, 'query'), listParkMasterRides);

module.exports = { parkMasterRidesRouter: router };
