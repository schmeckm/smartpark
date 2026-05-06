const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const controller = require('./mdm.controller');
const rideMasterExtensionsCtrl = require('../../controllers/ride-master-extensions.controller');
const { validateExtensionsPatchBody } = require('../../validators/ride-master-extensions-patch.validator');
const {
  parkBody,
  zoneBody,
  templateBody,
  rideTemplateUpdateBody,
  rideCreateBody,
  rideUpdateBody,
  cloneFromTemplateBody,
  assignZoneBody,
  activeBody,
  parkIdParams,
  idParams,
  cloneTemplateParams,
} = require('./mdm.validators');

const router = Router();

router.get('/parks', requirePermission('rides', 'read'), controller.listParks);
router.post('/parks', requirePermission('rides', 'create'), validate(parkBody), controller.createPark);

router.get('/parks/:parkId/zones', requirePermission('rides', 'read'), validate(parkIdParams, 'params'), controller.listZones);
router.post(
  '/parks/:parkId/zones',
  requirePermission('rides', 'create'),
  validate(parkIdParams, 'params'),
  validate(zoneBody),
  controller.createZone
);

router.get('/ride-types', requirePermission('rides', 'read'), controller.listRideTypes);

router.get('/ride-templates', requirePermission('rides', 'read'), controller.listTemplates);
router.get('/ride-templates/:id', requirePermission('rides', 'read'), validate(idParams, 'params'), controller.getTemplate);
router.post('/ride-templates', requirePermission('rides', 'create'), validate(templateBody), controller.createTemplate);
router.put(
  '/ride-templates/:id',
  requirePermission('rides', 'update'),
  validate(idParams, 'params'),
  validate(rideTemplateUpdateBody),
  controller.updateTemplate
);

router.get('/rides', requirePermission('rides', 'read'), controller.listRides);
router.post('/rides', requirePermission('rides', 'create'), validate(rideCreateBody), controller.createRide);
router.get(
  '/rides/:id/extensions',
  requirePermission('rides', 'read'),
  validate(idParams, 'params'),
  rideMasterExtensionsCtrl.getMdmRideExtensions
);
router.patch(
  '/rides/:id/extensions',
  requirePermission('rides', 'update'),
  validate(idParams, 'params'),
  validateExtensionsPatchBody,
  rideMasterExtensionsCtrl.patchMdmRideExtensions
);
router.get('/rides/:id', requirePermission('rides', 'read'), validate(idParams, 'params'), controller.getRide);
router.put('/rides/:id', requirePermission('rides', 'update'), validate(idParams, 'params'), validate(rideUpdateBody), controller.updateRide);
router.patch(
  '/rides/:id/active',
  requirePermission('rides', 'update'),
  validate(idParams, 'params'),
  validate(activeBody),
  controller.patchActive
);
router.post(
  '/ride-templates/:templateId/clone-ride',
  requirePermission('rides', 'create'),
  validate(cloneTemplateParams, 'params'),
  validate(cloneFromTemplateBody),
  controller.cloneFromTemplate
);

router.get('/rides/:id/capacity-model', requirePermission('rides', 'read'), validate(idParams, 'params'), controller.getCapacityModel);
router.get('/rides/:id/staffing-model', requirePermission('rides', 'read'), validate(idParams, 'params'), controller.getStaffingModel);
router.patch(
  '/rides/:id/zone',
  requirePermission('rides', 'update'),
  validate(idParams, 'params'),
  validate(assignZoneBody),
  controller.assignZone
);

module.exports = { mdmRouter: router };
