const { Model, DataTypes } = require('sequelize');

class ParkDemandForecast5m extends Model {}

function defineParkDemandForecast5m(sequelize) {
  ParkDemandForecast5m.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      snapshotTs: { type: DataTypes.DATE, allowNull: false, field: 'snapshot_ts' },
      plannedDemand: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'planned_demand' },
      knownRegisteredExpected: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'known_registered_expected',
      },
      plannedTotal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'planned_total' },
      trafficPressureScore: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0,
        field: 'traffic_pressure_score',
      },
      weatherScore: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0, field: 'weather_score' },
      holidayScore: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0, field: 'holiday_score' },
      eventScore: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0, field: 'event_score' },
      parkingPressureScore: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0,
        field: 'parking_pressure_score',
      },
      externalDemandPressureScore: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0,
        field: 'external_demand_pressure_score',
      },
      additionalDemandLow: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'additional_demand_low',
      },
      additionalDemandMid: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'additional_demand_mid',
      },
      additionalDemandHigh: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'additional_demand_high',
      },
      expectedAttendanceLow: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'expected_attendance_low',
      },
      expectedAttendanceMid: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'expected_attendance_mid',
      },
      expectedAttendanceHigh: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'expected_attendance_high',
      },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'normal' },
      confidenceScore: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0,
        field: 'confidence_score',
      },
      recommendationsJson: { type: DataTypes.JSONB, allowNull: true, field: 'recommendations_json' },
      explanationJson: { type: DataTypes.JSONB, allowNull: true, field: 'explanation_json' },
    },
    {
      sequelize,
      modelName: 'ParkDemandForecast5m',
      tableName: 'park_demand_forecasts_5m',
      underscored: true,
      timestamps: true,
    }
  );
  return ParkDemandForecast5m;
}

module.exports = { defineParkDemandForecast5m, ParkDemandForecast5m };
