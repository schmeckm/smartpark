const { Model, DataTypes } = require('sequelize');

class SqdcMoodFeedback extends Model {}

function defineSqdcMoodFeedback(sequelize) {
  SqdcMoodFeedback.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: true, field: 'asset_id' },
      moodScore: { type: DataTypes.SMALLINT, allowNull: false, field: 'mood_score' },
      comment: { type: DataTypes.TEXT, allowNull: true },
      feedbackDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'feedback_date' },
      createdByUserId: { type: DataTypes.UUID, allowNull: true, field: 'created_by_user_id' },
    },
    {
      sequelize,
      modelName: 'SqdcMoodFeedback',
      tableName: 'sqdc_mood_feedback',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcMoodFeedback;
}

module.exports = { defineSqdcMoodFeedback, SqdcMoodFeedback };
