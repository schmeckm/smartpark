const { AdapterPackage } = require('../models');

/** Primary key is UUID; Sequelize still issues WHERE id = $1 and Postgres rejects slug strings (22P02). */
function isUuidPk(id) {
  const t = String(id || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

class AdapterPackageRepository {
  findAll() {
    return AdapterPackage.findAll({ order: [['adapterKey', 'ASC']] });
  }

  findByPk(id) {
    if (!isUuidPk(id)) return Promise.resolve(null);
    return AdapterPackage.findByPk(id);
  }

  findByAdapterKey(adapterKey) {
    return AdapterPackage.findOne({ where: { adapterKey } });
  }

  async upsertByAdapterKey(adapterKey, patch) {
    const row = await this.findByAdapterKey(adapterKey);
    if (!row) return AdapterPackage.create({ adapterKey, ...patch });
    await row.update(patch);
    return row;
  }
}

module.exports = { AdapterPackageRepository };
