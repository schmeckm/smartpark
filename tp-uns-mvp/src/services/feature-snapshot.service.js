const { Op } = require('sequelize');
const { LatestState, ForecastSnapshot, Park } = require('../models');
const { AppError } = require('../utils/app-error');

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function topicMetric(topicPath) {
  const parts = String(topicPath || '').split('/');
  return parts[5] || '';
}

class FeatureSnapshotService {
  async createFeatureSnapshot(parkId) {
    const park = await Park.findByPk(parkId);
    if (!park) throw new AppError('Park not found', 404);

    const rows = await LatestState.findAll({
      where: {
        parkId,
        topicPath: {
          [Op.or]: [
            { [Op.like]: 'tpuns/%/v1/rides/%/queue_time' },
            { [Op.like]: 'tpuns/%/v1/rides/%/status' },
            { [Op.like]: 'tpuns/%/v1/entry/%/vehicle_count' },
            { [Op.like]: 'tpuns/%/v1/traffic/%/congestion_factor' },
          ],
        },
      },
    });

    const queueTimes = rows.filter((r) => topicMetric(r.topicPath) === 'queue_time').map((r) => toNum(r.value));
    const statuses = rows.filter((r) => topicMetric(r.topicPath) === 'status').map((r) => String(r.value || '').toUpperCase());
    const vehicleCounts = rows.filter((r) => topicMetric(r.topicPath) === 'vehicle_count').map((r) => toNum(r.value));
    const trafficFactors = rows.filter((r) => topicMetric(r.topicPath) === 'congestion_factor').map((r) => toNum(r.value));

    const avgQueueTime = queueTimes.length ? queueTimes.reduce((a, b) => a + b, 0) / queueTimes.length : 0;
    const openRidesCount = statuses.filter((s) => s === 'OPEN').length;
    const closedRidesCount = statuses.filter((s) => s === 'CLOSED').length;
    const trafficPressureIndex = trafficFactors.length
      ? trafficFactors.reduce((a, b) => a + b, 0) / trafficFactors.length
      : 0;
    const vehicleAvg = vehicleCounts.length ? vehicleCounts.reduce((a, b) => a + b, 0) / vehicleCounts.length : 0;
    const inboundIndex = Math.max(0, vehicleAvg * (1 + trafficPressureIndex));
    const crowdIndex = Math.max(0, Math.min(100, avgQueueTime * 1.5 + trafficPressureIndex * 20 + inboundIndex * 0.02));

    return ForecastSnapshot.create({
      parkId,
      snapshotTime: new Date(),
      crowdIndex,
      inboundIndex,
      avgQueueTime,
      trafficPressureIndex,
      openRidesCount,
      closedRidesCount,
    });
  }
}

module.exports = { FeatureSnapshotService };
