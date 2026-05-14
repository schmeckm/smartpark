'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('park_asset_pdm_evaluation_logs', {
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
      source: { type: Sequelize.STRING(32), allowNull: false },
      evaluated_at: { type: Sequelize.DATE, allowNull: false },
      risk_level: { type: Sequelize.STRING(16), allowNull: false },
      fingerprint: { type: Sequelize.STRING(64), allowNull: false },
      snapshot_json: { type: Sequelize.JSONB, allowNull: false },
    });

    await queryInterface.addIndex('park_asset_pdm_evaluation_logs', ['park_id', 'asset_id', 'evaluated_at'], {
      name: 'idx_pdm_eval_logs_park_asset_evaluated',
    });
    await queryInterface.addIndex('park_asset_pdm_evaluation_logs', ['park_id', 'asset_id', 'fingerprint'], {
      name: 'idx_pdm_eval_logs_park_asset_fingerprint',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('park_asset_pdm_evaluation_logs');
  },
};
