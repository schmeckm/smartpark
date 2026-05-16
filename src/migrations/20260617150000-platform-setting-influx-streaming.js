'use strict';

const { PLATFORM_SETTING_REGISTRY } = require('../constants/platform-settings.registry');

const SETTING_KEY = 'INFLUX_OT_STREAMING_ENABLED';

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      `SELECT setting_key FROM platform_settings WHERE setting_key = :key LIMIT 1`,
      { replacements: { key: SETTING_KEY } }
    );
    if (existing && existing.length) return;

    const meta = PLATFORM_SETTING_REGISTRY[SETTING_KEY];
    const now = new Date();
    await queryInterface.bulkInsert('platform_settings', [
      {
        setting_key: SETTING_KEY,
        setting_value: meta.codeDefault ? 'true' : 'false',
        value_type: meta.valueType,
        category: meta.category,
        description: meta.description,
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('platform_settings', { setting_key: SETTING_KEY });
  },
};
