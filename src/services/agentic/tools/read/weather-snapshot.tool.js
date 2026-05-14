'use strict';

const { WeatherObservation } = require('../../../../models');

/**
 * Latest weather observation for the park UUID (`internal_park_id`), else newest row globally (labeled fallback).
 */
const weatherSnapshotTool = {
  name: 'read.weather_snapshot',
  description:
    'Returns latest WeatherObservation for this park (internalParkId match); falls back to latest observation globally when none.',
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;

    let row = await WeatherObservation.findOne({
      where: { internalParkId: parkId },
      order: [
        ['observedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    let scope = 'park';
    if (!row) {
      row = await WeatherObservation.findOne({
        order: [
          ['observedAt', 'DESC'],
          ['createdAt', 'DESC'],
        ],
      });
      scope = row ? 'global_fallback' : 'none';
    }

    if (!row) {
      return {
        parkId,
        scope: 'none',
        observation: null,
        hint: 'No weather observations in DB yet.',
      };
    }

    const p = row.get({ plain: true });
    return {
      parkId,
      scope,
      observation: {
        id: p.id,
        condition: p.condition,
        temperatureC: p.temperatureC != null ? Number(p.temperatureC) : null,
        rainMm: p.rainMm != null ? Number(p.rainMm) : null,
        rainProbabilityPercent:
          p.rainProbabilityPercent != null ? Number(p.rainProbabilityPercent) : null,
        windKmh: p.windKmh != null ? Number(p.windKmh) : null,
        weatherCode: p.weatherCode != null ? Number(p.weatherCode) : null,
        observedAt: p.observedAt ? new Date(p.observedAt).toISOString() : null,
        internalParkId: p.internalParkId || null,
        source: p.source || null,
      },
      hint:
        scope === 'global_fallback'
          ? 'No observation scoped to this park; showing latest global row.'
          : null,
    };
  },
};

module.exports = { weatherSnapshotTool };
