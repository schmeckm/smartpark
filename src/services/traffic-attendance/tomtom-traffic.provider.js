'use strict';

const TOMTOM_ROUTING_BASE = 'https://api.tomtom.com/routing/1/calculateRoute';

class TomTomTrafficProviderError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'TomTomTrafficProviderError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Calls TomTom Routing "Calculate Route" and returns a normalized snapshot payload.
 * Does not persist. Inject `fetchFn` for tests (defaults to global fetch).
 */
class TomTomTrafficProvider {
  constructor(deps = {}) {
    this.fetchFn = deps.fetchFn || ((...args) => globalThis.fetch(...args));
    this.apiKey = deps.apiKey != null ? String(deps.apiKey) : '';
    this.baseUrl = (deps.baseUrl != null ? String(deps.baseUrl) : TOMTOM_ROUTING_BASE).replace(/\/+$/, '');
    this.timeoutMs = Math.max(1000, Number(deps.timeoutMs) || 15000);
  }

  assertConfigured(enabled) {
    if (!enabled) {
      throw new TomTomTrafficProviderError('TomTom traffic integration is disabled', 'TOMTOM_DISABLED');
    }
    if (!this.apiKey || !String(this.apiKey).trim()) {
      throw new TomTomTrafficProviderError('TOMTOM_API_KEY is not set', 'TOMTOM_API_KEY_MISSING');
    }
  }

  /**
   * @param {{ originLat: number, originLng: number, destinationLat: number, destinationLng: number, corridorId: string }} corridor
   * @param {{ enabled: boolean }} opts
   * @returns {Promise<{ normalized: object, providerRawResponse: object }>}
   */
  async fetchRouteForCorridor(corridor, opts = { enabled: true }) {
    this.assertConfigured(opts.enabled);
    const olat = corridor.originLat;
    const olng = corridor.originLng;
    const dlat = corridor.destinationLat;
    const dlng = corridor.destinationLng;
    if (olat == null || olng == null || dlat == null || dlng == null) {
      throw new TomTomTrafficProviderError('Corridor is missing valid origin/destination coordinates', 'INVALID_COORDS');
    }
    const oLat = Number(olat);
    const oLng = Number(olng);
    const dLat = Number(dlat);
    const dLng = Number(dlng);
    if (![oLat, oLng, dLat, dLng].every((n) => Number.isFinite(n))) {
      throw new TomTomTrafficProviderError('Corridor is missing valid origin/destination coordinates', 'INVALID_COORDS');
    }

    const qs = new URLSearchParams({
      key: this.apiKey.trim(),
      traffic: 'true',
      travelMode: 'car',
      routeType: 'fastest',
      instructionsType: 'tagged',
      computeTravelTimeFor: 'all',
    });
    // TomTom expects literal `lat,lng:lat,lng` in the path (commas/colons must not be percent-encoded).
    const url = `${this.baseUrl}/${oLat},${oLng}:${dLat},${dLng}/json?${qs.toString()}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ac.signal });
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
      throw new TomTomTrafficProviderError(
        aborted ? `TomTom request timed out after ${this.timeoutMs}ms` : `TomTom request failed: ${e.message}`,
        aborted ? 'TOMTOM_TIMEOUT' : 'TOMTOM_NETWORK',
        { cause: e }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new TomTomTrafficProviderError('TomTom returned non-JSON body', 'TOMTOM_MALFORMED', { status: res.status });
    }

    if (res.status === 429) {
      throw new TomTomTrafficProviderError('TomTom rate limit (429)', 'TOMTOM_RATE_LIMIT', { status: 429, body });
    }
    if (!res.ok) {
      throw new TomTomTrafficProviderError(`TomTom HTTP ${res.status}`, 'TOMTOM_HTTP', { status: res.status, body });
    }

    const routes = body && Array.isArray(body.routes) ? body.routes : null;
    if (!routes || routes.length === 0 || !routes[0] || typeof routes[0].summary !== 'object') {
      throw new TomTomTrafficProviderError('TomTom response missing routes[0].summary', 'TOMTOM_MALFORMED', { body });
    }

    const summary = routes[0].summary;
    const travelTimeSeconds = numOrUndef(summary.travelTimeInSeconds);
    const trafficDelaySeconds = numOrUndef(summary.trafficDelayInSeconds) ?? 0;
    const noTrafficTravelTimeSeconds = numOrUndef(
      summary.noTrafficTravelTimeInSeconds ?? summary.historicTrafficTravelTimeInSeconds
    );
    const routeDistanceMeters = numOrUndef(summary.lengthInMeters);

    if (travelTimeSeconds == null || travelTimeSeconds < 0) {
      throw new TomTomTrafficProviderError('TomTom summary missing travelTimeInSeconds', 'TOMTOM_MALFORMED', {
        summary,
      });
    }

    const baselineSeconds =
      noTrafficTravelTimeSeconds != null && noTrafficTravelTimeSeconds > 0
        ? noTrafficTravelTimeSeconds
        : Math.max(0, travelTimeSeconds - trafficDelaySeconds);
    const delayPercent = baselineSeconds > 0 ? (travelTimeSeconds - baselineSeconds) / baselineSeconds : 0;

    const sampledAt = new Date().toISOString();
    const normalized = {
      corridorId: String(corridor.corridorId || corridor.id),
      provider: 'tomtom',
      originLat: oLat,
      originLng: oLng,
      destinationLat: dLat,
      destinationLng: dLng,
      routeDistanceMeters: routeDistanceMeters ?? null,
      travelTimeSeconds,
      trafficDelaySeconds,
      noTrafficTravelTimeSeconds: noTrafficTravelTimeSeconds ?? null,
      delayPercent,
      sampledAt,
      providerStatus: 'ok',
    };

    return { normalized, providerRawResponse: body };
  }
}

function numOrUndef(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

module.exports = { TomTomTrafficProvider, TomTomTrafficProviderError, TOMTOM_ROUTING_BASE };
