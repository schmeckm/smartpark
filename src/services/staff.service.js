const { UniqueConstraintError } = require('sequelize');
const { AppError } = require('../utils/app-error');
const { userHasPermission } = require('../constants/rbac');
const { StaffRepository } = require('../repositories/staff.repository');
const { ZoneRepository } = require('../repositories/zone.repository');
const { Ride } = require('../models');
const { emitZoneUpdated } = require('../sockets');
const { AuditLogService } = require('./audit-log.service');
const { jsonSnapshot } = require('../utils/json-snapshot');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();

class StaffService {
  constructor() {
    this.staffRepository = new StaffRepository();
    this.zoneRepository = new ZoneRepository();
  }

  /**
   * Compute the assignment fields for an UPDATE patch, merging the partial
   * payload with the existing row, then delegating to `resolveAssignment`.
   * Returns `{}` when neither ride nor zone is touched by the caller.
   */
  async buildAssignmentPatch(existing, payload) {
    if (payload.currentRideId === undefined && payload.currentZoneId === undefined) {
      return {};
    }
    const rideExplicit = payload.currentRideId !== undefined;
    const nextRideId = rideExplicit ? payload.currentRideId ?? null : existing.currentRideId;

    let nextZoneId;
    if (nextRideId) {
      // resolveAssignment will derive the zone from the ride.
      nextZoneId = null;
    } else if (payload.currentZoneId !== undefined) {
      nextZoneId = payload.currentZoneId ?? null;
    } else {
      nextZoneId = existing.currentZoneId;
    }

    const resolved = await this.resolveAssignment({
      currentZoneId: nextZoneId,
      currentRideId: nextRideId,
    });
    return {
      currentZoneId: resolved.currentZoneId,
      currentRideId: resolved.currentRideId,
    };
  }

  /**
   * Resolve the assignment fields for a write payload.
   *
   * Flexible-staff semantics: a staff member is assigned EITHER to a zone
   * OR to a ride/show/attraction. When `currentRideId` is provided, the
   * ride's `zoneId` is the source of truth for `currentZoneId` (so
   * existing zone-based aggregations keep working transparently).
   *
   * @returns {Promise<{ currentZoneId: string|null, currentRideId: string|null }>}
   */
  async resolveAssignment({ currentZoneId, currentRideId }) {
    if (currentRideId) {
      const ride = await Ride.findByPk(currentRideId, { attributes: ['id', 'zoneId'] });
      if (!ride) {
        throw new AppError('Ride / show / attraction not found for staff assignment', 400, {
          code: 'BAD_REQUEST',
        });
      }
      return { currentZoneId: ride.zoneId, currentRideId };
    }
    if (currentZoneId) {
      await this.ensureZoneExists(currentZoneId);
      return { currentZoneId, currentRideId: null };
    }
    return { currentZoneId: null, currentRideId: null };
  }

  listStaff() {
    return this.staffRepository.findAll({ includeZone: true, includeRide: true });
  }

  async getStaffById(id) {
    const staff = await this.staffRepository.findById(id, {
      includeZone: true,
      includeRide: true,
    });
    if (!staff) throw new AppError('Staff member not found', 404, { code: 'NOT_FOUND' });
    return staff;
  }

  normalizeEmployeeNumber(v) {
    if (v === undefined || v === null || v === '') return null;
    return String(v).trim() || null;
  }

  async ensureSupervisorValid(supervisorId, excludeStaffId) {
    if (supervisorId == null || supervisorId === '') return;
    if (excludeStaffId && supervisorId === excludeStaffId) {
      throw new AppError('Supervisor / People Manager cannot be the same person', 400, { code: 'BAD_SUPERVISOR' });
    }
    const row = await this.staffRepository.findById(supervisorId, {
      includeZone: false,
      includeSupervisor: false,
    });
    if (!row) {
      throw new AppError('Supervisor / People Manager not found', 400, { code: 'BAD_SUPERVISOR' });
    }
  }

  async createStaff(payload) {
    const assignment = await this.resolveAssignment({
      currentZoneId: payload.currentZoneId ?? null,
      currentRideId: payload.currentRideId ?? null,
    });
    const supervisorId = payload.supervisorId ?? null;
    if (supervisorId) await this.ensureSupervisorValid(supervisorId, null);
    const employeeNumber = this.normalizeEmployeeNumber(payload.employeeNumber);
    let created;
    try {
      created = await this.staffRepository.create({
        firstName: payload.firstName,
        lastName: payload.lastName,
        employeeNumber,
        supervisorId,
        role: payload.role,
        currentZoneId: assignment.currentZoneId,
        currentRideId: assignment.currentRideId,
        available: payload.available ?? true,
        skillLevel: payload.skillLevel ?? 1,
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError && e.errors?.some((x) => x.path === 'employee_number')) {
        throw new AppError('Personalnummer ist bereits vergeben', 409, { code: 'DUPLICATE_EMPLOYEE_NUMBER' });
      }
      throw e;
    }
    if (created.currentZoneId) await this.emitZoneRefresh(created.currentZoneId);
    const member = await this.staffRepository.findById(created.id, {
      includeZone: true,
      includeRide: true,
    });
    await auditLogService.log({
      action: AUDIT.STAFF_CREATE,
      entityType: 'staff',
      entityId: created.id,
      oldValue: null,
      newValue: jsonSnapshot(member),
    });
    return member;
  }

  async updateStaff(id, payload) {
    const existing = await this.staffRepository.findById(id, { includeZone: false, includeRide: false, includeSupervisor: false });
    if (!existing) throw new AppError('Staff member not found', 404, { code: 'NOT_FOUND' });
    if (payload.supervisorId !== undefined) {
      const sid = payload.supervisorId ?? null;
      if (sid) await this.ensureSupervisorValid(sid, id);
    }

    // Either-or assignment: if ride or zone is part of this patch, resolve them together.
    const assignmentPatch = await this.buildAssignmentPatch(existing, payload);

    const patch = {
      ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
      ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
      ...(payload.role !== undefined ? { role: payload.role } : {}),
      ...assignmentPatch,
      ...(payload.supervisorId !== undefined ? { supervisorId: payload.supervisorId ?? null } : {}),
      ...(payload.available !== undefined ? { available: payload.available } : {}),
      ...(payload.skillLevel !== undefined ? { skillLevel: payload.skillLevel } : {}),
    };
    if (payload.employeeNumber !== undefined) {
      patch.employeeNumber = this.normalizeEmployeeNumber(payload.employeeNumber);
    }
    try {
      await this.staffRepository.updateById(id, patch);
    } catch (e) {
      if (e instanceof UniqueConstraintError && e.errors?.some((x) => x.path === 'employee_number')) {
        throw new AppError('Personalnummer ist bereits vergeben', 409, { code: 'DUPLICATE_EMPLOYEE_NUMBER' });
      }
      throw e;
    }

    if (existing.currentZoneId) await this.emitZoneRefresh(existing.currentZoneId);
    if (
      assignmentPatch.currentZoneId &&
      assignmentPatch.currentZoneId !== existing.currentZoneId
    ) {
      await this.emitZoneRefresh(assignmentPatch.currentZoneId);
    }
    const member = await this.staffRepository.findById(id, {
      includeZone: true,
      includeRide: true,
    });
    await auditLogService.log({
      action: AUDIT.STAFF_UPDATE,
      entityType: 'staff',
      entityId: id,
      oldValue: jsonSnapshot(existing),
      newValue: jsonSnapshot(member),
    });
    return member;
  }

  async deleteStaff(id) {
    const existing = await this.staffRepository.findById(id, { includeZone: false, includeSupervisor: false });
    if (!existing) throw new AppError('Staff member not found', 404, { code: 'NOT_FOUND' });
    await this.staffRepository.deleteById(id);
    if (existing.currentZoneId) await this.emitZoneRefresh(existing.currentZoneId);
    await auditLogService.log({
      action: AUDIT.STAFF_DELETE,
      entityType: 'staff',
      entityId: id,
      oldValue: jsonSnapshot(existing),
      newValue: null,
    });
  }

  async ensureZoneExists(zoneId) {
    const zone = await this.zoneRepository.findById(zoneId);
    if (!zone) throw new AppError('Zone not found for staff assignment', 400, { code: 'BAD_REQUEST' });
  }

  async emitZoneRefresh(zoneId) {
    const zone = await this.zoneRepository.findById(zoneId, {
      includeRides: true,
      includeStaff: true,
    });
    if (zone) emitZoneUpdated(zone);
  }

  async exportJsonBundle() {
    const rows = await this.staffRepository.findAll({ includeZone: false });
    return {
      schemaVersion: 1,
      entityType: 'staff',
      generatedAt: new Date().toISOString(),
      totalExported: rows.length,
      items: rows.map((r) => r.get({ plain: true })),
    };
  }

  /**
   * @param {{ items: Array<Record<string, unknown>> }} body
   * @param {{ role: string }} user
   */
  async importBundle(body, user) {
    const items = body.items || [];
    const appliedIds = [];
    const failed = [];
    let appliedCount = 0;

    for (const item of items) {
      const rowId = item.id ? String(item.id) : undefined;
      try {
        if (rowId) {
          if (!userHasPermission(user, 'staff', 'update')) {
            failed.push({
              id: rowId,
              error: 'Insufficient permission (staff.update)',
              code: 'FORBIDDEN',
            });
            continue;
          }
          await this.updateStaff(rowId, {
            firstName: item.firstName,
            lastName: item.lastName,
            employeeNumber: item.employeeNumber,
            role: item.role,
            currentZoneId: item.currentZoneId ?? null,
            currentRideId:
              item.currentRideId !== undefined ? item.currentRideId ?? null : undefined,
            supervisorId: item.supervisorId !== undefined ? item.supervisorId ?? null : undefined,
            available: item.available,
            skillLevel: item.skillLevel,
          });
          appliedIds.push(rowId);
          appliedCount += 1;
        } else {
          if (!userHasPermission(user, 'staff', 'create')) {
            failed.push({
              error: 'Insufficient permission (staff.create)',
              code: 'FORBIDDEN',
            });
            continue;
          }
          const created = await this.createStaff({
            firstName: item.firstName,
            lastName: item.lastName,
            employeeNumber: item.employeeNumber,
            role: item.role,
            currentZoneId: item.currentZoneId ?? null,
            currentRideId: item.currentRideId ?? null,
            supervisorId: item.supervisorId ?? null,
            available: item.available ?? true,
            skillLevel: item.skillLevel ?? 1,
          });
          appliedIds.push(created.id);
          appliedCount += 1;
        }
      } catch (e) {
        const msg =
          e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e);
        failed.push({
          id: rowId,
          error: msg,
          code: e instanceof AppError ? e.code : undefined,
        });
      }
    }

    return {
      entityType: 'staff',
      appliedCount,
      appliedIds,
      failedCount: failed.length,
      failed,
    };
  }

  async exportXlsxBuffer() {
    const rows = await this.staffRepository.findAll({ includeZone: false, includeSupervisor: false });
    const { buildStaffXlsxBuffer } = require('../utils/staff-spreadsheet.helper');
    return buildStaffXlsxBuffer(rows);
  }

  /**
   * @param {Buffer} buffer
   * @param {{ role: string }} user
   */
  async importXlsxBuffer(buffer, user) {
    const { parseStaffXlsx } = require('../utils/staff-spreadsheet.helper');
    const items = parseStaffXlsx(buffer);
    return this.importBundle({ items }, user);
  }
}

module.exports = { StaffService };
