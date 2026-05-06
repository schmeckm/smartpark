const { RecommendationScore } = require('../models');

class RecommendationScoreRepository {
  findByRecommendationId(recommendationId) {
    return RecommendationScore.findOne({ where: { recommendationId } });
  }

  async upsertForRecommendation(recommendationId, payload) {
    const existing = await RecommendationScore.findOne({ where: { recommendationId } });
    if (existing) {
      await existing.update(payload);
      return existing.reload();
    }
    return RecommendationScore.create({ recommendationId, ...payload });
  }
}

module.exports = { RecommendationScoreRepository };
