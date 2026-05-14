'use strict';

const { Op } = require('sequelize');
const { Forecast } = require('../../../../models');

/**
 * Read-only snapshot of recent park-level forecasts from persisted `forecasts` rows.
 * Does not invoke forecast generation services.
 */
const forecastReadTool = {
  name: 'read.forecast_summary',
  description: 'Lists recent non-expired PARK-level forecasts (subject scoped to park UUID).',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    const now = new Date();
    const rows = await Forecast.findAll({
      where: {
        [Op.and]: [
          { subjectType: 'PARK' },
          { [Op.or]: [{ subjectId: parkId }, { subjectId: null }] },
          { [Op.or]: [{ expiresAt: { [Op.gt]: now } }, { expiresAt: null }] },
        ],
      },
      order: [['producedAt', 'DESC']],
      limit,
      attributes: [
        'id',
        'subjectType',
        'subjectId',
        'targetMetric',
        'horizonMinutes',
        'predictedValue',
        'confidence',
        'producedAt',
        'expiresAt',
      ],
    });

    const plain = rows.map((r) => {
      const p = r.get({ plain: true });
      return {
        id: p.id,
        targetMetric: p.targetMetric,
        horizonMinutes: p.horizonMinutes,
        predictedValue: p.predictedValue != null ? Number(p.predictedValue) : null,
        confidence: p.confidence != null ? Number(p.confidence) : null,
        producedAt: p.producedAt ? new Date(p.producedAt).toISOString() : null,
        expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
      };
    });

    return {
      parkId,
      count: plain.length,
      items: plain,
    };
  },
};

module.exports = { forecastReadTool };
