class EntityTypeTemplatesService {
  models() {
    return require('../../models');
  }

  /**
   * @param {string} [entityType] PARK | RIDE | SHOW | RESTAURANT (optional filter)
   */
  async list(entityType) {
    const { EntityTypeTemplate } = this.models();
    const where = { activeFlag: true };
    if (entityType && String(entityType).trim()) {
      where.entityType = String(entityType).trim().toUpperCase();
    }
    return EntityTypeTemplate.findAll({
      where,
      order: [
        ['entityType', 'ASC'],
        ['templateCode', 'ASC'],
      ],
    });
  }

  async getById(id) {
    const { EntityTypeTemplate } = this.models();
    return EntityTypeTemplate.findByPk(id);
  }
}

module.exports = { EntityTypeTemplatesService };
