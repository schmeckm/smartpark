const { Op } = require('sequelize');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { Park, ParkAsset, AssetType } = require('../models');
const { WeatherService } = require('./weather.service');
const { AiFeatureStoreService } = require('./ai-feature-store.service');
const { fetchOpenMeteoCurrent, wmoCodeToCondition } = require('./open-meteo-client');
const { AdapterInstallConfigRepository } = require('../repositories/adapter-install-config.repository');
const { mergeAdapterInstallConfig } = require('../utils/adapter-install-config-merge');

/** Normalize slug-like keys for comparing adapter install `parkSlug` to `parks.slug`. */
function slugNorm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Adapter install YAML (`weather_open_meteo`) may bind via parkSlug/sparkplugGroupId.
 * If neither is set, coords apply to any park still missing coordinates (single-park setups).
 */
function weatherInstallMatchesPark(merged, park) {
  const bind = String(merged.parkSlug || merged.sparkplugGroupId || merged.contextParkId || '').trim();
  if (!bind) return true;
  const b = slugNorm(bind);
  if (slugNorm(park.slug) === b) return true;
  if (park.externalEntityId && slugNorm(String(park.externalEntityId)) === b) return true;
  const extRaw = park.externalEntityId != null ? String(park.externalEntityId).trim().toLowerCase() : '';
  if (extRaw && bind.toLowerCase() === extRaw) return true;
  return false;
}

/**
 * Same lat/lon as the Weather adapter UI / `weather_open_meteo.install.yaml` (configJson ∪ contextJson).
 * @param {import('../models').Park} park
 * @returns {{ lat: number, lon: number } | null}
 */
function resolveCoordinatesFromWeatherOpenMeteoInstall(park) {
  try {
    const repo = new AdapterInstallConfigRepository();
    const doc = repo.load('weather_open_meteo');
    if (!doc || typeof doc !== 'object') return null;
    const cfg = doc.configJson && typeof doc.configJson === 'object' ? doc.configJson : {};
    const ctx = doc.contextJson && typeof doc.contextJson === 'object' ? doc.contextJson : {};
    const merged = mergeAdapterInstallConfig(cfg, ctx);
    if (!weatherInstallMatchesPark(merged, park)) return null;
    const lat = merged.latitude != null ? Number(merged.latitude) : null;
    const lon = merged.longitude != null ? Number(merged.longitude) : null;
    if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  } catch (e) {
    logger.debug({ err: e?.message }, 'weather_open_meteo.install_coords_skip');
  }
  return null;
}

/** Last completed tick status for GET /ai/pipeline-health (null before first run). */
let lastWeatherOpenMeteoHealth = null;

function getWeatherOpenMeteoSchedulerHealth() {
  return lastWeatherOpenMeteoHealth;
}

/** Platform parks excluded only when sync is explicitly disabled. */
function isActiveParkRow(park) {
  return park.syncManaged !== false;
}

class WeatherOpenMeteoSchedulerService {
  constructor() {
    this.weather = new WeatherService();
    this._tickRunning = false;
  }

  /**
   * @returns {{ lat: number, lon: number } | null}
   */
  async resolveCoordinates(park) {
    const lat0 = park.latitude != null ? Number(park.latitude) : null;
    const lon0 = park.longitude != null ? Number(park.longitude) : null;
    if (
      lat0 != null &&
      lon0 != null &&
      Number.isFinite(lat0) &&
      Number.isFinite(lon0)
    ) {
      return { lat: lat0, lon: lon0 };
    }

    const parkType = await AssetType.findOne({
      where: { code: 'PARK' },
      attributes: ['id'],
    });
    if (!parkType) return null;

    const asset = await ParkAsset.findOne({
      where: {
        parkId: park.id,
        assetTypeId: parkType.id,
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null },
      },
      order: [['updatedAt', 'DESC']],
      attributes: ['latitude', 'longitude'],
    });
    if (asset) {
      const lat = Number(asset.latitude);
      const lon = Number(asset.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }

    const fromInstall = resolveCoordinatesFromWeatherOpenMeteoInstall(park);
    if (fromInstall) {
      logger.info(
        { parkId: park.id, slug: park.slug, source: 'weather_open_meteo.install.yaml' },
        'weather_open_meteo.using_adapter_install_coordinates'
      );
    }
    return fromInstall;
  }

  async persistObservation(park, cur) {
    const code = cur.weatherCode;
    const condition = wmoCodeToCondition(code);
    const externalKey =
      park.externalEntityId != null && String(park.externalEntityId).trim() !== ''
        ? String(park.externalEntityId).trim()
        : String(park.slug);

    await this.weather.createObservationFromPayload(
      {
        condition,
        temperatureC: cur.temperatureC,
        rainMm: cur.rainMm,
        rainProbabilityPercent: cur.rainProbabilityPercent,
        windKmh: cur.windKmh,
        weatherCode: code,
        source: 'open_meteo_scheduler',
        parkId: externalKey,
        internalParkId: park.id,
        observedAt: cur.observedAt,
      },
      { emit: true }
    );
  }

  async runTick() {
    if (this._tickRunning) {
      logger.warn('weather_open_meteo.tick_skip_overlap');
      return;
    }
    this._tickRunning = true;
    const startedAt = Date.now();
    const errors = [];
    let parksConsidered = 0;
    let parksSkippedNoCoords = 0;
    let parksSucceeded = 0;
    let parksFailed = 0;
    let snapshotRebuildAttempted = false;
    let snapshotRebuildOk = null;
    let snapshotRebuildError = null;

    try {
      const parks = await Park.findAll({
        attributes: [
          'id',
          'slug',
          'name',
          'timezone',
          'latitude',
          'longitude',
          'externalEntityId',
          'syncManaged',
        ],
      });
      const targets = parks.filter(isActiveParkRow);
      parksConsidered = targets.length;

      for (const park of targets) {
        let coords;
        try {
          coords = await this.resolveCoordinates(park);
        } catch (e) {
          parksFailed += 1;
          const message = e?.message || String(e);
          errors.push({ parkId: park.id, slug: park.slug, message });
          logger.warn(
            { err: message, parkId: park.id, slug: park.slug },
            'weather_open_meteo.resolve_coords_failed'
          );
          continue;
        }
        if (!coords) {
          parksSkippedNoCoords += 1;
          logger.warn(
            { parkId: park.id, slug: park.slug },
            'weather_open_meteo.skip_no_coordinates'
          );
          continue;
        }

        try {
          const ps = getPlatformSettingsService();
          const retries = await ps.getNumber('WEATHER_OPEN_METEO_FETCH_RETRIES', 3);
          const baseDelayMs = await ps.getNumber('WEATHER_OPEN_METEO_RETRY_BASE_MS', 500);
          const cur = await fetchOpenMeteoCurrent(coords.lat, coords.lon, park.timezone || 'UTC', {
            retries,
            baseDelayMs,
            baseForecastUrl: env.weatherOpenMeteoForecastUrl,
          });
          await this.persistObservation(park, cur);
          parksSucceeded += 1;
          logger.info(
            {
              parkId: park.id,
              slug: park.slug,
              weatherCode: cur.weatherCode,
              temperatureC: cur.temperatureC,
            },
            'weather_open_meteo.park_ingested'
          );
        } catch (e) {
          parksFailed += 1;
          const message = e?.message || String(e);
          errors.push({ parkId: park.id, slug: park.slug, message });
          logger.warn(
            { err: message, parkId: park.id, slug: park.slug },
            'weather_open_meteo.park_fetch_failed'
          );
        }
      }

      const psRebuild = getPlatformSettingsService();
      const rebuildSnapshots = await psRebuild.getBoolean('WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS', true);
      if (rebuildSnapshots && parksSucceeded > 0) {
        snapshotRebuildAttempted = true;
        try {
          await new AiFeatureStoreService().buildSnapshots();
          snapshotRebuildOk = true;
          logger.info({ parksSucceeded }, 'weather_open_meteo.snapshot_rebuild_ok');
        } catch (e) {
          snapshotRebuildOk = false;
          snapshotRebuildError = e?.message || String(e);
          logger.warn({ err: snapshotRebuildError }, 'weather_open_meteo.snapshot_rebuild_failed');
        }
      }
    } catch (e) {
      const message = e?.message || String(e);
      logger.warn({ err: message }, 'weather_open_meteo.tick_failed');
      errors.push({ parkId: null, slug: null, message });
    } finally {
      const finishedAt = Date.now();
      lastWeatherOpenMeteoHealth = {
        enabled: true,
        finishedAtIso: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        parksConsidered,
        parksSkippedNoCoords,
        parksSucceeded,
        parksFailed,
        snapshotRebuildAttempted,
        snapshotRebuildOk,
        snapshotRebuildError,
        errors: errors.slice(0, 25),
      };
      this._tickRunning = false;
    }
  }

  /**
   * Enable/interval from PlatformSettingsService (DB → ENV → default).
   * @returns {Promise<() => void>}
   */
  async start() {
    const ps = getPlatformSettingsService();
    const enabled = await ps.getBoolean('WEATHER_OPEN_METEO_ENABLED', false);
    if (!enabled) {
      lastWeatherOpenMeteoHealth = {
        enabled: false,
        finishedAtIso: null,
        message: 'WEATHER_OPEN_METEO_ENABLED is false (platform settings / env / default)',
      };
      logger.info('weather_open_meteo.scheduler_disabled');
      return () => {};
    }

    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    const schedule = (ms) => {
      if (cancelled) return;
      timer = setTimeout(() => void runCycle(), ms);
    };

    const runCycle = async () => {
      if (cancelled) return;
      try {
        const on = await ps.getBoolean('WEATHER_OPEN_METEO_ENABLED', false);
        if (!on) {
          lastWeatherOpenMeteoHealth = {
            enabled: false,
            finishedAtIso: null,
            message: 'WEATHER_OPEN_METEO_ENABLED turned off',
          };
          schedule(15_000);
          return;
        }
        await this.runTick();
        const intervalSec = await ps.getNumber('WEATHER_OPEN_METEO_INTERVAL_SECONDS', 300);
        schedule(Math.max(60_000, intervalSec * 1000));
      } catch (e) {
        logger.warn({ err: e?.message || String(e) }, 'weather_open_meteo.interval_tick_failed');
        schedule(120_000);
      }
    };

    const intervalSec0 = await ps.getNumber('WEATHER_OPEN_METEO_INTERVAL_SECONDS', 300);
    logger.info({ intervalSeconds: intervalSec0 }, 'weather_open_meteo.scheduler_started');
    schedule(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    };
  }
}

module.exports = {
  WeatherOpenMeteoSchedulerService,
  getWeatherOpenMeteoSchedulerHealth,
};
