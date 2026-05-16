'use strict';

/** Latest TomTom routing poll outcome per corridor (for UI ampel / operator diagnostics). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('traffic_corridors', 'last_poll_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('traffic_corridors', 'last_poll_result');
  },
};
