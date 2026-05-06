'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('adapter_run_logs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      adapter_key: { type: Sequelize.STRING(120), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false },
      observation_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      valid_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      invalid_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('adapter_run_logs', ['adapter_key', 'created_at'], {
      name: 'idx_adapter_run_logs_key_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('adapter_run_logs');
  },
};
