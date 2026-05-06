const { Model, DataTypes } = require('sequelize');

class AppSetting extends Model {}

function defineAppSetting(sequelize) {
  AppSetting.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      key: { type: DataTypes.STRING(200), allowNull: false, unique: true },
      value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'AppSetting',
      tableName: 'app_settings',
      underscored: true,
    }
  );
  return AppSetting;
}

module.exports = { defineAppSetting, AppSetting };
