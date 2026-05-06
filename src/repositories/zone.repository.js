const { Op } = require('sequelize');
const { Zone, Ride, Staff } = require('../models');

class ZoneRepository {
  findAll(options = {}) {
    const include = [];
    if (options.includeRides) include.push({ model: Ride, as: 'rides', required: false });
    if (options.includeStaff) {
      include.push({
        model: Staff,
        as: 'staffMembers',
        required: false,
        include: [
          {
            model: Staff,
            as: 'supervisor',
            required: false,
            attributes: ['id', 'firstName', 'lastName', 'employeeNumber', 'role'],
          },
        ],
      });
    }
    return Zone.findAll({
      order: [['name', 'ASC']],
      ...(include.length ? { include } : {}),
    });
  }

  findAllActive() {
    return Zone.findAll({
      where: { status: 'ACTIVE' },
      order: [['name', 'ASC']],
    });
  }

  findById(id, options = {}) {
    const include = [];
    if (options.includeRides) include.push({ model: Ride, as: 'rides', required: false });
    if (options.includeStaff) {
      include.push({
        model: Staff,
        as: 'staffMembers',
        required: false,
        include: [
          {
            model: Staff,
            as: 'supervisor',
            required: false,
            attributes: ['id', 'firstName', 'lastName', 'employeeNumber', 'role'],
          },
        ],
      });
    }
    return Zone.findByPk(id, {
      ...(include.length ? { include } : {}),
    });
  }

  findByIds(ids) {
    if (!ids || ids.length === 0) return Promise.resolve([]);
    return Zone.findAll({ where: { id: { [Op.in]: ids } } });
  }

  create(data) {
    return Zone.create(data);
  }

  async updateById(id, data) {
    const zone = await Zone.findByPk(id);
    if (!zone) return null;
    await zone.update(data);
    return zone;
  }

  async deleteById(id) {
    const zone = await Zone.findByPk(id);
    if (!zone) return false;
    await zone.destroy();
    return true;
  }

  countFoodStaffAvailableInZone(zoneId) {
    return Staff.count({
      where: {
        currentZoneId: zoneId,
        role: 'FOOD_SERVICE',
        available: true,
      },
    });
  }
}

module.exports = { ZoneRepository };
