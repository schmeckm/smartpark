const { Model, DataTypes } = require('sequelize');

class VisitPlanVersion extends Model {}

function defineVisitPlanVersion(sequelize) {
  VisitPlanVersion.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'park_id',
      },
      planYear: { type: DataTypes.INTEGER, allowNull: false, field: 'plan_year' },
      name: { type: DataTypes.STRING(200), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by_user_id',
      },
    },
    {
      sequelize,
      modelName: 'VisitPlanVersion',
      tableName: 'visit_plan_versions',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return VisitPlanVersion;
}

module.exports = { defineVisitPlanVersion, VisitPlanVersion };
