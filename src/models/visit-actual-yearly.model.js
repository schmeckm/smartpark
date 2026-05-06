const { Model, DataTypes } = require('sequelize');

class VisitActualYearly extends Model {}

function defineVisitActualYearly(sequelize) {
  VisitActualYearly.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'park_id',
      },
      actualYear: { type: DataTypes.INTEGER, allowNull: false, field: 'actual_year' },
      guestCounts: { type: DataTypes.JSONB, allowNull: false, field: 'guest_counts', defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'VisitActualYearly',
      tableName: 'visit_actual_yearly',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return VisitActualYearly;
}

module.exports = { defineVisitActualYearly, VisitActualYearly };
