'use strict';

const env = require('../../config/env');
const { logger } = require('../../utils/logger');
const { deleteSnapshotsOlderThan } = require('./traffic-corridor-snapshot.repository');

class TrafficSnapshotRetentionSchedulerService {
  constructor() {
    this._timer = null;
  }

  async _tick() {
    const days = env.trafficSnapshotRetentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const deleted = await deleteSnapshotsOlderThan(cutoff);
      if (deleted > 0) {
        logger.info({ deleted, olderThan: cutoff.toISOString(), retentionDays: days }, 'traffic-snapshot-retention: purged rows');
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'traffic-snapshot-retention: tick failed');
    }
  }

  async start() {
    if (!env.trafficSnapshotRetentionSchedulerEnabled) {
      logger.info('traffic-snapshot-retention: scheduler disabled');
      return null;
    }
    const intervalMs = env.trafficSnapshotRetentionIntervalSeconds * 1000;
    await this._tick();
    this._timer = setInterval(() => {
      this._tick().catch((e) => logger.warn({ err: e?.message }, 'traffic-snapshot-retention: interval error'));
    }, intervalMs);
    logger.info(
      { intervalSeconds: env.trafficSnapshotRetentionIntervalSeconds, retentionDays: env.trafficSnapshotRetentionDays },
      'traffic-snapshot-retention: started'
    );
    return () => this.stop();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { TrafficSnapshotRetentionSchedulerService };
