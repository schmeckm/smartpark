const { Recommendation, CrowdEvent, Zone, RecommendationScore } = require('../models');

const defaultInclude = [
  {
    model: CrowdEvent,
    as: 'event',
    required: false,
    include: [{ model: Zone, as: 'zone', required: false }],
  },
  { model: RecommendationScore, as: 'score', required: false },
];

class RecommendationRepository {
  findAll(options = {}) {
    return Recommendation.findAll({
      order: [['createdAt', 'DESC']],
      include: options.includeScore === false ? defaultInclude.filter((i) => i.as !== 'score') : defaultInclude,
      limit: options.limit,
    });
  }

  findAllOpen(options = {}) {
    return Recommendation.findAll({
      where: { status: 'OPEN' },
      order: [['createdAt', 'DESC']],
      include: defaultInclude,
      limit: options.limit || 500,
    });
  }

  findById(id) {
    return Recommendation.findByPk(id, {
      include: defaultInclude,
    });
  }

  create(data) {
    return Recommendation.create(data);
  }

  async updateById(id, data) {
    const row = await Recommendation.findByPk(id);
    if (!row) return null;
    await row.update(data);
    return this.findById(id);
  }
}

module.exports = { RecommendationRepository };
