const WAIT_ENTITY_SUPPORTED = new Set(['WAIT_TIME_UPDATED', 'ENTITY_STATUS_UPDATED']);

/** Minimal WMO → condition label (aligned with weather_open_meteo naming style). */
function openMeteoConditionFromCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'unknown';
  if (c === 0) return 'clear';
  if (c <= 3) return 'mainly_clear_to_overcast';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain_showers';
  if (c >= 85 && c <= 86) return 'snow_showers';
  if (c >= 95 && c <= 99) return 'thunderstorm';
  return `wmo_${c}`;
}

function inferQueueEntityMessageType(observation) {
  if (observation.canonicalMessageType && WAIT_ENTITY_SUPPORTED.has(observation.canonicalMessageType)) {
    return observation.canonicalMessageType;
  }
  const et = String(observation.eventType || '').toUpperCase();
  const metric = String(observation.metric || '').toLowerCase();
  if (et.includes('STATUS') || metric === 'status' || metric === 'entity_status' || metric.endsWith('_status')) {
    return 'ENTITY_STATUS_UPDATED';
  }
  if (
    et.includes('QUEUE') ||
    et.includes('WAIT') ||
    et.includes('TRAVEL') ||
    et.includes('STANDBY') ||
    metric.includes('wait') ||
    metric.includes('queue')
  ) {
    return 'WAIT_TIME_UPDATED';
  }
  return 'WAIT_TIME_UPDATED';
}

function toBoolOpen(value) {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  const s = String(value || '').toUpperCase();
  if (s === 'CLOSED' || s === 'DOWN' || s === 'OFF') return false;
  if (s === 'OPEN' || s === 'UP' || s === 'ON') return true;
  return true;
}

function resolveExternalParkId(context, observation) {
  return (
    observation.externalParkId ||
    context.externalParkId ||
    context.sparkplugGroupId ||
    (observation.metadata && observation.metadata.parkSlug) ||
    context.parkSlug ||
    null
  );
}

/**
 * Open-Meteo poll emits multiple WEATHER_OBSERVED metrics; only encode once (temperature row carries openMeteo payload).
 */
function encodeWeatherObservation(observation, context) {
  const domain = String(observation.domain || '').toLowerCase();
  const et = String(observation.eventType || '').toUpperCase();
  if (domain !== 'weather' && !et.includes('WEATHER')) return null;
  if (String(observation.metric) !== 'temperature') {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'weather_canonical_deduped_non_temperature_metric',
    };
  }

  const provider = observation.source || observation.provider || context.provider || 'weather_open_meteo';
  const internalParkIdEarly =
    context.internalParkId || observation.metadata?.internalParkId || null;
  const resolvedExtPark = resolveExternalParkId(context, observation);
  const externalParkId = resolvedExtPark || internalParkIdEarly;
  if (!externalParkId) {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'weather_canonical_missing_externalParkId_or_internalParkId_context',
    };
  }

  const cur = observation.rawPayload?.openMeteo?.current || {};
  const wmo = cur.weather_code;
  const condition = openMeteoConditionFromCode(wmo);
  const occurredAt = observation.eventTime || new Date().toISOString();
  const receivedAt = new Date().toISOString();
  const internalParkId = internalParkIdEarly;

  return {
    profile: 'canonical_historian',
    canonicalMessages: [
      {
        messageType: 'WEATHER_OBSERVATION_UPDATED',
        provider,
        providerMessageId: observation.providerMessageId || null,
        externalDestinationId: observation.externalDestinationId || context.externalDestinationId || null,
        externalParkId,
        externalEntityId: observation.externalEntityId || context.externalEntityId || 'weather_current',
        entityType: observation.entityType || 'WEATHER_STATION',
        occurredAt,
        receivedAt,
        status: 'RECEIVED',
        errorMessage: null,
        rawPayload: observation.rawPayload && typeof observation.rawPayload === 'object' ? observation.rawPayload : observation,
        payload: {
          internalParkId,
          condition,
          temperatureC: cur.temperature_2m != null ? Number(cur.temperature_2m) : Number(observation.value),
          rainMm: cur.precipitation != null ? Number(cur.precipitation) : null,
          rainProbabilityPercent:
            cur.precipitation_probability != null ? Number(cur.precipitation_probability) : null,
          windKmh: cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null,
          sampledAt: occurredAt,
        },
      },
    ],
  };
}

/**
 * calendar_school_holidays emits many HOLIDAY_FACTOR_OBSERVED metrics; encode once (holiday_score row).
 */
function encodeCalendarContextObservation(observation, context) {
  const et = String(observation.eventType || '').toUpperCase();
  const domain = String(observation.domain || '').toLowerCase();
  if (!et.includes('HOLIDAY_FACTOR') && domain !== 'calendar') return null;
  if (String(observation.metric) !== 'holiday_score') {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'calendar_canonical_deduped_non_summary_metric',
    };
  }

  const provider = observation.source || observation.provider || context.provider || 'calendar_school_holidays';
  const internalParkIdEarly =
    context.internalParkId || observation.metadata?.internalParkId || null;
  const resolvedExtPark = resolveExternalParkId(context, observation);
  const externalParkId = resolvedExtPark || internalParkIdEarly;
  if (!externalParkId && !internalParkIdEarly) {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'calendar_canonical_missing_externalParkId_or_internalParkId_context',
    };
  }

  const meta = observation.metadata && typeof observation.metadata === 'object' ? observation.metadata : {};
  const factors = observation.rawPayload?.factors || {};
  const contextDate = meta.date || null;
  if (!contextDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(contextDate))) {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'calendar_canonical_missing_context_date',
    };
  }

  const isPublicHoliday = Boolean(factors.is_public_holiday_de_bw === 1 || factors.is_public_holiday_de_bw === true);
  const schoolDe = factors.is_holiday_de_bw === 1 || factors.is_holiday_de_bw === true;
  const schoolFr = factors.is_holiday_fr_grandest === 1 || factors.is_holiday_fr_grandest === true;
  const schoolCh = factors.is_holiday_ch_bs === 1 || factors.is_holiday_ch_bs === true;
  const isSchoolHoliday = Boolean(schoolDe || schoolFr || schoolCh);

  const regions = [];
  if (schoolDe) regions.push('DE-BW');
  if (schoolFr) regions.push('FR-GE');
  if (schoolCh) regions.push('CH-BS');
  const schoolHolidayRegion = regions.join(',').slice(0, 32);

  const occurredAt = observation.eventTime || new Date().toISOString();
  const receivedAt = new Date().toISOString();
  const internalParkId = internalParkIdEarly;

  return {
    profile: 'canonical_historian',
    canonicalMessages: [
      {
        messageType: 'CALENDAR_CONTEXT_UPDATED',
        provider,
        providerMessageId: observation.providerMessageId || null,
        externalDestinationId: observation.externalDestinationId || context.externalDestinationId || null,
        externalParkId,
        externalEntityId: observation.externalEntityId || context.externalEntityId || 'calendar_current',
        entityType: observation.entityType || 'CALENDAR_FEED',
        occurredAt,
        receivedAt,
        status: 'RECEIVED',
        errorMessage: null,
        rawPayload: observation.rawPayload && typeof observation.rawPayload === 'object' ? observation.rawPayload : observation,
        payload: {
          internalParkId,
          contextDate: String(contextDate),
          isPublicHoliday,
          isSchoolHoliday,
          holidayName: null,
          schoolHolidayRegion: schoolHolidayRegion || null,
          regionCode: schoolHolidayRegion || null,
        },
      },
    ],
  };
}

/**
 * Maps a normalized adapter observation to canonical inbound rows for the historian pipeline.
 *
 * @param {Record<string, unknown>} observation
 * @param {Record<string, unknown>} context
 */
function encode(observation, context) {
  const ctx = context && typeof context === 'object' ? context : {};

  const weatherOut = encodeWeatherObservation(observation, ctx);
  if (weatherOut) return weatherOut;

  const calOut = encodeCalendarContextObservation(observation, ctx);
  if (calOut) return calOut;

  const provider = observation.provider || ctx.provider;
  if (!provider) {
    return { profile: 'canonical_historian', skipped: true, reason: 'missing provider (observation.provider or context.provider)' };
  }
  const externalParkId = observation.externalParkId || ctx.externalParkId;
  const externalEntityId = observation.externalEntityId || ctx.externalEntityId;
  if (!externalParkId || !externalEntityId) {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'missing externalParkId or externalEntityId for canonical historian sink',
    };
  }

  if (observation.canonicalMessageType && !WAIT_ENTITY_SUPPORTED.has(observation.canonicalMessageType)) {
    return {
      profile: 'canonical_historian',
      skipped: true,
      reason: 'canonicalMessageType not supported by observation encoder (use WAIT_TIME_UPDATED or ENTITY_STATUS_UPDATED)',
    };
  }

  const messageType = inferQueueEntityMessageType(observation);
  const occurredAt = observation.eventTime || new Date().toISOString();
  const receivedAt = new Date().toISOString();
  const base = {
    messageType,
    provider,
    providerMessageId: observation.providerMessageId || null,
    externalDestinationId: observation.externalDestinationId || ctx.externalDestinationId || null,
    externalParkId,
    externalEntityId,
    entityType: observation.entityType || ctx.entityType || 'OTHER',
    occurredAt,
    receivedAt,
    status: 'RECEIVED',
    errorMessage: null,
    rawPayload: observation.rawPayload && typeof observation.rawPayload === 'object' ? observation.rawPayload : observation,
  };

  if (messageType === 'ENTITY_STATUS_UPDATED') {
    return {
      profile: 'canonical_historian',
      canonicalMessages: [
        {
          ...base,
          payload: {
            isOpen: toBoolOpen(observation.value),
          },
        },
      ],
    };
  }

  const waitTime = Number(observation.value);
  return {
    profile: 'canonical_historian',
    canonicalMessages: [
      {
        ...base,
        messageType: 'WAIT_TIME_UPDATED',
        payload: {
          waitTime: Number.isFinite(waitTime) ? waitTime : null,
          status: observation.status || null,
          isOpen: typeof observation.isOpen === 'boolean' ? observation.isOpen : true,
          sampledAt: occurredAt,
          externalEntityName: observation.externalEntityName || observation.assetSlug || null,
        },
      },
    ],
  };
}

module.exports = { encode };
