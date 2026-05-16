'use strict';

const { Router } = require('express');
const env = require('../../../config/env');
const { requirePermission } = require('../../../middleware/rbac.middleware');
const controller = require('../controllers/integration-flow.controller');

const router = Router();

function integrationFlowEngineGate(_req, res, next) {
  if (!env.integrationFlowEngineEnabled) {
    return res.status(404).json({ success: false, message: 'Not found', code: 'NOT_FOUND' });
  }
  next();
}

router.use(integrationFlowEngineGate);
router.get('/', requirePermission('integrations', 'read'), controller.listNodes);

module.exports = { integrationNodesRouter: router };
