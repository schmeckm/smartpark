const { Model, DataTypes } = require('sequelize');

class ParkFeatureSnapshot extends Model {}

function defineParkFeatureSnapshot(sequelize) {
  ParkFeatureSnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalParkId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_park_id' },
      snapshotAt: { type: DataTypes.DATE, allowNull: false, field: 'snapshot_at' },
      timezone: { type: DataTypes.STRING(64), allowNull: true },
      ridesReporting: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'rides_reporting' },
      ridesOpen: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'rides_open' },
      openRatio: { type: DataTypes.DECIMAL(8, 6), allowNull: false, defaultValue: 0, field: 'open_ratio' },
      avgWait: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'avg_wait' },
      medianWait: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'median_wait' },
      p90Wait: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'p90_wait' },
      maxWait: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'max_wait' },
      closedRatio: { type: DataTypes.DECIMAL(8, 6), allowNull: false, defaultValue: 0, field: 'closed_ratio' },
      sourceMessageCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'source_message_count',
      },
      internalParkId: { type: DataTypes.UUID, allowNull: true, field: 'internal_park_id' },
      localDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'local_date' },
      localHour: { type: DataTypes.SMALLINT, allowNull: true, field: 'local_hour' },
      dayOfWeek: { type: DataTypes.SMALLINT, allowNull: true, field: 'day_of_week' },
      month: { type: DataTypes.SMALLINT, allowNull: true },
      season: { type: DataTypes.SMALLINT, allowNull: true },
      isWeekend: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_weekend' },
      isPublicHoliday: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_public_holiday' },
      isSchoolHoliday: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_school_holiday' },
      holidayName: { type: DataTypes.STRING(200), allowNull: true, field: 'holiday_name' },
      temperatureC: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'temperature_c' },
      precipitationMm: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'precipitation_mm' },
      windSpeedKmh: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'wind_speed_kmh' },
      weatherCondition: { type: DataTypes.STRING(80), allowNull: true, field: 'weather_condition' },
      trafficIndex: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'traffic_index' },
      specialEventFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'special_event_flag' },
      parkCrowdIndex: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'park_crowd_index' },
      completenessScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'completeness_score' },
      targetWaitTime15m: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'target_wait_time_15m' },
      targetWaitTime60m: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'target_wait_time_60m' },
      targetWaitTime120m: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'target_wait_time_120m' },
      xFeaturesExtras: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'x_features_extras' },
      rainProbabilityPercent: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'rain_probability_percent' },
      inboundEtaMin: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'inbound_eta_min' },
      visitorsEstimate: { type: DataTypes.INTEGER, allowNull: true, field: 'visitors_estimate' },
      openRidesCount: { type: DataTypes.INTEGER, allowNull: true, field: 'open_rides_count' },
      closedRidesCount: { type: DataTypes.INTEGER, allowNull: true, field: 'closed_rides_count' },
      crowdIndex: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'crowd_index' },
      withinScheduledOperatingHours: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        field: 'within_scheduled_operating_hours',
      },
      scheduledOperatingSnapshotAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'scheduled_operating_snapshot_at',
      },
    },
    {
      sequelize,
      modelName: 'ParkFeatureSnapshot',
      tableName: 'park_feature_snapshots_5m',
      underscored: true,
    }
  );
  return ParkFeatureSnapshot;
}

module.exports = { defineParkFeatureSnapshot, ParkFeatureSnapshot };
