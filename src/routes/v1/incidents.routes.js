const { Router } = require('express');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  listIncidentsQuery,
  incidentIdParams,
  createIncidentBody,
  patchIncidentBody,
} = require('../../validators/incidents.schemas');
const incidentController = require('../../controllers/incident.controller');

const router = Router();

router.use(requireParkContext);

router.get('/', requirePermission('incidents', 'read'), validate(listIncidentsQuery, 'query'), incidentController.listIncidents);

router.get(
  '/:id',
  requirePermission('incidents', 'read'),
  validate(incidentIdParams, 'params'),
  incidentController.getIncident
);

router.post(
  '/',
  requirePermission('incidents', 'create'),
  validate(createIncidentBody),
  incidentController.createIncident
);

router.patch(
  '/:id',
  requireAnyPermission(['incidents', 'create'], ['incidents', 'assign']),
  validate(incidentIdParams, 'params'),
  validate(patchIncidentBody),
  incidentController.patchIncident
);

router.delete(
  '/:id',
  requirePermission('incidents', 'delete'),
  validate(incidentIdParams, 'params'),
  incidentController.deleteIncident
);

module.exports = { incidentsRouter: router };
