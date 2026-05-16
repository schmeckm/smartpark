'use strict';

/** Align DB row key with adapter package `traffic_tomtom` (modular traffic adapters). */
module.exports = {
  /** @param {import('sequelize').QueryInterface} queryInterface */
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE traffic_provider_configs SET provider_key = 'traffic_tomtom' WHERE provider_key = 'tomtom'`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE traffic_provider_configs SET provider_key = 'tomtom' WHERE provider_key = 'traffic_tomtom'`
    );
  },
};
