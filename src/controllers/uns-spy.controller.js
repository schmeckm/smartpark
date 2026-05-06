'use strict';

const { Op } = require('sequelize');
const { asyncHandler } = require('../utils/async-handler');
const { sequelize, UnsDiscoveryEvent, UnsTopicProposal } = require('../models');
const { AuditLogService } = require('../services/audit-log.service');
const AUDIT = require('../constants/audit-actions');
const {
  approveAdapterDiscoveryEvent,
  rejectAdapterDiscoveryEvent,
  ignoreAdapterDiscoveryEvent,
} = require('../services/uns-spy-adapter-discovery.service');

const auditLogService = new AuditLogService();

const listEvents = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);
  const where = {};
  const and = [];
  if (q.classification) and.push({ classification: String(q.classification) });
  if (q.topicPrefix) {
    and.push({ topicPath: { [Op.iLike]: `${String(q.topicPrefix)}%` } });
  }
  if (q.eventSource === 'adapter') {
    and.push(sequelize.literal(`(details->>'source') = 'adapter'`));
  } else if (q.eventSource === 'mqtt') {
    and.push(sequelize.literal(`coalesce(details->>'source','') <> 'adapter'`));
  }
  if (and.length) where[Op.and] = and;

  const { rows, count } = await UnsDiscoveryEvent.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
  });
  res.json({
    success: true,
    data: { total: count, limit, offset, items: rows.map((r) => r.get({ plain: true })) },
  });
});

const listProposals = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);
  const where = {};
  if (q.status) where.status = String(q.status);
  const { rows, count } = await UnsTopicProposal.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
  });
  res.json({
    success: true,
    data: { total: count, limit, offset, items: rows.map((r) => r.get({ plain: true })) },
  });
});

async function auditSpyAction(action, event, { actorUserId, ...rest } = {}) {
  const d = event?.details || {};
  await auditLogService.log({
    action,
    entityType: 'uns_discovery_event',
    entityId: event.id,
    oldValue: null,
    newValue: {
      eventId: event.id,
      provider: d.provider,
      externalId: d.externalEntityId,
      ...rest,
    },
    userId: actorUserId ?? null,
  });
}

const approveEvent = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { id: eventId, ...body } = v;
  const userId = req.user?.id || null;
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Discovery event not found', code: 'NOT_FOUND' });
  }
  const data = await approveAdapterDiscoveryEvent(eventId, body, { userId });
  await auditSpyAction(AUDIT.UNS_SPY_DISCOVERY_APPROVE, event, {
    action: 'approve',
    mappedEntityId: data.mappedEntityId,
    actorUserId: userId,
  });
  res.json({ success: true, data });
});

const rejectEvent = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const eventId = req.params.id;
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Discovery event not found', code: 'NOT_FOUND' });
  }
  const data = await rejectAdapterDiscoveryEvent(eventId, { userId });
  await auditSpyAction(AUDIT.UNS_SPY_DISCOVERY_REJECT, event, { action: 'reject', actorUserId: userId });
  res.json({ success: true, data });
});

const ignoreEvent = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const eventId = req.params.id;
  const event = await UnsDiscoveryEvent.findByPk(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Discovery event not found', code: 'NOT_FOUND' });
  }
  const data = await ignoreAdapterDiscoveryEvent(eventId, { userId });
  await auditSpyAction(AUDIT.UNS_SPY_DISCOVERY_IGNORE, event, { action: 'ignore', actorUserId: userId });
  res.json({ success: true, data });
});

module.exports = {
  listEvents,
  listProposals,
  approveEvent,
  rejectEvent,
  ignoreEvent,
};
