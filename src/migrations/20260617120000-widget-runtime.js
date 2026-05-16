'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dashboard_widget_registry', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      widget_key: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      display_name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(128), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      component_name: { type: Sequelize.STRING(128), allowNull: false },
      config_schema: { type: Sequelize.JSONB, allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.createTable('dashboard_data_source_registry', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      data_source_key: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      display_name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(128), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      source_type: { type: Sequelize.STRING(64), allowNull: false },
      endpoint: { type: Sequelize.STRING(512), allowNull: true },
      refresh_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.createTable('dashboard_widget_instances', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      widget_key: { type: Sequelize.STRING(128), allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      widget_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      data_source_key: { type: Sequelize.STRING(128), allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: Sequelize.STRING(255), allowNull: true },
      updated_by: { type: Sequelize.STRING(255), allowNull: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dashboard_widget_instances', ['widget_key'], {
      name: 'idx_dashboard_widget_instances_widget_key',
    });
    await queryInterface.addIndex('dashboard_widget_instances', ['data_source_key'], {
      name: 'idx_dashboard_widget_instances_data_source_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dashboard_widget_instances');
    await queryInterface.dropTable('dashboard_data_source_registry');
    await queryInterface.dropTable('dashboard_widget_registry');
  },
};
