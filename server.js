const http = require('http');
require('./src/config/env');
const { app } = require('./src/app');
const env = require('./src/config/env');
const { sequelize } = require('./src/models');
const { initSocket } = require('./src/sockets');
const { startMqtt } = require('./src/services/mqtt-connector.service');
const { AiOrchestratorService } = require('./src/services/ai-orchestrator.service');
const { IntegrationOrchestratorService } = require('./src/services/integration-orchestrator.service');
const { AdapterInstalledSchedulerService } = require('./src/services/adapter-installed-scheduler.service');
const { WeatherOpenMeteoSchedulerService } = require('./src/services/weather-open-meteo-scheduler.service');
const { logger } = require('./src/utils/logger');
const { getPlatformSettingsService } = require('./src/services/platform-settings.service');
const {
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
} = require('./src/services/attraction-oee-simulator.service');
const { MlTrainingSchedulerService } = require('./src/services/ml/ml-training-scheduler.service');
const { buildFeatureFlagReport } = require('./src/bootstrap/feature-flags.report');

const port = env.port;

async function start() {
  logger.info({ flags: buildFeatureFlagReport(env) }, 'feature flags resolved');

  await sequelize.authenticate();
  logger.info('database connection established');

  await getPlatformSettingsService().warmupCache();

  const server = http.createServer(app);
  initSocket(server);

  const stopAi = await new AiOrchestratorService().startIfEnabled();
  const integrationOrchestrator = new IntegrationOrchestratorService();
  await integrationOrchestrator.bootstrap();
  const stopExternalIntegrations = integrationOrchestrator.startPollingIfEnabled();
  const stopInstalledAdapterScheduler = await new AdapterInstalledSchedulerService().start();
  const stopWeatherOpenMeteo = await new WeatherOpenMeteoSchedulerService().start();
  const stopMlTraining = await new MlTrainingSchedulerService().start();
  process.on('beforeExit', () => stopAi());
  process.on('beforeExit', () => stopExternalIntegrations());
  process.on('beforeExit', () => stopInstalledAdapterScheduler());
  process.on('beforeExit', () => stopWeatherOpenMeteo());
  process.on('beforeExit', () => stopMlTraining());

  server.listen(port, () => {
    logger.info({ port }, 'Smart Park OS API listening');
    startMqtt();
    if (env.simOeeEnabled && env.simOeeAutoStart) {
      startAttractionOeeSimulator({})
        .then((r) => logger.info({ r }, 'attraction OEE simulator auto-start'))
        .catch((e) => logger.warn({ err: e.message }, 'attraction OEE simulator auto-start failed'));
    }
  });

  process.on('SIGTERM', () => {
    stopAttractionOeeSimulator().catch(() => {});
  });
  process.on('SIGINT', () => {
    stopAttractionOeeSimulator().catch(() => {});
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
