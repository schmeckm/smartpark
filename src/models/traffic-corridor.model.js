const { Model, DataTypes } = require('sequelize');

class TrafficCorridor extends Model {}

function defineTrafficCorridor(sequelize) {
  TrafficCorridor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      name: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      originLabel: { type: DataTypes.STRING(300), allowNull: true, field: 'origin_label' },
      originLat: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'origin_lat' },
      originLng: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'origin_lng' },
      destinationLabel: { type: DataTypes.STRING(300), allowNull: true, field: 'destination_label' },
      destinationLat: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'destination_lat' },
      destinationLng: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'destination_lng' },
      direction: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'inbound' },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'manual' },
      baselineTravelTimeMin: { type: DataTypes.DECIMAL(12, 4), allowNull: false, field: 'baseline_travel_time_min' },
      weight: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1.0 },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      lastPollResult: { type: DataTypes.JSONB, allowNull: true, field: 'last_poll_result' },
    },
    {
      sequelize,
      modelName: 'TrafficCorridor',
      tableName: 'traffic_corridors',
      underscored: true,
      timestamps: true,
    }
  );
  return TrafficCorridor;
}

module.exports = { defineTrafficCorridor, TrafficCorridor };
