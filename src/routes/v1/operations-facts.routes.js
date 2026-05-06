const { Router } = require('express');
const { requireAnyPermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate } = require('../../middleware/validate.middleware');
const operationsFactsController = require('../../controllers/operations-facts.controller');
const {
  parkIdParams,
  parkZoneParams,
  parkRideParams,
  ridesRegistryFirstQuery,
  rideAssetIdOnlyParams,
} = require('../../validators/operations-facts.schemas');

const router = Router();
router.use(requireParkContext);

router.get(
  '/rides',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(ridesRegistryFirstQuery, 'query'),
  operationsFactsController.listRideFactsRegistryFirst
);

router.get(
  '/rides/:id',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdOnlyParams, 'params'),
  operationsFactsController.getRideFactsRegistryFirst
);

router.get(
  '/parks/:parkId',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(parkIdParams, 'params'),
  operationsFactsController.getParkFacts
);

router.get(
  '/parks/:parkId/zones/:zoneId',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(parkZoneParams, 'params'),
  operationsFactsController.getZoneFacts
);

router.get(
  '/parks/:parkId/rides/:rideId',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(parkRideParams, 'params'),
  operationsFactsController.getRideFacts
);

module.exports = { operationsFactsRouter: router };
