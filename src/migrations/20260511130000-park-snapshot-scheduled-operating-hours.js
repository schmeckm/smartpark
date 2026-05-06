'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('park_feature_snapshots_5m', 'within_scheduled_operating_hours', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      comment:
        'True/false if bucket midpoint is inside provider opening_times for local_date; null if unknown.',
    });
    await queryInterface.addColumn('park_feature_snapshots_5m', 'scheduled_operating_snapshot_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'sampled_at of park_operating_snapshots row used for evaluation.',
    });

    await queryInterface.sequelize.query(`
CREATE OR REPLACE VIEW park_operational_context_v AS
SELECT
  f.internal_park_id,
  p.name AS park_name,
  p.slug AS park_slug,
  p.timezone AS park_timezone,
  f.provider,
  f.external_park_id,
  f.snapshot_at,
  f.local_date,
  f.local_hour,
  f.within_scheduled_operating_hours,
  f.scheduled_operating_snapshot_at,
  f.visitors_estimate,
  f.is_public_holiday,
  f.is_school_holiday,
  f.holiday_name,
  f.rides_reporting,
  f.rides_open,
  f.open_ratio,
  f.updated_at
FROM park_feature_snapshots_5m f
LEFT JOIN parks p ON p.id = f.internal_park_id;
`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS park_operational_context_v;');
    await queryInterface.removeColumn('park_feature_snapshots_5m', 'scheduled_operating_snapshot_at');
    await queryInterface.removeColumn('park_feature_snapshots_5m', 'within_scheduled_operating_hours');
  },
};
