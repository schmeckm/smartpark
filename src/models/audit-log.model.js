const { Model, DataTypes } = require('sequelize');

class AuditLog extends Model {}

function defineAuditLog(sequelize) {
  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'user_id',
      },
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: 'entity_type',
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'entity_id',
      },
      oldValue: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'old_value',
      },
      newValue: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'new_value',
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return AuditLog;
}

module.exports = { defineAuditLog, AuditLog };
