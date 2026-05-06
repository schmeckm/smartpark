const { asyncHandler } = require('../utils/async-handler');
const { WeatherService } = require('../services/weather.service');
const { IngestionService } = require('../services/ingestion.service');
const { validate } = require('../middleware/validate.middleware');
const { createWeatherObservationSchema } = require('../validators/weather.schemas');

const weatherService = new WeatherService();
const ingestion = new IngestionService();

const current = asyncHandler(async (req, res) => {
  const obs = await weatherService.getCurrent();
  res.json({ success: true, data: obs || null });
});

const create = asyncHandler(async (req, res) => {
  const body = req.validated;
  const obs = await ingestion.ingestWeatherObservationFromApi(body);
  res.status(201).json({ success: true, data: obs });
});

module.exports = {
  current,
  create,
  createValidators: [validate(createWeatherObservationSchema), create],
};
