const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { actualYearParams, putVisitActualMerged } = require('../../validators/visit-actual.schemas');
const visitActualController = require('../../controllers/visit-actual.controller');

const router = Router();

router.use(requireParkContext);

router.get(
  '/:actualYear',
  requirePermission('rides', 'read'),
  validate(actualYearParams, 'params'),
  visitActualController.getVisitActualYear
);

router.put(
  '/:actualYear',
  requirePermission('rides', 'update'),
  validateMergedParamsBody(putVisitActualMerged),
  visitActualController.putVisitActualYear
);

module.exports = { visitActualRouter: router };
