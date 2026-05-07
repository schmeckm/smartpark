const { internalBus } = require('../mqtt/mqtt-subscriber.service');
const { FeatureSnapshotService } = require('../services/feature-snapshot.service');

const featureSnapshotService = new FeatureSnapshotService();

function startFeatureSnapshotJob() {
  internalBus.on('canonical-event-created', async (event) => {
    try {
      await featureSnapshotService.createFeatureSnapshot(event.parkId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Feature snapshot job failed:', err.message);
    }
  });
}

module.exports = { startFeatureSnapshotJob };
