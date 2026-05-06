const { Op } = require('sequelize');
const { IntegrationEventLog } = require('../models');

class IntegrationEventLogRepository {
  create(data) {
    return IntegrationEventLog.create(data);
  }

  findById(id) {
    return IntegrationEventLog.findByPk(id);
  }

  async findRecentByFingerprint(fingerprint, since) {
    if (!fingerprint) return null;
    return IntegrationEventLog.findOne({
      where: {
        payloadFingerprint: fingerprint,
        status: { [Op.in]: ['RECEIVED', 'PROCESSED'] },
        createdAt: { [Op.gte]: since },
      },
      order: [['createdAt', 'DESC']],
    });
  }

  findAll({ limit = 100, offset = 0 } = {}) {
    return IntegrationEventLog.findAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
  }

  count() {
    return IntegrationEventLog.count();
  }

  async markProcessed(id) {
    const row = await IntegrationEventLog.findByPk(id);
    if (!row) return null;
    await row.update({ status: 'PROCESSED', processedAt: new Date() });
    return row;
  }

  async markFailed(id, errorMessage) {
    const row = await IntegrationEventLog.findByPk(id);
    if (!row) return null;
    await row.update({ status: 'FAILED', errorMessage, processedAt: new Date() });
    return row;
  }
}

module.exports = { IntegrationEventLogRepository };
