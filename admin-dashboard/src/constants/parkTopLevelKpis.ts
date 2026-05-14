/** Park command KPI catalog (top-level matrix). Order matches product spec. */
export type ParkTopLevelKpiTyp = 'live' | 'aggregated' | 'daily' | 'ai' | 'operational' | 'historical'

export type ParkTopLevelKpiCategory =
  | 'visitors'
  | 'operations'
  | 'ot_maintenance'
  | 'financial'
  | 'safety'
  | 'ai_forecast'

export type ParkTopLevelKpiId =
  | 'currentGuests'
  | 'parkOccupancyPct'
  | 'entryRate'
  | 'exitRate'
  | 'avgQueueTime'
  | 'guestSatisfactionScore'
  | 'rideAvailabilityPct'
  | 'openAttractions'
  | 'delayedAttractions'
  | 'totalThroughput'
  | 'zoneCongestionIndex'
  | 'staffUtilization'
  | 'activePdmAlerts'
  | 'criticalRideRisks'
  | 'mtbf'
  | 'mttr'
  | 'revenueToday'
  | 'spendPerGuest'
  | 'foodRevenue'
  | 'merchandiseRevenue'
  | 'safetyIncidents'
  | 'emergencyEvents'
  | 'forecastedPeakTime'
  | 'predictedQueueRisk'
  | 'predictedRideFailureRisk'

export type ParkTopLevelKpiDef = {
  id: ParkTopLevelKpiId
  category: ParkTopLevelKpiCategory
  typ: ParkTopLevelKpiTyp
}

export const PARK_TOP_LEVEL_KPI_CATEGORY_ORDER: ParkTopLevelKpiCategory[] = [
  'visitors',
  'operations',
  'ot_maintenance',
  'financial',
  'safety',
  'ai_forecast',
]

export const PARK_TOP_LEVEL_KPIS: ParkTopLevelKpiDef[] = [
  { id: 'currentGuests', category: 'visitors', typ: 'live' },
  { id: 'parkOccupancyPct', category: 'visitors', typ: 'live' },
  { id: 'entryRate', category: 'visitors', typ: 'live' },
  { id: 'exitRate', category: 'visitors', typ: 'live' },
  { id: 'avgQueueTime', category: 'visitors', typ: 'aggregated' },
  { id: 'guestSatisfactionScore', category: 'visitors', typ: 'daily' },
  { id: 'rideAvailabilityPct', category: 'operations', typ: 'live' },
  { id: 'openAttractions', category: 'operations', typ: 'live' },
  { id: 'delayedAttractions', category: 'operations', typ: 'live' },
  { id: 'totalThroughput', category: 'operations', typ: 'live' },
  { id: 'zoneCongestionIndex', category: 'operations', typ: 'ai' },
  { id: 'staffUtilization', category: 'operations', typ: 'operational' },
  { id: 'activePdmAlerts', category: 'ot_maintenance', typ: 'live' },
  { id: 'criticalRideRisks', category: 'ot_maintenance', typ: 'ai' },
  { id: 'mtbf', category: 'ot_maintenance', typ: 'historical' },
  { id: 'mttr', category: 'ot_maintenance', typ: 'historical' },
  { id: 'revenueToday', category: 'financial', typ: 'daily' },
  { id: 'spendPerGuest', category: 'financial', typ: 'daily' },
  { id: 'foodRevenue', category: 'financial', typ: 'daily' },
  { id: 'merchandiseRevenue', category: 'financial', typ: 'daily' },
  { id: 'safetyIncidents', category: 'safety', typ: 'live' },
  { id: 'emergencyEvents', category: 'safety', typ: 'live' },
  { id: 'forecastedPeakTime', category: 'ai_forecast', typ: 'ai' },
  { id: 'predictedQueueRisk', category: 'ai_forecast', typ: 'ai' },
  { id: 'predictedRideFailureRisk', category: 'ai_forecast', typ: 'ai' },
]
