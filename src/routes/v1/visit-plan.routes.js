const { Router } = require('express');
const multer = require('multer');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const {
  listVisitPlansQuery,
  visitPlanIdParams,
  createVisitPlanBody,
  patchVisitPlanBody,
  visitPlanForecastMerged,
} = require('../../validators/visit-plan.schemas');
const visitPlanController = require('../../controllers/visit-plan.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const router = Router();

router.use(requireParkContext);

router.get(
  '/',
  requirePermission('rides', 'read'),
  validate(listVisitPlansQuery, 'query'),
  visitPlanController.listVisitPlans
);

router.post(
  '/',
  requirePermission('rides', 'update'),
  validate(createVisitPlanBody),
  visitPlanController.createVisitPlan
);

router.get(
  '/:id/export/xlsx',
  requirePermission('rides', 'read'),
  validate(visitPlanIdParams, 'params'),
  visitPlanController.exportVisitPlanXlsx
);

router.post(
  '/:id/import/xlsx',
  requirePermission('rides', 'update'),
  validate(visitPlanIdParams, 'params'),
  upload.single('file'),
  visitPlanController.importVisitPlanXlsx
);

router.post(
  '/:id/forecast',
  requirePermission('rides', 'update'),
  validateMergedParamsBody(visitPlanForecastMerged),
  visitPlanController.forecastVisitPlan
);

router.get(
  '/:id',
  requirePermission('rides', 'read'),
  validate(visitPlanIdParams, 'params'),
  visitPlanController.getVisitPlan
);

router.patch(
  '/:id',
  requirePermission('rides', 'update'),
  validate(visitPlanIdParams, 'params'),
  validate(patchVisitPlanBody),
  visitPlanController.patchVisitPlan
);

router.delete(
  '/:id',
  requirePermission('rides', 'update'),
  validate(visitPlanIdParams, 'params'),
  visitPlanController.deleteVisitPlan
);

module.exports = { visitPlanRouter: router };
