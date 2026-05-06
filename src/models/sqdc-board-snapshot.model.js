const { Model, DataTypes } = require('sequelize');

class SqdcBoardSnapshot extends Model {}

function defineSqdcBoardSnapshot(sequelize) {
  SqdcBoardSnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      businessDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'business_date' },
      deliveryOee5m: { type: DataTypes.DECIMAL(6, 3), allowNull: true, field: 'delivery_oee_5m' },
      customerGuestCount: { type: DataTypes.INTEGER, allowNull: true, field: 'customer_guest_count' },
      leadTechnicianName: { type: DataTypes.STRING(200), allowNull: true, field: 'lead_technician_name' },
      notes: { type: DataTypes.TEXT, allowNull: true },
      capturedByUserId: { type: DataTypes.UUID, allowNull: true, field: 'captured_by_user_id' },
    },
    {
      sequelize,
      modelName: 'SqdcBoardSnapshot',
      tableName: 'sqdc_board_snapshots',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcBoardSnapshot;
}

module.exports = { defineSqdcBoardSnapshot, SqdcBoardSnapshot };
