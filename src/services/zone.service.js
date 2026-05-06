const { AppError } = require('../utils/app-error');
const { ZoneRepository } = require('../repositories/zone.repository');
const { emitZoneUpdated } = require('../sockets');
const { AuditLogService } = require('./audit-log.service');
const { jsonSnapshot } = require('../utils/json-snapshot');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();

class ZoneService {
  constructor() {
    this.zoneRepository = new ZoneRepository();
  }

  listZones() {
    return this.zoneRepository.findAll({ includeRides: true, includeStaff: true });
  }

  async getZoneById(id) {
    const zone = await this.zoneRepository.findById(id, { includeRides: true, includeStaff: true });
    if (!zone) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
    return zone;
  }

  async createZone(payload) {
    const created = await this.zoneRepository.create({
      name: payload.name,
      type: payload.type,
      currentCrowdLevel: payload.currentCrowdLevel ?? 0,
      forecastCrowdLevel: payload.forecastCrowdLevel ?? 0,
      maxCapacity: payload.maxCapacity,
      status: payload.status ?? 'ACTIVE',
      adjacentZoneIds: payload.adjacentZoneIds ?? [],
    });
    const zone = await this.zoneRepository.findById(created.id, {
      includeRides: true,
      includeStaff: true,
    });
    emitZoneUpdated(zone || created);
    await auditLogService.log({
      action: AUDIT.ZONE_CREATE,
      entityType: 'zone',
      entityId: created.id,
      oldValue: null,
      newValue: jsonSnapshot(zone || created),
    });
    return zone || created;
  }

  async updateZone(id, payload) {
    const before = await this.zoneRepository.findById(id, { includeRides: true, includeStaff: true });
    if (!before) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });

    const updated = await this.zoneRepository.updateById(id, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.type !== undefined ? { type: payload.type } : {}),
      ...(payload.currentCrowdLevel !== undefined ? { currentCrowdLevel: payload.currentCrowdLevel } : {}),
      ...(payload.forecastCrowdLevel !== undefined ? { forecastCrowdLevel: payload.forecastCrowdLevel } : {}),
      ...(payload.maxCapacity !== undefined ? { maxCapacity: payload.maxCapacity } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.adjacentZoneIds !== undefined ? { adjacentZoneIds: payload.adjacentZoneIds } : {}),
    });
    if (!updated) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
    const zone = await this.zoneRepository.findById(id, { includeRides: true, includeStaff: true });
    if (!zone) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
    emitZoneUpdated(zone);
    await auditLogService.log({
      action: AUDIT.ZONE_UPDATE,
      entityType: 'zone',
      entityId: id,
      oldValue: jsonSnapshot(before),
      newValue: jsonSnapshot(zone),
    });
    return zone;
  }

  async deleteZone(id) {
    const before = await this.zoneRepository.findById(id);
    const ok = await this.zoneRepository.deleteById(id);
    if (!ok) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });
    emitZoneUpdated({ id, deleted: true });
    await auditLogService.log({
      action: AUDIT.ZONE_DELETE,
      entityType: 'zone',
      entityId: id,
      oldValue: jsonSnapshot(before),
      newValue: null,
    });
  }
}

module.exports = { ZoneService };
