'use strict';

const { AiRecommendationScoringService } = require('../../../ai-recommendation-scoring.service');

const scoringService = new AiRecommendationScoringService();

/**
 * Scores OPEN recommendations (existing AI scoring pipeline).
 * Note: scoring traverses all open recommendations globally — park-level filtering would require extending {@link AiRecommendationScoringService}.
 */
const writeRecommendationsScoreBatchTool = {
  name: 'write.recommendations_score_batch',
  description: 'Runs AI scoring for OPEN recommendations (batch; existing service semantics).',
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  requiresApproval: true,
  async execute() {
    return scoringService.scoreAllOpen({ emitSocket: true });
  },
};

module.exports = { writeRecommendationsScoreBatchTool };
