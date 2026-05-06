const { Router } = require('express');
const dashboardController = require('../../controllers/dashboard.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');

const router = Router();

router.get('/summary', requirePermission('dashboard', 'read'), dashboardController.getSummary);

module.exports = { dashboardRouter: router };
