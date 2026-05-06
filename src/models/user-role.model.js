const { Model, DataTypes } = require('sequelize');

class UserRole extends Model {}

function defineUserRole(sequelize) {
  UserRole.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      roleCode: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'role_code',
      },
    },
    {
      sequelize,
      modelName: 'UserRole',
      tableName: 'user_roles',
      underscored: true,
    }
  );

  return UserRole;
}

module.exports = { defineUserRole, UserRole };
