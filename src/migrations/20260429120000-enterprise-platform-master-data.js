'use strict';

/**
 * Align platform MDM with enterprise model:
 * park_assets common fields, expanded specialization columns,
 * asset_targets (KPIs for all assets), asset_runtime_overrides (JSON payload).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await queryInterface.addColumn('park_assets', 'short_name', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
    await queryInterface.addColumn('park_assets', 'description', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('park_assets', 'zone_label', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('park_assets', 'active_flag', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('park_assets', 'opening_flag', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });

    await queryInterface.renameColumn('ride_master_data', 'operator_min', 'min_staff');
    await queryInterface.renameColumn('ride_master_data', 'operator_standard', 'normal_staff');
    await queryInterface.renameColumn('ride_master_data', 'operator_peak', 'peak_staff');

    await queryInterface.addColumn('ride_master_data', 'ride_category', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'trains_count', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'cycle_time_sec', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'theoretical_capacity_pph', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'max_height_cm', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'rain_sensitive', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('ride_master_data', 'plc_type', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'maintenance_class', {
      type: Sequelize.STRING(16),
      allowNull: true,
    });

    await queryInterface.createTable('asset_targets', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      target_availability_pct: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      target_wait_time_min: { type: Sequelize.INTEGER, allowNull: true },
      target_utilization_pct: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      target_oee_pct: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      revenue_priority: { type: Sequelize.STRING(32), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await sequelize.query(`
      INSERT INTO asset_targets (asset_id, target_availability_pct, target_oee_pct, created_at, updated_at)
      SELECT asset_id, target_availability, target_oee, NOW(), NOW()
      FROM ride_master_data
      WHERE target_availability IS NOT NULL OR target_oee IS NOT NULL
      ON CONFLICT (asset_id) DO NOTHING;
    `);

    await queryInterface.removeColumn('ride_master_data', 'target_oee');
    await queryInterface.removeColumn('ride_master_data', 'target_availability');

    await queryInterface.renameColumn('show_master_data', 'typical_duration_min', 'duration_min');
    await queryInterface.renameColumn('show_master_data', 'venue_type', 'venue_name');

    await queryInterface.addColumn('show_master_data', 'show_type', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'seats_capacity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'standing_capacity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'schedule_pattern', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'shows_per_day', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'first_show_time', {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'last_show_time', {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'performer_count', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'technical_staff', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'operator_staff', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'language', {
      type: Sequelize.STRING(16),
      allowNull: true,
    });
    await queryInterface.addColumn('show_master_data', 'indoor_flag', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('show_master_data', 'weather_sensitive', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('restaurant_master_data', 'restaurant_type', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'indoor_seats', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'outdoor_seats', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'max_capacity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'avg_service_time_min', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'avg_table_turnover_min', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'kitchen_capacity_orders_h', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'kitchen_staff_min', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'service_staff_min', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'peak_staff', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'avg_basket_value', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('restaurant_master_data', 'alcohol_license', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('restaurant_master_data', 'mobile_ordering', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.createTable('asset_runtime_overrides', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      valid_from: { type: Sequelize.DATE, allowNull: true },
      valid_to: { type: Sequelize.DATE, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('asset_runtime_overrides', ['asset_id'], {
      name: 'asset_runtime_overrides_asset_idx',
    });

    const rideProf = JSON.stringify({
      capacityPph: 1200,
      theoreticalCapacityPph: 1200,
      dispatchIntervalSec: 90,
      seatsPerCycle: 24,
      minStaff: 2,
      normalStaff: 3,
      peakStaff: 5,
      weatherSensitive: true,
      windLimitKmh: 65,
      minHeightCm: 140,
      thrillLevel: 4,
      targets: {
        targetAvailabilityPct: 97,
        targetWaitTimeMin: 30,
        targetUtilizationPct: 85,
        targetOeePct: 85,
        revenuePriority: 'HIGH',
      },
    });
    await sequelize.query(
      `UPDATE ride_templates SET default_profile = $1::jsonb, updated_at = NOW() WHERE code = 'RIDE_DEFAULT'`,
      { bind: [rideProf] }
    );
  },

  async down(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;
    await queryInterface.dropTable('asset_runtime_overrides');
    await queryInterface.removeColumn('restaurant_master_data', 'mobile_ordering');
    await queryInterface.removeColumn('restaurant_master_data', 'alcohol_license');
    await queryInterface.removeColumn('restaurant_master_data', 'avg_basket_value');
    await queryInterface.removeColumn('restaurant_master_data', 'peak_staff');
    await queryInterface.removeColumn('restaurant_master_data', 'service_staff_min');
    await queryInterface.removeColumn('restaurant_master_data', 'kitchen_staff_min');
    await queryInterface.removeColumn('restaurant_master_data', 'kitchen_capacity_orders_h');
    await queryInterface.removeColumn('restaurant_master_data', 'avg_table_turnover_min');
    await queryInterface.removeColumn('restaurant_master_data', 'avg_service_time_min');
    await queryInterface.removeColumn('restaurant_master_data', 'max_capacity');
    await queryInterface.removeColumn('restaurant_master_data', 'outdoor_seats');
    await queryInterface.removeColumn('restaurant_master_data', 'indoor_seats');
    await queryInterface.removeColumn('restaurant_master_data', 'restaurant_type');

    await queryInterface.removeColumn('show_master_data', 'weather_sensitive');
    await queryInterface.removeColumn('show_master_data', 'indoor_flag');
    await queryInterface.removeColumn('show_master_data', 'language');
    await queryInterface.removeColumn('show_master_data', 'operator_staff');
    await queryInterface.removeColumn('show_master_data', 'technical_staff');
    await queryInterface.removeColumn('show_master_data', 'performer_count');
    await queryInterface.removeColumn('show_master_data', 'last_show_time');
    await queryInterface.removeColumn('show_master_data', 'first_show_time');
    await queryInterface.removeColumn('show_master_data', 'shows_per_day');
    await queryInterface.removeColumn('show_master_data', 'schedule_pattern');
    await queryInterface.removeColumn('show_master_data', 'standing_capacity');
    await queryInterface.removeColumn('show_master_data', 'seats_capacity');
    await queryInterface.removeColumn('show_master_data', 'show_type');
    await queryInterface.renameColumn('show_master_data', 'venue_name', 'venue_type');
    await queryInterface.renameColumn('show_master_data', 'duration_min', 'typical_duration_min');

    await queryInterface.addColumn('ride_master_data', 'target_oee', {
      type: Sequelize.DECIMAL(6, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('ride_master_data', 'target_availability', {
      type: Sequelize.DECIMAL(6, 2),
      allowNull: true,
    });
    await sequelize.query(`
      UPDATE ride_master_data r
      SET target_oee = t.target_oee_pct,
          target_availability = t.target_availability_pct
      FROM asset_targets t
      WHERE t.asset_id = r.asset_id;
    `);
    await queryInterface.dropTable('asset_targets');

    await queryInterface.removeColumn('ride_master_data', 'maintenance_class');
    await queryInterface.removeColumn('ride_master_data', 'plc_type');
    await queryInterface.removeColumn('ride_master_data', 'rain_sensitive');
    await queryInterface.removeColumn('ride_master_data', 'max_height_cm');
    await queryInterface.removeColumn('ride_master_data', 'theoretical_capacity_pph');
    await queryInterface.removeColumn('ride_master_data', 'cycle_time_sec');
    await queryInterface.removeColumn('ride_master_data', 'trains_count');
    await queryInterface.removeColumn('ride_master_data', 'ride_category');

    await queryInterface.renameColumn('ride_master_data', 'peak_staff', 'operator_peak');
    await queryInterface.renameColumn('ride_master_data', 'normal_staff', 'operator_standard');
    await queryInterface.renameColumn('ride_master_data', 'min_staff', 'operator_min');

    await queryInterface.removeColumn('park_assets', 'opening_flag');
    await queryInterface.removeColumn('park_assets', 'active_flag');
    await queryInterface.removeColumn('park_assets', 'zone_label');
    await queryInterface.removeColumn('park_assets', 'description');
    await queryInterface.removeColumn('park_assets', 'short_name');

    const rideProf = JSON.stringify({
      capacityPph: 1200,
      dispatchIntervalSec: 90,
      seatsPerCycle: 24,
      operatorMin: 2,
      operatorStandard: 3,
      operatorPeak: 5,
      weatherSensitive: true,
      windLimitKmh: 65,
      minHeightCm: 140,
      thrillLevel: 4,
      targetOee: 85,
      targetAvailability: 97,
    });
    await queryInterface.sequelize.query(
      `UPDATE ride_templates SET default_profile = $1::jsonb, updated_at = NOW() WHERE code = 'RIDE_DEFAULT'`,
      { bind: [rideProf] }
    );
  },
};
