const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const YAML = require('yamljs');
const { authenticate } = require('../../middleware/auth.middleware');
const { attachParkContext } = require('../../middleware/park-context.middleware');
const { healthRouter } = require('./health.routes');
const { authRouter } = require('./auth.routes');
const { usersRouter } = require('./users.routes');
const { zoneRouter } = require('./zone.routes');
const { rideRouter } = require('./ride.routes');
const { crowdEventRouter } = require('./crowd-event.routes');
const { recommendationRouter } = require('./recommendation.routes');
const { dashboardRouter } = require('./dashboard.routes');
const { auditLogRouter } = require('./audit-log.routes');
const { mqttRouter } = require('./mqtt.routes');
const { integrationRouter } = require('./integration.routes');
const { weatherRouter } = require('./weather.routes');
const { importRouter } = require('./import.routes');
const { simulatorRouter } = require('./simulator.routes');
const { dataQualityRouter } = require('./data-quality.routes');
const { registerProtectedAiRoutes, aiController } = require('./ai.routes');
const { integrationsRouter } = require('./integrations.routes');
const { unsRouter } = require('../../modules/uns/uns.routes');
const { unsRegistryRouter } = require('./uns-registry.routes');
const { unsSpyRouter } = require('./uns-spy.routes');
const { mdmRouter } = require('../../modules/mdm/mdm.routes');
const {
  platformParksRouter,
  platformAssetsRouter,
  platformTemplatesRouter,
} = require('../../modules/platform/platform.routes');
const { observationsRouter } = require('../../modules/observations/observations.routes');
const { incidentsRouter } = require('./incidents.routes');
const { sqdcRouter } = require('./sqdc.routes');
const { addonBoardRouter } = require('./addon-board.routes');
const { operationsFactsRouter } = require('./operations-facts.routes');
const { platformSettingsRouter } = require('./platform-settings.routes');
const { parkMasterRidesRouter } = require('../../modules/rides/park-master.routes');
const { themeparksSyncRouter } = require('../../modules/adapters/themeparks/themeparks-sync.routes');
const { registryPublisherRouter } = require('./registry-publisher.routes');
const { trafficCorridorsGlobalRouter } = require('./traffic-corridors-global.routes');
const v1Router = Router();

const openApiPath = path.join(__dirname, '..', '..', 'openapi', 'openapi.yaml');
const openApiDocument = YAML.load(openApiPath);

v1Router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

v1Router.use('/health', healthRouter);
v1Router.use('/auth', authRouter);

v1Router.get('/ai/health', aiController.getHealth);

v1Router.use(authenticate);
v1Router.use(attachParkContext);

v1Router.use('/users', usersRouter);
v1Router.use('/zones', zoneRouter);
v1Router.use('/rides', rideRouter);
v1Router.use('/events', crowdEventRouter);
v1Router.use('/recommendations', recommendationRouter);
v1Router.use('/dashboard', dashboardRouter);
v1Router.use('/audit-logs', auditLogRouter);
v1Router.use('/mqtt', mqttRouter);
v1Router.use('/integration', integrationRouter);
v1Router.use('/weather', weatherRouter);
v1Router.use('/import', importRouter);
v1Router.use('/simulator', simulatorRouter);
v1Router.use('/data-quality', dataQualityRouter);
v1Router.use('/integrations', integrationsRouter);
v1Router.use('/uns', unsRouter);
v1Router.use('/uns-registry', unsRegistryRouter);
v1Router.use('/uns-spy', unsSpyRouter);
v1Router.use('/registry-publisher', registryPublisherRouter);
v1Router.use('/mdm', mdmRouter);
v1Router.use('/parks', platformParksRouter);
v1Router.use('/assets', platformAssetsRouter);
v1Router.use('/park-rides', parkMasterRidesRouter);
v1Router.use('/observations', observationsRouter);
v1Router.use('/incidents', incidentsRouter);
v1Router.use('/sqdc', sqdcRouter);
v1Router.use('/addon-board', addonBoardRouter);
v1Router.use('/operations-facts', operationsFactsRouter);
v1Router.use('/traffic-corridors', trafficCorridorsGlobalRouter);
v1Router.use('/admin/platform-settings', platformSettingsRouter);
v1Router.use('/sync', themeparksSyncRouter);
v1Router.use('/templates', platformTemplatesRouter);
registerProtectedAiRoutes(v1Router);

module.exports = { v1Router };
