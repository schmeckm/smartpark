const { IntegrationEventLogRepository } = require('../repositories/integration-event-log.repository');
const { ZoneRepository } = require('../repositories/zone.repository');
const { RideRepository } = require('../repositories/ride.repository');
const { DataQualityService } = require('./data-quality.service');
const { CrowdEventService } = require('./crowd-event.service');
const { WeatherService } = require('./weather.service');
const { payloadFingerprint } = require('../utils/payload-fingerprint');
const { emitIngestionEvent, emitDataQualityNew } = require('../sockets');
const { longWaitThresholdMinutes, weatherImpactConditions } = require('../constants/ingestion');

class IngestionService {
  constructor() {
    this.logRepository = new IntegrationEventLogRepository();
    this.zoneRepository = new ZoneRepository();
    this.rideRepository = new RideRepository();
    this.dataQuality = new DataQualityService();
    this.crowdEventService = new CrowdEventService();
    this.weatherService = new WeatherService();
  }

  async getFirstZone() {
    const z = await this.zoneRepository.findAll();
    return z[0] || null;
  }

  async _emitLog(log) {
    emitIngestionEvent({
      id: log.id,
      eventType: log.eventType,
      status: log.status,
      topic: log.topic,
      sourceSystem: log.sourceSystem,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt,
    });
  }

  /**
   * @param {string} sourceSystem
   * @param {string} [topic]
   * @param {string} [eventType]
   * @param {object} payload
   * @param {(logId: string) => Promise<void>} processor
   */
  async withIntegrationLog(sourceSystem, topic, eventType, payload, processor) {
    const fp = payloadFingerprint(payload);
    const dupSince = new Date(Date.now() - 5 * 60 * 1000);
    const dupe = await this.logRepository.findRecentByFingerprint(fp, dupSince);
    if (dupe) {
      const log = await this.logRepository.create({
        sourceSystem,
        topic: topic || null,
        eventType: eventType || 'duplicate',
        payload,
        status: 'FAILED',
        errorMessage: 'DUPLICATE_PAYLOAD',
        payloadFingerprint: fp,
        processedAt: new Date(),
      });
      const issue = await this.dataQuality.createIssue({
        sourceSystem: 'ingestion',
        issueType: 'DUPLICATE_EVENT',
        severity: 'LOW',
        message: 'Duplicate payload within time window',
        payload,
        integrationEventId: log.id,
      });
      emitDataQualityNew(issue);
      await this._emitLog(log);
      return;
    }

    const log = await this.logRepository.create({
      sourceSystem,
      topic: topic || null,
      eventType: eventType || null,
      payload,
      status: 'RECEIVED',
      payloadFingerprint: fp,
    });

    try {
      await processor(log.id);
      const updated = await this.logRepository.markProcessed(log.id);
      await this._emitLog(updated || (await this.logRepository.findById(log.id)));
    } catch (err) {
      await this.logRepository.markFailed(
        log.id,
        err?.message || String(err)
      );
      const u = await this.logRepository.findById(log.id);
      await this._emitLog(u);
    }
  }

  async processCrowdPayload({ topic, payload, sourceSystem = 'mqtt' }) {
    return this.withIntegrationLog(sourceSystem, topic, 'crowd', payload, (logId) =>
      this._processCrowd(logId, payload, topic, sourceSystem)
    );
  }

  async _processCrowd(integrationId, row, _topic, source) {
    const tErr = this.dataQuality.validateTimestamp(row.timestamp);
    if (tErr) {
      await this._dq(integrationId, 'STALE_OR_BAD_TIMESTAMP', tErr, row);
      throw new Error(tErr);
    }
    const clErr = this.dataQuality.validateCrowdLevel(row.crowdLevel);
    if (clErr) {
      await this._dq(integrationId, 'INVALID_CROWD', clErr, row);
      throw new Error(clErr);
    }
    if (!row.zoneId) {
      const msg = 'zoneId is required';
      await this._dq(integrationId, 'MISSING_ZONE', msg, row);
      throw new Error(msg);
    }
    const zone = await this.zoneRepository.findById(row.zoneId);
    if (!zone) {
      const msg = 'unknown zoneId';
      await this._dq(integrationId, 'UNKNOWN_ZONE', msg, row);
      throw new Error(msg);
    }
    const prev = zone.currentCrowdLevel;
    const max = zone.maxCapacity || 1;
    const rNew = row.crowdLevel / max;
    const rOld = prev / max;

    await this.zoneRepository.updateById(row.zoneId, { currentCrowdLevel: row.crowdLevel });
    const refreshed = await this.zoneRepository.findById(row.zoneId, { includeRides: true, includeStaff: true });
    const { emitZoneUpdated } = require('../sockets');
    if (refreshed) emitZoneUpdated(refreshed);

    const src = row.source || source;
    if (rNew >= 0.75) {
      await this.crowdEventService.createEvent({
        zoneId: row.zoneId,
        eventType: 'CROWD_SPIKE',
        crowdLevel: row.crowdLevel,
        severity: Math.min(5, 1 + Math.floor(rNew * 4)),
        source: src,
        syncZone: false,
      });
    } else if (rOld >= 0.45 && rNew < rOld && rOld - rNew >= 0.1) {
      await this.crowdEventService.createEvent({
        zoneId: row.zoneId,
        eventType: 'CROWD_DROP',
        crowdLevel: row.crowdLevel,
        severity: 1,
        source: src,
        syncZone: false,
      });
    }
  }

  async _dq(integrationId, type, message, row) {
    const created = await this.dataQuality.repository.create({
      sourceSystem: 'ingestion',
      issueType: type,
      severity: 'MEDIUM',
      message,
      payload: row,
      integrationEventId: integrationId,
    });
    emitDataQualityNew(created);
  }

  async processRidePayload({ topic, payload, sourceSystem = 'mqtt' }) {
    return this.withIntegrationLog(sourceSystem, topic, 'ride_status', payload, () =>
      this._processRide(payload, sourceSystem)
    );
  }

  async _processRide(row) {
    const tErr = this.dataQuality.validateTimestamp(row.timestamp);
    if (tErr) throw new Error(tErr);
    if (!row.rideId) throw new Error('rideId is required');
    const waitErr = this.dataQuality.validateWaitTime(row.waitTime);
    if (waitErr) throw new Error(waitErr);

    const ride = await this.rideRepository.findById(row.rideId, { includeZone: true });
    if (!ride) {
      const msg = 'unknown rideId';
      const issue = await this.dataQuality.createIssue({
        sourceSystem: 'ingestion',
        issueType: 'UNKNOWN_RIDE',
        severity: 'HIGH',
        message: msg,
        payload: row,
      });
      emitDataQualityNew(issue);
      throw new Error(msg);
    }

    const before = ride.get({ plain: true });
    const status = row.status != null ? row.status : before.status;
    const wait = row.waitTime != null ? row.waitTime : before.waitTime;

    await this.rideRepository.updateById(row.rideId, {
      status,
      waitTime: wait,
    });
    const updated = await this.rideRepository.findById(row.rideId, { includeZone: true });
    const { emitZoneUpdated } = require('../sockets');
    if (updated?.zoneId) {
      const z = await this.zoneRepository.findById(updated.zoneId, { includeRides: true, includeStaff: true });
      if (z) emitZoneUpdated(z);
    }

    if (before.status === 'OPEN' && (status === 'CLOSED' || status === 'MAINTENANCE')) {
      const zone = await this.zoneRepository.findById(ride.zoneId);
      if (zone) {
        await this.crowdEventService.createEvent({
          zoneId: zone.id,
          eventType: 'RIDE_CLOSURE',
          crowdLevel: 0,
          severity: 3,
          source: row.source || 'ride-mqtt',
          syncZone: false,
        });
      }
    } else if (
      Number(wait) >= longWaitThresholdMinutes &&
      Number(before.waitTime) < longWaitThresholdMinutes
    ) {
      const zone = await this.zoneRepository.findById(ride.zoneId);
      if (zone) {
        await this.crowdEventService.createEvent({
          zoneId: zone.id,
          eventType: 'CROWD_SPIKE',
          crowdLevel: zone.currentCrowdLevel,
          severity: 3,
          source: 'long-wait-ride',
          syncZone: false,
        });
      }
    }
  }

  async processWeatherPayload({ topic, payload, sourceSystem = 'mqtt' }) {
    return this.withIntegrationLog(sourceSystem, topic, 'weather', payload, () =>
      this._processWeatherRow(payload, sourceSystem)
    );
  }

  async _processWeatherRow(row, _source) {
    const ts = row.timestamp || row.observedAt;
    const tErr = this.dataQuality.validateTimestamp(ts);
    if (tErr) throw new Error(tErr);
    if (!row.condition) throw new Error('condition is required');
    const parkId = row.parkId || 'default';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const internalParkId =
      row.internalParkId && UUID_RE.test(String(row.internalParkId))
        ? String(row.internalParkId)
        : UUID_RE.test(String(parkId))
          ? String(parkId)
          : null;

    const obs = await this.weatherService.createObservationFromPayload(
      {
        condition: row.condition,
        temperatureC: row.temperatureC,
        rainMm: row.rainMm,
        windKmh: row.windKmh,
        source: row.source || 'mqtt',
        parkId,
        internalParkId,
        observedAt: ts,
      },
      { emit: true }
    );

    const cond = String(row.condition).toUpperCase();
    const isImpact = weatherImpactConditions.some((w) => cond.includes(w));
    if (isImpact) {
      const zone = await this.getFirstZone();
      if (!zone) {
        return obs;
      }
      const evPack = await this.crowdEventService.createEvent({
        zoneId: zone.id,
        eventType: 'WEATHER_IMPACT',
        crowdLevel: 0,
        severity: 4,
        source: 'weather',
        weatherCondition: cond,
        syncZone: false,
      });
      return { observation: obs, weatherEvent: evPack?.event };
    }
    return obs;
  }

  /**
   * Manual weather POST (HTTP) — not wrapped in withIntegrationLog duplicate (caller may log separately)
   */
  async ingestWeatherObservationFromApi(row) {
    return this._processWeatherRow(
      {
        ...row,
        parkId: row.parkId || 'default',
        internalParkId: row.internalParkId,
        timestamp: row.observedAt || row.timestamp || new Date(),
      },
      'api'
    );
  }

  async processSensorTopic({ topic, raw, sourceSystem = 'mqtt' }) {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      const log = await this.logRepository.create({
        sourceSystem,
        topic,
        eventType: 'sensor',
        payload: { raw: raw.toString().slice(0, 2000) },
        status: 'FAILED',
        errorMessage: 'Invalid JSON on sensor channel',
        processedAt: new Date(),
      });
      await this._emitLog(log);
      return;
    }
    if (data.crowdLevel != null && data.zoneId) {
      await this.processCrowdPayload({
        topic,
        sourceSystem: `${sourceSystem}/sensor-fanout`,
        payload: { ...data, source: data.source || 'sensor', timestamp: data.timestamp || new Date().toISOString() },
      });
    } else {
      await this.withIntegrationLog(
        sourceSystem,
        topic,
        'sensor',
        data,
        async () => {
          return null;
        }
      );
    }
  }
}

module.exports = { IngestionService };
