'use strict';

const { PlatformSetting } = require('../models');
const {
  PLATFORM_SETTING_REGISTRY,
  PLATFORM_SETTING_KEYS,
  getRegistryEntry,
} = require('../constants/platform-settings.registry');
const { AppError } = require('../utils/app-error');

const CACHE_TTL_MS = 45_000;

/** @returns {boolean | null} null = unset */
function truthyEnv(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s === 'true' || s === '1' || s.toLowerCase() === 'yes') return true;
  if (s === 'false' || s === '0' || s.toLowerCase() === 'no') return false;
  return null;
}

function parseBooleanFromStored(raw) {
  const t = truthyEnv(raw);
  if (t === null) return false;
  return t;
}

function clampNum(n, meta) {
  const c = meta?.clamp;
  if (!c || !Number.isFinite(n)) return n;
  return Math.min(c.max, Math.max(c.min, n));
}

class PlatformSettingsService {
  constructor() {
    this._cacheAt = 0;
    /** @type {import('../models').PlatformSetting[] | null} */
    this._cacheRows = null;
  }

  invalidateCache() {
    this._cacheAt = 0;
    this._cacheRows = null;
  }

  async warmupCache() {
    await this._loadRowsForce();
  }

  async _loadRowsForce() {
    const rows = await PlatformSetting.findAll({ where: { activeFlag: true } });
    this._cacheRows = rows;
    this._cacheAt = Date.now();
    return rows;
  }

  async _loadRows() {
    const now = Date.now();
    if (this._cacheRows && now - this._cacheAt < CACHE_TTL_MS) return this._cacheRows;
    return this._loadRowsForce();
  }

  /** @param {import('../models').PlatformSetting[]} rows */
  rowMap(rows) {
    const m = new Map();
    for (const r of rows) {
      m.set(r.settingKey, r);
    }
    return m;
  }

  /**
   * @param {Map<string, import('../models').PlatformSetting>} rows
   * @returns {{ value: boolean, source: 'DB'|'ENV'|'DEFAULT' }}
   */
  resolveBoolean(key, rows) {
    const meta = getRegistryEntry(key);
    const codeDefault = meta?.valueType === 'boolean' ? Boolean(meta.codeDefault) : false;
    const row = rows.get(key);
    if (row && row.activeFlag) {
      return { value: parseBooleanFromStored(row.settingValue), source: 'DB' };
    }
    const envVar = meta?.envVar;
    if (envVar) {
      const raw = process.env[envVar];
      const t = truthyEnv(raw);
      if (t !== null) {
        return { value: t, source: 'ENV' };
      }
    }
    return { value: codeDefault, source: 'DEFAULT' };
  }

  /**
   * @param {Map<string, import('../models').PlatformSetting>} rows
   * @returns {{ value: number, source: 'DB'|'ENV'|'DEFAULT' }}
   */
  resolveNumber(key, rows) {
    const meta = getRegistryEntry(key);
    const codeDefault = meta?.valueType === 'number' ? Number(meta.codeDefault) || 0 : 0;
    const row = rows.get(key);
    if (row && row.activeFlag) {
      const n = Number(String(row.settingValue).trim());
      const v = Number.isFinite(n) ? clampNum(n, meta) : clampNum(codeDefault, meta);
      return { value: v, source: 'DB' };
    }
    const envVar = meta?.envVar;
    if (envVar) {
      const raw = process.env[envVar];
      if (raw !== undefined && String(raw).trim() !== '') {
        const n = Number(String(raw).trim());
        const v = Number.isFinite(n) ? clampNum(n, meta) : clampNum(codeDefault, meta);
        return { value: v, source: 'ENV' };
      }
    }
    return { value: clampNum(codeDefault, meta), source: 'DEFAULT' };
  }

  /**
   * @param {Map<string, import('../models').PlatformSetting>} rows
   * @returns {{ value: string, source: 'DB'|'ENV'|'DEFAULT' }}
   */
  resolveString(key, rows) {
    const meta = getRegistryEntry(key);
    const codeDefault = meta?.valueType === 'string' ? String(meta.codeDefault ?? '') : '';
    const row = rows.get(key);
    if (row && row.activeFlag) {
      return { value: String(row.settingValue ?? ''), source: 'DB' };
    }
    const envVar = meta?.envVar;
    if (envVar) {
      const raw = process.env[envVar];
      if (raw !== undefined && String(raw).trim() !== '') {
        return { value: String(raw).trim(), source: 'ENV' };
      }
    }
    return { value: codeDefault, source: 'DEFAULT' };
  }

  async getBoolean(key, fallback = false) {
    const meta = getRegistryEntry(key);
    const rows = this.rowMap(await this._loadRows());
    if (!meta || meta.valueType !== 'boolean') {
      const row = rows.get(key);
      if (row && row.activeFlag) return parseBooleanFromStored(row.settingValue);
      return fallback;
    }
    return this.resolveBoolean(key, rows).value;
  }

  async getNumber(key, fallback = 0) {
    const meta = getRegistryEntry(key);
    const rows = this.rowMap(await this._loadRows());
    if (!meta || meta.valueType !== 'number') {
      const row = rows.get(key);
      if (row && row.activeFlag) {
        const n = Number(String(row.settingValue).trim());
        return Number.isFinite(n) ? n : fallback;
      }
      return fallback;
    }
    return this.resolveNumber(key, rows).value;
  }

  async getString(key, fallback = '') {
    const meta = getRegistryEntry(key);
    const rows = this.rowMap(await this._loadRows());
    if (!meta || meta.valueType !== 'string') {
      const row = rows.get(key);
      if (row && row.activeFlag) return String(row.settingValue ?? '');
      return fallback;
    }
    return this.resolveString(key, rows).value;
  }

  /**
   * @param {string | null | undefined} category — e.g. AI, WEATHER, ADAPTERS
   */
  async getSettingsByCategory(category) {
    const rows = this.rowMap(await this._loadRows());
    const cat = category ? String(category).trim().toUpperCase() : null;
    const keys = PLATFORM_SETTING_KEYS.filter((k) => !cat || PLATFORM_SETTING_REGISTRY[k].category === cat);
    return keys.map((k) => {
      const meta = PLATFORM_SETTING_REGISTRY[k];
      let resolved;
      if (meta.valueType === 'boolean') resolved = this.resolveBoolean(k, rows);
      else if (meta.valueType === 'number') resolved = this.resolveNumber(k, rows);
      else resolved = this.resolveString(k, rows);
      const dbRow = rows.get(k);
      return {
        settingKey: k,
        settingValue: dbRow ? dbRow.settingValue : null,
        valueType: meta.valueType,
        category: meta.category,
        description: meta.description,
        activeFlag: dbRow ? dbRow.activeFlag : true,
        effectiveValue: resolved.value,
        resolvedSource: resolved.source,
      };
    });
  }

  /** Snapshot of effective values + per-field resolution source for pipeline health / diagnostics. */
  async getEffectiveForPipelineHealth() {
    const rows = this.rowMap(await this._loadRows());
    return {
      aiSampling: {
        enabled: this.resolveBoolean('AI_SAMPLING_ENABLED', rows),
        intervalSeconds: this.resolveNumber('AI_SAMPLING_INTERVAL_SECONDS', rows),
      },
      weatherOpenMeteo: {
        enabled: this.resolveBoolean('WEATHER_OPEN_METEO_ENABLED', rows),
        intervalSeconds: this.resolveNumber('WEATHER_OPEN_METEO_INTERVAL_SECONDS', rows),
        rebuildSnapshots: this.resolveBoolean('WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS', rows),
      },
      adapters: {
        schedulerEnabled: this.resolveBoolean('ADAPTER_SCHEDULER_ENABLED', rows),
        externalParkDataEnabled: this.resolveBoolean('EXTERNAL_PARK_DATA_ENABLED', rows),
        externalPollIntervalSeconds: this.resolveNumber('EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS', rows),
      },
    };
  }

  async setSetting(key, value) {
    const meta = getRegistryEntry(key);
    if (!meta) {
      throw new AppError('Unknown platform setting key', 400, { code: 'UNKNOWN_SETTING_KEY' });
    }
    let serialized;
    if (meta.valueType === 'boolean') {
      const b = value === true || value === 'true' || value === 1 || value === '1';
      serialized = b ? 'true' : 'false';
    } else if (meta.valueType === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new AppError('Invalid number value', 422, { code: 'INVALID_VALUE' });
      }
      serialized = String(clampNum(n, meta));
    } else {
      serialized = String(value ?? '').trim();
      if (!serialized) {
        throw new AppError('Value required', 422, { code: 'INVALID_VALUE' });
      }
    }

    const row = await PlatformSetting.findOne({ where: { settingKey: key } });
    if (!row) {
      await PlatformSetting.create({
        settingKey: key,
        settingValue: serialized,
        valueType: meta.valueType,
        category: meta.category,
        description: meta.description,
        activeFlag: true,
      });
    } else {
      await row.update({
        settingValue: serialized,
        valueType: meta.valueType,
        category: meta.category,
        description: meta.description,
        activeFlag: true,
      });
    }
    this.invalidateCache();
    if (key === 'INFLUX_OT_STREAMING_ENABLED') {
      try {
        const { refreshInfluxStreamingGate } = require('./influx-ot-metrics.service');
        refreshInfluxStreamingGate().catch(() => {});
      } catch {
        /* influx service optional at load */
      }
    }
    const rows = this.rowMap(await this._loadRowsForce());
    if (meta.valueType === 'boolean') return this.resolveBoolean(key, rows);
    if (meta.valueType === 'number') return this.resolveNumber(key, rows);
    return this.resolveString(key, rows);
  }
}

let singleton = null;

function getPlatformSettingsService() {
  if (!singleton) singleton = new PlatformSettingsService();
  return singleton;
}

module.exports = {
  PlatformSettingsService,
  getPlatformSettingsService,
  CACHE_TTL_MS,
};
