const { Model, DataTypes } = require('sequelize');

class PlatformSetting extends Model {}

function definePlatformSetting(sequelize) {
  PlatformSetting.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      settingKey: { type: DataTypes.STRING(120), allowNull: false, unique: true, field: 'setting_key' },
      settingValue: { type: DataTypes.TEXT, allowNull: false, field: 'setting_value' },
      valueType: { type: DataTypes.STRING(32), allowNull: false, field: 'value_type' },
      category: { type: DataTypes.STRING(64), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
    },
    {
      sequelize,
      modelName: 'PlatformSetting',
      tableName: 'platform_settings',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return PlatformSetting;
}

module.exports = { definePlatformSetting, PlatformSetting };
