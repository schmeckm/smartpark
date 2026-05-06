'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ride_master_data', 'max_speed_kmh', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'structure_height_m', {
      type: Sequelize.DECIMAL(6, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'track_length_m', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ride_master_data', 'max_speed_kmh');
    await queryInterface.removeColumn('ride_master_data', 'structure_height_m');
    await queryInterface.removeColumn('ride_master_data', 'track_length_m');
  },
};
