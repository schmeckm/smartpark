const { asyncHandler } = require('../utils/async-handler');
const { RecommendationService } = require('../services/recommendation.service');

const recommendationService = new RecommendationService();

const listRecommendations = asyncHandler(async (req, res) => {
  const rows = await recommendationService.listRecommendations();
  res.json({ success: true, data: rows });
});

const updateRecommendationStatus = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const row = await recommendationService.updateStatus(req.params.id, body.status);
  res.json({ success: true, data: row });
});

module.exports = {
  listRecommendations,
  updateRecommendationStatus,
};
