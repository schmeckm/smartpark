const { DataTypes, Model } = require('sequelize');

class Park extends Model {}

function definePark(sequelize) {
  Park.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      timezone: { type: DataTypes.STRING(64), allowNull: false },
    },
    { sequelize, modelName: 'Park', tableName: 'parks', underscored: true, freezeTableName: true }
  );
  return Park;
}

module.exports = { Park, definePark };
