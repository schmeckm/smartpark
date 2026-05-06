'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('integration_event_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      source_system: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: 'mqtt',
      },
      topic: { type: Sequelize.STRING(512), allowNull: true },
      event_type: { type: Sequelize.STRING(80), allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: true },
      status: {
        type: Sequelize.ENUM('RECEIVED', 'PROCESSED', 'FAILED'),
        allowNull: false,
        defaultValue: 'RECEIVED',
      },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      payload_fingerprint: { type: Sequelize.STRING(64), allowNull: true, field: 'payload_fingerprint' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      processed_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('integration_event_logs', ['status'], { name: 'idx_integration_event_logs_status' });
    await queryInterface.addIndex('integration_event_logs', ['payload_fingerprint', 'created_at'], {
      name: 'idx_integration_fingerprint',
    });
    await queryInterface.addIndex('integration_event_logs', ['created_at'], { name: 'idx_integration_event_logs_created' });

    await queryInterface.createTable('weather_observations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      condition: { type: Sequelize.STRING(64), allowNull: false },
      temperature_c: { type: Sequelize.FLOAT, allowNull: true, field: 'temperature_c' },
      rain_mm: { type: Sequelize.FLOAT, allowNull: true, field: 'rain_mm' },
      wind_kmh: { type: Sequelize.FLOAT, allowNull: true, field: 'wind_kmh' },
      source: { type: Sequelize.STRING(120), allowNull: true },
      park_id: { type: Sequelize.STRING(120), allowNull: true, field: 'park_id' },
      observed_at: { type: Sequelize.DATE, allowNull: false, field: 'observed_at' },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'created_at',
      },
    });
    await queryInterface.addIndex('weather_observations', ['observed_at'], { name: 'idx_weather_observations_observed' });

    await queryInterface.createTable('data_quality_issues', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      source_system: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'ingestion' },
      issue_type: { type: Sequelize.STRING(80), allowNull: false },
      severity: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'MEDIUM' },
      message: { type: Sequelize.TEXT, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: true },
      integration_event_id: { type: Sequelize.UUID, allowNull: true, field: 'integration_event_id' },
      resolved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('data_quality_issues', ['resolved', 'created_at'], { name: 'idx_data_quality_issues_resolved' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('data_quality_issues');
    await queryInterface.dropTable('weather_observations');
    await queryInterface.dropTable('integration_event_logs');
  },
};
