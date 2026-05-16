/**
 * TomTom "Calculate Route" responses: use `routes[].legs[].points[]` (WGS84).
 * @typedef {[number, number]} LatLngTuple
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Extract Leaflet-ready [lat, lng] pairs from sanitized provider raw JSON.
 * @param {unknown} providerRawResponse
 * @returns {LatLngTuple[]}
 */
export function extractTomTomRouteLatLngs(providerRawResponse) {
  const out = []
  if (providerRawResponse == null || typeof providerRawResponse !== 'object') return out
  const routes = /** @type {Record<string, unknown>} */ (providerRawResponse).routes
  if (!Array.isArray(routes) || routes.length === 0) return out
  const route0 = routes[0]
  if (route0 == null || typeof route0 !== 'object') return out
  const legs = /** @type {Record<string, unknown>} */ (route0).legs
  if (!Array.isArray(legs)) return out
  for (const leg of legs) {
    if (leg == null || typeof leg !== 'object') continue
    const pts = /** @type {Record<string, unknown>} */ (leg).points
    if (!Array.isArray(pts)) continue
    for (const p of pts) {
      if (p == null || typeof p !== 'object') continue
      const po = /** @type {Record<string, unknown>} */ (p)
      const lat = num(po.latitude ?? po.lat)
      const lng = num(po.longitude ?? po.lng ?? po.lon)
      if (lat == null || lng == null) continue
      const prev = out[out.length - 1]
      if (prev && prev[0] === lat && prev[1] === lng) continue
      out.push([lat, lng])
    }
  }
  return out
}

/**
 * Returns true when the object tree may still contain an exposed HTTP `key` query value
 * (not redacted). Intended for display guard / unit tests on sanitized TomTom snapshots.
 * @param {unknown} root
 * @returns {boolean}
 */
export function tomTomRawJsonMayExposeApiKey(root) {
  const walk = (v) => {
    if (v == null) return false
    if (Array.isArray(v)) return v.some(walk)
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (String(k).toLowerCase() === 'key') {
          if (typeof val === 'string' && val !== '***' && val.length > 0) return true
        }
        if (walk(val)) return true
      }
    }
    return false
  }
  return walk(root)
}
