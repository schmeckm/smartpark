const { Model, DataTypes } = require('sequelize');

class WeatherObservation extends Model {}

function defineWeatherObservation(sequelize) {
  WeatherObservation.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      condition: { type: DataTypes.STRING(64), allowNull: false },
      temperatureC: { type: DataTypes.FLOAT, allowNull: true, field: 'temperature_c' },
      rainMm: { type: DataTypes.FLOAT, allowNull: true, field: 'rain_mm' },
      rainProbabilityPercent: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: 'rain_probability_percent',
      },
      windKmh: { type: DataTypes.FLOAT, allowNull: true, field: 'wind_kmh' },
      /** WMO weather code from Open-Meteo (optional). */
      weatherCode: { type: DataTypes.SMALLINT, allowNull: true, field: 'weather_code' },
      source: { type: DataTypes.STRING(120), allowNull: true },
      parkId: { type: DataTypes.STRING(120), allowNull: true, field: 'park_id' },
      internalParkId: { type: DataTypes.UUID, allowNull: true, field: 'internal_park_id' },
      observedAt: { type: DataTypes.DATE, allowNull: false, field: 'observed_at' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'WeatherObservation',
      tableName: 'weather_observations',
      underscored: true,
      updatedAt: false,
    }
  );

  return WeatherObservation;
}

module.exports = { defineWeatherObservation, WeatherObservation };
