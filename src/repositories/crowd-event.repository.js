const { CrowdEvent, Zone, Recommendation } = require('../models');

class CrowdEventRepository {
  findAll(options = {}) {
    return CrowdEvent.findAll({
      order: [['createdAt', 'DESC']],
      limit: options.limit,
      include: [
        { model: Zone, as: 'zone', required: false },
        ...(options.includeRecommendations
          ? [{ model: Recommendation, as: 'recommendations', required: false }]
          : []),
      ],
    });
  }

  findById(id) {
    return CrowdEvent.findByPk(id, {
      include: [
        { model: Zone, as: 'zone', required: false },
        { model: Recommendation, as: 'recommendations', required: false },
      ],
    });
  }

  create(data) {
    return CrowdEvent.create(data);
  }
}

module.exports = { CrowdEventRepository };
