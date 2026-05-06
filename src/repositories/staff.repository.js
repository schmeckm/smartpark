const { Staff, Zone } = require('../models');

function buildIncludes(options = {}) {
  const { includeZone = false, includeSupervisor = true } = options;
  const include = [];
  if (includeZone) {
    include.push({ model: Zone, as: 'currentZone', required: false });
  }
  if (includeSupervisor) {
    include.push({
      model: Staff,
      as: 'supervisor',
      required: false,
      attributes: ['id', 'firstName', 'lastName', 'employeeNumber', 'role'],
    });
  }
  return include.length ? include : undefined;
}

class StaffRepository {
  findAll(options = {}) {
    return Staff.findAll({
      order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      include: buildIncludes({
        includeZone: options.includeZone,
        includeSupervisor: options.includeSupervisor !== false,
      }),
    });
  }

  findById(id, options = {}) {
    return Staff.findByPk(id, {
      include: buildIncludes({
        includeZone: options.includeZone,
        includeSupervisor: options.includeSupervisor !== false,
      }),
    });
  }

  create(data) {
    return Staff.create(data);
  }

  async updateById(id, data) {
    const staff = await Staff.findByPk(id);
    if (!staff) return null;
    await staff.update(data);
    return staff;
  }

  async deleteById(id) {
    const staff = await Staff.findByPk(id);
    if (!staff) return false;
    await staff.destroy();
    return true;
  }
}

module.exports = { StaffRepository };
