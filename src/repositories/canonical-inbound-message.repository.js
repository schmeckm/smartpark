const { CanonicalInboundMessage } = require('../models');

class CanonicalInboundMessageRepository {
  createMany(rows) {
    if (!rows.length) return Promise.resolve([]);
    return CanonicalInboundMessage.bulkCreate(rows, { returning: true });
  }

  findById(id) {
    return CanonicalInboundMessage.findByPk(id);
  }

  findAll({ provider, externalParkId, status, messageType, limit = 100, offset = 0 } = {}) {
    const where = {};
    if (provider) where.provider = provider;
    if (externalParkId) where.externalParkId = externalParkId;
    if (status) where.status = status;
    if (messageType) where.messageType = messageType;
    return CanonicalInboundMessage.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
  }

  async updateById(id, data) {
    const row = await CanonicalInboundMessage.findByPk(id);
    if (!row) return null;
    await row.update(data);
    return row;
  }
}

module.exports = { CanonicalInboundMessageRepository };
