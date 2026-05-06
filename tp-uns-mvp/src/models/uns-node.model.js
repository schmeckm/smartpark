const { DataTypes, Model } = require('sequelize');

class UnsNode extends Model {}

const NODE_TYPES = [
  'PARK',
  'DOMAIN',
  'AREA',
  'RIDE',
  'ENTRY',
  'PARKING',
  'TRAFFIC',
  'WEATHER',
  'FORECAST',
  'CAMERA',
  'SENSOR',
  'METRIC',
];

function defineUnsNode(sequelize) {
  UnsNode.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      parentId: { type: DataTypes.UUID, allowNull: true, field: 'parent_id' },
      name: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      nodeType: { type: DataTypes.ENUM(...NODE_TYPES), allowNull: false, field: 'node_type' },
      domain: { type: DataTypes.STRING(80), allowNull: true },
      metric: { type: DataTypes.STRING(80), allowNull: true },
      unit: { type: DataTypes.STRING(32), allowNull: true },
      topicPath: { type: DataTypes.STRING(255), allowNull: true, field: 'topic_path' },
      description: { type: DataTypes.TEXT, allowNull: true },
      isLeaf: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_leaf' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    },
    { sequelize, modelName: 'UnsNode', tableName: 'uns_nodes', underscored: true, freezeTableName: true }
  );
  return UnsNode;
}

module.exports = { UnsNode, defineUnsNode, NODE_TYPES };
