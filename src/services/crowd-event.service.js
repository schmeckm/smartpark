const { AppError } = require('../utils/app-error');
const { CrowdEventRepository } = require('../repositories/crowd-event.repository');
const { ZoneRepository } = require('../repositories/zone.repository');
const { RideRepository } = require('../repositories/ride.repository');
const { RecommendationRepository } = require('../repositories/recommendation.repository');
const { RecommendationEngineService } = require('./recommendation-engine.service');
const { emitCrowdEventCreated, emitRecommendationCreated, emitZoneUpdated } = require('../sockets');
const { AuditLogService } = require('./audit-log.service');
const { AiRecommendationScoringService } = require('./ai-recommendation-scoring.service');
const { jsonSnapshot } = require('../utils/json-snapshot');
const { logger } = require('../utils/logger');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();
const aiRecommendationScoringService = new AiRecommendationScoringService();

class CrowdEventService {
  constructor() {
    this.crowdEventRepository = new CrowdEventRepository();
    this.zoneRepository = new ZoneRepository();
    this.rideRepository = new RideRepository();
    this.recommendationRepository = new RecommendationRepository();
    this.engine = new RecommendationEngineService({
      zoneRepository: this.zoneRepository,
      rideRepository: this.rideRepository,
      recommendationRepository: this.recommendationRepository,
    });
  }

  listEvents() {
    return this.crowdEventRepository.findAll({ limit: 200, includeRecommendations: true });
  }

  async createEvent(payload) {
    const zone = await this.zoneRepository.findById(payload.zoneId);
    if (!zone) throw new AppError('Zone not found', 404, { code: 'NOT_FOUND' });

    const syncZone = payload.syncZone !== false;
    if (syncZone) {
      await this.zoneRepository.updateById(zone.id, { currentCrowdLevel: payload.crowdLevel });
    }

    const event = await this.crowdEventRepository.create({
      zoneId: payload.zoneId,
      eventType: payload.eventType,
      crowdLevel: payload.crowdLevel,
      severity: payload.severity ?? 1,
      source: payload.source ?? 'api',
    });

    const hydratedEvent = await this.crowdEventRepository.findById(event.id);
    emitCrowdEventCreated(hydratedEvent || event);

    const refreshedZone = await this.zoneRepository.findById(zone.id, {
      includeRides: true,
      includeStaff: true,
    });
    if (refreshedZone) emitZoneUpdated(refreshedZone);

    let recommendations = [];
    if (payload.eventType === 'CROWD_SPIKE') {
      const zoneForEval = refreshedZone || zone;
      recommendations = await this.engine.evaluateCrowdSpike({
        event: hydratedEvent || event,
        zone: zoneForEval,
      });
      for (const rec of recommendations) {
        emitRecommendationCreated(rec);
        try {
          await aiRecommendationScoringService.scoreRecommendationById(rec.id, { emitSocket: true });
        } catch (e) {
          logger.warn({ err: e.message, recommendationId: rec.id }, 'auto score recommendation failed');
        }
      }
    } else if (payload.eventType === 'WEATHER_IMPACT' && payload.weatherCondition) {
      const zoneForEval = refreshedZone || zone;
      recommendations = await this.engine.evaluateWeatherImpact({
        event: hydratedEvent || event,
        zone: zoneForEval,
        condition: payload.weatherCondition,
      });
      for (const rec of recommendations) {
        emitRecommendationCreated(rec);
        try {
          await aiRecommendationScoringService.scoreRecommendationById(rec.id, { emitSocket: true });
        } catch (e) {
          logger.warn({ err: e.message, recommendationId: rec.id }, 'auto score recommendation failed');
        }
      }
    }

    await auditLogService.log({
      action: AUDIT.EVENT_CREATE,
      entityType: 'crowd_event',
      entityId: event.id,
      oldValue: null,
      newValue: jsonSnapshot(hydratedEvent || event),
    });

    return { event: hydratedEvent || event, recommendations };
  }
}

module.exports = { CrowdEventService };
