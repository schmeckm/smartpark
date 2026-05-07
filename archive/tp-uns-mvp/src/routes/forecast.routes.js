const express = require('express');
const { ForecastSnapshot } = require('../models');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router({ mergeParams: true });

router.get(
  '/latest',
  asyncHandler(async (req, res) => {
    const row = await ForecastSnapshot.findOne({
      where: { parkId: req.params.parkId },
      order: [['snapshotTime', 'DESC']],
    });
    res.json({ success: true, data: row || null });
  })
);

module.exports = { forecastRouter: router };
