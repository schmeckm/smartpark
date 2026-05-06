const { AppError } = require('../utils/app-error');
const { RideRepository } = require('../repositories/ride.repository');
const { ZoneRepository } = require('../repositories/zone.repository');
const { emitZoneUpdated } = require('../sockets');
const { AuditLogService } = require('./audit-log.service');
const { jsonSnapshot } = require('../utils/json-snapshot');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();

class RideService {
  constructor() {
    this.rideRepository = new RideRepository();
    this.zoneRepository = new ZoneRepository();
  }

  listRides() {
    return this.rideRepository.findAll({ includeZone: true });
  }

  async getRideById(id) {
    const ride = await this.rideRepository.findById(id, { includeZone: true });
    if (!ride) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
    return ride;
  }

  async createRide(payload) {
    await this.ensureZoneExists(payload.zoneId);
    const ride = await this.rideRepository.create({
      name: payload.name,
      zoneId: payload.zoneId,
      status: payload.status ?? 'OPEN',
      waitTime: payload.waitTime ?? 0,
      capacityPerHour: payload.capacityPerHour ?? 0,
      criticality: payload.criticality ?? 1,
    });
    await this.emitZoneRefresh(payload.zoneId);
    await auditLogService.log({
      action: AUDIT.RIDE_CREATE,
      entityType: 'ride',
      entityId: ride.id,
      oldValue: null,
      newValue: jsonSnapshot(ride),
    });
    return ride;
  }

  async updateRide(id, payload) {
    const existing = await this.rideRepository.findById(id);
    if (!existing) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
    if (payload.zoneId) await this.ensureZoneExists(payload.zoneId);

    const ride = await this.rideRepository.updateById(id, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.zoneId !== undefined ? { zoneId: payload.zoneId } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.waitTime !== undefined ? { waitTime: payload.waitTime } : {}),
      ...(payload.capacityPerHour !== undefined ? { capacityPerHour: payload.capacityPerHour } : {}),
      ...(payload.criticality !== undefined ? { criticality: payload.criticality } : {}),
    });

    await this.emitZoneRefresh(existing.zoneId);
    if (payload.zoneId && payload.zoneId !== existing.zoneId) {
      await this.emitZoneRefresh(payload.zoneId);
    }

    const statusChanged =
      payload.status !== undefined && payload.status !== existing.status;
    await auditLogService.log({
      action: statusChanged ? AUDIT.RIDE_STATUS_CHANGE : AUDIT.RIDE_UPDATE,
      entityType: 'ride',
      entityId: id,
      oldValue: jsonSnapshot(existing),
      newValue: jsonSnapshot(ride),
    });

    return ride;
  }

  async deleteRide(id) {
    const existing = await this.rideRepository.findById(id);
    if (!existing) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
    const zoneId = existing.zoneId;
    await this.rideRepository.deleteById(id);
    await this.emitZoneRefresh(zoneId);
    await auditLogService.log({
      action: AUDIT.RIDE_DELETE,
      entityType: 'ride',
      entityId: id,
      oldValue: jsonSnapshot(existing),
      newValue: null,
    });
  }

  async ensureZoneExists(zoneId) {
    const zone = await this.zoneRepository.findById(zoneId);
    if (!zone) throw new AppError('Zone not found for ride', 400, { code: 'BAD_REQUEST' });
  }

  async emitZoneRefresh(zoneId) {
    const zone = await this.zoneRepository.findById(zoneId, {
      includeRides: true,
      includeStaff: true,
    });
    if (zone) emitZoneUpdated(zone);
  }
}

module.exports = { RideService };
