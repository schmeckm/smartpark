const { Model, DataTypes } = require('sequelize');

const INCIDENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

class Incident extends Model {}

function defineIncident(sequelize) {
  Incident.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      parkId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'park_id',
      },
      status: {
        type: DataTypes.ENUM(...INCIDENT_STATUSES),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      severity: {
        type: DataTypes.ENUM(...INCIDENT_SEVERITIES),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      ownerUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'owner_user_id',
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'created_by_user_id',
      },
      linkedEntityType: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: 'linked_entity_type',
      },
      linkedEntityId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'linked_entity_id',
      },
      slaDueAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'sla_due_at',
      },
    },
    {
      sequelize,
      modelName: 'Incident',
      tableName: 'incidents',
      underscored: true,
      timestamps: true,
    }
  );

  return Incident;
}

module.exports = { defineIncident, Incident, INCIDENT_STATUSES, INCIDENT_SEVERITIES };
