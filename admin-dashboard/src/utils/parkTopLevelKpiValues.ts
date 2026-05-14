import type { AiInsightsSummary } from '@/api/client'
import type { ParkTopLevelKpiId } from '@/constants/parkTopLevelKpis'
import type { Ride, Zone } from '@/types/api'

const EM_DASH = '—'

export type ParkTopLevelKpiValueCtx = {
  zones: Zone[]
  rides: Ride[]
  rideAvailabilityPct: number | null
  openRideCount: number
  avgWaitMinutes: number | null
  staffingCoveragePct: number | null
  /** Total open incidents when API allowed; null = not loaded / no permission. */
  openIncidentsTotal: number | null
  aiSummary: AiInsightsSummary | null
  criticalRecCount: number
}

function sumZoneCrowd(zones: Zone[]): number {
  return zones.reduce((a, z) => a + (typeof z.currentCrowdLevel === 'number' ? z.currentCrowdLevel : 0), 0)
}

function sumZoneCapacity(zones: Zone[]): number {
  return zones.reduce((a, z) => a + (typeof z.maxCapacity === 'number' && z.maxCapacity > 0 ? z.maxCapacity : 0), 0)
}

/** Zones at or above 75% of max capacity (heuristic congestion). */
function congestedZoneCount(zones: Zone[]): { congested: number; total: number } {
  const zs = zones.filter((z) => typeof z.maxCapacity === 'number' && z.maxCapacity > 0)
  const congested = zs.filter((z) => z.currentCrowdLevel / z.maxCapacity >= 0.75).length
  return { congested, total: zs.length }
}

function ratioToPercentDisplay(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  const n = ratio > 1 ? ratio : ratio * 100
  return Math.min(100, Math.round(n))
}

export type ResolvedParkTopLevelKpi = {
  id: ParkTopLevelKpiId
  valueText: string
  /** i18n key for optional footnote under value (e.g. proxy data). */
  footnoteKey?: string
}

export function resolveParkTopLevelKpi(id: ParkTopLevelKpiId, ctx: ParkTopLevelKpiValueCtx): ResolvedParkTopLevelKpi {
  const zs = ctx.zones
  const crowdSum = sumZoneCrowd(zs)
  const capSum = sumZoneCapacity(zs)

  switch (id) {
    case 'currentGuests': {
      if (!zs.length) return { id, valueText: EM_DASH }
      return {
        id,
        valueText: crowdSum.toLocaleString(),
        footnoteKey: 'parkTopLevelKpis.footnotes.currentGuestsProxy',
      }
    }
    case 'parkOccupancyPct': {
      if (!capSum) return { id, valueText: EM_DASH }
      const pct = Math.min(100, Math.round((crowdSum / capSum) * 100))
      return { id, valueText: `${pct}%`, footnoteKey: 'parkTopLevelKpis.footnotes.zoneCapacityModel' }
    }
    case 'entryRate':
    case 'exitRate':
      return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.notConnected' }
    case 'avgQueueTime': {
      const m = ctx.avgWaitMinutes
      return { id, valueText: m == null ? EM_DASH : `${m} min` }
    }
    case 'guestSatisfactionScore':
    case 'activePdmAlerts':
    case 'mtbf':
    case 'mttr':
    case 'revenueToday':
    case 'spendPerGuest':
    case 'foodRevenue':
    case 'merchandiseRevenue':
    case 'emergencyEvents':
      return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.notConnected' }
    case 'rideAvailabilityPct': {
      const p = ctx.rideAvailabilityPct
      return { id, valueText: p == null ? EM_DASH : `${p}%` }
    }
    case 'openAttractions':
      return { id, valueText: String(ctx.openRideCount) }
    case 'delayedAttractions': {
      const n = ctx.rides.filter((r) => r.status === 'OPEN' && typeof r.waitTime === 'number' && r.waitTime >= 30).length
      return { id, valueText: String(n), footnoteKey: 'parkTopLevelKpis.footnotes.delayedWaitThreshold' }
    }
    case 'totalThroughput': {
      const sum = ctx.rides
        .filter((r) => r.status === 'OPEN')
        .reduce((a, r) => a + (typeof r.capacityPerHour === 'number' && r.capacityPerHour > 0 ? r.capacityPerHour : 0), 0)
      if (!sum) return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.throughputCapacitySum' }
      return {
        id,
        valueText: `${sum.toLocaleString()} /h`,
        footnoteKey: 'parkTopLevelKpis.footnotes.throughputCapacitySum',
      }
    }
    case 'zoneCongestionIndex': {
      const { congested, total } = congestedZoneCount(ctx.zones)
      if (!total) return { id, valueText: EM_DASH }
      const idx = Math.min(100, Math.round((congested / total) * 100))
      return {
        id,
        valueText: `${idx}% (${congested}/${total})`,
        footnoteKey: 'parkTopLevelKpis.footnotes.zoneCongestionHeuristic',
      }
    }
    case 'staffUtilization': {
      const p = ctx.staffingCoveragePct
      return { id, valueText: p == null ? EM_DASH : `${p}%` }
    }
    case 'criticalRideRisks':
      return {
        id,
        valueText: String(ctx.criticalRecCount),
        footnoteKey: 'parkTopLevelKpis.footnotes.criticalRecsProxy',
      }
    case 'safetyIncidents': {
      const t = ctx.openIncidentsTotal
      return { id, valueText: t == null ? EM_DASH : String(t) }
    }
    case 'forecastedPeakTime': {
      const s = ctx.aiSummary
      if (!s?.topHotspotZones?.length) return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.aiNoData' }
      const top = s.topHotspotZones[0]
      const horizon = s.forecastHorizonMinutes
      return {
        id,
        valueText: `${top.zoneName} · ${horizon}m`,
        footnoteKey: 'parkTopLevelKpis.footnotes.aiHotspotHorizon',
      }
    }
    case 'predictedQueueRisk': {
      const s = ctx.aiSummary
      if (s == null) return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.aiNoData' }
      const pct = ratioToPercentDisplay(s.highestPredictedCrowdRatio)
      return { id, valueText: `${pct}%`, footnoteKey: 'parkTopLevelKpis.footnotes.aiCrowdRatio' }
    }
    case 'predictedRideFailureRisk':
      return { id, valueText: EM_DASH, footnoteKey: 'parkTopLevelKpis.footnotes.notConnected' }
    default:
      return { id, valueText: EM_DASH }
  }
}
