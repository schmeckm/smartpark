const { AppSettingRepository } = require('../../../repositories/app-setting.repository');
const { ExternalEntityMappingRepository } = require('../../../repositories/external-entity-mapping.repository');

const SELECTED_PARK_SETTING_KEY = 'externalParkData.selectedPark';
const THEMEPARKS_FALLBACK_ENTITY_ESTIMATE = 120;

function toArrayUnique(items) {
  return [...new Set(items)];
}

function normalizeType(v) {
  return String(v || '')
    .trim()
    .toUpperCase();
}

function uniqueBy(rows, keyFn) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const k = keyFn(row);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

class AdapterInventoryService {
  constructor() {
    this.settingRepo = new AppSettingRepository();
    this.mappingRepo = new ExternalEntityMappingRepository();
  }

  _emptyInventory() {
    return {
      adapterKey: null,
      deviceCount: null,
      entityCount: null,
      serviceCount: null,
      devices: [],
      entities: [],
      services: [],
      metadata: { known: false },
    };
  }

  _weatherInventory(adapterKey) {
    return {
      adapterKey,
      deviceCount: 1,
      entityCount: 5,
      serviceCount: 1,
      devices: [
        {
          id: 'open_meteo_cloud_endpoint',
          name: 'Open-Meteo Cloud Endpoint',
          type: 'CLOUD_ENDPOINT',
        },
      ],
      entities: [
        { id: 'weather_current_temperature', slug: 'current', metric: 'temperature', type: 'WEATHER_METRIC' },
        { id: 'weather_current_rain_probability', slug: 'current', metric: 'rain_probability', type: 'WEATHER_METRIC' },
        { id: 'weather_current_rain_mm', slug: 'current', metric: 'rain_mm', type: 'WEATHER_METRIC' },
        { id: 'weather_current_wind_speed', slug: 'current', metric: 'wind_speed', type: 'WEATHER_METRIC' },
        { id: 'weather_current_weather_condition', slug: 'current', metric: 'weather_condition', type: 'WEATHER_METRIC' },
      ],
      services: [{ id: 'poll_weather_now', name: 'Poll weather now', type: 'POLL_ACTION' }],
      metadata: { known: true, source: 'static_profile' },
    };
  }

  _calendarDemandInventory(adapterKey) {
    const metrics = [
      'is_weekend',
      'is_public_holiday',
      'is_school_holiday',
      'bridge_day',
      'month',
      'weekday',
      'season_summer',
      'season_halloween',
      'season_winter',
      'holiday_score',
    ];
    return {
      adapterKey,
      deviceCount: 1,
      entityCount: metrics.length,
      serviceCount: 1,
      devices: [{ id: 'calendar_gateway', name: 'Park demand calendar', type: 'CALENDAR_GATEWAY' }],
      entities: metrics.map((m) => ({
        id: `calendar_current_${m}`,
        slug: 'current',
        metric: m,
        type: 'CALENDAR_METRIC',
      })),
      services: [{ id: 'poll_calendar_demand', name: 'Poll calendar demand', type: 'POLL_ACTION' }],
      metadata: { known: true, source: 'static_profile' },
    };
  }

  _demoInventory(adapterKey) {
    return {
      adapterKey,
      deviceCount: 2,
      entityCount: 9,
      serviceCount: 2,
      devices: [
        { id: 'demo_gateway', name: 'Demo Gateway', type: 'SIMULATED_GATEWAY' },
        { id: 'demo_station', name: 'Demo Station', type: 'SIMULATED_ENDPOINT' },
      ],
      entities: [
        { id: 'demo_ride_1', type: 'RIDE' },
        { id: 'demo_ride_2', type: 'RIDE' },
        { id: 'demo_ride_3', type: 'RIDE' },
        { id: 'demo_ride_4', type: 'RIDE' },
        { id: 'demo_access_gate', type: 'ACCESS_POINT' },
        { id: 'demo_metric_queue_time', type: 'METRIC' },
        { id: 'demo_metric_status', type: 'METRIC' },
        { id: 'demo_metric_vehicle_count', type: 'METRIC' },
        { id: 'demo_weather', type: 'METRIC' },
      ],
      services: [
        { id: 'demo_poll', name: 'Poll demo payload', type: 'POLL_ACTION' },
        { id: 'demo_discover', name: 'Discover demo entities', type: 'DISCOVERY_ACTION' },
      ],
      metadata: { known: true, source: 'static_profile' },
    };
  }

  async _themeParksInventory(adapterKey) {
    const selected = await this.settingRepo.getValue(SELECTED_PARK_SETTING_KEY, null);
    const hasPark =
      selected &&
      String(selected.provider || '') === 'themeparks_wiki' &&
      selected.externalParkId != null &&
      String(selected.externalParkId).trim() !== '';

    let entityRows = [];
    if (hasPark) {
      entityRows = await this.mappingRepo.findAll({
        provider: 'themeparks_wiki',
        parkId: String(selected.externalParkId),
        limit: 5000,
      });
    }

    const allowedTypes = new Set(['RIDE', 'SHOW', 'RESTAURANT', 'ATTRACTION']);
    const filtered = (entityRows || []).filter((r) => allowedTypes.has(normalizeType(r.externalEntityType)));
    const unique = uniqueBy(filtered, (r) => String(r.externalEntityId || '').trim());
    const entityCount = unique.length > 0 ? unique.length : THEMEPARKS_FALLBACK_ENTITY_ESTIMATE;

    const entities = unique.slice(0, 300).map((r) => ({
      id: String(r.externalEntityId || ''),
      name: r.externalEntityName || String(r.externalEntityId || ''),
      type: normalizeType(r.externalEntityType) || 'OTHER',
      mappingStatus: r.mappingStatus || null,
    }));

    return {
      adapterKey,
      deviceCount: 1,
      entityCount,
      serviceCount: 3,
      devices: [{ id: 'themeparks_wiki_api', name: 'ThemeParks.wiki API', type: 'CLOUD_ENDPOINT' }],
      entities,
      services: [
        { id: 'sync_entities', name: 'Sync entities', type: 'SYNC_ACTION' },
        { id: 'sync_live', name: 'Sync live data', type: 'SYNC_ACTION' },
        { id: 'sync_calendar', name: 'Sync calendar', type: 'SYNC_ACTION' },
      ],
      metadata: {
        known: true,
        source: hasPark && unique.length > 0 ? 'selected_park_mappings' : 'fallback_estimate',
        selectedPark: hasPark ? selected.externalParkId : null,
      },
    };
  }

  /**
   * Operational breakdown for ThemeParks.wiki (mappings DB). Used by Adapter Operations Center.
   */
  async getThemeParksWikiOpsDetail() {
    const selected = await this.settingRepo.getValue(SELECTED_PARK_SETTING_KEY, null);
    const hasPark =
      selected &&
      String(selected.provider || '') === 'themeparks_wiki' &&
      selected.externalParkId != null &&
      String(selected.externalParkId).trim() !== '';

    if (!hasPark) {
      return {
        adapterKey: 'themeparks_wiki',
        selectedParkId: null,
        selectedParkName: null,
        lastEntitiesSyncedAt: null,
        lastLiveObservationsAt: null,
        lastLiveObservationCount: null,
        mappedEntityTotal: 0,
        childrenCount: 0,
        attractionsCount: 0,
        showsCount: 0,
        restaurantsCount: 0,
      };
    }

    const parkId = String(selected.externalParkId).trim();
    const rows = await this.mappingRepo.findAll({
      provider: 'themeparks_wiki',
      parkId,
      limit: 15000,
    });

    let attractionsCount = 0;
    let showsCount = 0;
    let restaurantsCount = 0;
    let childrenCount = 0;
    let lastEntitiesSyncedAt = null;

    for (const r of rows || []) {
      const t = normalizeType(r.externalEntityType);
      if (t === 'RIDE' || t === 'ATTRACTION') attractionsCount += 1;
      else if (t === 'SHOW') showsCount += 1;
      else if (t === 'RESTAURANT') restaurantsCount += 1;
      else childrenCount += 1;

      const u = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
      if (u && (!lastEntitiesSyncedAt || u > lastEntitiesSyncedAt)) lastEntitiesSyncedAt = u;
    }

    return {
      adapterKey: 'themeparks_wiki',
      selectedParkId: parkId,
      selectedParkName: selected.parkName != null ? String(selected.parkName) : null,
      lastEntitiesSyncedAt: lastEntitiesSyncedAt ? new Date(lastEntitiesSyncedAt).toISOString() : null,
      lastLiveObservationsAt: null,
      lastLiveObservationCount: null,
      mappedEntityTotal: rows.length,
      childrenCount,
      attractionsCount,
      showsCount,
      restaurantsCount,
    };
  }

  async getInventory(adapterKey) {
    const key = String(adapterKey || '').trim();
    if (!key) return this._emptyInventory();
    if (key === 'weather_open_meteo') return this._weatherInventory(key);
    if (key === 'calendar_demand') return this._calendarDemandInventory(key);
    if (key === 'themeparks_wiki') return this._themeParksInventory(key);
    if (key === 'demo_static_adapter') return this._demoInventory(key);
    return { ...this._emptyInventory(), adapterKey: key };
  }

  async getInventoryMap(adapterKeys) {
    const keys = toArrayUnique((adapterKeys || []).map((k) => String(k || '').trim()).filter(Boolean));
    const map = new Map();
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      map.set(key, await this.getInventory(key));
    }
    return map;
  }
}

module.exports = { AdapterInventoryService, THEMEPARKS_FALLBACK_ENTITY_ESTIMATE };
