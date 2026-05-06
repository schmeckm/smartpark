const { MappingRule } = require('../models');

class MappingRuleRepository {
  findEnabledByProvider(provider) {
    return MappingRule.findAll({
      where: { provider, enabled: true },
      order: [['priority', 'ASC']],
    });
  }
}

module.exports = { MappingRuleRepository };
