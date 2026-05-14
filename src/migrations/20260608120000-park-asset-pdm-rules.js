'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('park_asset_pdm_rules', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      label: { type: Sequelize.STRING(200), allowNull: true },
      metric_name: { type: Sequelize.STRING(160), allowNull: false },
      warn_above: { type: Sequelize.DOUBLE, allowNull: true },
      critical_above: { type: Sequelize.DOUBLE, allowNull: true },
      warn_below: { type: Sequelize.DOUBLE, allowNull: true },
      critical_below: { type: Sequelize.DOUBLE, allowNull: true },
      unit: { type: Sequelize.STRING(32), allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('park_asset_pdm_rules', {
      type: 'unique',
      name: 'uq_park_asset_pdm_rules_asset_metric',
      fields: ['asset_id', 'metric_name'],
    });

    await queryInterface.addIndex('park_asset_pdm_rules', ['park_id', 'asset_id'], {
      name: 'idx_park_asset_pdm_rules_park_asset',
    });
    await queryInterface.addIndex('park_asset_pdm_rules', ['asset_id', 'enabled'], {
      name: 'idx_park_asset_pdm_rules_asset_enabled',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('park_asset_pdm_rules');
  },
};
