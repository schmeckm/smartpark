class MdmRepository {
  /**
   * @param {import('sequelize').Sequelize} sequelize
   * @param {Record<string, import('sequelize').Model>} m
   */
  constructor(sequelize, m) {
    this.sequelize = sequelize;
    this.m = m;
  }

  rideIncludes() {
    const { MdmRideOperations, MdmRideCapacity, MdmRideStaffing, MdmRideSafety, MdmRideGuestRules, MdmRideIntegration, MdmRideKpiTargets, MdmRideStaffRole, MdmRideDocument, MdmPark, MdmParkZone, MdmRideType } = this.m;
    return [
      { model: MdmPark, as: 'park', required: false },
      { model: MdmParkZone, as: 'parkZone', required: false },
      { model: MdmRideType, as: 'rideType', required: false },
      { model: MdmRideOperations, as: 'operations', required: false },
      { model: MdmRideCapacity, as: 'capacity', required: false },
      { model: MdmRideStaffing, as: 'staffing', required: false },
      { model: MdmRideSafety, as: 'safety', required: false },
      { model: MdmRideGuestRules, as: 'guestRules', required: false },
      { model: MdmRideIntegration, as: 'integration', required: false },
      { model: MdmRideKpiTargets, as: 'kpiTargets', required: false },
      { model: MdmRideStaffRole, as: 'staffRoles', required: false },
      { model: MdmRideDocument, as: 'documents', required: false },
    ];
  }

  listParks() {
    return this.m.MdmPark.findAll({ order: [['code', 'ASC']] });
  }

  listZones(parkId) {
    return this.m.MdmParkZone.findAll({ where: { parkId }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  }

  listRideTypes() {
    return this.m.MdmRideType.findAll({ order: [['code', 'ASC']] });
  }

  listTemplates(query = {}) {
    const where = {};
    if (query.rideTypeId) where.rideTypeId = query.rideTypeId;
    return this.m.MdmRideTemplate.findAll({ where, include: [{ model: this.m.MdmRideType, as: 'rideType' }], order: [['displayName', 'ASC']] });
  }

  findTemplateById(id) {
    return this.m.MdmRideTemplate.findByPk(id, { include: [{ model: this.m.MdmRideType, as: 'rideType' }] });
  }

  listRides({ parkId, parkZoneId, activeFlag } = {}) {
    const where = {};
    if (parkId) where.parkId = parkId;
    if (parkZoneId) where.parkZoneId = parkZoneId;
    if (activeFlag !== undefined && activeFlag !== null && activeFlag !== '') where.activeFlag = activeFlag === true || activeFlag === 'true';
    return this.m.MdmRide.findAll({
      where,
      include: this.rideIncludes(),
      order: [['name', 'ASC']],
    });
  }

  findRideById(id) {
    return this.m.MdmRide.findByPk(id, { include: this.rideIncludes() });
  }

  async createEmptyExtensionRows(rideId, transaction, userId) {
    const { MdmRideOperations, MdmRideCapacity, MdmRideStaffing, MdmRideSafety, MdmRideGuestRules, MdmRideIntegration, MdmRideKpiTargets } = this.m;
    const audit = { createdBy: userId || null, updatedBy: userId || null };
    await MdmRideOperations.create({ rideId, ...audit }, { transaction });
    await MdmRideCapacity.create({ rideId, ...audit }, { transaction });
    await MdmRideStaffing.create({ rideId, ...audit }, { transaction });
    await MdmRideSafety.create({ rideId, ...audit }, { transaction });
    await MdmRideGuestRules.create({ rideId, ...audit }, { transaction });
    await MdmRideIntegration.create({ rideId, ...audit }, { transaction });
    await MdmRideKpiTargets.create({ rideId, ...audit }, { transaction });
  }

  async applyProfileToExtensions(rideId, profile, transaction, userId) {
    if (!profile || typeof profile !== 'object') return;
    const audit = { updatedBy: userId || null };
    const { MdmRideOperations, MdmRideCapacity, MdmRideStaffing, MdmRideSafety, MdmRideGuestRules, MdmRideIntegration, MdmRideKpiTargets } = this.m;
    const pairs = [
      [MdmRideOperations, profile.operations],
      [MdmRideCapacity, profile.capacity],
      [MdmRideStaffing, profile.staffing],
      [MdmRideSafety, profile.safety],
      [MdmRideGuestRules, profile.guestRules],
      [MdmRideIntegration, profile.integration],
      [MdmRideKpiTargets, profile.kpi],
    ];
    for (const [Model, patch] of pairs) {
      if (!patch || typeof patch !== 'object') continue;
      const row = await Model.findByPk(rideId, { transaction });
      if (row) await row.update({ ...patch, ...audit }, { transaction });
    }
  }

  async appendStatusHistory(rideId, fromStatus, toStatus, reason, userId, transaction) {
    await this.m.MdmRideStatusHistory.create(
      {
        rideId,
        fromStatus,
        toStatus,
        reason: reason || null,
        changedAt: new Date(),
        changedBy: userId || null,
      },
      { transaction }
    );
  }
}

module.exports = { MdmRepository };
