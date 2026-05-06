'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ride_master_data', 'planned_cycle_time_sec', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Planned ride cycle duration (MD); live OPC can override via opc_reference_cycle_time_sec',
    });
    await queryInterface.addColumn('ride_master_data', 'opc_reference_cycle_time_sec', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Last OPC/measured cycle time snapshot (s); simulator prefers this over planned when set',
    });
    await queryInterface.addColumn('ride_master_data', 'max_queue_guests', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Max guests in queue area before overcapacity warning; null = heuristic from seats×trains',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ride_master_data', 'planned_cycle_time_sec');
    await queryInterface.removeColumn('ride_master_data', 'opc_reference_cycle_time_sec');
    await queryInterface.removeColumn('ride_master_data', 'max_queue_guests');
  },
};
