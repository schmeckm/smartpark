const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const importController = require('../../controllers/import.controller');

const router = Router();

router.post(
  '/staff',
  requirePermission('import', 'create'),
  ...importController.uploadFile,
  importController.staff
);
router.post(
  '/rides',
  requirePermission('import', 'create'),
  ...importController.uploadFile,
  importController.rides
);
router.post(
  '/zones',
  requirePermission('import', 'create'),
  ...importController.uploadFile,
  importController.zones
);

module.exports = { importRouter: router };
