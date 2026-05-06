const { Model, DataTypes } = require('sequelize');

const URGENCY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const IMPACT_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

class RecommendationScore extends Model {}

function defineRecommendationScore(sequelize) {
  RecommendationScore.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      recommendationId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'recommendation_id' },
      score: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      urgency: { type: DataTypes.ENUM(...URGENCY_LEVELS), allowNull: false },
      impact: { type: DataTypes.ENUM(...IMPACT_LEVELS), allowNull: false },
      confidence: { type: DataTypes.DECIMAL(8, 6), allowNull: false },
      expectedBenefit: { type: DataTypes.JSONB, allowNull: true, field: 'expected_benefit' },
      explanation: { type: DataTypes.JSONB, allowNull: false },
      factors: { type: DataTypes.JSONB, allowNull: false },
      modelVersionId: { type: DataTypes.UUID, allowNull: true, field: 'model_version_id' },
    },
    {
      sequelize,
      modelName: 'RecommendationScore',
      tableName: 'recommendation_scores',
      underscored: true,
    }
  );
  return RecommendationScore;
}

module.exports = { defineRecommendationScore, RecommendationScore, URGENCY_LEVELS, IMPACT_LEVELS };
