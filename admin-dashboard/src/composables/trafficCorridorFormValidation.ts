/** WGS84 bounds aligned with backend `traffic-corridor-coords.js`. */
export function isValidWgs84Pair(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < -90 || lat > 90) return false
  if (lng < -180 || lng > 180) return false
  return true
}

export function wgs84CoordErrorMessage(
  originLat: number | null,
  originLng: number | null,
  destLat: number | null,
  destLng: number | null
): string | null {
  const oAny = originLat != null || originLng != null
  const oOk = originLat != null && originLng != null
  if (oAny && oOk && !isValidWgs84Pair(originLat, originLng)) {
    return 'Origin coordinates are outside valid WGS84 range (lat −90…90, lng −180…180).'
  }
  const dAny = destLat != null || destLng != null
  const dOk = destLat != null && destLng != null
  if (dAny && dOk && !isValidWgs84Pair(destLat, destLng)) {
    return 'Destination coordinates are outside valid WGS84 range (lat −90…90, lng −180…180).'
  }
  return null
}

export function clampScore0to100(v: string | number): number | undefined {
  if (v === '' || v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.min(100, Math.max(0, n))
}
