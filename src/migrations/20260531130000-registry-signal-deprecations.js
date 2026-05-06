'use strict';

/** Phase 11 — per ride asset + signal_key legacy deprecation governance (additive). */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('registry_signal_deprecations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      ride_asset_id: { type: Sequelize.UUID, allowNull: false },
      signal_key: { type: Sequelize.STRING(128), allowNull: false },
      signal_catalog_id: { type: Sequelize.UUID, allowNull: true },
      registry_authoritative: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      legacy_fallback_disabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      legacy_publish_disabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      validation_started_at: { type: Sequelize.DATE, allowNull: true },
      authoritative_marked_at: { type: Sequelize.DATE, allowNull: true },
      legacy_fallback_disabled_at: { type: Sequelize.DATE, allowNull: true },
      legacy_publish_disabled_at: { type: Sequelize.DATE, allowNull: true },
      last_health_pass_at: { type: Sequelize.DATE, allowNull: true },
      stability_window_started_at: { type: Sequelize.DATE, allowNull: true },
      updated_by_user_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('registry_signal_deprecations', {
      fields: ['ride_asset_id'],
      type: 'foreign key',
      name: 'registry_signal_deprecations_ride_asset_fk',
      references: { table: 'park_assets', field: 'asset_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addConstraint('registry_signal_deprecations', {
      fields: ['signal_catalog_id'],
      type: 'foreign key',
      name: 'registry_signal_deprecations_signal_catalog_fk',
      references: { table: 'signal_catalog', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addConstraint('registry_signal_deprecations', {
      fields: ['updated_by_user_id'],
      type: 'foreign key',
      name: 'registry_signal_deprecations_updated_by_user_fk',
      references: { table: 'users', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addConstraint('registry_signal_deprecations', {
      type: 'unique',
      name: 'registry_signal_deprecations_ride_signal_uq',
      fields: ['ride_asset_id', 'signal_key'],
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE registry_signal_deprecations
      ADD CONSTRAINT registry_signal_deprecations_fallback_requires_authoritative
      CHECK (legacy_fallback_disabled = false OR registry_authoritative = true);
    `);

    await queryInterface.addIndex('registry_signal_deprecations', ['ride_asset_id'], {
      name: 'registry_signal_deprecations_ride_asset_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('registry_signal_deprecations');
  },
};
