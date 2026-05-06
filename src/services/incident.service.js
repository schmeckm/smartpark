const { Op } = require('sequelize');
const { Incident, User, Park } = require('../models');
const { AppError } = require('../utils/app-error');
const { AuditLogService } = require('./audit-log.service');
const { userHasPermission } = require('../constants/rbac');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();

function toPublicUserBrief(u) {
  if (!u) return null;
  const p = u.get ? u.get({ plain: true }) : u;
  return {
    id: p.id,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    displayName: p.displayName ?? null,
  };
}

function serializeIncident(row) {
  const plain = row.get ? row.get({ plain: true }) : row;
  return {
    id: plain.id,
    parkId: plain.parkId,
    status: plain.status,
    severity: plain.severity,
    title: plain.title,
    description: plain.description,
    ownerUserId: plain.ownerUserId,
    createdByUserId: plain.createdByUserId,
    linkedEntityType: plain.linkedEntityType,
    linkedEntityId: plain.linkedEntityId,
    slaDueAt: plain.slaDueAt ? new Date(plain.slaDueAt).toISOString() : null,
    createdAt: plain.createdAt ? new Date(plain.createdAt).toISOString() : null,
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
    owner: plain.owner ? toPublicUserBrief(plain.owner) : null,
    creator: plain.creator ? toPublicUserBrief(plain.creator) : null,
  };
}

const includeUsers = [
  { model: User, as: 'owner', attributes: ['id', 'email', 'firstName', 'lastName', 'displayName'], required: false },
  { model: User, as: 'creator', attributes: ['id', 'email', 'firstName', 'lastName', 'displayName'], required: true },
];

class IncidentService {
  async listForPark(parkId, { status, limit, offset, linkedEntityType, linkedEntityId, createdFrom, createdTo }) {
    const where = { parkId };
    if (status) where.status = status;
    if (linkedEntityType && linkedEntityId) {
      where.linkedEntityType = String(linkedEntityType).trim();
      where.linkedEntityId = String(linkedEntityId).trim();
    }
    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt[Op.gte] = new Date(createdFrom);
      if (createdTo) where.createdAt[Op.lte] = new Date(createdTo);
    }
    const { rows, count } = await Incident.findAndCountAll({
      where,
      include: includeUsers,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
    return { items: rows.map(serializeIncident), total: count };
  }

  async getByIdForPark(id, parkId) {
    const row = await Incident.findOne({
      where: { id, parkId },
      include: includeUsers,
    });
    if (!row) return null;
    return serializeIncident(row);
  }

  async create(parkId, actingUser, body) {
    const park = await Park.findByPk(parkId, { attributes: ['id'] });
    if (!park) throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });

    const userId = actingUser.id;
    let ownerUserId = body.ownerUserId ?? null;
    if (ownerUserId && String(ownerUserId) !== String(userId) && !userHasPermission(actingUser, 'incidents', 'assign')) {
      throw new AppError('Cannot assign owner to another user without incidents.assign', 403, { code: 'ASSIGN_FORBIDDEN' });
    }
    if (ownerUserId) {
      const u = await User.findByPk(ownerUserId, { attributes: ['id'] });
      if (!u) throw new AppError('Owner user not found', 422, { code: 'OWNER_NOT_FOUND' });
    }

    const row = await Incident.create({
      parkId,
      title: body.title,
      description: body.description || null,
      severity: body.severity,
      status: body.status,
      ownerUserId,
      createdByUserId: userId,
      linkedEntityType: body.linkedEntityType || null,
      linkedEntityId: body.linkedEntityId || null,
      slaDueAt: body.slaDueAt || null,
    });

    await auditLogService.log({
      action: AUDIT.INCIDENT_CREATE,
      entityType: 'incident',
      entityId: row.id,
      oldValue: null,
      newValue: { parkId, title: row.title, status: row.status },
      userId,
    });

    const full = await Incident.findByPk(row.id, { include: includeUsers });
    return serializeIncident(full);
  }

  async patch(id, parkId, actingUser, body) {
    const row = await Incident.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Incident not found', 404, { code: 'NOT_FOUND' });

    if (body.ownerUserId !== undefined && String(body.ownerUserId || '') !== String(row.ownerUserId || '')) {
      const assigningOther =
        body.ownerUserId != null && String(body.ownerUserId) !== String(actingUser.id);
      if (assigningOther && !userHasPermission(actingUser, 'incidents', 'assign')) {
        throw new AppError('Insufficient permission to assign owner', 403, { code: 'ASSIGN_FORBIDDEN' });
      }
      if (body.ownerUserId) {
        const u = await User.findByPk(body.ownerUserId, { attributes: ['id'] });
        if (!u) throw new AppError('Owner user not found', 422, { code: 'OWNER_NOT_FOUND' });
      }
    }

    const before = row.get({ plain: true });
    await row.update({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.severity !== undefined ? { severity: body.severity } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId || null } : {}),
      ...(body.linkedEntityType !== undefined ? { linkedEntityType: body.linkedEntityType || null } : {}),
      ...(body.linkedEntityId !== undefined ? { linkedEntityId: body.linkedEntityId || null } : {}),
      ...(body.slaDueAt !== undefined ? { slaDueAt: body.slaDueAt || null } : {}),
    });

    await auditLogService.log({
      action: AUDIT.INCIDENT_UPDATE,
      entityType: 'incident',
      entityId: row.id,
      oldValue: { status: before.status, ownerUserId: before.ownerUserId },
      newValue: { status: row.status, ownerUserId: row.ownerUserId },
      userId: actingUser.id,
    });

    const full = await Incident.findByPk(row.id, { include: includeUsers });
    return serializeIncident(full);
  }

  async delete(id, parkId, actingUser) {
    const row = await Incident.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Incident not found', 404, { code: 'NOT_FOUND' });
    const before = row.get({ plain: true });
    await row.destroy();
    await auditLogService.log({
      action: AUDIT.INCIDENT_DELETE,
      entityType: 'incident',
      entityId: id,
      oldValue: { title: before.title, status: before.status },
      newValue: null,
      userId: actingUser?.id || null,
    });
    return { deleted: true, id };
  }
}

module.exports = { IncidentService, serializeIncident };
