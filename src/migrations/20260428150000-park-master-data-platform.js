'use strict';

/**
 * Enterprise park master data: parks → zones → park_assets (generic) + specialization
 * + templates + asset_observations (live metrics; never queue in master tables).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await queryInterface.createTable('asset_types', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    const assetTypeCodes = [
      ['PARK', 'Park', 'Park root or destination park'],
      ['RIDE', 'Ride / attraction', 'Thrill and family rides'],
      ['SHOW', 'Show', 'Theatre and entertainment'],
      ['RESTAURANT', 'Restaurant', 'Food & beverage'],
      ['SHOP', 'Shop', 'Retail'],
      ['HOTEL', 'Hotel', 'Lodging'],
      ['FACILITY', 'Facility', 'General facility'],
      ['TOILET', 'Toilet', 'Restroom'],
      ['ENTRANCE', 'Entrance', 'Gate or entrance'],
      ['PARKING', 'Parking', 'Parking area'],
      ['SERVICE_POINT', 'Service point', 'Guest services, first aid, etc.'],
    ];
    for (const [code, name, desc] of assetTypeCodes) {
      await sequelize.query(
        `INSERT INTO asset_types (id, code, name, description, sort_order, created_at, updated_at)
         VALUES (gen_random_uuid(), :code, :name, :desc, 0, NOW(), NOW())`,
        { replacements: { code, name, desc } }
      );
    }

    await queryInterface.createTable('parks', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      slug: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      timezone: { type: Sequelize.STRING(64), allowNull: true },
      external_source: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'THEMEPARKS_WIKI' },
      external_entity_id: { type: Sequelize.STRING(64), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await sequelize.query(`
      CREATE UNIQUE INDEX parks_external_source_entity_uq ON parks (external_source, external_entity_id)
      WHERE external_entity_id IS NOT NULL AND trim(external_entity_id) <> '';
    `);

    await queryInterface.createTable('park_zones', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      slug: { type: Sequelize.STRING(128), allowNull: false },
      parent_zone_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'park_zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      external_entity_id: { type: Sequelize.STRING(64), allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('park_zones', ['park_id']);
    await queryInterface.addConstraint('park_zones', {
      fields: ['park_id', 'slug'],
      type: 'unique',
      name: 'park_zones_park_slug_uq',
    });

    await queryInterface.createTable('park_assets', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      zone_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'park_zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      parent_asset_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      asset_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'asset_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: { type: Sequelize.STRING(240), allowNull: false },
      slug: { type: Sequelize.STRING(160), allowNull: false },
      latitude: { type: Sequelize.DOUBLE, allowNull: true },
      longitude: { type: Sequelize.DOUBLE, allowNull: true },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'UNKNOWN' },
      external_source: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'THEMEPARKS_WIKI' },
      external_entity_id: { type: Sequelize.STRING(64), allowNull: true },
      external_parent_id: { type: Sequelize.STRING(64), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('park_assets', ['park_id']);
    await queryInterface.addIndex('park_assets', ['asset_type_id']);
    await queryInterface.addIndex('park_assets', ['parent_asset_id']);
    await queryInterface.addIndex('park_assets', ['zone_id']);
    await queryInterface.addConstraint('park_assets', {
      fields: ['park_id', 'slug'],
      type: 'unique',
      name: 'park_assets_park_slug_uq',
    });
    await sequelize.query(`
      CREATE UNIQUE INDEX park_assets_external_uq ON park_assets (external_source, external_entity_id)
      WHERE external_entity_id IS NOT NULL AND trim(external_entity_id) <> '';
    `);

    const extRow = (Sequelize) => ({
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('ride_master_data', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      capacity_pph: { type: Sequelize.INTEGER, allowNull: true },
      dispatch_interval_sec: { type: Sequelize.INTEGER, allowNull: true },
      seats_per_cycle: { type: Sequelize.INTEGER, allowNull: true },
      operator_min: { type: Sequelize.INTEGER, allowNull: true },
      operator_standard: { type: Sequelize.INTEGER, allowNull: true },
      operator_peak: { type: Sequelize.INTEGER, allowNull: true },
      weather_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      wind_limit_kmh: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      min_height_cm: { type: Sequelize.INTEGER, allowNull: true },
      thrill_level: { type: Sequelize.SMALLINT, allowNull: true },
      manufacturer: { type: Sequelize.STRING(160), allowNull: true },
      build_year: { type: Sequelize.SMALLINT, allowNull: true },
      target_oee: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      target_availability: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      ...extRow(Sequelize),
    });

    await queryInterface.createTable('show_master_data', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      typical_duration_min: { type: Sequelize.INTEGER, allowNull: true },
      venue_type: { type: Sequelize.STRING(80), allowNull: true },
      audience_rating: { type: Sequelize.STRING(40), allowNull: true },
      ...extRow(Sequelize),
    });

    await queryInterface.createTable('restaurant_master_data', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cuisine_type: { type: Sequelize.STRING(120), allowNull: true },
      seating_capacity: { type: Sequelize.INTEGER, allowNull: true },
      service_style: { type: Sequelize.STRING(80), allowNull: true },
      ...extRow(Sequelize),
    });

    await queryInterface.createTable('shop_master_data', {
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      retail_category: { type: Sequelize.STRING(120), allowNull: true },
      square_meters: { type: Sequelize.INTEGER, allowNull: true },
      ...extRow(Sequelize),
    });

    await queryInterface.createTable('ride_templates', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(160), allowNull: false },
      default_profile: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('staffing_templates', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(160), allowNull: false },
      template_body: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('maintenance_templates', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(160), allowNull: false },
      template_body: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('asset_observations', {
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
      metric_code: { type: Sequelize.STRING(64), allowNull: false },
      metric_value: { type: Sequelize.TEXT, allowNull: false },
      unit: { type: Sequelize.STRING(32), allowNull: true },
      timestamp: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'THEMEPARKS_WIKI' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('asset_observations', ['asset_id', 'metric_code', 'timestamp'], {
      name: 'asset_observations_asset_metric_ts_idx',
    });
    await queryInterface.addIndex('asset_observations', ['timestamp']);

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
    await sequelize.query(
      `INSERT INTO ride_templates (id, code, name, default_profile, is_system, created_at, updated_at)
       VALUES (gen_random_uuid(), 'RIDE_DEFAULT', 'Default thrill ride', $1::jsonb, true, NOW(), NOW())`,
      { bind: [rideProf] }
    );

    const staffBody = JSON.stringify({ roles: [{ code: 'RIDE_OPERATOR', standard: 2, peak: 4 }] });
    await sequelize.query(
      `INSERT INTO staffing_templates (id, code, name, template_body, created_at, updated_at)
       VALUES (gen_random_uuid(), 'RIDE_OPS_STANDARD', 'Standard ride operations staffing', $1::jsonb, NOW(), NOW())`,
      { bind: [staffBody] }
    );

    const maintBody = JSON.stringify({ strategy: 'PREDICTIVE', inspectionIntervalDays: 30 });
    await sequelize.query(
      `INSERT INTO maintenance_templates (id, code, name, template_body, created_at, updated_at)
       VALUES (gen_random_uuid(), 'RIDE_MAINT_STANDARD', 'Standard ride maintenance', $1::jsonb, NOW(), NOW())`,
      { bind: [maintBody] }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('asset_observations');
    await queryInterface.dropTable('shop_master_data');
    await queryInterface.dropTable('restaurant_master_data');
    await queryInterface.dropTable('show_master_data');
    await queryInterface.dropTable('ride_master_data');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS park_assets_external_uq;');
    await queryInterface.dropTable('park_assets');
    await queryInterface.dropTable('park_zones');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS parks_external_source_entity_uq;');
    await queryInterface.dropTable('parks');
    await queryInterface.dropTable('maintenance_templates');
    await queryInterface.dropTable('staffing_templates');
    await queryInterface.dropTable('ride_templates');
    await queryInterface.dropTable('asset_types');
  },
};
