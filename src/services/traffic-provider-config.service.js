'use strict';

const { TrafficProviderConfig } = require('../models');
const { encryptSecret, decryptSecret } = require('../utils/credentials-crypto');
const { TomTomTrafficProvider, TomTomTrafficProviderError } = require('./traffic-attendance/tomtom-traffic.provider');
const { AuditLogService } = require('./audit-log.service');
const { AppError } = require('../utils/app-error');

/** DB `traffic_provider_configs.provider_key` for the TomTom traffic adapter package (`traffic_tomtom`). */
const TRAFFIC_TOMTOM_ROW_KEY = 'traffic_tomtom';
const DEFAULT_BASE = 'https://api.tomtom.com/routing/1/calculateRoute';

function maskFromSuffix(suffix) {
  const s = suffix && String(suffix).trim() ? String(suffix).trim() : '';
  if (!s) return null;
  return `************${s}`;
}

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

function toPublicDto(row) {
  if (!row) {
    return {
      id: null,
      providerKey: TRAFFIC_TOMTOM_ROW_KEY,
      displayName: 'TomTom Traffic',
      enabled: false,
      maskedApiKey: null,
      pollIntervalMinutes: 10,
      timeoutMs: 15000,
      baseUrl: DEFAULT_BASE,
      createdAt: null,
      updatedAt: null,
      createdBy: null,
      updatedBy: null,
    };
  }
  const p = plainRow(row);
  return {
    id: p.id,
    providerKey: p.providerKey,
    displayName: p.displayName,
    enabled: Boolean(p.enabled),
    maskedApiKey: p.apiKeySuffix ? maskFromSuffix(p.apiKeySuffix) : null,
    pollIntervalMinutes: Number(p.pollIntervalMinutes) || 10,
    timeoutMs: Number(p.timeoutMs) || 15000,
    baseUrl: p.baseUrl || DEFAULT_BASE,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    createdBy: p.createdByUserId || null,
    updatedBy: p.updatedByUserId || null,
  };
}

class TrafficProviderConfigService {
  constructor(deps = {}) {
    this.TrafficProviderConfigModel = deps.TrafficProviderConfig || TrafficProviderConfig;
    this.auditLog = deps.auditLogService || new AuditLogService();
  }

  async findTrafficTomTomRow() {
    return this.TrafficProviderConfigModel.findOne({ where: { providerKey: TRAFFIC_TOMTOM_ROW_KEY } });
  }

  async listMasked() {
    const row = await this.findTrafficTomTomRow();
    return [toPublicDto(row)];
  }

  /**
   * Runtime bundle for TomTom HTTP calls (decrypted key — never log or return in HTTP GET).
   */
  async getTomTomRuntimeOrThrow() {
    const row = await this.findTrafficTomTomRow();
    if (!row || !row.enabled) {
      throw new TomTomTrafficProviderError('TomTom traffic integration is disabled', 'TOMTOM_DISABLED');
    }
    if (!row.encryptedApiKey || !String(row.encryptedApiKey).trim()) {
      throw new TomTomTrafficProviderError('TomTom API key is not configured', 'TOMTOM_API_KEY_MISSING');
    }
    let apiKey;
    try {
      apiKey = decryptSecret(row.encryptedApiKey);
    } catch {
      throw new TomTomTrafficProviderError('TomTom API key could not be decrypted', 'TOMTOM_API_KEY_MISSING');
    }
    if (!String(apiKey || '').trim()) {
      throw new TomTomTrafficProviderError('TomTom API key is not configured', 'TOMTOM_API_KEY_MISSING');
    }
    return {
      apiKey: String(apiKey).trim(),
      baseUrl: String(row.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
      timeoutMs: Math.max(1000, Number(row.timeoutMs) || 15000),
      pollIntervalMinutes: Math.max(1, Number(row.pollIntervalMinutes) || 10),
    };
  }

  /**
   * @param {object} body
   * @param {string|null} userId
   */
  async upsertTomTom(body, userId) {
    const prev = await this.findTrafficTomTomRow();
    const prevDto = toPublicDto(prev);

    const patch = {
      providerKey: TRAFFIC_TOMTOM_ROW_KEY,
      displayName: body.displayName != null ? String(body.displayName).trim() : 'TomTom Traffic',
      enabled: Boolean(body.enabled),
      pollIntervalMinutes: Math.max(1, Number(body.pollIntervalMinutes) || 10),
      timeoutMs: Math.max(1000, Number(body.timeoutMs) || 15000),
      baseUrl: String(body.baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, '') || DEFAULT_BASE,
      updatedByUserId: userId || null,
    };

    if (body.apiKey != null && String(body.apiKey).trim() !== '') {
      const raw = String(body.apiKey).trim();
      patch.encryptedApiKey = encryptSecret(raw);
      patch.apiKeySuffix = raw.length <= 4 ? raw : raw.slice(-4);
    }

    const keepsKey = Boolean(prev && prev.encryptedApiKey && !(body.apiKey && String(body.apiKey).trim()));
    const willHaveKey = keepsKey || Boolean(patch.encryptedApiKey);
    if (patch.enabled && !willHaveKey) {
      throw new AppError('TomTom API key is required when enabled', 422, { code: 'API_KEY_REQUIRED' });
    }

    let row;
    if (!prev) {
      patch.createdByUserId = userId || null;
      row = await this.TrafficProviderConfigModel.create(patch);
    } else {
      const updatePayload = { ...patch };
      if (body.apiKey == null || String(body.apiKey).trim() === '') {
        delete updatePayload.encryptedApiKey;
        delete updatePayload.apiKeySuffix;
      }
      await prev.update(updatePayload);
      row = await this.findTrafficTomTomRow();
    }

    const nextDto = toPublicDto(row);
    await this.auditLog.log({
      action: 'traffic_provider_config.upsert',
      entityType: 'traffic_provider_config',
      entityId: nextDto.id || null,
      oldValue: {
        providerKey: TRAFFIC_TOMTOM_ROW_KEY,
        enabled: prevDto.enabled,
        maskedApiKey: prevDto.maskedApiKey,
        pollIntervalMinutes: prevDto.pollIntervalMinutes,
        timeoutMs: prevDto.timeoutMs,
        baseUrl: prevDto.baseUrl,
      },
      newValue: {
        providerKey: TRAFFIC_TOMTOM_ROW_KEY,
        enabled: nextDto.enabled,
        maskedApiKey: nextDto.maskedApiKey,
        pollIntervalMinutes: nextDto.pollIntervalMinutes,
        timeoutMs: nextDto.timeoutMs,
        baseUrl: nextDto.baseUrl,
        apiKeyRotated: Boolean(body.apiKey && String(body.apiKey).trim()),
      },
      userId,
    });

    return nextDto;
  }

  /**
   * @param {object} body optional coords
   * @param {{ fetchFn?: function }} [opts]
   */
  async testTomTomConnection(body = {}, opts = {}) {
    const rt = await this.getTomTomRuntimeOrThrow();
    const provider = new TomTomTrafficProvider({
      apiKey: rt.apiKey,
      baseUrl: rt.baseUrl,
      timeoutMs: rt.timeoutMs,
      fetchFn: opts.fetchFn,
    });
    const oLat = body.originLat != null ? Number(body.originLat) : 52.377956;
    const oLng = body.originLng != null ? Number(body.originLng) : 4.89707;
    const dLat = body.destinationLat != null ? Number(body.destinationLat) : 52.520008;
    const dLng = body.destinationLng != null ? Number(body.destinationLng) : 13.404954;
    if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) {
      throw new TomTomTrafficProviderError('Invalid test coordinates', 'INVALID_COORDS');
    }
    const { normalized } = await provider.fetchRouteForCorridor(
      { corridorId: '00000000-0000-4000-8000-000000000001', originLat: oLat, originLng: oLng, destinationLat: dLat, destinationLng: dLng },
      { enabled: true }
    );
    return {
      ok: true,
      providerStatus: normalized.providerStatus || 'ok',
      travelTimeSeconds: normalized.travelTimeSeconds,
      routeDistanceMeters: normalized.routeDistanceMeters,
    };
  }
}

module.exports = {
  TrafficProviderConfigService,
  /** @deprecated use TRAFFIC_TOMTOM_ROW_KEY */
  TOMTOM_PROVIDER_KEY: TRAFFIC_TOMTOM_ROW_KEY,
  TRAFFIC_TOMTOM_ROW_KEY,
  DEFAULT_TOMTOM_ROUTING_BASE: DEFAULT_BASE,
  maskFromSuffix,
  toPublicDto,
};
