const { createApp } = require('./src/app');
const env = require('./src/config/env');
const { sequelize } = require('./src/models');
const { startMqttSubscriber } = require('./src/mqtt/mqtt-subscriber.service');
const { startFeatureSnapshotJob } = require('./src/jobs/feature-snapshot.job');

async function main() {
  await sequelize.authenticate();
  const app = createApp();
  startMqttSubscriber();
  startFeatureSnapshotJob();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`TP-UNS backend running on :${env.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Startup failed:', err);
  process.exit(1);
});
