const { WeatherObservation } = require('../models');

class WeatherObservationRepository {
  create(data) {
    return WeatherObservation.create(data);
  }

  findCurrent() {
    return WeatherObservation.findOne({ order: [['observedAt', 'DESC'], ['createdAt', 'DESC']] });
  }

  listRecent({ limit = 50 } = {}) {
    return WeatherObservation.findAll({
      order: [['observedAt', 'DESC']],
      limit,
    });
  }
}

module.exports = { WeatherObservationRepository };
