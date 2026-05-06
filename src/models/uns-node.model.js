const { Model, DataTypes } = require('sequelize');

class UnsNode extends Model {}

function defineUnsNode(sequelize) {
  UnsNode.init(
    {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      parkId: { type: DataTypes.STRING(255), allowNull: false },
      parentId: { type: DataTypes.UUID, allowNull: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: false },
      nodeType: { type: DataTypes.STRING(80), allowNull: false },
      domain: { type: DataTypes.STRING(80), allowNull: true },
      metric: { type: DataTypes.STRING(80), allowNull: true },
      topicPath: { type: DataTypes.STRING(500), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      isLeaf: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      entityKind: { type: DataTypes.STRING(40), allowNull: true, field: 'entity_kind' },
      sparkplugEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'sparkplug_enabled' },
      isStructureLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_structure_locked' },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    },
    {
      sequelize,
      modelName: 'UnsNode',
      tableName: 'uns_nodes',
      underscored: true,
    }
  );
  return UnsNode;
}

module.exports = { defineUnsNode, UnsNode };
