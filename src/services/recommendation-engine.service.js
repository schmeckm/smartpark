const { Recommendation } = require('../models');

const CAPACITY_SPIKE_THRESHOLD = 0.75;
const LONG_WAIT_MINUTES = 45;
const SECURITY_SEVERITY_THRESHOLD = 4;
const SECURITY_CAPACITY_RATIO = 0.9;

function crowdRatio(eventCrowdLevel, zoneMaxCapacity) {
  const cap = zoneMaxCapacity || 1;
  return eventCrowdLevel / cap;
}

function priorityForRatio(ratio) {
  if (ratio >= 0.98) return 'CRITICAL';
  if (ratio >= 0.9) return 'HIGH';
  if (ratio >= 0.82) return 'MEDIUM';
  return 'LOW';
}

async function hasOpenRecommendation(eventId, recommendationType) {
  const existing = await Recommendation.findOne({
    where: { eventId, recommendationType, status: 'OPEN' },
  });
  return Boolean(existing);
}

class RecommendationEngineService {
  constructor({ zoneRepository, rideRepository, recommendationRepository }) {
    this.zoneRepository = zoneRepository;
    this.rideRepository = rideRepository;
    this.recommendationRepository = recommendationRepository;
  }

  /**
   * For CROWD_SPIKE events above 75% of zone max capacity, generate operational recommendations.
   */
  async evaluateCrowdSpike({ event, zone }) {
    if (event.eventType !== 'CROWD_SPIKE') return [];

    const ratio = crowdRatio(event.crowdLevel, zone.maxCapacity);
    if (ratio <= CAPACITY_SPIKE_THRESHOLD) return [];

    const created = [];
    const pr = priorityForRatio(ratio);

    const adjacentIds = Array.isArray(zone.adjacentZoneIds) ? zone.adjacentZoneIds : [];
    const neighbors = await this.zoneRepository.findByIds(adjacentIds);

    let reallocationNeighbor = null;
    for (const neighbor of neighbors) {
      const calmer =
        neighbor.currentCrowdLevel < zone.currentCrowdLevel ||
        neighbor.currentCrowdLevel / (neighbor.maxCapacity || 1) + 0.05 < ratio;
      if (!calmer) continue;

      const foodAvailable = await this.zoneRepository.countFoodStaffAvailableInZone(neighbor.id);
      if (foodAvailable > 0) {
        reallocationNeighbor = neighbor;
        break;
      }
    }

    if (reallocationNeighbor && !(await hasOpenRecommendation(event.id, 'REALLOCATE_STAFF'))) {
      created.push(
        await this.recommendationRepository.create({
          eventId: event.id,
          recommendationType: 'REALLOCATE_STAFF',
          priority: pr === 'LOW' ? 'MEDIUM' : pr,
          message: `Food service capacity is available in ${reallocationNeighbor.name}; consider short-term reallocation to ${zone.name}.`,
        })
      );
    }

    const securityRiskHigh =
      Number(event.severity) >= SECURITY_SEVERITY_THRESHOLD || ratio >= SECURITY_CAPACITY_RATIO;
    if (securityRiskHigh && !(await hasOpenRecommendation(event.id, 'SEND_SECURITY'))) {
      created.push(
        await this.recommendationRepository.create({
          eventId: event.id,
          recommendationType: 'SEND_SECURITY',
          priority: ratio >= SECURITY_CAPACITY_RATIO ? 'CRITICAL' : 'HIGH',
          message: `Elevated security posture recommended for ${zone.name} due to crowd pressure or incident severity.`,
        })
      );
    }

    const longWaits = await this.rideRepository.countLongWaitsInZone(zone.id, LONG_WAIT_MINUTES);
    if (longWaits > 0 && !(await hasOpenRecommendation(event.id, 'GUEST_ROUTING'))) {
      created.push(
        await this.recommendationRepository.create({
          eventId: event.id,
          recommendationType: 'GUEST_ROUTING',
          priority: pr,
          message: `One or more rides in ${zone.name} exceed ${LONG_WAIT_MINUTES} minutes; route guests to alternative zones with capacity.`,
        })
      );
    }

    return created;
  }

  /**
   * Generate indoor routing / guest comms for severe weather.
   */
  async evaluateWeatherImpact({ event, zone, condition }) {
    if (event.eventType !== 'WEATHER_IMPACT') return [];
    const up = (condition || '').toUpperCase();
    const isBad =
      /RAIN|STORM|HAIL|SNOW|THUNDER|LIGHTNING|FOG|HEAT|WIND|COLD|ICE/.test(up);
    if (!isBad) return [];
    const created = [];
    if (!(await hasOpenRecommendation(event.id, 'GUEST_ROUTING'))) {
      const pri = /STORM|HAIL|THUNDER|LIGHTNING|ICE/.test(up) ? 'HIGH' : 'MEDIUM';
      created.push(
        await this.recommendationRepository.create({
          eventId: event.id,
          recommendationType: 'GUEST_ROUTING',
          priority: pri,
          message: `Weather: ${condition}. Re-route guests to covered and indoor activities around ${zone.name} and park-wide shelter points.`,
        })
      );
    }
    if (/(STORM|HAIL|THUNDER|LIGHTNING|HIGH|WIND|EXTREME)/.test(up)) {
      if (!(await hasOpenRecommendation(event.id, 'SEND_SECURITY'))) {
        created.push(
          await this.recommendationRepository.create({
            eventId: event.id,
            recommendationType: 'SEND_SECURITY',
            priority: 'HIGH',
            message: `Weather incident (${condition}): heighten security coverage for queue and pathway overflow.`,
          })
        );
      }
    }
    return created;
  }
}

module.exports = {
  RecommendationEngineService,
  crowdRatio,
  CAPACITY_SPIKE_THRESHOLD,
};
