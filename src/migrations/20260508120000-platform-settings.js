'use strict';

const { PLATFORM_SETTING_REGISTRY, PLATFORM_SETTING_KEYS } = require('../constants/platform-settings.registry');

function seedRows() {
  const now = new Date();
  return PLATFORM_SETTING_KEYS.map((settingKey) => {
    const meta = PLATFORM_SETTING_REGISTRY[settingKey];
    let settingValue;
    if (meta.valueType === 'boolean') settingValue = meta.codeDefault ? 'true' : 'false';
    else if (meta.valueType === 'number') settingValue = String(meta.codeDefault);
    else settingValue = String(meta.codeDefault ?? '');
    return {
      setting_key: settingKey,
      setting_value: settingValue,
      value_type: meta.valueType,
      category: meta.category,
      description: meta.description,
      active_flag: true,
      created_at: now,
      updated_at: now,
    };
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('platform_settings', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
      },
      setting_key: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      setting_value: { type: Sequelize.TEXT, allowNull: false },
      value_type: { type: Sequelize.STRING(32), allowNull: false },
      category: { type: Sequelize.STRING(64), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('platform_settings', ['category'], {
      name: 'platform_settings_category_idx',
    });
    await queryInterface.bulkInsert('platform_settings', seedRows());
  },

  async down(queryInterface) {
    await queryInterface.dropTable('platform_settings');
  },
};
