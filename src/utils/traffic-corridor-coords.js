'use strict';

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : NaN;
}

/** @param {unknown} lat @param {unknown} lng */
function isValidWgs84Pair(lat, lng) {
  const la = num(lat);
  const lo = num(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (la < -90 || la > 90) return false;
  if (lo < -180 || lo > 180) return false;
  return true;
}

/**
 * @param {{ originLat?: unknown, originLng?: unknown, destinationLat?: unknown, destinationLng?: unknown }} p
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function validateWgs84CorridorCoordinates(p) {
  const pairs = [
    ['originLat', 'originLng', p.originLat, p.originLng],
    ['destinationLat', 'destinationLng', p.destinationLat, p.destinationLng],
  ];
  for (const [laK, loK, la, lo] of pairs) {
    if (la == null && lo == null) continue;
    if (la == null || lo == null) {
      return { ok: false, code: 'COORD_PAIR_INCOMPLETE', message: `${laK}/${loK} must both be set` };
    }
    if (!isValidWgs84Pair(la, lo)) {
      return {
        ok: false,
        code: 'COORD_WGS84_INVALID',
        message: `Invalid WGS84 coordinates for ${laK}/${loK}`,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {{
 *   travelTimeSeconds?: number | null,
 *   routeDistanceMeters?: number | null,
 *   currentTravelTimeMin: number,
 *   operatorBaselineTravelTimeMin: number,
 * }} p
 * @returns {Array<{ code: string, message: string }>}
 */
function evaluateRouteRealismWarnings(p) {
  const out = [];
  const tts = p.travelTimeSeconds != null ? Number(p.travelTimeSeconds) : NaN;
  if (Number.isFinite(tts) && tts <= 0) {
    out.push({ code: 'TRAVEL_TIME_INVALID', message: 'travelTimeSeconds must be > 0' });
  }
  const dist = p.routeDistanceMeters != null ? Number(p.routeDistanceMeters) : NaN;
  if (Number.isFinite(dist) && dist <= 0) {
    out.push({ code: 'ROUTE_DISTANCE_INVALID', message: 'routeDistanceMeters must be > 0' });
  }
  const cur = Number(p.currentTravelTimeMin);
  const base = Number(p.operatorBaselineTravelTimeMin);
  if (Number.isFinite(cur) && Number.isFinite(base) && base > 0) {
    if (cur < base * 0.3) {
      out.push({
        code: 'CURRENT_FAR_BELOW_BASELINE',
        message: `Current travel ${cur.toFixed(1)} min is >70% below operator baseline ${base.toFixed(1)} min`,
      });
    }
    if (cur > base * 4) {
      out.push({
        code: 'CURRENT_FAR_ABOVE_BASELINE',
        message: `Current travel ${cur.toFixed(1)} min is >300% above operator baseline ${base.toFixed(1)} min`,
      });
    }
  }
  return out;
}

module.exports = {
  isValidWgs84Pair,
  validateWgs84CorridorCoordinates,
  evaluateRouteRealismWarnings,
};
