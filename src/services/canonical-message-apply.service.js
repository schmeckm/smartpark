const { emitIngestionEvent } = require('../sockets');
const { RideRepository } = require('../repositories/ride.repository');
const { RideWaitTimeSampleRepository } = require('../repositories/ride-wait-time-sample.repository');
const { ParkOperatingSnapshotRepository } = require('../repositories/park-operating-snapshot.repository');
const { WeatherService } = require('./weather.service');
const { TimeseriesService } = require('./timeseries.service');
const { ExternalEntityMappingService } = require('./external-entity-mapping.service');
const { DataQualityIssueRepository } = require('../repositories/data-quality-issue.repository');
const { normalizeScheduleDateString } = require('../utils/schedule-date.util');

class CanonicalMessageApplyService {
  constructor() {
    this.rideRepository = new RideRepository();
    this.waitRepository = new RideWaitTimeSampleRepository();
    this.snapshotRepository = new ParkOperatingSnapshotRepository();
    this.weatherService = new WeatherService();
    this.timeseriesService = new TimeseriesService();
    this.mappingService = new ExternalEntityMappingService();
    this.dataQualityIssueRepository = new DataQualityIssueRepository();
  }

  /**
   * Resolve platform `parks.id` from canonical payload / external ThemeParks id / slug.
   * @param {object} message
   * @param {object} payload
   */
  async resolvePlatformParkForCanonical(message, payload = {}) {
    const { Park } = require('../models');
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const pid = payload.internalParkId != null ? String(payload.internalParkId).trim() : '';
    if (pid && uuidRe.test(pid)) {
      const row = await Park.findByPk(pid, { attributes: ['id'] });
      if (row) return row.id;
    }

    const ext = message.externalParkId != null ? String(message.externalParkId).trim() : '';
    if (!ext) return null;

    if (uuidRe.test(ext)) {
      const byPk = await Park.findByPk(ext, { attributes: ['id'] });
      if (byPk) return byPk.id;
    }

    let park = await Park.findOne({
      where: { externalEntityId: ext, externalSource: 'THEMEPARKS_WIKI' },
      attributes: ['id'],
    });
    if (park) return park.id;

    park = await Park.findOne({
      where: { externalEntityId: ext },
      attributes: ['id'],
    });
    if (park) return park.id;

    const slug = ext
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    park = await Park.findOne({
      where: { slug },
      attributes: ['id'],
    });
    return park ? park.id : null;
  }

  async resolveParkAssetIdForExternal(message) {
    const { Park, ParkAsset } = require('../models');
    const extPark = message.externalParkId != null ? String(message.externalParkId) : '';
    const extEntity = message.externalEntityId != null ? String(message.externalEntityId) : '';
    if (!extPark || !extEntity) return null;
    const park = await Park.findOne({
      where: { externalEntityId: extPark, externalSource: 'THEMEPARKS_WIKI' },
      attributes: ['id'],
    });
    if (!park) return null;
    const asset = await ParkAsset.findOne({
      where: {
        parkId: park.id,
        externalEntityId: extEntity,
        externalSource: 'THEMEPARKS_WIKI',
      },
      attributes: ['assetId'],
    });
    return asset ? asset.assetId : null;
  }

  async resolveInternalParkIdFromExternal(externalParkId) {
    if (externalParkId == null || String(externalParkId).trim() === '') return null;
    const { Park } = require('../models');
    const park = await Park.findOne({
      where: { externalEntityId: String(externalParkId), externalSource: 'THEMEPARKS_WIKI' },
      attributes: ['id'],
    });
    return park ? park.id : null;
  }

  async createNeedsReviewIssue(message, text) {
    return this.dataQualityIssueRepository.create({
      sourceSystem: `adapter:${message.provider}`,
      issueType: 'MAPPING_MISSING',
      severity: 'MEDIUM',
      message: text,
      payload: {
        messageType: message.messageType,
        externalParkId: message.externalParkId || null,
        externalEntityId: message.externalEntityId || null,
      },
      integrationEventId: null,
      resolved: false,
    });
  }

  async applyWaitTime(message) {
    const mapping = await this.mappingService.resolveMapping(message);
    const payload = message.payload;
    const parkAssetId = await this.resolveParkAssetIdForExternal(message);
    await this.waitRepository.create({
      provider: message.provider,
      externalParkId: message.externalParkId,
      externalEntityId: message.externalEntityId,
      externalEntityName: payload.externalEntityName || null,
      internalRideId: mapping.internalEntityType === 'RIDE' ? mapping.internalEntityId : null,
      parkAssetId,
      waitTime: payload.waitTime == null ? null : Number(payload.waitTime),
      status: payload.status || null,
      isOpen: payload.isOpen == null ? null : Boolean(payload.isOpen),
      rawPayload: message.rawPayload || {},
      sampledAt: payload.sampledAt ? new Date(payload.sampledAt) : new Date(),
    });

    if (mapping.mappingStatus === 'MAPPED' && mapping.internalEntityType === 'RIDE' && mapping.internalEntityId) {
      await this.rideRepository.updateById(mapping.internalEntityId, {
        waitTime: payload.waitTime == null ? 0 : Number(payload.waitTime),
        status: payload.isOpen === false ? 'CLOSED' : 'OPEN',
      });
      return { applied: true };
    }
    await mapping.update({ mappingStatus: 'NEEDS_REVIEW' });
    await this.createNeedsReviewIssue(
      message,
      `No ride mapping for external entity ${message.externalEntityId} (${payload.externalEntityName || 'unknown'})`
    );
    return { applied: false };
  }

  async applyEntityStatus(message) {
    const mapping = await this.mappingService.resolveMapping(message);
    if (mapping.mappingStatus === 'MAPPED' && mapping.internalEntityType === 'RIDE' && mapping.internalEntityId) {
      const status = message.payload.isOpen === false ? 'CLOSED' : 'OPEN';
      await this.rideRepository.updateById(mapping.internalEntityId, { status });
      return { applied: true };
    }
    await mapping.update({ mappingStatus: 'NEEDS_REVIEW' });
    await this.createNeedsReviewIssue(message, `No mapping for status update: ${message.externalEntityId}`);
    return { applied: false };
  }

  async applyOperatingHours(message) {
    const payload =
      message.payload && typeof message.payload === 'object' ? { ...message.payload } : {};
    const dateNorm = normalizeScheduleDateString(
      payload.date ?? payload.day ?? payload.scheduleDate ?? null
    );
    if (dateNorm) payload.date = dateNorm;

    await this.snapshotRepository.create({
      provider: message.provider,
      externalDestinationId: message.externalDestinationId || null,
      externalParkId: message.externalParkId,
      openingTimes: payload,
      crowdLevel: null,
      rawPayload: message.rawPayload || {},
      sampledAt: payload.date ? new Date(`${payload.date}T12:00:00.000Z`) : new Date(),
    });
    return { applied: true };
  }

  async applyCrowdLevel(message) {
    await this.snapshotRepository.create({
      provider: message.provider,
      externalDestinationId: message.externalDestinationId || null,
      externalParkId: message.externalParkId,
      openingTimes: null,
      crowdLevel: message.payload,
      rawPayload: message.rawPayload || {},
      sampledAt: new Date(),
    });
    return { applied: true };
  }

  async applyWeather(message) {
    const payload = message.payload || {};
    const internalParkId = await this.resolvePlatformParkForCanonical(message, payload);
    if (!internalParkId) {
      await this.createNeedsReviewIssue(
        message,
        'Could not resolve platform park for weather observation (set context.internalParkId or a known externalParkId)'
      );
      return { applied: false };
    }
    const { Park } = require('../models');
    const parkRow = await Park.findByPk(internalParkId, { attributes: ['externalEntityId', 'slug'] });
    const parkIdStr =
      (parkRow?.externalEntityId && String(parkRow.externalEntityId)) ||
      (parkRow?.slug && String(parkRow.slug)) ||
      String(message.externalParkId || internalParkId);

    await this.weatherService.createObservationFromPayload(
      {
        condition: payload.condition || 'UNKNOWN',
        temperatureC: payload.temperatureC ?? null,
        rainMm: payload.rainMm ?? null,
        rainProbabilityPercent: payload.rainProbabilityPercent ?? null,
        windKmh: payload.windKmh ?? null,
        source: String(message.provider || 'adapter').slice(0, 120),
        parkId: parkIdStr,
        internalParkId,
        observedAt: payload.sampledAt || message.occurredAt,
      },
      { emit: true }
    );
    return { applied: true };
  }

  async applyCalendarContext(message) {
    const payload = message.payload || {};
    const internalParkId = await this.resolvePlatformParkForCanonical(message, payload);
    if (!internalParkId) {
      await this.createNeedsReviewIssue(
        message,
        'Could not resolve platform park for calendar context (set context.internalParkId or a known externalParkId)'
      );
      return { applied: false };
    }
    await this.timeseriesService.upsertParkCalendarRow({
      parkId: internalParkId,
      contextDate: String(payload.contextDate),
      patch: {
        isPublicHoliday: Boolean(payload.isPublicHoliday),
        isSchoolBreak: Boolean(payload.isSchoolHoliday),
        holidayName: payload.holidayName != null ? String(payload.holidayName).slice(0, 200) : null,
        regionCode:
          (payload.regionCode && String(payload.regionCode).slice(0, 32)) ||
          (payload.schoolHolidayRegion && String(payload.schoolHolidayRegion).slice(0, 32)) ||
          null,
        source: `adapter:${message.provider}`.slice(0, 64),
        extra: { provider: message.provider, externalParkId: message.externalParkId || null },
      },
    });
    return { applied: true };
  }

  async apply(message) {
    let result = { applied: false };
    if (message.messageType === 'WAIT_TIME_UPDATED') result = await this.applyWaitTime(message);
    else if (message.messageType === 'ENTITY_STATUS_UPDATED') result = await this.applyEntityStatus(message);
    else if (message.messageType === 'PARK_OPERATING_HOURS_UPDATED') result = await this.applyOperatingHours(message);
    else if (message.messageType === 'PARK_CROWD_LEVEL_UPDATED') result = await this.applyCrowdLevel(message);
    else if (message.messageType === 'WEATHER_OBSERVATION_UPDATED') result = await this.applyWeather(message);
    else if (message.messageType === 'CALENDAR_CONTEXT_UPDATED') result = await this.applyCalendarContext(message);
    else if (message.messageType === 'PARK_ENTITY_SYNCED') {
      await this.mappingService.ensureMappingRecord(message);
      result = { applied: true };
    } else if (message.messageType === 'DESTINATION_SYNCED' || message.messageType === 'PARK_SYNCED') {
      result = { applied: true };
    }

    emitIngestionEvent({
      source: 'canonical',
      messageType: message.messageType,
      provider: message.provider,
      externalEntityId: message.externalEntityId || null,
      status: result.applied ? 'APPLIED' : 'IGNORED',
      occurredAt: message.occurredAt,
    });
    return result;
  }
}

module.exports = { CanonicalMessageApplyService };
