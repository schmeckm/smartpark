const { Op } = require('sequelize');
const { sequelize, Forecast, MlModelVersion } = require('../models');

class ForecastRepository {
  /**
   * Replace all ZONE + CROWD_LEVEL forecasts for a model version in one transaction.
   */
  async replaceZoneCrowdLevelForecasts(modelVersionId, rows) {
    return sequelize.transaction(async (t) => {
      await Forecast.destroy({
        where: { modelVersionId, subjectType: 'ZONE', targetMetric: 'CROWD_LEVEL' },
        transaction: t,
      });
      if (rows.length === 0) return [];
      return Forecast.bulkCreate(rows, { transaction: t, validate: true, returning: true });
    });
  }

  /**
   * Latest ZONE + CROWD_LEVEL forecast for a zone at 60m horizon (baseline model optional).
   */
  async findLatestZoneCrowd60m(zoneId) {
    const now = new Date();
    return Forecast.findOne({
      where: {
        subjectType: 'ZONE',
        subjectId: zoneId,
        targetMetric: 'CROWD_LEVEL',
        horizonMinutes: 60,
        [Op.or]: [{ expiresAt: { [Op.gt]: now } }, { expiresAt: null }],
      },
      order: [['producedAt', 'DESC']],
      include: [{ model: MlModelVersion, as: 'modelVersion', required: false }],
    });
  }

  async listRecent(options = {}) {
    const { horizonMinutes, subjectType, targetMetric, limit = 100, zoneIds } = options;
    const where = {};
    if (horizonMinutes != null) where.horizonMinutes = horizonMinutes;
    if (subjectType) where.subjectType = subjectType;
    if (targetMetric) where.targetMetric = targetMetric;
    if (Array.isArray(zoneIds) && zoneIds.length) {
      where.subjectType = 'ZONE';
      where.subjectId = { [Op.in]: zoneIds };
    }

    const now = new Date();
    return Forecast.findAll({
      where: {
        ...where,
        [Op.or]: [{ expiresAt: { [Op.gt]: now } }, { expiresAt: null }],
      },
      order: [['producedAt', 'DESC']],
      limit: Math.min(200, limit),
      include: [{ model: MlModelVersion, as: 'modelVersion', required: false }],
    });
  }
}

module.exports = { ForecastRepository };
