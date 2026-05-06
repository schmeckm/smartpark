const { Model, DataTypes } = require('sequelize');

const INTEGRATION_LOG_STATUSES = ['RECEIVED', 'PROCESSED', 'FAILED'];

class IntegrationEventLog extends Model {}

function defineIntegrationEventLog(sequelize) {
  IntegrationEventLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      sourceSystem: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'mqtt', field: 'source_system' },
      topic: { type: DataTypes.STRING(512), allowNull: true },
      eventType: { type: DataTypes.STRING(80), allowNull: true, field: 'event_type' },
      payload: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.ENUM(...INTEGRATION_LOG_STATUSES), allowNull: false, defaultValue: 'RECEIVED' },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
      payloadFingerprint: { type: DataTypes.STRING(64), allowNull: true, field: 'payload_fingerprint' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      processedAt: { type: DataTypes.DATE, allowNull: true, field: 'processed_at' },
    },
    {
      sequelize,
      modelName: 'IntegrationEventLog',
      tableName: 'integration_event_logs',
      underscored: true,
      updatedAt: false,
    }
  );

  return IntegrationEventLog;
}

module.exports = { defineIntegrationEventLog, IntegrationEventLog, INTEGRATION_LOG_STATUSES };
