'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('asset_downtime_events', {
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
      started_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true },
      planned: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      reason_code: { type: Sequelize.STRING(64), allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'manual' },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('asset_downtime_events', ['asset_id', 'started_at'], {
      name: 'idx_asset_downtime_events_asset_started',
    });
    await queryInterface.addIndex('asset_downtime_events', ['park_id', 'started_at'], {
      name: 'idx_asset_downtime_events_park_started',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('asset_downtime_events');
  },
};
