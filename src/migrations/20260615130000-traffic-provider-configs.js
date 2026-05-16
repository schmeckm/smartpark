'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('traffic_provider_configs', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      provider_key: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      display_name: { type: Sequelize.STRING(200), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      encrypted_api_key: { type: Sequelize.TEXT, allowNull: true },
      api_key_suffix: { type: Sequelize.STRING(8), allowNull: true },
      poll_interval_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      timeout_ms: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 15000 },
      base_url: { type: Sequelize.STRING(500), allowNull: false },
      created_by_user_id: { type: Sequelize.UUID, allowNull: true },
      updated_by_user_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('traffic_provider_configs', ['provider_key'], {
      name: 'traffic_provider_configs_provider_key_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('traffic_provider_configs');
  },
};
