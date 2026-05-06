/** Gäste/h (theoreticalCapacityPph) — Grenzen für Parkkarten-Chips „Frequenz“. */

export type ParkMapFreqBand = 'VERY_HIGH' | 'MEDIUM' | 'LOW' | 'WEAK' | 'UNKNOWN'

export type ParkMapFreqThresholds = {
  veryHighMin: number
  mediumMin: number
  lowMin: number
}

export const DEFAULT_PARK_MAP_FREQ_THRESHOLDS: ParkMapFreqThresholds = {
  veryHighMin: 1200,
  mediumMin: 500,
  lowMin: 150,
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return fallback
}

/** Normalisiert gespeicherte Schwellen; bei ungültiger Reihenfolge → Defaults. */
export function parseParkMapFreqThresholds(raw: unknown): ParkMapFreqThresholds {
  const d = DEFAULT_PARK_MAP_FREQ_THRESHOLDS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d }
  const o = raw as Record<string, unknown>
  const veryHighMin = asInt(o.veryHighMin, d.veryHighMin)
  const mediumMin = asInt(o.mediumMin, d.mediumMin)
  const lowMin = asInt(o.lowMin, d.lowMin)
  const t = { veryHighMin, mediumMin, lowMin }
  if (t.veryHighMin < 1 || t.veryHighMin > 50000) return { ...d }
  if (t.mediumMin < 1 || t.mediumMin > 50000) return { ...d }
  if (t.lowMin < 1 || t.lowMin > 50000) return { ...d }
  if (!(t.veryHighMin > t.mediumMin && t.mediumMin > t.lowMin)) return { ...d }
  return t
}

export function resolveParkMapFreqThresholds(user: { uiPreferences?: unknown } | null | undefined): ParkMapFreqThresholds {
  const prefs = user?.uiPreferences as Record<string, unknown> | undefined
  const th = prefs?.parkMapFreqThresholds
  return parseParkMapFreqThresholds(th)
}

export function parkMapFreqBandFromPph(
  pph: number | null,
  isRide: boolean,
  t: ParkMapFreqThresholds
): ParkMapFreqBand {
  if (!isRide) return 'UNKNOWN'
  if (pph == null) return 'UNKNOWN'
  if (pph >= t.veryHighMin) return 'VERY_HIGH'
  if (pph >= t.mediumMin) return 'MEDIUM'
  if (pph >= t.lowMin) return 'LOW'
  return 'WEAK'
}
