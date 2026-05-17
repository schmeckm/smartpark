const { Model, DataTypes } = require('sequelize');

class UserPark extends Model {}

function defineUserPark(sequelize) {
  UserPark.init(
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
      parkId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'park_id',
      },
    },
    {
      sequelize,
      modelName: 'UserPark',
      tableName: 'user_parks',
      underscored: true,
    }
  );
  return UserPark;
}

module.exports = { defineUserPark, UserPark };
