const { Model, DataTypes } = require('sequelize');

const EVENT_TYPES = ['CROWD_SPIKE', 'CROWD_DROP', 'RIDE_CLOSURE', 'WEATHER_IMPACT'];

class CrowdEvent extends Model {}

function defineCrowdEvent(sequelize) {
  CrowdEvent.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      zoneId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'zone_id',
      },
      eventType: {
        type: DataTypes.ENUM(...EVENT_TYPES),
        allowNull: false,
        field: 'event_type',
      },
      crowdLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'crowd_level',
      },
      severity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      source: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: 'system',
      },
    },
    {
      sequelize,
      modelName: 'CrowdEvent',
      tableName: 'crowd_events',
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return CrowdEvent;
}

module.exports = { defineCrowdEvent, CrowdEvent, EVENT_TYPES };
