'use strict';

/**
 * Replaces the single UNIQUE on (scope, provider, …, external_entity_id, …) with two
 * partial unique indexes so park-level rows (external_entity_id IS NULL) cannot duplicate.
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {import('sequelize').Sequelize} Sequelize
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex(
      'forecast_training_labels',
      'uq_forecast_training_labels_scope_provider_park_entity_base_horizon'
    );

    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY scope, provider, external_park_id, base_snapshot_at, horizon_minutes,
                   COALESCE(external_entity_id, '')
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM forecast_training_labels
      )
      DELETE FROM forecast_training_labels f
      USING ranked r
      WHERE f.id = r.id AND r.rn > 1;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_ftl_park_provider_park_base_horizon_null_entity
      ON forecast_training_labels (provider, external_park_id, base_snapshot_at, horizon_minutes)
      WHERE external_entity_id IS NULL;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_ftl_entity_provider_park_entity_base_horizon
      ON forecast_training_labels (provider, external_park_id, external_entity_id, base_snapshot_at, horizon_minutes)
      WHERE external_entity_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_ftl_entity_provider_park_entity_base_horizon;'
    );
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_ftl_park_provider_park_base_horizon_null_entity;'
    );

    await queryInterface.addIndex(
      'forecast_training_labels',
      ['scope', 'provider', 'external_park_id', 'external_entity_id', 'base_snapshot_at', 'horizon_minutes'],
      {
        unique: true,
        name: 'uq_forecast_training_labels_scope_provider_park_entity_base_horizon',
      }
    );
  },
};
