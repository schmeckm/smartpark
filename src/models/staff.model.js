const { Model, DataTypes } = require('sequelize');

const STAFF_ROLES = ['FOOD_SERVICE', 'RIDE_OPERATOR', 'CLEANING', 'SECURITY', 'GUEST_SERVICE'];

class Staff extends Model {}

function defineStaff(sequelize) {
  Staff.init(
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
      employeeNumber: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
        field: 'employee_number',
      },
      role: {
        type: DataTypes.ENUM(...STAFF_ROLES),
        allowNull: false,
      },
      supervisorId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'supervisor_id',
      },
      currentZoneId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'current_zone_id',
      },
      available: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      skillLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: 'skill_level',
      },
    },
    {
      sequelize,
      modelName: 'Staff',
      tableName: 'staff',
      underscored: true,
    }
  );

  return Staff;
}

module.exports = { defineStaff, Staff, STAFF_ROLES };
