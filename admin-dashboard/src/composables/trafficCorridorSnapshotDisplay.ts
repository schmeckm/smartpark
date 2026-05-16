import type { TrafficCorridorLastPollResult } from '@/types/api'

/** Congestion score is 0..100 (see `computeSnapshotMetrics` in backend). */
export type CongestionAmpel = 'none' | 'low' | 'medium' | 'high'

/** Last TomTom poll failed (coords or HTTP) — overrides snapshot-based ampel. */
export type CorridorTrafficAmpel = CongestionAmpel | 'routing_error'

export type { TrafficCorridorLastPollResult }

export function congestionAmpel(score: number | null | undefined): CongestionAmpel {
  if (score == null || !Number.isFinite(Number(score))) return 'none'
  const s = Number(score)
  if (s <= 25) return 'low'
  if (s <= 50) return 'medium'
  return 'high'
}

export function congestionAmpelDotClass(level: CongestionAmpel): string {
  switch (level) {
    case 'low':
      return 'bg-emerald-400 ring-2 ring-emerald-400/30'
    case 'medium':
      return 'bg-amber-400 ring-2 ring-amber-400/35'
    case 'high':
      return 'bg-rose-500 ring-2 ring-rose-500/35'
    default:
      return 'bg-slate-600 ring-2 ring-slate-600/40'
  }
}

/** Short DE label for table cells (page copy is mixed DE/EN). */
export function congestionAmpelLabelDe(level: CongestionAmpel): string {
  switch (level) {
    case 'low':
      return 'Ruhig'
    case 'medium':
      return 'Mäßig'
    case 'high':
      return 'Stark'
    default:
      return '—'
  }
}

export function congestionAmpelTitleDe(level: CongestionAmpel): string {
  switch (level) {
    case 'low':
      return 'Stauindikator: gering (Congestion-Score ≤ 25)'
    case 'medium':
      return 'Stauindikator: erhöht (Score 26–50)'
    case 'high':
      return 'Stauindikator: hoch (Score > 50)'
    default:
      return 'Kein Snapshot oder kein Congestion-Score'
  }
}

export function corridorTrafficAmpel(
  lastPoll: TrafficCorridorLastPollResult | null | undefined,
  congestionScore: number | null | undefined
): CorridorTrafficAmpel {
  if (lastPoll && typeof lastPoll === 'object' && lastPoll.ok === false) return 'routing_error'
  return congestionAmpel(congestionScore)
}

export function corridorAmpelDotClass(level: CorridorTrafficAmpel): string {
  if (level === 'routing_error') return 'bg-rose-600 ring-2 ring-rose-500/45'
  return congestionAmpelDotClass(level)
}

export function corridorAmpelLabelDe(level: CorridorTrafficAmpel): string {
  if (level === 'routing_error') return 'Fehler'
  return congestionAmpelLabelDe(level)
}

export function corridorAmpelTitleDe(
  level: CorridorTrafficAmpel,
  lastPoll: TrafficCorridorLastPollResult | null | undefined
): string {
  if (level === 'routing_error' && lastPoll && typeof lastPoll === 'object') {
    const code = lastPoll.code != null ? String(lastPoll.code) : ''
    const msg = lastPoll.message != null ? String(lastPoll.message) : ''
    const bits = [code, msg].filter(Boolean)
    return bits.length ? `Letzter Routing-Poll: ${bits.join(' — ')}` : 'Letzter Routing-Poll fehlgeschlagen'
  }
  return congestionAmpelTitleDe(level as CongestionAmpel)
}

export function snapshotAgeMinutes(iso: string | null | undefined): number | null {
  if (iso == null || String(iso).trim() === '') return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 60000)
}

/**
 * Text colour hint for “how old is this row” (independent of congestion).
 * @param ageMinutes from {@link snapshotAgeMinutes}
 */
export function snapshotAgeTextClass(ageMinutes: number | null): string {
  if (ageMinutes == null) return 'text-slate-500'
  if (ageMinutes <= 20) return 'text-slate-400'
  if (ageMinutes <= 60) return 'text-amber-300/90'
  return 'text-rose-300/90'
}

export type DataFreshnessAmpel = 'fresh' | 'aging' | 'stale' | 'unknown'

/**
 * Ampel nach Datenalter relativ zum Poll-Intervall (TomTom-Adapter / Scheduler).
 */
export function dataFreshnessAmpel(
  lastSnapshotIso: string | null | undefined,
  pollIntervalMinutes: number | null | undefined
): DataFreshnessAmpel {
  const age = snapshotAgeMinutes(lastSnapshotIso ?? null)
  if (age == null) return 'unknown'
  const interval = Math.max(1, Number(pollIntervalMinutes) || 15)
  const warn = Math.max(15, Math.round(interval * 1.5))
  const bad = Math.max(45, Math.round(interval * 3))
  if (age <= warn) return 'fresh'
  if (age <= bad) return 'aging'
  return 'stale'
}

export function dataFreshnessDotClass(level: DataFreshnessAmpel): string {
  switch (level) {
    case 'fresh':
      return 'bg-emerald-400 ring-2 ring-emerald-400/30'
    case 'aging':
      return 'bg-amber-400 ring-2 ring-amber-400/35'
    case 'stale':
      return 'bg-rose-500 ring-2 ring-rose-500/35'
    default:
      return 'bg-slate-600 ring-2 ring-slate-600/40'
  }
}

export function dataFreshnessTitleDe(
  level: DataFreshnessAmpel,
  lastIso: string | null,
  pollMin: number | null
): string {
  const age = snapshotAgeMinutes(lastIso)
  const interval = Math.max(1, Number(pollMin) || 15)
  if (level === 'unknown') return 'Kein TomTom-Snapshot in diesem Park (Korridore prüfen oder Poll ausführen).'
  const ageStr = age == null ? 'Alter unbekannt' : `${age} Min. seit letztem TomTom-Stand`
  return `${ageStr}. Poll-Intervall: ${interval} Min. (Ampel relativ dazu).`
}
