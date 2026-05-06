const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const dataQualityController = require('../../controllers/data-quality.controller');

const router = Router();

router.get('/issues', requirePermission('dataquality', 'read'), dataQualityController.list);
router.patch(
  '/issues/:id/resolve',
  requirePermission('dataquality', 'update'),
  dataQualityController.resolve
);

module.exports = { dataQualityRouter: router };
