import type { OperationFactBreakdownEntry } from '@/api/client'

/** UI bucket for source transparency badges (maps API `sourceBreakdown[].source`). */
export type OperationsFactsUiBadge = 'REGISTRY' | 'LEGACY_UNS' | 'CANONICAL' | 'OBSERVATION' | 'MISSING'

const KPI_KEYS = [
  'status',
  'queueTime',
  'predictedWaitTime',
  'throughputActual',
  'throughputTheoretical',
  'capacityUtilization',
  'vehiclesActive',
  'staffActual',
  'downtimeMinutes',
] as const

export type OperationsFactPilotKpiKey = (typeof KPI_KEYS)[number]

export function pilotKpiKeys(): readonly OperationsFactPilotKpiKey[] {
  return KPI_KEYS
}

export function breakdownUiBadge(entry: OperationFactBreakdownEntry | null | undefined): OperationsFactsUiBadge {
  if (!entry) return 'MISSING'
  const s = String(entry.source || '').trim().toUpperCase()
  if (
    s === 'REGISTRY' ||
    s === 'LEGACY_UNS' ||
    s === 'CANONICAL' ||
    s === 'OBSERVATION' ||
    s === 'MISSING'
  ) {
    return s
  }
  return 'OBSERVATION'
}

export function badgeToneClass(badge: OperationsFactsUiBadge): string {
  switch (badge) {
    case 'REGISTRY':
      return 'border-emerald-700/80 bg-emerald-950/50 text-emerald-200'
    case 'LEGACY_UNS':
      return 'border-amber-600/70 bg-amber-950/40 text-amber-100'
    case 'CANONICAL':
      return 'border-sky-600/70 bg-sky-950/45 text-sky-100'
    case 'OBSERVATION':
      return 'border-slate-600/80 bg-slate-900/50 text-slate-200'
    default:
      return 'border-rose-700/75 bg-rose-950/45 text-rose-100'
  }
}

export function formatOperationFactKpiValue(kpiKey: OperationsFactPilotKpiKey, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (kpiKey === 'status') return String(value)

  const n = typeof value === 'number' ? value : Number(value)
  const isNum = Number.isFinite(n)

  if (kpiKey === 'queueTime' || kpiKey === 'predictedWaitTime' || kpiKey === 'downtimeMinutes') {
    return isNum ? `${n}′` : String(value)
  }
  if (kpiKey === 'throughputActual' || kpiKey === 'throughputTheoretical') {
    return isNum ? `${n} pph` : String(value)
  }
  if (kpiKey === 'capacityUtilization') {
    if (isNum) return `${n}%`
    return String(value)
  }
  if (kpiKey === 'vehiclesActive' || kpiKey === 'staffActual') {
    return isNum ? String(n) : String(value)
  }
  return String(value)
}

export function factValueForKpi(
  ride: { [k: string]: unknown } | null,
  kpi: OperationsFactPilotKpiKey
): unknown {
  if (!ride) return null
  return ride[kpi]
}
