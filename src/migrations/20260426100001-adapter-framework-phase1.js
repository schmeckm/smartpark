'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('adapter_packages', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      adapter_key: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      version: { type: Sequelize.STRING(40), allowNull: false },
      runtime: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'NODE' },
      adapter_type: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'PUBLIC_API' },
      source_type: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'LOCAL_PACKAGE' },
      source_path: { type: Sequelize.STRING(500), allowNull: true },
      capabilities: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      config_schema: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      permissions: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'INSTALLED' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('adapter_packages', ['enabled', 'status'], { name: 'idx_adapter_packages_enabled_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('adapter_packages');
  },
};
