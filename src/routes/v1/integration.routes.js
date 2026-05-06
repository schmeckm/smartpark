const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const integrationController = require('../../controllers/integration.controller');

const router = Router();

router.get('/logs', requirePermission('integration', 'read'), integrationController.listLogs);

module.exports = { integrationRouter: router };
