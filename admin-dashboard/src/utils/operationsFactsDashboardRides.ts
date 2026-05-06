import type { OperationFactRide } from '@/api/client'
import type { Ride, RideStatus } from '@/types/api'

/** Coerce Operations Facts KPI scalars to a finite number, or null. */
export function factNumeric(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Map free-form / enum status from facts to dashboard {@link RideStatus}.
 * Falls back to OPEN when unknown (table still renders).
 */
export function normalizeOperationFactStatus(raw: unknown): RideStatus {
  if (raw == null) return 'OPEN'
  if (typeof raw === 'boolean') return raw ? 'OPEN' : 'CLOSED'
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw !== 0 ? 'OPEN' : 'CLOSED'
  if (typeof raw !== 'string') return 'OPEN'
  const s = raw.trim().toUpperCase()
  if (s.includes('MAINT') || s.includes('DOWN') || s.includes('REFURB') || s === 'MAINTENANCE') {
    return 'MAINTENANCE'
  }
  if (s.includes('CLOSE') || s === 'CLOSED' || s === '0' || s === 'FALSE' || s === 'INACTIVE') {
    return 'CLOSED'
  }
  if (s.includes('OPEN') || s.includes('OPERAT') || s === '1' || s === 'TRUE' || s === 'ACTIVE') {
    return 'OPEN'
  }
  return 'OPEN'
}

function criticalityFromWait(wait: number): number {
  return Math.min(10, Math.max(1, Math.ceil(wait / 15) || 1))
}

/**
 * Phase T.4 — Prefer Operations Facts for ride-level operational fields.
 * Legacy `/rides` supplies zone layout and stable row identity; overlay applies when `ride.id === fact.rideAssetId`.
 * Facts-only park assets (no matching legacy row) are omitted here to avoid duplicate rows when ID spaces differ.
 */
export function mergeRidesWithOperationsFacts(legacy: Ride[], facts: OperationFactRide[] | null | undefined): Ride[] {
  if (!facts?.length) return legacy

  const factByAsset = new Map(facts.map((f) => [f.rideAssetId, f]))

  return legacy.map((r) => {
    const f = factByAsset.get(r.id)
    if (f) {
      const q = factNumeric(f.queueTime)
      const wait = q ?? r.waitTime
      const th = factNumeric(f.throughputTheoretical)
      const ta = factNumeric(f.throughputActual)
      const capFromFacts = th ?? ta
      return {
        ...r,
        name: (typeof f.name === 'string' && f.name.trim()) || r.name,
        status: normalizeOperationFactStatus(f.status),
        waitTime: wait,
        ...(capFromFacts != null ? { capacityPerHour: Math.max(0, Math.round(capFromFacts)) } : {}),
        criticality: criticalityFromWait(wait),
      }
    }
    return r
  })
}
