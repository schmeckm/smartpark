'use strict';

/** Smart Park OS — Ride / attraction master data (MDM). Park → zone → ride; templates; 1:1 extension tables. */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await queryInterface.createTable('mdm_parks', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      timezone: { type: Sequelize.STRING(64), allowNull: true },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      future_hints: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_parks', ['active_flag']);

    await queryInterface.createTable('mdm_park_zones', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      code: { type: Sequelize.STRING(64), allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      legacy_zone_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_park_zones', ['park_id']);
    await queryInterface.addConstraint('mdm_park_zones', {
      fields: ['park_id', 'code'],
      type: 'unique',
      name: 'mdm_park_zones_park_id_code_uq',
    });

    await queryInterface.createTable('mdm_ride_types', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });

    await queryInterface.createTable('mdm_ride_templates', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      ride_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_ride_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      code: { type: Sequelize.STRING(64), allowNull: false },
      display_name: { type: Sequelize.STRING(160), allowNull: false },
      default_profile: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addConstraint('mdm_ride_templates', {
      fields: ['ride_type_id', 'code'],
      type: 'unique',
      name: 'mdm_ride_templates_type_code_uq',
    });

    await queryInterface.createTable('mdm_rides', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      park_zone_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_park_zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      ride_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_ride_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      internal_ride_id: {
        type: Sequelize.UUID,
        allowNull: true,
        unique: true,
        references: { model: 'rides', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      external_id: { type: Sequelize.STRING(255), allowNull: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      short_name: { type: Sequelize.STRING(80), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      manufacturer: { type: Sequelize.STRING(160), allowNull: true },
      model: { type: Sequelize.STRING(120), allowNull: true },
      build_year: { type: Sequelize.SMALLINT, allowNull: true },
      commissioning_date: { type: Sequelize.DATEONLY, allowNull: true },
      lifecycle_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'ACTIVE' },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_rides', ['park_id']);
    await queryInterface.addIndex('mdm_rides', ['park_zone_id']);
    await queryInterface.addIndex('mdm_rides', ['ride_type_id']);
    await queryInterface.addIndex('mdm_rides', ['active_flag']);
    await queryInterface.addIndex('mdm_rides', ['external_id']);
    await sequelize.query(`
      CREATE UNIQUE INDEX mdm_rides_park_external_id_uq ON mdm_rides (park_id, external_id)
      WHERE external_id IS NOT NULL AND trim(external_id) <> '';
    `);

    const ext = async (name, fn) => {
      await queryInterface.createTable(name, {
        ride_id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          references: { model: 'mdm_rides', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        ...fn(Sequelize),
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      });
    };

    await ext('mdm_ride_operations', (S) => ({
      planned_opening_time: { type: S.TIME, allowNull: true },
      planned_closing_time: { type: S.TIME, allowNull: true },
      seasonal_flag: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      weather_sensitive_flag: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      wind_limit_kmh: { type: S.DECIMAL(8, 2), allowNull: true },
      min_temperature_c: { type: S.DECIMAL(6, 2), allowNull: true },
      max_temperature_c: { type: S.DECIMAL(6, 2), allowNull: true },
      night_operation_flag: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
    }));

    await ext('mdm_ride_capacity', (S) => ({
      seats_per_cycle: { type: S.INTEGER, allowNull: true },
      trains_count: { type: S.INTEGER, allowNull: true },
      dispatch_interval_sec: { type: S.INTEGER, allowNull: true },
      theoretical_capacity_pph: { type: S.INTEGER, allowNull: true },
      reduced_capacity_pph: { type: S.INTEGER, allowNull: true },
      wheelchair_capacity: { type: S.INTEGER, allowNull: true },
      single_rider_flag: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
    }));

    await ext('mdm_ride_staffing', (S) => ({
      minimum_staff: { type: S.INTEGER, allowNull: true },
      standard_staff: { type: S.INTEGER, allowNull: true },
      peak_staff: { type: S.INTEGER, allowNull: true },
      required_roles_json: { type: S.JSONB, allowNull: false, defaultValue: [] },
      training_level: { type: S.STRING(64), allowNull: true },
    }));

    await ext('mdm_ride_safety', (S) => ({
      safety_class: { type: S.STRING(64), allowNull: true },
      last_inspection_date: { type: S.DATEONLY, allowNull: true },
      next_inspection_due: { type: S.DATEONLY, allowNull: true },
      maintenance_strategy: { type: S.STRING(120), allowNull: true },
      emergency_sop_code: { type: S.STRING(80), allowNull: true },
    }));

    await ext('mdm_ride_guest_rules', (S) => ({
      min_height_cm: { type: S.INTEGER, allowNull: true },
      max_height_cm: { type: S.INTEGER, allowNull: true },
      age_restriction: { type: S.STRING(120), allowNull: true },
      fastpass_enabled: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      family_friendly_flag: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      thrill_level: { type: S.SMALLINT, allowNull: true },
    }));

    await ext('mdm_ride_integration', (S) => ({
      plc_type: { type: S.STRING(64), allowNull: true },
      opcua_enabled: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      mqtt_topic_base: { type: S.STRING(500), allowNull: true },
      camera_enabled: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      queue_sensor_type: { type: S.STRING(80), allowNull: true },
      health_topic: { type: S.STRING(500), allowNull: true },
    }));

    await ext('mdm_ride_kpi_targets', (S) => ({
      target_availability_pct: { type: S.DECIMAL(6, 2), allowNull: true },
      target_oee_pct: { type: S.DECIMAL(6, 2), allowNull: true },
      target_wait_time_min: { type: S.INTEGER, allowNull: true },
      revenue_priority: { type: S.SMALLINT, allowNull: true },
      forecast_cluster: { type: S.STRING(64), allowNull: true },
    }));

    await queryInterface.createTable('mdm_ride_staff_roles', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_rides', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role_code: { type: Sequelize.STRING(64), allowNull: false },
      headcount_standard: { type: Sequelize.INTEGER, allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_ride_staff_roles', ['ride_id']);

    await queryInterface.createTable('mdm_ride_documents', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_rides', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      doc_type: { type: Sequelize.STRING(64), allowNull: false },
      title: { type: Sequelize.STRING(240), allowNull: false },
      storage_uri: { type: Sequelize.TEXT, allowNull: true },
      mime_type: { type: Sequelize.STRING(120), allowNull: true },
      checksum: { type: Sequelize.STRING(128), allowNull: true },
      valid_from: { type: Sequelize.DATEONLY, allowNull: true },
      valid_to: { type: Sequelize.DATEONLY, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_ride_documents', ['ride_id']);

    await queryInterface.createTable('mdm_ride_status_history', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'mdm_rides', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      from_status: { type: Sequelize.STRING(32), allowNull: true },
      to_status: { type: Sequelize.STRING(32), allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: true },
      changed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      changed_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    });
    await queryInterface.addIndex('mdm_ride_status_history', ['ride_id']);
    await queryInterface.addIndex('mdm_ride_status_history', ['changed_at']);

    const types = [
      ['COASTER', 'Roller coaster', 'High-thrill tracked coaster'],
      ['DARK_RIDE', 'Dark ride', 'Indoor themed ride system'],
      ['WATER_RIDE', 'Water ride', 'Flume / rapids / splash'],
      ['FLAT_RIDE', 'Flat ride', 'Carousel, pendulum, etc.'],
      ['SHOW', 'Show', 'Theatre or stunt show venue'],
      ['RESTAURANT', 'Restaurant', 'F&B outlet'],
      ['SHOP', 'Shop', 'Retail'],
    ];
    for (const [code, name, desc] of types) {
      await sequelize.query(
        `INSERT INTO mdm_ride_types (id, code, name, description, created_at, updated_at)
         VALUES (gen_random_uuid(), :code, :name, :desc, NOW(), NOW())`,
        { replacements: { code, name, desc } }
      );
    }

    const [typeRows] = await sequelize.query(`SELECT id, code FROM mdm_ride_types ORDER BY code`);
    const typeByCode = Object.fromEntries(typeRows.map((r) => [r.code, r.id]));

    const defaultProfile = (overrides = {}) => ({
      operations: {
        seasonalFlag: false,
        weatherSensitiveFlag: false,
        nightOperationFlag: false,
        ...(overrides.operations || {}),
      },
      capacity: { singleRiderFlag: false, ...(overrides.capacity || {}) },
      staffing: { requiredRolesJson: [], ...(overrides.staffing || {}) },
      safety: { ...(overrides.safety || {}) },
      guestRules: { fastpassEnabled: false, familyFriendlyFlag: true, ...(overrides.guestRules || {}) },
      integration: { opcuaEnabled: false, cameraEnabled: false, ...(overrides.integration || {}) },
      kpi: { ...(overrides.kpi || {}) },
    });

    const templates = [
      { code: 'COASTER', tcode: 'DEFAULT', name: 'Coaster default', profile: defaultProfile({ guestRules: { thrillLevel: 5 } }) },
      { code: 'DARK_RIDE', tcode: 'DEFAULT', name: 'Dark ride default', profile: defaultProfile({ guestRules: { thrillLevel: 3 } }) },
      { code: 'WATER_RIDE', tcode: 'DEFAULT', name: 'Water ride default', profile: defaultProfile({ operations: { weatherSensitiveFlag: true } }) },
      { code: 'FLAT_RIDE', tcode: 'DEFAULT', name: 'Flat ride default', profile: defaultProfile({}) },
      { code: 'SHOW', tcode: 'DEFAULT', name: 'Show default', profile: defaultProfile({ capacity: { theoreticalCapacityPph: 800 } }) },
      { code: 'RESTAURANT', tcode: 'DEFAULT', name: 'Restaurant default', profile: defaultProfile({}) },
      { code: 'SHOP', tcode: 'DEFAULT', name: 'Shop default', profile: defaultProfile({}) },
    ];

    for (const t of templates) {
      const rtid = typeByCode[t.code];
      const prof = JSON.stringify(t.profile);
      await sequelize.query(
        `INSERT INTO mdm_ride_templates (id, ride_type_id, code, display_name, default_profile, is_system, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4::jsonb, true, NOW(), NOW())`,
        { bind: [rtid, t.tcode, t.name, prof] }
      );
    }

    await sequelize.query(
      `INSERT INTO mdm_parks (id, code, name, timezone, active_flag, future_hints, created_at, updated_at)
       VALUES (gen_random_uuid(), 'europa_park', 'Europa Park', 'Europe/Berlin', true, '{"roadmap":["oee","mqtt_forecast","workforce"]}'::jsonb, NOW(), NOW())`
    );
    const [parks] = await sequelize.query(`SELECT id FROM mdm_parks WHERE code = 'europa_park' LIMIT 1`);
    const parkId = parks[0].id;
    await sequelize.query(
      `INSERT INTO mdm_park_zones (id, park_id, code, name, sort_order, created_at, updated_at)
       VALUES (gen_random_uuid(), :parkId, 'main_street', 'Main Street', 0, NOW(), NOW())`,
      { replacements: { parkId } }
    );
  },

  async down(queryInterface) {
    const tables = [
      'mdm_ride_status_history',
      'mdm_ride_documents',
      'mdm_ride_staff_roles',
      'mdm_ride_kpi_targets',
      'mdm_ride_integration',
      'mdm_ride_guest_rules',
      'mdm_ride_safety',
      'mdm_ride_staffing',
      'mdm_ride_capacity',
      'mdm_ride_operations',
      'mdm_rides',
      'mdm_ride_templates',
      'mdm_ride_types',
      'mdm_park_zones',
      'mdm_parks',
    ];
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS mdm_rides_park_external_id_uq;');
    for (const t of tables) {
      await queryInterface.dropTable(t);
    }
  },
};
