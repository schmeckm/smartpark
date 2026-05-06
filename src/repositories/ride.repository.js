const { Ride, Zone } = require('../models');
const { Op } = require('sequelize');

class RideRepository {
  findAll(options = {}) {
    return Ride.findAll({
      order: [['name', 'ASC']],
      include: options.includeZone ? [{ model: Zone, as: 'zone', required: false }] : undefined,
    });
  }

  findById(id, options = {}) {
    return Ride.findByPk(id, {
      include: options.includeZone ? [{ model: Zone, as: 'zone', required: false }] : undefined,
    });
  }

  findByZoneId(zoneId) {
    return Ride.findAll({ where: { zoneId } });
  }

  countLongWaitsInZone(zoneId, minWaitMinutes) {
    return Ride.count({
      where: {
        zoneId,
        status: 'OPEN',
        waitTime: { [Op.gt]: minWaitMinutes },
      },
    });
  }

  create(data) {
    return Ride.create(data);
  }

  async updateById(id, data) {
    const ride = await Ride.findByPk(id);
    if (!ride) return null;
    await ride.update(data);
    return ride;
  }

  async deleteById(id) {
    const ride = await Ride.findByPk(id);
    if (!ride) return false;
    await ride.destroy();
    return true;
  }
}

module.exports = { RideRepository };
