const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { runScenarioSchema } = require('../../validators/simulator.schemas');
const {
  attractionOeeStartBody,
  attractionOeeScenarioBody,
  attractionOeeCandidatesQuery,
} = require('../../validators/attraction-oee-simulator.schemas');
const simulatorController = require('../../controllers/simulator.controller');
const attractionOeeController = require('../../controllers/attraction-oee-simulator.controller');

const router = Router();

router.get('/status', requirePermission('integration', 'read'), simulatorController.status);
router.post('/start', requirePermission('simulator', 'run'), simulatorController.start);
router.post('/stop', requirePermission('simulator', 'run'), simulatorController.stop);
router.post(
  '/scenario',
  requirePermission('simulator', 'run'),
  validate(runScenarioSchema),
  simulatorController.scenario
);

const oeeRouter = Router();
oeeRouter.get(
  '/candidates',
  requirePermission('rides', 'read'),
  validate(attractionOeeCandidatesQuery, 'query'),
  attractionOeeController.listCandidates
);
oeeRouter.get('/status', requirePermission('integration', 'read'), attractionOeeController.status);
oeeRouter.post(
  '/start',
  requirePermission('simulator', 'run'),
  validate(attractionOeeStartBody),
  attractionOeeController.start
);
oeeRouter.post('/stop', requirePermission('simulator', 'run'), attractionOeeController.stop);
oeeRouter.post(
  '/scenario',
  requirePermission('simulator', 'run'),
  validate(attractionOeeScenarioBody),
  attractionOeeController.scenario
);
router.use('/attraction-oee', oeeRouter);

module.exports = { simulatorRouter: router };
