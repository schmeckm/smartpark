const { Model, DataTypes } = require('sequelize');

const USER_ROLES = [
  'ADMIN',
  'OPERATIONS_MANAGER',
  'SECURITY_MANAGER',
  'OPERATOR',
  'VIEWER',
];

class User extends Model {}

function defineUser(sequelize) {
  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      firstName: {
        type: DataTypes.STRING(80),
        allowNull: false,
        field: 'first_name',
      },
      lastName: {
        type: DataTypes.STRING(80),
        allowNull: false,
        field: 'last_name',
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash',
      },
      role: {
        type: DataTypes.ENUM(...USER_ROLES),
        allowNull: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_login_at',
      },
      languageCode: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'en',
        field: 'language_code',
      },
      displayName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'display_name',
      },
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      dateFormat: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'YYYY-MM-DD',
        field: 'date_format',
      },
      timeFormat: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: '24h',
        field: 'time_format',
      },
      locale: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      uiPreferences: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'ui_preferences',
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      defaultScope: {
        attributes: { exclude: ['passwordHash'] },
      },
    }
  );

  return User;
}

module.exports = { defineUser, User, USER_ROLES };
