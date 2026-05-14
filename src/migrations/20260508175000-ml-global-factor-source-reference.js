'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ml_global_factors', 'adapter_key', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
    await queryInterface.addColumn('ml_global_factors', 'mqtt_topic', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ml_global_factors', 'mqtt_topic');
    await queryInterface.removeColumn('ml_global_factors', 'adapter_key');
  },
};
