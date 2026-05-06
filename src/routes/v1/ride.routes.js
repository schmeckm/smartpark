const { Router } = require('express');
const rideController = require('../../controllers/ride.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { createRideSchema, updateRideSchema } = require('../../validators/ride.schemas');

const router = Router();

router.get('/', requirePermission('rides', 'read'), rideController.listRides);
router.get('/:id', requirePermission('rides', 'read'), rideController.getRide);
router.post('/', requirePermission('rides', 'create'), validate(createRideSchema), rideController.createRide);
router.patch(
  '/:id',
  requirePermission('rides', 'update'),
  validate(updateRideSchema),
  rideController.updateRide
);
router.delete('/:id', requirePermission('rides', 'delete'), rideController.deleteRide);

module.exports = { rideRouter: router };
