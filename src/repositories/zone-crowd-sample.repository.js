const { Op } = require('sequelize');
const { ZoneCrowdSample } = require('../models');

class ZoneCrowdSampleRepository {
  bulkCreate(records) {
    return ZoneCrowdSample.bulkCreate(records, { validate: true, returning: true });
  }

  findRecentByZoneId(zoneId, { since, limit = 40 }) {
    return ZoneCrowdSample.findAll({
      where: {
        zoneId,
        sampledAt: { [Op.gte]: since },
      },
      order: [['sampledAt', 'ASC']],
      limit,
    });
  }
}

module.exports = { ZoneCrowdSampleRepository };
