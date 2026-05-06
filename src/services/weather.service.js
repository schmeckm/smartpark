const { AppError } = require('../utils/app-error');
const { WeatherObservationRepository } = require('../repositories/weather-observation.repository');
const { emitWeatherUpdated } = require('../sockets');

class WeatherService {
  constructor() {
    this.repository = new WeatherObservationRepository();
  }

  getCurrent() {
    return this.repository.findCurrent();
  }

  listRecent() {
    return this.repository.listRecent({ limit: 100 });
  }

  async createObservationFromPayload(
    {
      condition,
      temperatureC,
      rainMm,
      rainProbabilityPercent,
      windKmh,
      weatherCode,
      source,
      parkId,
      internalParkId,
      observedAt,
    },
    { emit = true } = {}
  ) {
    if (!condition) throw new AppError('condition is required', 400, { code: 'VALIDATION_ERROR' });
    const at = observedAt ? new Date(observedAt) : new Date();
    if (Number.isNaN(at.getTime())) {
      throw new AppError('invalid observedAt', 400, { code: 'VALIDATION_ERROR' });
    }
    const row = await this.repository.create({
      condition: String(condition).toUpperCase(),
      temperatureC: temperatureC == null ? null : Number(temperatureC),
      rainMm: rainMm == null ? null : Number(rainMm),
      rainProbabilityPercent:
        rainProbabilityPercent == null ? null : Number(rainProbabilityPercent),
      windKmh: windKmh == null ? null : Number(windKmh),
      weatherCode: weatherCode == null || weatherCode === '' ? null : Number(weatherCode),
      source: source || 'api',
      parkId: parkId || null,
      internalParkId: internalParkId || null,
      observedAt: at,
    });
    if (emit) emitWeatherUpdated(row);
    return row;
  }
}

module.exports = { WeatherService };
