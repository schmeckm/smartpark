const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const controller = require('../../controllers/adapters.controller');
const { adapterOpsKeyParamsSchema, adapterRunsQuerySchema } = require('../../validators/adapters.schemas');

const router = Router();

router.get('/health', requirePermission('integrations', 'read'), controller.getHealth);
router.get('/dashboard', requirePermission('integrations', 'read'), controller.getDashboard);
router.get('/runs', requirePermission('integrations', 'read'), validate(adapterRunsQuerySchema, 'query'), controller.listRuns);

router.get('/:adapterKey/status', requirePermission('integrations', 'read'), validate(adapterOpsKeyParamsSchema, 'params'), controller.getStatus);
router.post('/:adapterKey/run-now', requirePermission('integrations', 'manage'), validate(adapterOpsKeyParamsSchema, 'params'), controller.runNow);
router.post('/:adapterKey/pause', requirePermission('integrations', 'manage'), validate(adapterOpsKeyParamsSchema, 'params'), controller.pause);
router.post('/:adapterKey/activate', requirePermission('integrations', 'manage'), validate(adapterOpsKeyParamsSchema, 'params'), controller.activate);
router.post('/:adapterKey/disable', requirePermission('integrations', 'manage'), validate(adapterOpsKeyParamsSchema, 'params'), controller.disable);

module.exports = { adaptersRouter: router };
