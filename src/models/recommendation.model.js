const { Model, DataTypes } = require('sequelize');

const RECOMMENDATION_TYPES = [
  'REALLOCATE_STAFF',
  'OPEN_SERVICE_POINT',
  'SEND_SECURITY',
  'CLEANING_SUPPORT',
  'GUEST_ROUTING',
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const RECOMMENDATION_STATUSES = ['OPEN', 'ACCEPTED', 'REJECTED', 'COMPLETED'];

class Recommendation extends Model {}

function defineRecommendation(sequelize) {
  Recommendation.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      eventId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'event_id',
      },
      recommendationType: {
        type: DataTypes.ENUM(...RECOMMENDATION_TYPES),
        allowNull: false,
        field: 'recommendation_type',
      },
      priority: {
        type: DataTypes.ENUM(...PRIORITIES),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...RECOMMENDATION_STATUSES),
        allowNull: false,
        defaultValue: 'OPEN',
      },
    },
    {
      sequelize,
      modelName: 'Recommendation',
      tableName: 'recommendations',
      underscored: true,
    }
  );

  return Recommendation;
}

module.exports = {
  defineRecommendation,
  Recommendation,
  RECOMMENDATION_TYPES,
  PRIORITIES,
  RECOMMENDATION_STATUSES,
};
