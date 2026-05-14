'use strict';

/**
 * Smart Park OS — staff.current_ride_id
 *
 * Allows a flexible staff member to be assigned directly to a ride / show /
 * attraction (not only to a zone). When current_ride_id is set, the API
 * derives current_zone_id from the ride's zone so existing zone-based
 * aggregations keep working.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('staff', 'current_ride_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'rides', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('staff', ['current_ride_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('staff', ['current_ride_id']);
    await queryInterface.removeColumn('staff', 'current_ride_id');
  },
};
