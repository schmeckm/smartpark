const { ExternalEntityMapping } = require('../models');

class ExternalEntityMappingRepository {
  findAll({ provider, parkId, status, limit = 300 } = {}) {
    const where = {};
    if (provider) where.provider = provider;
    if (parkId) where.externalParkId = parkId;
    if (status) where.mappingStatus = status;
    return ExternalEntityMapping.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit,
    });
  }

  findById(id) {
    return ExternalEntityMapping.findByPk(id);
  }

  findByExternalKey(key, opts = {}) {
    return ExternalEntityMapping.findOne({
      where: { provider: key.provider, externalParkId: key.externalParkId, externalEntityId: key.externalEntityId },
      ...opts,
    });
  }

  async upsertByExternalKey(key, data, opts = {}) {
    const row = await this.findByExternalKey(key, { transaction: opts.transaction });
    if (!row) return ExternalEntityMapping.create({ ...key, ...data }, { transaction: opts.transaction });
    await row.update(data, { transaction: opts.transaction });
    return row;
  }
}

module.exports = { ExternalEntityMappingRepository };
