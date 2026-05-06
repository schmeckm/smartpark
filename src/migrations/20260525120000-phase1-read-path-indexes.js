'use strict';

/**
 * Additive indexes for common read paths (canonical timeline, ride snapshots by park time, SQDC by day).
 * Safe: no table/column drops; down removes only these index names.
 */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('canonical_inbound_messages', ['external_park_id', 'occurred_at'], {
      name: 'idx_canonical_msgs_external_park_occurred_at',
    });
    await queryInterface.addIndex('ride_feature_snapshots_5m', ['internal_park_id', 'snapshot_at'], {
      name: 'idx_ride_feature_snapshots_5m_internal_park_snapshot_at',
    });
    await queryInterface.addIndex('sqdc_board_snapshots', ['park_id', 'business_date'], {
      name: 'idx_sqdc_board_snapshots_park_business_date',
    });
    await queryInterface.addIndex('incidents', ['park_id', 'linked_entity_id', 'created_at'], {
      name: 'idx_incidents_park_linked_entity_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('incidents', 'idx_incidents_park_linked_entity_created_at');
    await queryInterface.removeIndex('sqdc_board_snapshots', 'idx_sqdc_board_snapshots_park_business_date');
    await queryInterface.removeIndex('ride_feature_snapshots_5m', 'idx_ride_feature_snapshots_5m_internal_park_snapshot_at');
    await queryInterface.removeIndex('canonical_inbound_messages', 'idx_canonical_msgs_external_park_occurred_at');
  },
};
