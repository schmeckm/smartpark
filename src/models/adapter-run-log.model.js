const { Model, DataTypes } = require('sequelize');

const ADAPTER_RUN_STATUSES = ['SUCCESS', 'PARTIAL', 'FAILED'];

class AdapterRunLog extends Model {}

function defineAdapterRunLog(sequelize) {
  AdapterRunLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      adapterKey: { type: DataTypes.STRING(120), allowNull: false, field: 'adapter_key' },
      status: { type: DataTypes.STRING(32), allowNull: false },
      observationCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'observation_count' },
      validCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'valid_count' },
      invalidCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'invalid_count' },
      summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'AdapterRunLog',
      tableName: 'adapter_run_logs',
      underscored: true,
      updatedAt: false,
    }
  );

  return AdapterRunLog;
}

module.exports = { defineAdapterRunLog, AdapterRunLog, ADAPTER_RUN_STATUSES };
