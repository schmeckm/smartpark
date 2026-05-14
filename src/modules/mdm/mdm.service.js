const { Op } = require('sequelize');
const { AppError } = require('../../utils/app-error');
const { MdmRepository } = require('./mdm.repository');

class MdmService {
  /**
   * @param {import('sequelize').Sequelize} sequelize
   * @param {Record<string, import('sequelize').Model>} models
   */
  constructor(sequelize, models) {
    this.sequelize = sequelize;
    this.models = models;
    this.repo = new MdmRepository(sequelize, models);
  }

  async assertZoneInPark(parkZoneId, parkId) {
    const z = await this.models.MdmParkZone.findByPk(parkZoneId);
    if (!z) throw new AppError('Park zone not found', 404, { code: 'NOT_FOUND' });
    if (String(z.parkId) !== String(parkId)) throw new AppError('Zone does not belong to park', 422, { code: 'VALIDATION_ERROR' });
    return z;
  }

  listParks() {
    return this.repo.listParks();
  }

  listZones(parkId) {
    return this.repo.listZones(parkId);
  }

  listRideTypes() {
    return this.repo.listRideTypes();
  }

  listTemplates(query) {
    return this.repo.listTemplates(query);
  }

  getTemplate(id) {
    return this.repo.findTemplateById(id);
  }

  listRides(query) {
    return this.repo.listRides(query);
  }

  getRide(id) {
    return this.repo.findRideById(id);
  }

  async createRide(payload, userId) {
    const { MdmRide } = this.models;
    await this.assertZoneInPark(payload.parkZoneId, payload.parkId);
    const t = await this.sequelize.transaction();
    try {
      const ride = await MdmRide.create(
        {
          parkId: payload.parkId,
          parkZoneId: payload.parkZoneId,
          rideTypeId: payload.rideTypeId,
          internalRideId: payload.internalRideId || null,
          externalId: payload.externalId || null,
          name: payload.name,
          shortName: payload.shortName || null,
          description: payload.description || null,
          manufacturer: payload.manufacturer || null,
          model: payload.model || null,
          buildYear: payload.buildYear ?? null,
          commissioningDate: payload.commissioningDate || null,
          lifecycleStatus: payload.lifecycleStatus || 'ACTIVE',
          activeFlag: payload.activeFlag !== false,
          createdBy: userId || null,
          updatedBy: userId || null,
        },
        { transaction: t }
      );
      await this.repo.createEmptyExtensionRows(ride.id, t, userId);
      if (payload.profile && typeof payload.profile === 'object') {
        await this.repo.applyProfileToExtensions(ride.id, payload.profile, t, userId);
      }
      await this.repo.appendStatusHistory(ride.id, null, ride.lifecycleStatus, 'Created', userId, t);
      await t.commit();
      return this.repo.findRideById(ride.id);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async updateRide(id, payload, userId) {
    const ride = await this.models.MdmRide.findByPk(id);
    if (!ride) throw new AppError('MDM ride not found', 404, { code: 'NOT_FOUND' });
    if (payload.parkZoneId && payload.parkId) {
      await this.assertZoneInPark(payload.parkZoneId, payload.parkId);
    } else if (payload.parkZoneId) {
      await this.assertZoneInPark(payload.parkZoneId, ride.parkId);
    }
    const t = await this.sequelize.transaction();
    try {
      const prevLifecycle = ride.lifecycleStatus;
      const corePatch = { ...payload, updatedBy: userId || null };
      ['operations', 'capacity', 'staffing', 'safety', 'guestRules', 'integration', 'kpi', 'kpiTargets', 'profile'].forEach((k) => delete corePatch[k]);
      Object.keys(corePatch).forEach((k) => {
        if (corePatch[k] === undefined) delete corePatch[k];
      });
      await ride.update(corePatch, { transaction: t });
      const extModels = {
        operations: this.models.MdmRideOperations,
        capacity: this.models.MdmRideCapacity,
        staffing: this.models.MdmRideStaffing,
        safety: this.models.MdmRideSafety,
        guestRules: this.models.MdmRideGuestRules,
        integration: this.models.MdmRideIntegration,
        kpiTargets: this.models.MdmRideKpiTargets,
      };
      for (const [key, Model] of Object.entries(extModels)) {
        if (!payload[key] || typeof payload[key] !== 'object') continue;
        const row = await Model.findByPk(ride.id, { transaction: t });
        if (row) await row.update({ ...payload[key], updatedBy: userId || null }, { transaction: t });
      }
      if (payload.kpi && typeof payload.kpi === 'object') {
        const row = await this.models.MdmRideKpiTargets.findByPk(ride.id, { transaction: t });
        if (row) await row.update({ ...payload.kpi, updatedBy: userId || null }, { transaction: t });
      }
      if (payload.lifecycleStatus && payload.lifecycleStatus !== prevLifecycle) {
        await this.repo.appendStatusHistory(ride.id, prevLifecycle, payload.lifecycleStatus, payload.lifecycleReason || null, userId, t);
      }
      await t.commit();
      return this.repo.findRideById(id);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async setActiveFlag(id, activeFlag, userId) {
    const ride = await this.models.MdmRide.findByPk(id);
    if (!ride) throw new AppError('MDM ride not found', 404, { code: 'NOT_FOUND' });
    const prev = Boolean(ride.activeFlag);
    const next = Boolean(activeFlag);
    const t = await this.sequelize.transaction();
    try {
      await ride.update({ activeFlag: next, updatedBy: userId || null }, { transaction: t });
      await this.repo.appendStatusHistory(ride.id, prev ? 'ACTIVE' : 'INACTIVE', next ? 'ACTIVE' : 'INACTIVE', 'active_flag', userId, t);
      await t.commit();
      return this.repo.findRideById(id);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async cloneFromTemplate(templateId, body, userId) {
    const tpl = await this.repo.findTemplateById(templateId);
    if (!tpl) throw new AppError('Template not found', 404, { code: 'NOT_FOUND' });
    const zone = await this.models.MdmParkZone.findByPk(body.parkZoneId);
    if (!zone) throw new AppError('Park zone not found', 404, { code: 'NOT_FOUND' });
    return this.createRide(
      {
        parkId: zone.parkId,
        parkZoneId: body.parkZoneId,
        rideTypeId: tpl.rideTypeId,
        name: body.name,
        externalId: body.externalId || null,
        shortName: body.shortName || null,
        description: body.description || null,
        profile: tpl.defaultProfile,
      },
      userId
    );
  }

  async getCapacityModel(rideId) {
    const ride = await this.repo.findRideById(rideId);
    if (!ride) throw new AppError('MDM ride not found', 404, { code: 'NOT_FOUND' });
    return {
      rideId: ride.id,
      name: ride.name,
      capacity: ride.capacity,
      operations: {
        dispatchIntervalSec: ride.capacity?.dispatchIntervalSec ?? null,
        seasonalFlag: ride.operations?.seasonalFlag ?? null,
        weatherSensitiveFlag: ride.operations?.weatherSensitiveFlag ?? null,
      },
    };
  }

  async getStaffingModel(rideId) {
    const ride = await this.repo.findRideById(rideId);
    if (!ride) throw new AppError('MDM ride not found', 404, { code: 'NOT_FOUND' });
    return {
      rideId: ride.id,
      name: ride.name,
      staffing: ride.staffing,
      staffRoles: ride.staffRoles || [],
    };
  }

  async assignZone(rideId, parkZoneId, userId) {
    const ride = await this.models.MdmRide.findByPk(rideId);
    if (!ride) throw new AppError('MDM ride not found', 404, { code: 'NOT_FOUND' });
    await this.assertZoneInPark(parkZoneId, ride.parkId);
    await ride.update({ parkZoneId, updatedBy: userId || null });
    return this.repo.findRideById(rideId);
  }

  async createPark(body, userId) {
    return this.models.MdmPark.create({
      code: body.code,
      name: body.name,
      timezone: body.timezone || null,
      activeFlag: body.activeFlag !== false,
      futureHints: body.futureHints || {},
      createdBy: userId || null,
      updatedBy: userId || null,
    });
  }

  async createZone(parkId, body, userId) {
    const p = await this.models.MdmPark.findByPk(parkId);
    if (!p) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
    return this.models.MdmParkZone.create({
      parkId,
      code: body.code,
      name: body.name,
      sortOrder: body.sortOrder ?? 0,
      zoneContext: body.zoneContext && typeof body.zoneContext === 'object' ? body.zoneContext : {},
      legacyZoneId: body.legacyZoneId || null,
      createdBy: userId || null,
      updatedBy: userId || null,
    });
  }

  async createTemplate(body, userId) {
    return this.models.MdmRideTemplate.create({
      rideTypeId: body.rideTypeId,
      code: body.code,
      displayName: body.displayName,
      defaultProfile: body.defaultProfile || {},
      isSystem: Boolean(body.isSystem),
      createdBy: userId || null,
      updatedBy: userId || null,
    });
  }

  async updateTemplate(id, body, userId) {
    const row = await this.models.MdmRideTemplate.findByPk(id);
    if (!row) throw new AppError('Template not found', 404, { code: 'NOT_FOUND' });
    const patch = {};
    for (const k of ['displayName', 'defaultProfile', 'isSystem', 'rideTypeId', 'code']) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    await row.update({
      ...patch,
      updatedBy: userId || null,
    });
    return this.repo.findTemplateById(id);
  }
}

module.exports = { MdmService };
