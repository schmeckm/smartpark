const { ProviderAdapterConfig } = require('../models');

class ProviderAdapterConfigRepository {
  findAll() {
    return ProviderAdapterConfig.findAll({ order: [['provider', 'ASC']] });
  }

  findByProvider(provider) {
    return ProviderAdapterConfig.findOne({ where: { provider } });
  }

  async upsertByProvider(provider, data) {
    const row = await this.findByProvider(provider);
    if (!row) {
      return ProviderAdapterConfig.create({ provider, ...data });
    }
    await row.update(data);
    return row;
  }
}

module.exports = { ProviderAdapterConfigRepository };
