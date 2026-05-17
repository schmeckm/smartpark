const Joi = require('joi');

const uuid = Joi.string().uuid();

const parkIdParams = Joi.object({
  parkId: uuid.required(),
});

const corridorIdParams = Joi.object({
  corridorId: uuid.required(),
});

const lat = Joi.number().min(-90).max(90).allow(null);
const lng = Joi.number().min(-180).max(180).allow(null);

const trafficCorridorCreateBody = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().allow('', null).max(5000).optional(),
  originLabel: Joi.string().allow('', null).max(300).optional(),
  originLat: lat.optional(),
  originLng: lng.optional(),
  destinationLabel: Joi.string().allow('', null).max(300).optional(),
  destinationLat: lat.optional(),
  destinationLng: lng.optional(),
  direction: Joi.string().valid('inbound', 'outbound').optional(),
  baselineTravelTimeMin: Joi.number().min(0).required(),
  weight: Joi.number().min(0).max(100).optional(),
  enabled: Joi.boolean().optional(),
});

const trafficCorridorPatchBody = Joi.object({
  name: Joi.string().trim().min(1).max(200).optional(),
  description: Joi.string().allow('', null).max(5000).optional(),
  originLabel: Joi.string().allow('', null).max(300).optional(),
  originLat: lat.optional(),
  originLng: lng.optional(),
  destinationLabel: Joi.string().allow('', null).max(300).optional(),
  destinationLat: lat.optional(),
  destinationLng: lng.optional(),
  direction: Joi.string().valid('inbound', 'outbound').optional(),
  baselineTravelTimeMin: Joi.number().min(0).optional(),
  weight: Joi.number().min(0).max(100).optional(),
  enabled: Joi.boolean().optional(),
})
  .min(1)
  .messages({ 'object.min': 'At least one field is required' });

const manualTrafficSnapshotBody = Joi.object({
  currentTravelTimeMin: Joi.number().min(0).required(),
  snapshotTs: Joi.date()
    .iso()
    .max('now')
    .min(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .optional()
    .messages({
      'date.max': 'snapshotTs cannot be in the future',
      'date.min': 'snapshotTs cannot be older than 7 days',
    }),
});

const trafficCorridorSnapshotHistoryQuery = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),
});

const score0to100 = Joi.number().min(0).max(100).optional();

const attendanceRiskForecastRunBody = Joi.object({
  plannedDemand: Joi.number().integer().min(0).required(),
  knownRegisteredExpected: Joi.number().integer().min(0).required(),
  weatherScore: score0to100,
  holidayScore: score0to100,
  eventScore: score0to100,
  parkingPressureScore: score0to100,
});

const forecastHistoryQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(500).optional(),
});

module.exports = {
  parkIdParams,
  corridorIdParams,
  trafficCorridorCreateBody,
  trafficCorridorPatchBody,
  manualTrafficSnapshotBody,
  trafficCorridorSnapshotHistoryQuery,
  attendanceRiskForecastRunBody,
  forecastHistoryQuery,
};
