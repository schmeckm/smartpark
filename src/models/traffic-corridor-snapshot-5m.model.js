const { Model, DataTypes } = require('sequelize');

class TrafficCorridorSnapshot5m extends Model {}

function defineTrafficCorridorSnapshot5m(sequelize) {
  TrafficCorridorSnapshot5m.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      corridorId: { type: DataTypes.UUID, allowNull: false, field: 'corridor_id' },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      snapshotTs: { type: DataTypes.DATE, allowNull: false, field: 'snapshot_ts' },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'manual' },
      currentTravelTimeMin: { type: DataTypes.DECIMAL(12, 4), allowNull: false, field: 'current_travel_time_min' },
      baselineTravelTimeMin: { type: DataTypes.DECIMAL(12, 4), allowNull: false, field: 'baseline_travel_time_min' },
      delayMin: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: 'delay_min' },
      delayPercent: { type: DataTypes.DECIMAL(14, 8), allowNull: true, field: 'delay_percent' },
      congestionScore: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: 'congestion_score' },
      inboundPressureScore: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: 'inbound_pressure_score' },
      rawPayloadJson: { type: DataTypes.JSONB, allowNull: true, field: 'raw_payload_json' },
    },
    {
      sequelize,
      modelName: 'TrafficCorridorSnapshot5m',
      tableName: 'traffic_corridor_snapshots_5m',
      underscored: true,
      timestamps: true,
    }
  );
  return TrafficCorridorSnapshot5m;
}

module.exports = { defineTrafficCorridorSnapshot5m, TrafficCorridorSnapshot5m };
