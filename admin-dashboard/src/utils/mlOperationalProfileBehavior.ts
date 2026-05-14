/**
 * Operational forecast behavior — parse/merge profile JSON blobs for operator UI.
 * Conventional keys inside existing Phase-3 JSON columns; no API or DB changes.
 */

export type ScoreBand = 'low' | 'medium' | 'high'

export type RideBehaviorDraft = {
  entityType: string
  category: string
  modelType: string
  featureSetCode: string
  environment: string
  experienceClass: string
  weatherSensitive: boolean
  rainSensitive: boolean
  windSensitive: boolean
  heatSensitive: boolean
  weatherSensitivityScore: number
  rainImpactScore: number
  windImpactScore: number
  heatImpactScore: number
  queueElasticityScore: number
  maxQueueTargetMin: number
  targetThroughputFactor: number
  staffDependencyScore: number
  downtimeRiskScore: number
  maintenanceCriticality: number
  capacityElasticityScore: number
  availabilityTargetPercent: number
}

export const emptyRideBehaviorDraft = (): RideBehaviorDraft => ({
  entityType: '',
  category: '',
  modelType: '',
  featureSetCode: '',
  environment: '',
  experienceClass: '',
  weatherSensitive: false,
  rainSensitive: false,
  windSensitive: false,
  heatSensitive: false,
  weatherSensitivityScore: 0.5,
  rainImpactScore: 0.5,
  windImpactScore: 0.5,
  heatImpactScore: 0.5,
  queueElasticityScore: 0.5,
  maxQueueTargetMin: 0,
  targetThroughputFactor: 1,
  staffDependencyScore: 0.5,
  downtimeRiskScore: 0.5,
  maintenanceCriticality: 0.5,
  capacityElasticityScore: 0.5,
  availabilityTargetPercent: 95,
})

function num(v: unknown, fallback: number): number {
  if (v == null || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function num01(v: unknown, fallback: number): number {
  const n = num(v, fallback)
  return Math.min(1, Math.max(0, n))
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1 || v === '1') return true
  if (v === 'false' || v === 0 || v === '0') return false
  return fallback
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s || fallback
}

export function scoreBand(n: number): ScoreBand {
  if (n < 0.34) return 'low'
  if (n < 0.67) return 'medium'
  return 'high'
}

export function parseJsonObjectLoose(raw: string): Record<string, unknown> {
  const t = String(raw || '').trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {}
}

/** Hydrate ride operational draft from rideJson form strings (capacity, weather, queue, …). */
export function hydrateRideBehaviorDraft(
  rideType: string,
  capRaw: string,
  weatherRaw: string,
  queueRaw: string,
  downtimeRaw: string,
  staffingRaw: string,
  throughputRaw: string
): RideBehaviorDraft {
  const d = emptyRideBehaviorDraft()
  const cap = parseJsonObjectLoose(capRaw)
  const wx = parseJsonObjectLoose(weatherRaw)
  const q = parseJsonObjectLoose(queueRaw)
  const down = parseJsonObjectLoose(downtimeRaw)
  const staff = parseJsonObjectLoose(staffingRaw)
  const thr = parseJsonObjectLoose(throughputRaw)

  d.entityType = str(cap.entityType) || rideType
  d.category = str(cap.category)
  d.modelType = str(cap.modelType)
  d.featureSetCode = str(cap.featureSetCode)
  d.environment = str(cap.environment)
  d.experienceClass = str(cap.experienceClass)

  d.weatherSensitive = bool(wx.weatherSensitive, false)
  d.rainSensitive = bool(wx.rainSensitive, false)
  d.windSensitive = bool(wx.windSensitive, false)
  d.heatSensitive = bool(wx.heatSensitive, false)
  d.weatherSensitivityScore = num01(wx.weatherSensitivityScore, 0.5)
  d.rainImpactScore = num01(wx.rainImpactScore, 0.5)
  d.windImpactScore = num01(wx.windImpactScore, 0.5)
  d.heatImpactScore = num01(wx.heatImpactScore, 0.5)

  d.queueElasticityScore = num01(q.queueElasticityScore, 0.5)
  d.maxQueueTargetMin = num(q.maxQueueTargetMin, 0)
  d.targetThroughputFactor = num(q.targetThroughputFactor, 1)

  d.staffDependencyScore = num01(staff.staffDependencyScore, 0.5)
  d.downtimeRiskScore = num01(down.downtimeRiskScore, 0.5)
  d.maintenanceCriticality = num01(down.maintenanceCriticality, 0.5)
  d.capacityElasticityScore = num01(thr.capacityElasticityScore, 0.5)
  d.availabilityTargetPercent = Math.min(100, Math.max(0, num(thr.availabilityTargetPercent, 95)))

  return d
}

/** Write draft back into rideJson string fields (pretty-printed). */
export function applyRideBehaviorDraftToJsonStrings(
  d: RideBehaviorDraft,
  rideJson: {
    capacity: string
    weatherSensitivity: string
    queueBehavior: string
    downtimeSensitivity: string
    staffingDependency: string
    throughput: string
  },
  entityTypeOverride?: string
): void {
  const cap = parseJsonObjectLoose(rideJson.capacity)
  const wx = parseJsonObjectLoose(rideJson.weatherSensitivity)
  const q = parseJsonObjectLoose(rideJson.queueBehavior)
  const down = parseJsonObjectLoose(rideJson.downtimeSensitivity)
  const staff = parseJsonObjectLoose(rideJson.staffingDependency)
  const thr = parseJsonObjectLoose(rideJson.throughput)

  const et = String(entityTypeOverride ?? d.entityType ?? '').trim()
  Object.assign(cap, {
    entityType: et || undefined,
    category: d.category || undefined,
    modelType: d.modelType || undefined,
    featureSetCode: d.featureSetCode || undefined,
    environment: d.environment || undefined,
    experienceClass: d.experienceClass || undefined,
  })

  Object.assign(wx, {
    weatherSensitive: d.weatherSensitive,
    rainSensitive: d.rainSensitive,
    windSensitive: d.windSensitive,
    heatSensitive: d.heatSensitive,
    weatherSensitivityScore: d.weatherSensitivityScore,
    rainImpactScore: d.rainImpactScore,
    windImpactScore: d.windImpactScore,
    heatImpactScore: d.heatImpactScore,
  })

  Object.assign(q, {
    queueElasticityScore: d.queueElasticityScore,
    maxQueueTargetMin: d.maxQueueTargetMin,
    targetThroughputFactor: d.targetThroughputFactor,
  })

  Object.assign(staff, { staffDependencyScore: d.staffDependencyScore })
  Object.assign(down, {
    downtimeRiskScore: d.downtimeRiskScore,
    maintenanceCriticality: d.maintenanceCriticality,
  })
  Object.assign(thr, {
    capacityElasticityScore: d.capacityElasticityScore,
    availabilityTargetPercent: d.availabilityTargetPercent,
  })

  rideJson.capacity = JSON.stringify(cap, null, 2)
  rideJson.weatherSensitivity = JSON.stringify(wx, null, 2)
  rideJson.queueBehavior = JSON.stringify(q, null, 2)
  rideJson.downtimeSensitivity = JSON.stringify(down, null, 2)
  rideJson.staffingDependency = JSON.stringify(staff, null, 2)
  rideJson.throughput = JSON.stringify(thr, null, 2)
}

export function buildRideBehaviorSummaryLines(
  d: RideBehaviorDraft,
  t: (key: string) => string
): string[] {
  const w = scoreBand(d.weatherSensitivityScore)
  const q = scoreBand(d.queueElasticityScore)
  const dn = scoreBand(d.downtimeRiskScore)
  const st = scoreBand(d.staffDependencyScore)
  return [
    t(`aiMl.forecastBehavior.bandWeather.${w}`),
    t(`aiMl.forecastBehavior.bandQueue.${q}`),
    t(`aiMl.forecastBehavior.bandDowntime.${dn}`),
    t(`aiMl.forecastBehavior.bandStaff.${st}`),
  ]
}

export function buildRideRelevanceHints(d: RideBehaviorDraft, t: (key: string) => string): string[] {
  const hints: string[] = []
  if (d.rainSensitive && d.rainImpactScore >= 0.55) {
    hints.push(t('aiMl.forecastBehavior.hintRainQueues'))
  }
  if (d.staffDependencyScore >= 0.65) {
    hints.push(t('aiMl.forecastBehavior.hintStaff'))
  }
  if (d.downtimeRiskScore >= 0.65 && d.queueElasticityScore >= 0.55) {
    hints.push(t('aiMl.forecastBehavior.hintDowntimeQueue'))
  }
  if (d.downtimeRiskScore < 0.35 && d.staffDependencyScore < 0.45) {
    hints.push(t('aiMl.forecastBehavior.hintResilient'))
  }
  return hints.slice(0, 4)
}

export type EffectiveRow = { key: string; park: string | null; ride: string | null; effective: string }

function fmtScore01(v: unknown): string | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const x = n <= 1 ? n : n / 100
  return `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`
}

/** Merge: ride JSON sections override park `weatherProfileJson` keys where present. */
export function buildEffectiveForecastRows(
  parkWeather: Record<string, unknown>,
  rideWeather: Record<string, unknown>,
  rideQueue: Record<string, unknown>,
  rideStaff: Record<string, unknown>,
  rideDowntime: Record<string, unknown>,
  parkWeights: Record<string, number> | undefined,
  rideWeights: Record<string, number> | undefined,
  t: (key: string) => string
): EffectiveRow[] {
  const pw = (k: string) => parkWeather[k]

  const row = (labelKey: string, pk: unknown, rk: unknown): EffectiveRow => {
    const pr = fmtScore01(pk)
    const rr = fmtScore01(rk)
    const eff = rr != null ? rr : pr ?? '—'
    return { key: t(`aiMl.${labelKey}`), park: pr, ride: rr, effective: eff }
  }

  return [
    row('forecastBehavior.effectiveRain', pw('rainImpactScore'), rideWeather.rainImpactScore),
    row(
      'forecastBehavior.effectiveWeather',
      pw('weatherSensitivityScore'),
      rideWeather.weatherSensitivityScore
    ),
    row('forecastBehavior.effectiveQueue', null, rideQueue.queueElasticityScore),
    row('forecastBehavior.effectiveStaff', pw('staffDependencyScore'), rideStaff.staffDependencyScore),
    row('forecastBehavior.effectiveDowntime', pw('downtimeRiskScore'), rideDowntime.downtimeRiskScore),
    (() => {
      const wPark = parkWeights?.current_wait_time
      const wRide = rideWeights?.current_wait_time
      const wEff = wRide ?? wPark ?? 1
      return {
        key: t('aiMl.forecastBehavior.effectiveWeightWait'),
        park: wPark != null ? String(wPark) : null,
        ride: wRide != null ? String(wRide) : null,
        effective: String(wEff),
      }
    })(),
  ]
}

export function parkWeatherBaseline(parkRow: { weatherProfileJson?: Record<string, unknown> }): Record<string, unknown> {
  return parkRow.weatherProfileJson && typeof parkRow.weatherProfileJson === 'object'
    ? (parkRow.weatherProfileJson as Record<string, unknown>)
    : {}
}
