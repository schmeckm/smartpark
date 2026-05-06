const { asyncHandler } = require('../utils/async-handler');
const { SqdcService } = require('../services/sqdc.service');
const { SqdcBoardService } = require('../services/sqdc-board.service');

const sqdcService = new SqdcService();
const sqdcBoardService = new SqdcBoardService();

const getBoard = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || {};
  const data = await sqdcService.getBoard(parkId, {
    businessDate: q.businessDate,
    assetId: q.assetId || null,
  });
  res.json({ success: true, data });
});

const getHistory = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || {};
  const data = await sqdcService.getHistory(parkId, { assetId: q.assetId, days: q.days });
  res.json({ success: true, data });
});

const postMood = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcService.upsertMood(parkId, req.user.id, body);
  res.json({ success: true, data });
});

const postSafety = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcService.createSafetyEvent(parkId, req.user.id, body);
  res.status(201).json({ success: true, data });
});

const postSnapshot = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcService.upsertSnapshot(parkId, req.user.id, body);
  res.json({ success: true, data });
});

const getParkBoardHierarchical = asyncHandler(async (req, res) => {
  const ctx = req.parkContext.id;
  const { parkId, date } = req.validated || { ...req.params, ...req.query };
  const data = await sqdcBoardService.getParkSqdcBoard(ctx, parkId, date);
  res.json({ success: true, data });
});

const getAssetBoardHierarchical = asyncHandler(async (req, res) => {
  const ctx = req.parkContext.id;
  const { parkId, assetId, date } = req.validated || { ...req.params, ...req.query };
  const data = await sqdcBoardService.getAssetSqdcBoard(ctx, parkId, assetId, date);
  res.json({ success: true, data });
});

const postSqdcEvent = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcBoardService.createSqdcEvent(parkId, body);
  res.status(201).json({ success: true, data });
});

const postMoodFeedback = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcBoardService.createMoodFeedback(parkId, req.user.id, body);
  res.status(201).json({ success: true, data });
});

const postDailySnapshot = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await sqdcBoardService.saveDailySnapshot(parkId, body);
  res.json({ success: true, data });
});

module.exports = {
  getBoard,
  getHistory,
  postMood,
  postSafety,
  postSnapshot,
  getParkBoardHierarchical,
  getAssetBoardHierarchical,
  postSqdcEvent,
  postMoodFeedback,
  postDailySnapshot,
};
