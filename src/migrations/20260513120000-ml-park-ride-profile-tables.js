'use strict';

/** Phase 3 ML — park/ride metadata profiles (no forecast semantics; gated by ML_PROFILE_ENABLED). */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ml_park_profiles', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      park_id: { type: Sequelize.UUID, allowNull: false },
      profile_name: { type: Sequelize.STRING(255), allowNull: false },
      profile_version: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'v1' },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      crowd_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      weather_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      calendar_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      seasonality_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      event_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      visitor_mix_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('ml_ride_profiles', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      park_id: { type: Sequelize.UUID, allowNull: false },
      ride_id: { type: Sequelize.UUID, allowNull: false },
      profile_name: { type: Sequelize.STRING(255), allowNull: false },
      profile_version: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'v1' },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ride_type: { type: Sequelize.STRING(128), allowNull: true },
      capacity_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      popularity_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      queue_behavior_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      weather_sensitivity_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      downtime_sensitivity_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      staffing_dependency_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      throughput_profile_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('ml_park_profiles', ['park_id'], { name: 'idx_ml_park_profiles_park' });
    await queryInterface.addIndex('ml_park_profiles', ['park_id', 'enabled'], {
      name: 'idx_ml_park_profiles_park_enabled',
    });
    await queryInterface.addConstraint('ml_park_profiles', {
      fields: ['park_id', 'profile_name', 'profile_version'],
      type: 'unique',
      name: 'uq_ml_park_profiles_park_name_version',
    });

    await queryInterface.addIndex('ml_ride_profiles', ['park_id'], { name: 'idx_ml_ride_profiles_park' });
    await queryInterface.addIndex('ml_ride_profiles', ['ride_id'], { name: 'idx_ml_ride_profiles_ride' });
    await queryInterface.addIndex('ml_ride_profiles', ['park_id', 'ride_id', 'enabled'], {
      name: 'idx_ml_ride_profiles_park_ride_enabled',
    });
    await queryInterface.addConstraint('ml_ride_profiles', {
      fields: ['park_id', 'ride_id', 'profile_name', 'profile_version'],
      type: 'unique',
      name: 'uq_ml_ride_profiles_park_ride_name_version',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ml_ride_profiles');
    await queryInterface.dropTable('ml_park_profiles');
  },
};
