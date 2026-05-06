const express = require('express');
const { Park } = require('../models');
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { UnsNodeService } = require('../services/uns-node.service');

const router = express.Router();
const unsNodeService = new UnsNodeService();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const row = await unsNodeService.createPark(req.body);
    res.status(201).json({ success: true, data: row });
  })
);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await Park.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await Park.findByPk(req.params.id);
    if (!row) throw new AppError('Park not found', 404);
    res.json({ success: true, data: row });
  })
);

module.exports = { parksRouter: router };
