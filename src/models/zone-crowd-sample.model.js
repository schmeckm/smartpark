const { Model, DataTypes } = require('sequelize');

class ZoneCrowdSample extends Model {}

function defineZoneCrowdSample(sequelize) {
  ZoneCrowdSample.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      zoneId: { type: DataTypes.UUID, allowNull: false, field: 'zone_id' },
      crowdLevel: { type: DataTypes.INTEGER, allowNull: false, field: 'crowd_level' },
      crowdRatio: { type: DataTypes.DECIMAL(12, 6), allowNull: false, field: 'crowd_ratio' },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'sampler' },
      sampledAt: { type: DataTypes.DATE, allowNull: false, field: 'sampled_at' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'ZoneCrowdSample',
      tableName: 'zone_crowd_samples',
      underscored: true,
      updatedAt: false,
    }
  );
  return ZoneCrowdSample;
}

module.exports = { defineZoneCrowdSample, ZoneCrowdSample };
