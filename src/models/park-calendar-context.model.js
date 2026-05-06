const { Model, DataTypes } = require('sequelize');

class ParkCalendarContext extends Model {}

function defineParkCalendarContext(sequelize) {
  ParkCalendarContext.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      contextDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'context_date' },
      isPublicHoliday: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_public_holiday',
      },
      isSchoolBreak: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_school_break',
      },
      holidayName: { type: DataTypes.STRING(200), allowNull: true, field: 'holiday_name' },
      regionCode: { type: DataTypes.STRING(32), allowNull: true, field: 'region_code' },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'manual' },
      extra: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'ParkCalendarContext',
      tableName: 'park_calendar_context',
      underscored: true,
    }
  );
  return ParkCalendarContext;
}

module.exports = { defineParkCalendarContext, ParkCalendarContext };
