const { Model, DataTypes } = require('sequelize');

const MAPPING_RULE_STRATEGIES = ['EXACT_NAME', 'SLUG', 'REGEX', 'MANUAL', 'PROVIDER_ID'];

class MappingRule extends Model {}

function defineMappingRule(sequelize) {
  MappingRule.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      ruleName: { type: DataTypes.STRING(200), allowNull: false, field: 'rule_name' },
      externalEntityType: { type: DataTypes.STRING(80), allowNull: true, field: 'external_entity_type' },
      internalEntityType: { type: DataTypes.STRING(80), allowNull: true, field: 'internal_entity_type' },
      matchStrategy: { type: DataTypes.STRING(32), allowNull: false, field: 'match_strategy' },
      ruleConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'rule_config' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'MappingRule',
      tableName: 'mapping_rules',
      underscored: true,
    }
  );

  return MappingRule;
}

module.exports = { defineMappingRule, MappingRule, MAPPING_RULE_STRATEGIES };
