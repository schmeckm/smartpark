const { RideWaitTimeSample } = require('../models');

class RideWaitTimeSampleRepository {
  create(data) {
    return RideWaitTimeSample.create(data);
  }

  listRecent({ provider, externalParkId, limit = 200 } = {}) {
    const where = {};
    if (provider) where.provider = provider;
    if (externalParkId) where.externalParkId = externalParkId;
    return RideWaitTimeSample.findAll({
      where,
      order: [['sampledAt', 'DESC']],
      limit,
    });
  }
}

module.exports = { RideWaitTimeSampleRepository };
