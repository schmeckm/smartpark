const { Model, DataTypes } = require('sequelize');

class DataQualityIssue extends Model {}

function defineDataQualityIssue(sequelize) {
  DataQualityIssue.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      sourceSystem: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'ingestion', field: 'source_system' },
      issueType: { type: DataTypes.STRING(80), allowNull: false, field: 'issue_type' },
      severity: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'MEDIUM' },
      message: { type: DataTypes.TEXT, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: true },
      integrationEventId: { type: DataTypes.UUID, allowNull: true, field: 'integration_event_id' },
      resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'DataQualityIssue',
      tableName: 'data_quality_issues',
      underscored: true,
      updatedAt: false,
    }
  );

  return DataQualityIssue;
}

module.exports = { defineDataQualityIssue, DataQualityIssue };
