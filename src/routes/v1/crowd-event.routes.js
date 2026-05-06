const { Router } = require('express');
const crowdEventController = require('../../controllers/crowd-event.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { createEventSchema } = require('../../validators/crowd-event.schemas');

const router = Router();

router.get('/', requirePermission('events', 'read'), crowdEventController.listEvents);
router.post(
  '/',
  requirePermission('events', 'create'),
  validate(createEventSchema),
  crowdEventController.createEvent
);

module.exports = { crowdEventRouter: router };
