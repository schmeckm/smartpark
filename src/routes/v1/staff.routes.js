const { Router } = require('express');
const multer = require('multer');
const staffController = require('../../controllers/staff.controller');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  createStaffSchema,
  updateStaffSchema,
  staffImportBody,
} = require('../../validators/staff.schemas');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const router = Router();

router.get(
  '/export/xlsx',
  requirePermission('staff', 'read'),
  staffController.exportStaffXlsx
);
router.get('/export', requirePermission('staff', 'read'), staffController.exportStaffJson);
router.post(
  '/import/xlsx',
  requireAnyPermission(['staff', 'update'], ['staff', 'create']),
  upload.single('file'),
  staffController.importStaffXlsx
);
router.post(
  '/import',
  requireAnyPermission(['staff', 'update'], ['staff', 'create']),
  validate(staffImportBody),
  staffController.importStaffJson
);

router.get('/', requirePermission('staff', 'read'), staffController.listStaff);
router.get('/:id', requirePermission('staff', 'read'), staffController.getStaff);
router.post('/', requirePermission('staff', 'create'), validate(createStaffSchema), staffController.createStaff);
router.patch(
  '/:id',
  requirePermission('staff', 'update'),
  validate(updateStaffSchema),
  staffController.updateStaff
);
router.delete('/:id', requirePermission('staff', 'delete'), staffController.deleteStaff);

module.exports = { staffRouter: router };
