const { Op } = require('sequelize');
const { Zone, Ride, Staff, CrowdEvent, Recommendation } = require('../models');

class DashboardService {
  async getSummary() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      zonesTotal,
      ridesOpen,
      ridesTotal,
      staffAvailable,
      staffTotal,
      openRecommendations,
      eventsLast24h,
      zones,
    ] = await Promise.all([
      Zone.count(),
      Ride.count({ where: { status: 'OPEN' } }),
      Ride.count(),
      Staff.count({ where: { available: true } }),
      Staff.count(),
      Recommendation.count({ where: { status: 'OPEN' } }),
      CrowdEvent.count({ where: { createdAt: { [Op.gte]: since } } }),
      Zone.findAll({ attributes: ['id', 'name', 'currentCrowdLevel', 'maxCapacity', 'status'] }),
    ]);

    const zonesNearCapacity = zones.filter((z) => {
      const cap = z.maxCapacity || 1;
      return z.currentCrowdLevel / cap >= 0.75;
    }).length;

    const priorityKeys = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const openByPriority = {};
    await Promise.all(
      priorityKeys.map(async (p) => {
        openByPriority[p] = await Recommendation.count({ where: { status: 'OPEN', priority: p } });
      })
    );

    const recentEvents = await CrowdEvent.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [{ association: 'zone', attributes: ['id', 'name'] }],
    });

    return {
      generatedAt: new Date().toISOString(),
      zones: { total: zonesTotal, nearCapacityCount: zonesNearCapacity },
      rides: { total: ridesTotal, open: ridesOpen },
      staff: { total: staffTotal, available: staffAvailable },
      recommendations: { open: openRecommendations, openByPriority },
      events: { last24Hours: eventsLast24h, recentSample: recentEvents },
    };
  }
}

module.exports = { DashboardService };
