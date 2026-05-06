'use strict';

/**
 * Phase B: optional JSONB on MDM rides for UNS / signal capability hints.
 * Platform assets continue to use park_assets.master_profile.unsAssetExtensions.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('mdm_rides', 'extensions', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('mdm_rides', 'extensions');
  },
};
