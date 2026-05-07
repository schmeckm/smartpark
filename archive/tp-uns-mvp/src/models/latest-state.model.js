const { DataTypes, Model } = require('sequelize');

class LatestState extends Model {}

function defineLatestState(sequelize) {
  LatestState.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      topicPath: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: 'topic_path' },
      value: { type: DataTypes.JSONB, allowNull: false },
      eventTime: { type: DataTypes.DATE, allowNull: false, field: 'event_time' },
      source: { type: DataTypes.STRING(120), allowNull: true },
      quality: { type: DataTypes.STRING(16), allowNull: true },
    },
    { sequelize, modelName: 'LatestState', tableName: 'latest_states', underscored: true, freezeTableName: true }
  );
  return LatestState;
}

module.exports = { LatestState, defineLatestState };
