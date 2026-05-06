const { Model, DataTypes } = require('sequelize');

class UnsLatestState extends Model {}

function defineUnsLatestState(sequelize) {
  UnsLatestState.init(
    {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      parkId: { type: DataTypes.STRING(255), allowNull: false },
      topicPath: { type: DataTypes.STRING(500), allowNull: false, unique: true },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      eventTime: { type: DataTypes.DATE, allowNull: false },
      quality: { type: DataTypes.STRING(32), allowNull: true },
      source: { type: DataTypes.STRING(80), allowNull: true },
    },
    {
      sequelize,
      modelName: 'UnsLatestState',
      tableName: 'uns_latest_states',
      underscored: true,
    }
  );
  return UnsLatestState;
}

module.exports = { defineUnsLatestState, UnsLatestState };
