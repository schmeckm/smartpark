const { Model, DataTypes } = require('sequelize');

const SQDC_MOODS = ['great', 'good', 'neutral', 'low', 'bad'];

class SqdcMoodRating extends Model {}

function defineSqdcMoodRating(sequelize) {
  SqdcMoodRating.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: true, field: 'asset_id' },
      userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
      businessDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'business_date' },
      mood: { type: DataTypes.STRING(16), allowNull: false },
    },
    {
      sequelize,
      modelName: 'SqdcMoodRating',
      tableName: 'sqdc_mood_ratings',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcMoodRating;
}

module.exports = { defineSqdcMoodRating, SqdcMoodRating, SQDC_MOODS };
