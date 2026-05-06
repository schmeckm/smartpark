'use strict';

/**
 * Provider snapshot + curated enrichment JSON + sync metadata for master-data CRUD
 * and safe ThemeParks re-sync (field locks in enrichment.locks).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const jsonb = { type: Sequelize.JSONB, allowNull: false, defaultValue: Sequelize.literal("'{}'::jsonb") };
    const ts = { type: Sequelize.DATE, allowNull: true };

    for (const table of ['parks', 'park_assets']) {
      await queryInterface.addColumn(table, 'provider_snapshot', jsonb);
      await queryInterface.addColumn(table, 'enrichment', jsonb);
      await queryInterface.addColumn(table, 'sync_managed', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
      await queryInterface.addColumn(table, 'last_synced_at', ts);
    }
  },

  async down(queryInterface) {
    for (const table of ['park_assets', 'parks']) {
      await queryInterface.removeColumn(table, 'last_synced_at');
      await queryInterface.removeColumn(table, 'sync_managed');
      await queryInterface.removeColumn(table, 'enrichment');
      await queryInterface.removeColumn(table, 'provider_snapshot');
    }
  },
};
