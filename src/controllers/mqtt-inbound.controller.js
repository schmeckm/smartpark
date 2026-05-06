'use strict';

const { Op } = require('sequelize');
const { asyncHandler } = require('../utils/async-handler');
const { MqttInboundMessage, UnsDiscoveryEvent, SPY_CLASSIFICATION } = require('../models');

const listInbound = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);
  const where = {};
  if (q.topicPrefix) {
    where.topic = { [Op.iLike]: `${String(q.topicPrefix)}%` };
  }
  if (q.spyClassification) {
    where.spyClassification = String(q.spyClassification);
  }
  if (q.capabilityDecision) {
    where.capabilityGuardDecision = String(q.capabilityDecision);
  }
  const { rows, count } = await MqttInboundMessage.findAndCountAll({
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

const listInboundUnknown = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);
  const unknownSet = [
    SPY_CLASSIFICATION.UNKNOWN_TOPIC,
    SPY_CLASSIFICATION.UNKNOWN_SIGNAL,
    SPY_CLASSIFICATION.CONFLICT,
  ];
  const where = { classification: { [Op.in]: unknownSet } };
  if (q.topicPrefix) {
    where.topicPath = { [Op.iLike]: `${String(q.topicPrefix)}%` };
  }
  const { rows, count } = await UnsDiscoveryEvent.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: MqttInboundMessage, as: 'mqttInboundMessage', required: false }],
  });
  res.json({
    success: true,
    data: { total: count, limit, offset, items: rows.map((r) => r.get({ plain: true })) },
  });
});

module.exports = {
  listInbound,
  listInboundUnknown,
};
