const { Router } = require('express');
const zoneController = require('../../controllers/zone.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { createZoneSchema, updateZoneSchema } = require('../../validators/zone.schemas');

const router = Router();

router.get('/', requirePermission('zones', 'read'), zoneController.listZones);
router.get('/:id', requirePermission('zones', 'read'), zoneController.getZone);
router.post('/', requirePermission('zones', 'create'), validate(createZoneSchema), zoneController.createZone);
router.patch(
  '/:id',
  requirePermission('zones', 'update'),
  validate(updateZoneSchema),
  zoneController.updateZone
);
router.delete('/:id', requirePermission('zones', 'delete'), zoneController.deleteZone);

module.exports = { zoneRouter: router };
