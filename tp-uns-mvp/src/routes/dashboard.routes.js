const express = require('express');
const { Op } = require('sequelize');
const { LatestState, ForecastSnapshot } = require('../models');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router({ mergeParams: true });

router.get(
  '/latest',
  asyncHandler(async (req, res) => {
    const states = await LatestState.findAll({
      where: { parkId: req.params.parkId },
      order: [['eventTime', 'DESC']],
      limit: 300,
    });
    const queueRows = states.filter((s) => String(s.topicPath).endsWith('/queue_time'));
    const statusRows = states.filter((s) => String(s.topicPath).endsWith('/status'));

    const avgQueueTime = queueRows.length
      ? queueRows.reduce((acc, r) => acc + Number(r.value || 0), 0) / queueRows.length
      : 0;
    const openRidesCount = statusRows.filter((r) => String(r.value || '').toUpperCase() === 'OPEN').length;
    const closedRidesCount = statusRows.filter((r) => String(r.value || '').toUpperCase() === 'CLOSED').length;

    res.json({
      success: true,
      data: {
        parkId: req.params.parkId,
        avgQueueTime,
        openRidesCount,
        closedRidesCount,
        latestSignals: states.slice(0, 20),
      },
    });
  })
);

router.get(
  '/forecast/latest',
  asyncHandler(async (req, res) => {
    const row = await ForecastSnapshot.findOne({
      where: { parkId: req.params.parkId, snapshotTime: { [Op.ne]: null } },
      order: [['snapshotTime', 'DESC']],
    });
    res.json({ success: true, data: row || null });
  })
);

module.exports = { dashboardRouter: router };
