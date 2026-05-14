/**
 * Canonical-to-Sparkplug Publisher
 *
 * Normalizes integration / cloud canonical data and publishes Sparkplug B–shaped MQTT
 * (JSON-on-wire MVP). Adapters stay canonical-only; this layer owns Sparkplug topics + payloads.
 *
 * @see buildSparkplugTopic in ../modules/uns/sparkplug-topic-builder.service.js
 */

const env = require('../config/env');
const { logger } = require('../utils/logger');
const { publishMqtt } = require('./mqtt-connector.service');
const { buildSparkplugTopic } = require('../modules/uns/sparkplug-topic-builder.service');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const {
  normalizeThemeParksEntityType,
  resolveThemeParksPublicationDomain,
  registerThemeParksDeviceDomain,
} = require('../modules/uns/theme-parks-entity-domain.service');
const { resolveSparkplugEdgeNodeForAsset } = require('./sparkplug-edge-resolver.service');

function sparkplugGroupIdOnly(parkSlug) {
  return env.sparkplugGroupId || slugifyName(parkSlug);
}

async function sparkplugRoutingForDevice(parkSlug, entitySlug, adapterContext, explicitEdgeNodeId) {
  const groupId = sparkplugGroupIdOnly(parkSlug);
  const edgeRes = await resolveSparkplugEdgeNodeForAsset({
    parkSlug,
    assetSlug: entitySlug,
    adapterContext: adapterContext && typeof adapterContext === 'object' ? adapterContext : {},
    explicitEdgeNodeId: explicitEdgeNodeId != null && String(explicitEdgeNodeId).trim() !== ''
      ? String(explicitEdgeNodeId).trim()
      : null,
  });
  return { groupId, edgeNodeId: edgeRes.edgeNodeId, sparkplugResolution: edgeRes };
}

function metricsFromObject(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([name, value]) => ({ name, value }));
}

function mergeLiveCanonicalByEntity(messages) {
  const map = new Map();
  for (const m of messages) {
    if (!m || !m.externalEntityId) continue;
    if (m.messageType !== 'WAIT_TIME_UPDATED' && m.messageType !== 'ENTITY_STATUS_UPDATED') continue;
    const id = String(m.externalEntityId);
    if (!map.has(id)) {
      const initialEt = (m.payload && m.payload.entityType) || m.entityType || null;
      const etStr = initialEt != null && String(initialEt).trim() !== '' ? String(initialEt).trim().toUpperCase() : null;
      const p = m.payload || {};
      map.set(id, {
        externalEntityId: id,
        entityType: etStr,
        entityName: p.externalEntityName || p.name || 'Unknown entity',
        entitySlug: slugifyName(p.slug || p.externalEntityName || p.name || id),
        metrics: {},
        timestamp: m.occurredAt || p?.sampledAt || new Date().toISOString(),
        rawPayload: m.rawPayload || {},
      });
    }
    const acc = map.get(id);
    if (m.entityType) acc.entityType = String(m.entityType).toUpperCase();
    if (m.payload?.entityType) acc.entityType = String(m.payload.entityType).toUpperCase();
    if (m.payload?.externalEntityName) acc.entityName = m.payload.externalEntityName;
    if (m.payload?.slug) acc.entitySlug = slugifyName(m.payload.slug);
    if (m.occurredAt) acc.timestamp = m.occurredAt;
    if (m.messageType === 'WAIT_TIME_UPDATED' && typeof m.payload?.waitTime === 'number') {
      acc.metrics.queue_time = m.payload.waitTime;
    }
    if (m.messageType === 'ENTITY_STATUS_UPDATED' && m.payload?.status != null) {
      acc.metrics.status = m.payload.status;
    }
  }
  return [...map.values()];
}

class CanonicalToSparkplugPublisher {
  constructor() {
    /** @type {Set<string>} */
    this._dbirthSent = new Set();
  }

  _dbirthKey(parkSlug, deviceId, edgeNodeId) {
    return `${slugifyName(parkSlug)}::${slugifyName(deviceId)}::${slugifyName(edgeNodeId)}`;
  }

  /**
   * @param {{ parkSlug: string; entityType: string; entityName?: string; entitySlug: string; metrics?: Record<string, unknown>; timestamp?: string; source?: string; theoreticalCapacity?: number | null }} evt
   */
  async publishFromCanonicalEvent(evt) {
    const parkSlug = String(evt.parkSlug || '').trim();
    const entitySlug = String(evt.entitySlug || '').trim();
    if (!parkSlug || !entitySlug) {
      logger.warn({ evt }, 'canonicalToSparkplugPublisher: missing parkSlug or entitySlug');
      return { published: false, reason: 'invalid_event' };
    }
    const deviceId = slugifyName(entitySlug);
    const adapterContext = evt.adapterContext && typeof evt.adapterContext === 'object' ? evt.adapterContext : {};
    const explicit =
      evt.explicitSparkplugEdgeNodeId != null && String(evt.explicitSparkplugEdgeNodeId).trim() !== ''
        ? String(evt.explicitSparkplugEdgeNodeId).trim()
        : evt.edgeNodeId != null && String(evt.edgeNodeId).trim() !== ''
          ? String(evt.edgeNodeId).trim()
          : null;
    const { groupId, edgeNodeId } = await sparkplugRoutingForDevice(
      parkSlug,
      entitySlug,
      adapterContext,
      explicit
    );
    const key = this._dbirthKey(parkSlug, deviceId, edgeNodeId);
    const domain = resolveThemeParksPublicationDomain(evt.entityName, evt.entityType);
    const source = evt.source != null ? String(evt.source) : 'canonical';
    const displayName = evt.entityName != null ? String(evt.entityName) : deviceId;
    const theoretical =
      evt.theoreticalCapacity != null && Number.isFinite(Number(evt.theoreticalCapacity))
        ? Number(evt.theoreticalCapacity)
        : null;

    if (!this._dbirthSent.has(key)) {
      await this._publishDbirth({
        groupId,
        edgeNodeId,
        deviceId,
        domain,
        displayName,
        source,
        theoreticalCapacity: theoretical,
      });
      this._dbirthSent.add(key);
    }

    const ts = evt.timestamp || new Date().toISOString();
    const topic = buildSparkplugTopic({ groupId, messageType: 'DDATA', edgeNodeId, deviceId });
    const metrics = metricsFromObject(evt.metrics || {});
    const payload = { timestamp: ts, metrics, tags: { source } };
    const mqtt = await publishMqtt(topic, payload);
    registerThemeParksDeviceDomain({ groupId, deviceId, domain, entityType: evt.entityType });
    return { published: mqtt.published, topic, mqtt };
  }

  async _publishDbirth({ groupId, edgeNodeId, deviceId, domain, displayName, source, theoreticalCapacity }) {
    const topic = buildSparkplugTopic({ groupId, messageType: 'DBIRTH', edgeNodeId, deviceId });
    const metrics = [
      { name: 'entity_type', value: domain },
      { name: 'display_name', value: displayName },
      { name: 'source', value: source },
    ];
    if (theoreticalCapacity != null) {
      metrics.push({ name: 'theoretical_capacity', value: theoreticalCapacity });
    }
    const payload = { timestamp: new Date().toISOString(), metrics, tags: { source } };
    await publishMqtt(topic, payload);
  }

  /**
   * After ThemeParks.wiki (or similar) live sync: merge per-entity metrics, DBIRTH if needed, then DDATA.
   * @param {{ parkSlug: string; provider: string; messages: Array<Record<string, unknown>> }} args
   */
  async publishFromLiveCanonicalMessages({ parkSlug, provider, messages }) {
    if (!Array.isArray(messages) || !messages.length) return { devices: 0 };
    const merged = mergeLiveCanonicalByEntity(messages);
    let n = 0;
    for (const row of merged) {
      if (!row.metrics || !Object.keys(row.metrics).length) continue;
      const deviceId = row.entitySlug || slugifyName(row.entityName || row.externalEntityId);
      const slugForRes = typeof row.entitySlug === 'string' && row.entitySlug.trim() ? row.entitySlug.trim() : deviceId;
      const { groupId, edgeNodeId } = await sparkplugRoutingForDevice(
        parkSlug,
        slugForRes,
        row.adapterContext,
        row.explicitSparkplugEdgeNodeId != null ? String(row.explicitSparkplugEdgeNodeId).trim() : null
      );
      const key = this._dbirthKey(parkSlug, deviceId, edgeNodeId);
      const domain = resolveThemeParksPublicationDomain(row.entityName, row.entityType);
      if (!this._dbirthSent.has(key)) {
        await this._publishDbirth({
          groupId,
          edgeNodeId,
          deviceId,
          domain,
          displayName: String(row.entityName || deviceId),
          source: String(provider || 'integration'),
          theoreticalCapacity: extractTheoreticalCapacity(row.rawPayload),
        });
        this._dbirthSent.add(key);
      }
      const ts = row.timestamp || new Date().toISOString();
      const topic = buildSparkplugTopic({ groupId, messageType: 'DDATA', edgeNodeId, deviceId });
      const srcTag = String(provider || 'integration');
      const payload = {
        timestamp: ts,
        metrics: metricsFromObject(row.metrics),
        tags: { source: srcTag },
      };
      await publishMqtt(topic, payload);
      registerThemeParksDeviceDomain({ groupId, deviceId, domain, entityType: row.entityType });
      n += 1;
    }
    return { devices: n };
  }

  /**
   * PARK_ENTITY_SYNCED batch: publish DBIRTH with static metadata for each entity.
   * @param {{ parkSlug: string; provider: string; messages: Array<Record<string, unknown>> }} args
   */
  async publishFromEntitySyncMessages({ parkSlug, provider, messages }) {
    if (!Array.isArray(messages) || !messages.length) return { births: 0 };
    let births = 0;
    const src = String(provider || 'integration');
    for (const m of messages) {
      if (!m || m.messageType !== 'PARK_ENTITY_SYNCED') continue;
      const p = m.payload || {};
      const slugRaw =
        typeof p.slug === 'string' && p.slug.trim() ? p.slug.trim() : p.externalEntityName || m.externalEntityId || '';
      const deviceId = slugifyName(p.slug || p.externalEntityName || m.externalEntityId || 'entity');
      const { groupId, edgeNodeId } = await sparkplugRoutingForDevice(parkSlug, slugRaw || deviceId, {});
      const key = this._dbirthKey(parkSlug, deviceId, edgeNodeId);
      const domain = resolveThemeParksPublicationDomain(
        m.payload?.externalEntityName || m.externalEntityId,
        m.entityType
      );
      const displayName = String(m.payload?.externalEntityName || deviceId);
      await this._publishDbirth({
        groupId,
        edgeNodeId,
        deviceId,
        domain,
        displayName,
        source: src,
        theoreticalCapacity: extractTheoreticalCapacity(m.rawPayload),
      });
      this._dbirthSent.add(key);
      registerThemeParksDeviceDomain({ groupId, deviceId, domain, entityType: m.entityType });
      births += 1;
    }
    return { births };
  }

  /**
   * Optional: device removed from park catalog (caller supplies slug).
   */
  async publishDdeath({ parkSlug, entitySlug, source }) {
    const deviceId = slugifyName(entitySlug);
    const { groupId, edgeNodeId } = await sparkplugRoutingForDevice(parkSlug, entitySlug, {}, null);
    const topic = buildSparkplugTopic({ groupId, messageType: 'DDEATH', edgeNodeId, deviceId });
    const src = String(source || 'canonical');
    const payload = {
      timestamp: new Date().toISOString(),
      metrics: [{ name: 'source', value: src }],
      tags: { source: src },
    };
    const mqtt = await publishMqtt(topic, payload);
    this._dbirthSent.delete(this._dbirthKey(parkSlug, deviceId, edgeNodeId));
    return { published: mqtt.published, topic };
  }

}

function extractTheoreticalCapacity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v =
    raw.theoreticalCapacity ??
    raw.maxGuestsPerHour ??
    raw.capacity ??
    raw.queue?.STANDBY?.capacity ??
    null;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let singleton;
function getCanonicalToSparkplugPublisher() {
  if (!singleton) singleton = new CanonicalToSparkplugPublisher();
  return singleton;
}

function publishFromCanonicalEvent(evt) {
  return getCanonicalToSparkplugPublisher().publishFromCanonicalEvent(evt);
}

module.exports = {
  CanonicalToSparkplugPublisher,
  getCanonicalToSparkplugPublisher,
  publishFromCanonicalEvent,
  normalizeThemeParksEntityType,
  /** @deprecated use normalizeThemeParksEntityType */
  mapEntityTypeToUnsDomain: normalizeThemeParksEntityType,
};
