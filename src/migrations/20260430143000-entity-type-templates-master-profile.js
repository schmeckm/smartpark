'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('park_assets', 'master_profile').catch(() => {});
    await queryInterface.removeColumn('park_assets', 'template_id').catch(() => {});
    await queryInterface.removeColumn('parks', 'master_profile').catch(() => {});
    await queryInterface.removeColumn('parks', 'template_id').catch(() => {});
    await queryInterface.dropTable('entity_type_templates').catch(() => {});

    await queryInterface.createTable('entity_type_templates', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      entity_type: { type: Sequelize.STRING(32), allowNull: false },
      template_code: { type: Sequelize.STRING(64), allowNull: false },
      template_name: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      default_values_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      required_fields_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      calculated_fields_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      validation_rules_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addConstraint('entity_type_templates', {
      fields: ['entity_type', 'template_code'],
      type: 'unique',
      name: 'entity_type_templates_uq_entity_template_code',
    });
    await queryInterface.addIndex('entity_type_templates', ['entity_type', 'active_flag'], {
      name: 'entity_type_templates_entity_type_active_idx',
    });

    await queryInterface.addColumn('parks', 'template_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'entity_type_templates', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('parks', 'master_profile', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });

    await queryInterface.addColumn('park_assets', 'template_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'entity_type_templates', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('park_assets', 'master_profile', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });

    const now = new Date();
    const rollerDefaults = {
      ride_type: 'ROLLER_COASTER',
      indoor_outdoor: 'OUTDOOR',
      employees_required_min: 2,
      employees_required_normal: 4,
      employees_required_peak: 6,
      weather_sensitive: true,
      rain_sensitive: true,
      wind_sensitive: true,
      queue_prediction_enabled: true,
      capacity_optimization_enabled: true,
      maintenance_criticality: 'HIGH',
      downtime_impact_level: 'HIGH',
      max_queue_time_target_min: 45,
    };
    const rollerRequired = [
      'ride_type',
      'employees_required_min',
      'employees_required_normal',
      'employees_required_peak',
    ];

    const seeds = [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        entity_type: 'PARK',
        template_code: 'THEME_PARK',
        template_name: 'Theme park',
        description: 'Large outdoor theme park defaults',
        default_values_json: JSON.stringify({
          season_type: 'SEASONAL',
          visitor_forecast_enabled: true,
          default_currency: 'EUR',
        }),
        required_fields_json: JSON.stringify(['park_name', 'timezone']),
        calculated_fields_json: JSON.stringify([]),
        validation_rules_json: JSON.stringify({}),
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        entity_type: 'RIDE',
        template_code: 'ROLLER_COASTER',
        template_name: 'Roller coaster',
        description: 'High-throughput coaster profile',
        default_values_json: JSON.stringify(rollerDefaults),
        required_fields_json: JSON.stringify(rollerRequired),
        calculated_fields_json: JSON.stringify(['calculated_capacity_per_hour', 'effective_capacity_per_hour']),
        validation_rules_json: JSON.stringify({
          dispatch_interval_sec: { min: 1 },
          seats_per_vehicle: { min: 0 },
          vehicles_count: { min: 0 },
        }),
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000003',
        entity_type: 'RIDE',
        template_code: 'DARK_RIDE',
        template_name: 'Dark ride',
        description: 'Indoor tracked dark ride',
        default_values_json: JSON.stringify({
          ride_type: 'DARK_RIDE',
          indoor_outdoor: 'INDOOR',
          weather_sensitive: false,
          rain_sensitive: false,
          wind_sensitive: false,
          queue_prediction_enabled: true,
        }),
        required_fields_json: JSON.stringify(['ride_type', 'employees_required_normal']),
        calculated_fields_json: JSON.stringify([]),
        validation_rules_json: JSON.stringify({}),
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000004',
        entity_type: 'SHOW',
        template_code: 'INDOOR_THEATER_SHOW',
        template_name: 'Indoor theater show',
        default_values_json: JSON.stringify({
          show_type: 'THEATER',
          indoor_outdoor: 'INDOOR',
          attendance_prediction_enabled: true,
        }),
        required_fields_json: JSON.stringify(['show_type', 'venue_capacity']),
        calculated_fields_json: JSON.stringify(['theoretical_guests_per_day']),
        validation_rules_json: JSON.stringify({
          venue_capacity: { min: 0 },
          show_duration_min: { min: 1 },
        }),
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000005',
        entity_type: 'RESTAURANT',
        template_code: 'QUICK_SERVICE',
        template_name: 'Quick service restaurant',
        default_values_json: JSON.stringify({
          restaurant_type: 'QUICK_SERVICE',
          service_model: 'COUNTER',
          demand_forecast_enabled: true,
        }),
        required_fields_json: JSON.stringify(['restaurant_type', 'seating_capacity']),
        calculated_fields_json: JSON.stringify([
          'calculated_service_capacity_per_hour',
          'calculated_seating_throughput_per_hour',
        ]),
        validation_rules_json: JSON.stringify({
          avg_service_time_min: { min: 0.01 },
          seating_capacity: { min: 0 },
        }),
        active_flag: true,
        created_at: now,
        updated_at: now,
      },
    ];

    await queryInterface.bulkInsert('entity_type_templates', seeds);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('park_assets', 'master_profile');
    await queryInterface.removeColumn('park_assets', 'template_id');
    await queryInterface.removeColumn('parks', 'master_profile');
    await queryInterface.removeColumn('parks', 'template_id');
    await queryInterface.dropTable('entity_type_templates');
  },
};
