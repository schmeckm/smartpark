const { AppSetting } = require('../models');

class AppSettingRepository {
  findByKey(key) {
    return AppSetting.findOne({ where: { key } });
  }

  async getValue(key, fallback = null) {
    const row = await this.findByKey(key);
    return row ? row.value : fallback;
  }

  async upsertValue(key, value) {
    const row = await this.findByKey(key);
    if (!row) return AppSetting.create({ key, value });
    await row.update({ value });
    return row;
  }

  async deleteByKey(key) {
    const row = await this.findByKey(key);
    if (!row) return false;
    await row.destroy();
    return true;
  }
}

module.exports = { AppSettingRepository };
