const express = require('express');
const { UnsNodeService } = require('../services/uns-node.service');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router({ mergeParams: true });
const unsNodeService = new UnsNodeService();

router.post(
  '/nodes',
  asyncHandler(async (req, res) => {
    const row = await unsNodeService.createNode(req.params.parkId, req.body);
    res.status(201).json({ success: true, data: row });
  })
);

router.get(
  '/tree',
  asyncHandler(async (req, res) => {
    const tree = await unsNodeService.getTreeByPark(req.params.parkId);
    res.json({ success: true, data: tree });
  })
);

router.get(
  '/latest-state',
  asyncHandler(async (req, res) => {
    const rows = await unsNodeService.getLatestStateByPark(req.params.parkId);
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/topics',
  asyncHandler(async (req, res) => {
    const rows = await unsNodeService.listTopicsByPark(req.params.parkId);
    res.json({ success: true, data: rows });
  })
);

router.patch(
  '/nodes/:nodeId',
  asyncHandler(async (req, res) => {
    const row = await unsNodeService.updateNode(req.params.nodeId, req.body);
    res.json({ success: true, data: row });
  })
);

router.delete(
  '/nodes/:nodeId',
  asyncHandler(async (req, res) => {
    await unsNodeService.deleteNode(req.params.nodeId);
    res.status(204).send();
  })
);

module.exports = { unsRouter: router };
