const express = require('express');
const { Device } = require('../models');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router({ mergeParams: true });

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const row = await Device.create({
      parkId: req.params.parkId,
      name: req.body.name,
      deviceType: req.body.deviceType,
      deviceKey: req.body.deviceKey,
      locationDescription: req.body.locationDescription || null,
      assignedNodeId: req.body.assignedNodeId || null,
      isActive: req.body.isActive !== false,
    });
    res.status(201).json({ success: true, data: row });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await Device.findAll({ where: { parkId: req.params.parkId }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rows });
  })
);

module.exports = { devicesRouter: router };
