const env = require('../config/env');
const { logger } = require('../utils/logger');
const { ZoneRepository } = require('../repositories/zone.repository');
const { ZoneCrowdSampleRepository } = require('../repositories/zone-crowd-sample.repository');

class ZoneCrowdSamplingService {
  constructor() {
    this.zoneRepository = new ZoneRepository();
    this.sampleRepository = new ZoneCrowdSampleRepository();
  }

  /**
   * Record current crowd for every active zone.
   * @returns {Promise<{ count: number }>}
   */
  async sampleAllZones() {
    const zones = await this.zoneRepository.findAllActive();
    const at = new Date();
    const rows = zones.map((z) => {
      const cap = Math.max(1, Number(z.maxCapacity) || 1);
      const level = Math.max(0, Number(z.currentCrowdLevel) || 0);
      return {
        zoneId: z.id,
        crowdLevel: level,
        crowdRatio: level / cap,
        source: 'zone-sampler',
        sampledAt: at,
        createdAt: at,
      };
    });
    if (rows.length === 0) {
      return { count: 0 };
    }
    try {
      await this.sampleRepository.bulkCreate(rows);
    } catch (e) {
      logger.warn({ err: e.message }, 'zone crowd sampling failed');
      throw e;
    }
    return { count: rows.length };
  }

  /**
   * @returns {() => void} disposer
   */
  startIntervalIfEnabled() {
    if (!env.aiSamplingEnabled) {
      return () => {};
    }
    const ms = env.aiSamplingIntervalSeconds * 1000;
    const id = setInterval(() => {
      this.sampleAllZones().catch((e) => logger.warn({ err: e.message }, 'background zone sampling error'));
    }, ms);
    return () => clearInterval(id);
  }
}

module.exports = { ZoneCrowdSamplingService };
