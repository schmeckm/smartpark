'use strict';

/** Park geo for Open-Meteo scheduler; optional WMO code on weather rows for auditing. */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('parks', 'latitude', {
      type: Sequelize.DOUBLE,
      allowNull: true,
    });
    await queryInterface.addColumn('parks', 'longitude', {
      type: Sequelize.DOUBLE,
      allowNull: true,
    });
    await queryInterface.addColumn('weather_observations', 'weather_code', {
      type: Sequelize.SMALLINT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('weather_observations', 'weather_code');
    await queryInterface.removeColumn('parks', 'longitude');
    await queryInterface.removeColumn('parks', 'latitude');
  },
};
