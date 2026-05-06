import type { EntityTypeTemplateRow } from '@/api/client'

export type WizardEntityTab = 'parks' | 'rides' | 'shows' | 'restaurants'
export type TemplateApplyMode = 'fill_empty' | 'override'

export interface WizardFormState {
  basic: {
    name: string
    displayName: string
    internalCode: string
    slug: string
    parkId: string
    parentAssetId: string
    zoneId: string
    activeFlag: boolean
    indoorOutdoor: string
    notes: string
    timezone: string
    /** When set, `parks.enrichment.defaultOperatingHours` overrides ThemeParks calendar for operating-context / snapshots. */
    masterOperatingHoursEnabled: boolean
    /** OPERATING = use opening/closing wall times in park TZ; CLOSED = treated as closed plan day. */
    masterOperatingType: 'OPERATING' | 'CLOSED'
    masterOpeningTime: string
    masterClosingTime: string
  }
  templateId: string
  templateApplyMode: TemplateApplyMode
  capacity: Record<string, unknown>
  staffing: Record<string, unknown>
  mlTargets: Record<string, unknown>
  /** Original master_profile snapshot merged on save with step fields (snake_case). */
  baseMasterProfile: Record<string, unknown>
}

export function emptyWizardState(tab: WizardEntityTab): WizardFormState {
  return {
    basic: {
      name: '',
      displayName: '',
      internalCode: '',
      slug: '',
      parkId: '',
      parentAssetId: '',
      zoneId: '',
      activeFlag: true,
      indoorOutdoor: '',
      notes: '',
      timezone: '',
      masterOperatingHoursEnabled: false,
      masterOperatingType: 'OPERATING',
      masterOpeningTime: '',
      masterClosingTime: '',
    },
    templateId: '',
    templateApplyMode: 'fill_empty',
    capacity: defaultCapacity(tab),
    staffing: defaultStaffing(tab),
    mlTargets: defaultMl(tab),
    baseMasterProfile: {},
  }
}

function defaultCapacity(tab: WizardEntityTab): Record<string, unknown> {
  if (tab === 'rides')
    return {
      theoreticalCapacityPerHour: '',
      targetThroughputPerHour: '',
      dispatchIntervalSec: '',
      seatsPerVehicle: '',
      vehiclesCount: '',
      loadingStations: '',
      loadTimeAvgSec: '',
      unloadTimeAvgSec: '',
    }
  if (tab === 'shows')
    return {
      venueCapacity: '',
      showDurationMin: '',
      turnoverTimeMin: '',
      showsPerDayTarget: '',
      avgFillRatePercent: '',
    }
  if (tab === 'restaurants')
    return {
      seatingCapacity: '',
      serviceCapacityPerHour: '',
      avgServiceTimeMin: '',
      cashRegisters: '',
      kitchenStations: '',
      tableTurnoverTimeMin: '',
    }
  return {
    maxDailyCapacity: '',
    expectedDailyVisitors: '',
    parkingCapacity: '',
    hotelRooms: '',
  }
}

function defaultStaffing(tab: WizardEntityTab): Record<string, unknown> {
  if (tab === 'rides')
    return {
      employeesRequiredMin: '',
      employeesRequiredNormal: '',
      employeesRequiredPeak: '',
      operatorSkillLevel: '',
      supervisorRequiredFlag: false,
    }
  if (tab === 'shows')
    return {
      employeesRequiredMin: '',
      employeesRequiredNormal: '',
      employeesRequiredPeak: '',
      performersRequired: '',
      technicalStaffRequired: '',
    }
  if (tab === 'restaurants')
    return {
      employeesRequiredMin: '',
      employeesRequiredNormal: '',
      employeesRequiredPeak: '',
      kitchenStaffRequired: '',
      serviceStaffRequired: '',
      cashierStaffRequired: '',
    }
  return {
    operationsStaffTarget: '',
    securityStaffTarget: '',
    cleaningStaffTarget: '',
  }
}

function defaultMl(tab: WizardEntityTab): Record<string, unknown> {
  const common = {
    mlEnabled: false,
    forecastEnabled: false,
    operationalCriticality: '',
    weatherSensitivity: '',
    guestSatisfactionWeight: '',
  }
  if (tab === 'rides')
    return {
      ...common,
      queuePredictionEnabled: false,
      capacityOptimizationEnabled: false,
      maxQueueTimeTargetMin: '',
      availabilityTargetPercent: '',
      downtimeImpactLevel: '',
      maintenanceCriticality: '',
      weatherSensitive: false,
      rainSensitive: false,
      windSensitive: false,
    }
  if (tab === 'shows')
    return {
      ...common,
      attendancePredictionEnabled: false,
      targetFillRatePercent: '',
      noShowRatePercent: '',
      crowdRedistributionWeight: '',
    }
  if (tab === 'restaurants')
    return {
      ...common,
      demandForecastEnabled: false,
      waitTimePredictionEnabled: false,
      revenueForecastEnabled: false,
      maxWaitTimeTargetMin: '',
      targetOrdersPerHour: '',
      targetRevenuePerHour: '',
    }
  return {
    ...common,
    visitorForecastEnabled: false,
    targetAvgQueueTimeMin: '',
    targetGuestSatisfaction: '',
    weatherRegionCode: '',
    schoolHolidayRegion: '',
    trafficRegionCode: '',
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function toNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function hydrateWizardFromDetail(
  detail: Record<string, unknown>,
  tab: WizardEntityTab
): WizardFormState {
  const pres = (detail.masterDataPresentation || {}) as Record<string, unknown>
  const mp = { ...((pres.master_profile as Record<string, unknown>) || {}) }
  const s = emptyWizardState(tab)

  if (detail.entityKind === 'park') {
    const p = (detail.park || {}) as Record<string, unknown>
    s.basic.name = str(p.name)
    s.basic.slug = str(p.slug)
    s.basic.timezone = str(p.timezone)
    s.basic.displayName = str(mp.display_name)
    s.basic.internalCode = str(mp.internal_code)
    s.basic.parkId = str(p.id)
    s.basic.activeFlag = p.activeFlag !== false && !(p.enrichment as { deactivated?: boolean })?.deactivated
    s.basic.indoorOutdoor = str(mp.indoor_outdoor)
    s.basic.notes = str(mp.notes)
    const doh = (p.enrichment as { defaultOperatingHours?: Record<string, unknown> } | undefined)?.defaultOperatingHours
    s.basic.masterOperatingHoursEnabled = doh?.useMasterOperatingHours === true
    s.basic.masterOperatingType =
      doh?.type != null && String(doh.type).toUpperCase() !== 'OPERATING' ? 'CLOSED' : 'OPERATING'
    s.basic.masterOpeningTime = str(doh?.openingTime)
    s.basic.masterClosingTime = str(doh?.closingTime)
    s.templateId = str(p.templateId)
    s.capacity.maxDailyCapacity = str(mp.max_daily_capacity ?? '')
    s.capacity.expectedDailyVisitors = str(mp.expected_daily_visitors ?? '')
    s.capacity.parkingCapacity = str(mp.parking_capacity ?? '')
    s.capacity.hotelRooms = str(mp.hotel_rooms ?? '')
    s.staffing.operationsStaffTarget = str(mp.operations_staff_target ?? '')
    s.staffing.securityStaffTarget = str(mp.security_staff_target ?? '')
    s.staffing.cleaningStaffTarget = str(mp.cleaning_staff_target ?? '')
    Object.assign(s.mlTargets, defaultMl('parks'), {
      mlEnabled: toBool(mp.ml_enabled),
      forecastEnabled: toBool(mp.forecast_enabled),
      operationalCriticality: str(mp.operational_criticality),
      weatherSensitivity: str(mp.weather_sensitivity),
      guestSatisfactionWeight: str(mp.guest_satisfaction_weight),
      visitorForecastEnabled: toBool(mp.visitor_forecast_enabled),
      targetAvgQueueTimeMin: str(mp.target_avg_queue_time_min ?? ''),
      targetGuestSatisfaction: str(mp.target_guest_satisfaction ?? ''),
      weatherRegionCode: str(mp.weather_region_code ?? ''),
      schoolHolidayRegion: str(mp.school_holiday_region ?? ''),
      trafficRegionCode: str(mp.traffic_region_code ?? ''),
    })
    s.baseMasterProfile = mp
    return s
  }

  const asset = (detail.asset || {}) as Record<string, unknown>
  s.basic.name = str(asset.name)
  s.basic.slug = str(asset.slug)
  s.basic.displayName = str(asset.shortName || mp.display_name)
  s.basic.internalCode = str(mp.internal_code)
  s.basic.parkId = str(asset.parkId)
  s.basic.parentAssetId = str(asset.parentAssetId ?? '')
  s.basic.zoneId = str(asset.zoneId ?? '')
  s.basic.activeFlag = asset.activeFlag !== false
  s.basic.indoorOutdoor = str(mp.indoor_outdoor)
  s.basic.notes = str(mp.notes || asset.description)
  s.templateId = str(asset.templateId)

  if (tab === 'rides') {
    const rm = (asset.rideMaster || {}) as Record<string, unknown>
    s.capacity.theoreticalCapacityPerHour = str(rm.theoreticalCapacityPph ?? mp.theoretical_capacity_per_hour ?? '')
    s.capacity.targetThroughputPerHour = str(rm.capacityPph ?? mp.target_throughput_per_hour ?? '')
    s.capacity.dispatchIntervalSec = str(rm.dispatchIntervalSec ?? mp.dispatch_interval_sec ?? '')
    s.capacity.seatsPerVehicle = str(rm.seatsPerCycle ?? mp.seats_per_vehicle ?? '')
    s.capacity.vehiclesCount = str(rm.trainsCount ?? mp.vehicles_count ?? '')
    s.capacity.loadingStations = str(mp.loading_stations ?? '')
    s.capacity.loadTimeAvgSec = str(mp.load_time_avg_sec ?? '')
    s.capacity.unloadTimeAvgSec = str(mp.unload_time_avg_sec ?? '')
    s.staffing.employeesRequiredMin = str(mp.employees_required_min ?? rm.minStaff ?? '')
    s.staffing.employeesRequiredNormal = str(mp.employees_required_normal ?? rm.normalStaff ?? '')
    s.staffing.employeesRequiredPeak = str(mp.employees_required_peak ?? rm.peakStaff ?? '')
    s.staffing.operatorSkillLevel = str(mp.operator_skill_level ?? '')
    s.staffing.supervisorRequiredFlag = toBool(mp.supervisor_required_flag)
    Object.assign(s.mlTargets, defaultMl('rides'), {
      mlEnabled: toBool(mp.ml_enabled),
      forecastEnabled: toBool(mp.forecast_enabled),
      operationalCriticality: str(mp.operational_criticality),
      weatherSensitivity: str(mp.weather_sensitivity),
      guestSatisfactionWeight: str(mp.guest_satisfaction_weight),
      queuePredictionEnabled: toBool(mp.queue_prediction_enabled),
      capacityOptimizationEnabled: toBool(mp.capacity_optimization_enabled),
      maxQueueTimeTargetMin: str(mp.max_queue_time_target_min ?? ''),
      availabilityTargetPercent: str(mp.availability_target_percent ?? ''),
      downtimeImpactLevel: str(mp.downtime_impact_level ?? ''),
      maintenanceCriticality: str(mp.maintenance_criticality ?? ''),
      weatherSensitive: toBool(mp.weather_sensitive ?? rm.weatherSensitive),
      rainSensitive: toBool(mp.rain_sensitive ?? rm.rainSensitive),
      windSensitive: toBool(mp.wind_sensitive ?? ''),
    })
  }

  if (tab === 'shows') {
    const sm = (asset.showMaster || {}) as Record<string, unknown>
    s.capacity.venueCapacity = str(sm.seatsCapacity ?? mp.venue_capacity ?? '')
    s.capacity.showDurationMin = str(sm.durationMin ?? mp.show_duration_min ?? '')
    s.capacity.turnoverTimeMin = str(mp.turnover_time_min ?? '')
    s.capacity.showsPerDayTarget = str(sm.showsPerDay ?? mp.shows_per_day_target ?? '')
    s.capacity.avgFillRatePercent = str(mp.avg_fill_rate_percent ?? '')
    s.staffing.employeesRequiredMin = str(mp.employees_required_min ?? sm.operatorStaff ?? '')
    s.staffing.employeesRequiredNormal = str(mp.employees_required_normal ?? '')
    s.staffing.employeesRequiredPeak = str(mp.employees_required_peak ?? '')
    s.staffing.performersRequired = str(sm.performerCount ?? mp.performers_required ?? '')
    s.staffing.technicalStaffRequired = str(sm.technicalStaff ?? mp.technical_staff_required ?? '')
    Object.assign(s.mlTargets, defaultMl('shows'), {
      mlEnabled: toBool(mp.ml_enabled),
      forecastEnabled: toBool(mp.forecast_enabled),
      operationalCriticality: str(mp.operational_criticality),
      weatherSensitivity: str(mp.weather_sensitivity),
      guestSatisfactionWeight: str(mp.guest_satisfaction_weight),
      attendancePredictionEnabled: toBool(mp.attendance_prediction_enabled),
      targetFillRatePercent: str(mp.target_fill_rate_percent ?? ''),
      noShowRatePercent: str(mp.no_show_rate_percent ?? ''),
      crowdRedistributionWeight: str(mp.crowd_redistribution_weight ?? ''),
    })
  }

  if (tab === 'restaurants') {
    const rt = (asset.restaurantMaster || {}) as Record<string, unknown>
    s.capacity.seatingCapacity = str(rt.seatingCapacity ?? mp.seating_capacity ?? '')
    s.capacity.serviceCapacityPerHour = str(rt.kitchenCapacityOrdersH ?? mp.service_capacity_per_hour ?? '')
    s.capacity.avgServiceTimeMin = str(rt.avgServiceTimeMin ?? mp.avg_service_time_min ?? '')
    s.capacity.cashRegisters = str(mp.cash_registers ?? '')
    s.capacity.kitchenStations = str(mp.kitchen_stations ?? '')
    s.capacity.tableTurnoverTimeMin = str(rt.avgTableTurnoverMin ?? mp.table_turnover_time_min ?? '')
    s.staffing.employeesRequiredMin = str(mp.employees_required_min ?? rt.kitchenStaffMin ?? '')
    s.staffing.employeesRequiredNormal = str(mp.employees_required_normal ?? rt.serviceStaffMin ?? '')
    s.staffing.employeesRequiredPeak = str(mp.employees_required_peak ?? rt.peakStaff ?? '')
    s.staffing.kitchenStaffRequired = str(mp.kitchen_staff_required ?? rt.kitchenStaffMin ?? '')
    s.staffing.serviceStaffRequired = str(mp.service_staff_required ?? rt.serviceStaffMin ?? '')
    s.staffing.cashierStaffRequired = str(mp.cashier_staff_required ?? '')
    Object.assign(s.mlTargets, defaultMl('restaurants'), {
      mlEnabled: toBool(mp.ml_enabled),
      forecastEnabled: toBool(mp.forecast_enabled),
      operationalCriticality: str(mp.operational_criticality),
      weatherSensitivity: str(mp.weather_sensitivity),
      guestSatisfactionWeight: str(mp.guest_satisfaction_weight),
      demandForecastEnabled: toBool(mp.demand_forecast_enabled),
      waitTimePredictionEnabled: toBool(mp.wait_time_prediction_enabled),
      revenueForecastEnabled: toBool(mp.revenue_forecast_enabled),
      maxWaitTimeTargetMin: str(mp.max_wait_time_target_min ?? ''),
      targetOrdersPerHour: str(mp.target_orders_per_hour ?? ''),
      targetRevenuePerHour: str(mp.target_revenue_per_hour ?? ''),
    })
  }

  s.baseMasterProfile = mp
  return s
}

function rideDerived(cap: Record<string, unknown>) {
  const dispatch = Number(cap.dispatchIntervalSec)
  const seats = Number(cap.seatsPerVehicle)
  const vehicles = Number(cap.vehiclesCount)
  let calculatedCapacityPerHour: number | null = null
  if (dispatch > 0 && seats >= 0 && vehicles >= 0) {
    calculatedCapacityPerHour = Math.floor((3600 / dispatch) * seats * vehicles)
  }
  const theoretical = toNum(cap.theoreticalCapacityPerHour)
  const target = toNum(cap.targetThroughputPerHour)
  let effectiveCapacityPerHour: number | null = null
  if (theoretical != null && target != null) effectiveCapacityPerHour = Math.min(theoretical, target)
  else if (theoretical != null) effectiveCapacityPerHour = theoretical
  else if (target != null) effectiveCapacityPerHour = target
  return { calculatedCapacityPerHour, effectiveCapacityPerHour }
}

function showDerived(cap: Record<string, unknown>) {
  const venue = toNum(cap.venueCapacity)
  const spd = toNum(cap.showsPerDayTarget)
  const theoreticalGuestsPerDay =
    venue != null && spd != null && venue >= 0 && spd >= 0 ? venue * spd : null
  return { theoreticalGuestsPerDay }
}

function restaurantDerived(cap: Record<string, unknown>) {
  const regs = toNum(cap.cashRegisters)
  const svcMin = toNum(cap.avgServiceTimeMin)
  let calculatedServiceCapacityPerHour: number | null = null
  if (regs != null && svcMin != null && svcMin > 0) calculatedServiceCapacityPerHour = regs * (60 / svcMin)
  const seating = toNum(cap.seatingCapacity)
  const turn = toNum(cap.tableTurnoverTimeMin)
  let calculatedSeatingThroughputPerHour: number | null = null
  if (seating != null && turn != null && turn > 0) calculatedSeatingThroughputPerHour = seating * (60 / turn)
  return { calculatedServiceCapacityPerHour, calculatedSeatingThroughputPerHour }
}

export function computeWizardKpis(tab: WizardEntityTab, state: WizardFormState): { label: string; value: string }[] {
  const { capacity, staffing, mlTargets } = state
  if (tab === 'rides') {
    const d = rideDerived(capacity)
    return [
      { label: 'Calculated capacity / h', value: d.calculatedCapacityPerHour != null ? String(d.calculatedCapacityPerHour) : '—' },
      { label: 'Target throughput / h', value: str(capacity.targetThroughputPerHour) || '—' },
      { label: 'Employees peak', value: str(staffing.employeesRequiredPeak) || '—' },
      { label: 'Max queue target (min)', value: str(mlTargets.maxQueueTimeTargetMin) || '—' },
    ]
  }
  if (tab === 'shows') {
    const d = showDerived(capacity)
    return [
      { label: 'Guests per day', value: d.theoreticalGuestsPerDay != null ? String(d.theoreticalGuestsPerDay) : '—' },
      { label: 'Target fill rate %', value: str(mlTargets.targetFillRatePercent) || '—' },
      { label: 'Employees peak', value: str(staffing.employeesRequiredPeak) || '—' },
      { label: 'No-show rate %', value: str(mlTargets.noShowRatePercent) || '—' },
    ]
  }
  if (tab === 'restaurants') {
    const d = restaurantDerived(capacity)
    return [
      {
        label: 'Service capacity / h',
        value: d.calculatedServiceCapacityPerHour != null ? String(Math.round(d.calculatedServiceCapacityPerHour)) : '—',
      },
      {
        label: 'Seating throughput / h',
        value:
          d.calculatedSeatingThroughputPerHour != null ? String(Math.round(d.calculatedSeatingThroughputPerHour)) : '—',
      },
      { label: 'Employees peak', value: str(staffing.employeesRequiredPeak) || '—' },
      { label: 'Revenue target / h', value: str(mlTargets.targetRevenuePerHour) || '—' },
    ]
  }
  return [
    { label: 'Max daily capacity', value: str(capacity.maxDailyCapacity) || '—' },
    { label: 'Expected visitors', value: str(capacity.expectedDailyVisitors) || '—' },
    { label: 'Ops staff target', value: str(staffing.operationsStaffTarget) || '—' },
    { label: 'Queue target (min)', value: str(mlTargets.targetAvgQueueTimeMin) || '—' },
  ]
}

export function validateStaffingChain(tab: WizardEntityTab, staffing: Record<string, unknown>): string | null {
  if (tab === 'parks') return null
  const a = toNum(staffing.employeesRequiredMin)
  const b = toNum(staffing.employeesRequiredNormal)
  const c = toNum(staffing.employeesRequiredPeak)
  if (a == null && b == null && c == null) return null
  if (a == null || b == null || c == null) return null
  if (a > b || b > c) return 'Staffing: min ≤ normal ≤ peak is required when all three are set.'
  return null
}

export function buildPatchPayload(tab: WizardEntityTab, state: WizardFormState): Record<string, unknown> {
  const { basic, capacity, staffing, mlTargets, baseMasterProfile, templateId } = state
  const mp: Record<string, unknown> = { ...baseMasterProfile }

  const put = (key: string, v: unknown) => {
    if (v === '' || v === undefined || v === null) return
    mp[key] = v
  }

  put('display_name', basic.displayName || undefined)
  put('internal_code', basic.internalCode || undefined)
  put('indoor_outdoor', basic.indoorOutdoor || undefined)
  put('notes', basic.notes || undefined)
  mp.ml_enabled = Boolean(mlTargets.mlEnabled)
  mp.forecast_enabled = Boolean(mlTargets.forecastEnabled)
  put('operational_criticality', mlTargets.operationalCriticality || undefined)
  put('weather_sensitivity', mlTargets.weatherSensitivity || undefined)
  put('guest_satisfaction_weight', toNum(mlTargets.guestSatisfactionWeight))

  if (tab === 'parks') {
    put('max_daily_capacity', toNum(capacity.maxDailyCapacity))
    put('expected_daily_visitors', toNum(capacity.expectedDailyVisitors))
    put('parking_capacity', toNum(capacity.parkingCapacity))
    put('hotel_rooms', toNum(capacity.hotelRooms))
    put('operations_staff_target', toNum(staffing.operationsStaffTarget))
    put('security_staff_target', toNum(staffing.securityStaffTarget))
    put('cleaning_staff_target', toNum(staffing.cleaningStaffTarget))
    mp.visitor_forecast_enabled = Boolean(mlTargets.visitorForecastEnabled)
    put('target_avg_queue_time_min', toNum(mlTargets.targetAvgQueueTimeMin))
    put('target_guest_satisfaction', toNum(mlTargets.targetGuestSatisfaction))
    put('weather_region_code', mlTargets.weatherRegionCode || undefined)
    put('school_holiday_region', mlTargets.schoolHolidayRegion || undefined)
    put('traffic_region_code', mlTargets.trafficRegionCode || undefined)
    const defaultOperatingHours = {
      useMasterOperatingHours: basic.masterOperatingHoursEnabled === true,
      type: basic.masterOperatingType === 'CLOSED' ? 'CLOSED' : 'OPERATING',
      openingTime: String(basic.masterOpeningTime || '').trim(),
      closingTime: String(basic.masterClosingTime || '').trim(),
    }
    return {
      name: basic.name,
      slug: basic.slug || undefined,
      timezone: basic.timezone || undefined,
      masterProfile: mp,
      enrichment: { defaultOperatingHours },
      ...(templateId ? { templateId } : {}),
    }
  }

  if (tab === 'rides') {
    put('loading_stations', toNum(capacity.loadingStations))
    put('load_time_avg_sec', toNum(capacity.loadTimeAvgSec))
    put('unload_time_avg_sec', toNum(capacity.unloadTimeAvgSec))
    put('employees_required_min', toNum(staffing.employeesRequiredMin))
    put('employees_required_normal', toNum(staffing.employeesRequiredNormal))
    put('employees_required_peak', toNum(staffing.employeesRequiredPeak))
    put('operator_skill_level', staffing.operatorSkillLevel || undefined)
    mp.supervisor_required_flag = Boolean(staffing.supervisorRequiredFlag)
    put('dispatch_interval_sec', toNum(capacity.dispatchIntervalSec))
    put('theoretical_capacity_per_hour', toNum(capacity.theoreticalCapacityPerHour))
    put('target_throughput_per_hour', toNum(capacity.targetThroughputPerHour))
    put('seats_per_vehicle', toNum(capacity.seatsPerVehicle))
    put('vehicles_count', toNum(capacity.vehiclesCount))
    mp.queue_prediction_enabled = Boolean(mlTargets.queuePredictionEnabled)
    mp.capacity_optimization_enabled = Boolean(mlTargets.capacityOptimizationEnabled)
    put('max_queue_time_target_min', toNum(mlTargets.maxQueueTimeTargetMin))
    put('availability_target_percent', toNum(mlTargets.availabilityTargetPercent))
    put('downtime_impact_level', mlTargets.downtimeImpactLevel || undefined)
    put('maintenance_criticality', mlTargets.maintenanceCriticality || undefined)
    mp.weather_sensitive = Boolean(mlTargets.weatherSensitive)
    mp.rain_sensitive = Boolean(mlTargets.rainSensitive)
    mp.wind_sensitive = Boolean(mlTargets.windSensitive)

    const rideMaster: Record<string, unknown> = {}
    const t = (k: string, v: number | null) => {
      if (v != null) rideMaster[k] = v
    }
    t('theoreticalCapacityPph', toNum(capacity.theoreticalCapacityPerHour))
    t('capacityPph', toNum(capacity.targetThroughputPerHour))
    t('dispatchIntervalSec', toNum(capacity.dispatchIntervalSec))
    t('seatsPerCycle', toNum(capacity.seatsPerVehicle))
    t('trainsCount', toNum(capacity.vehiclesCount))
    t('minStaff', toNum(staffing.employeesRequiredMin))
    t('normalStaff', toNum(staffing.employeesRequiredNormal))
    t('peakStaff', toNum(staffing.employeesRequiredPeak))
    if (mlTargets.weatherSensitive != null) rideMaster.weatherSensitive = toBool(mlTargets.weatherSensitive)
    if (mlTargets.rainSensitive != null) rideMaster.rainSensitive = toBool(mlTargets.rainSensitive)

    return {
      asset: {
        name: basic.name,
        slug: basic.slug || undefined,
        shortName: basic.displayName || undefined,
        zoneId: basic.zoneId || null,
        parentAssetId: basic.parentAssetId || null,
        activeFlag: basic.activeFlag,
        description: basic.notes || undefined,
      },
      rideMaster,
      masterProfile: mp,
      ...(templateId ? { templateId } : {}),
    }
  }

  if (tab === 'shows') {
    put('venue_capacity', toNum(capacity.venueCapacity))
    put('show_duration_min', toNum(capacity.showDurationMin))
    put('turnover_time_min', toNum(capacity.turnoverTimeMin))
    put('shows_per_day_target', toNum(capacity.showsPerDayTarget))
    put('avg_fill_rate_percent', toNum(capacity.avgFillRatePercent))
    put('employees_required_min', toNum(staffing.employeesRequiredMin))
    put('employees_required_normal', toNum(staffing.employeesRequiredNormal))
    put('employees_required_peak', toNum(staffing.employeesRequiredPeak))
    put('performers_required', toNum(staffing.performersRequired))
    put('technical_staff_required', toNum(staffing.technicalStaffRequired))
    mp.attendance_prediction_enabled = Boolean(mlTargets.attendancePredictionEnabled)
    put('target_fill_rate_percent', toNum(mlTargets.targetFillRatePercent))
    put('no_show_rate_percent', toNum(mlTargets.noShowRatePercent))
    put('crowd_redistribution_weight', toNum(mlTargets.crowdRedistributionWeight))

    const showMaster: Record<string, unknown> = {}
    const ts = (k: string, v: number | null) => {
      if (v != null) showMaster[k] = v
    }
    ts('seatsCapacity', toNum(capacity.venueCapacity))
    ts('durationMin', toNum(capacity.showDurationMin))
    ts('showsPerDay', toNum(capacity.showsPerDayTarget))
    ts('performerCount', toNum(staffing.performersRequired))
    ts('technicalStaff', toNum(staffing.technicalStaffRequired))
    ts('operatorStaff', toNum(staffing.employeesRequiredMin))

    return {
      asset: {
        name: basic.name,
        slug: basic.slug || undefined,
        shortName: basic.displayName || undefined,
        zoneId: basic.zoneId || null,
        parentAssetId: basic.parentAssetId || null,
        activeFlag: basic.activeFlag,
        description: basic.notes || undefined,
      },
      showMaster,
      masterProfile: mp,
      ...(templateId ? { templateId } : {}),
    }
  }

  if (tab !== 'restaurants') return {}

  put('seating_capacity', toNum(capacity.seatingCapacity))
  put('service_capacity_per_hour', toNum(capacity.serviceCapacityPerHour))
  put('avg_service_time_min', toNum(capacity.avgServiceTimeMin))
  put('cash_registers', toNum(capacity.cashRegisters))
  put('kitchen_stations', toNum(capacity.kitchenStations))
  put('table_turnover_time_min', toNum(capacity.tableTurnoverTimeMin))
  put('employees_required_min', toNum(staffing.employeesRequiredMin))
  put('employees_required_normal', toNum(staffing.employeesRequiredNormal))
  put('employees_required_peak', toNum(staffing.employeesRequiredPeak))
  put('kitchen_staff_required', toNum(staffing.kitchenStaffRequired))
  put('service_staff_required', toNum(staffing.serviceStaffRequired))
  put('cashier_staff_required', toNum(staffing.cashierStaffRequired))
    mp.demand_forecast_enabled = Boolean(mlTargets.demandForecastEnabled)
    mp.wait_time_prediction_enabled = Boolean(mlTargets.waitTimePredictionEnabled)
    mp.revenue_forecast_enabled = Boolean(mlTargets.revenueForecastEnabled)
  put('max_wait_time_target_min', toNum(mlTargets.maxWaitTimeTargetMin))
  put('target_orders_per_hour', toNum(mlTargets.targetOrdersPerHour))
  put('target_revenue_per_hour', toNum(mlTargets.targetRevenuePerHour))

  const restaurantMaster: Record<string, unknown> = {}
  const tr = (k: string, v: number | null) => {
    if (v != null) restaurantMaster[k] = v
  }
  tr('seatingCapacity', toNum(capacity.seatingCapacity))
  tr('kitchenCapacityOrdersH', toNum(capacity.serviceCapacityPerHour))
  tr('avgServiceTimeMin', toNum(capacity.avgServiceTimeMin))
  tr('avgTableTurnoverMin', toNum(capacity.tableTurnoverTimeMin))
  tr('kitchenStaffMin', toNum(staffing.kitchenStaffRequired))
  tr('serviceStaffMin', toNum(staffing.serviceStaffRequired))
  tr('peakStaff', toNum(staffing.employeesRequiredPeak))

  return {
    asset: {
      name: basic.name,
      slug: basic.slug || undefined,
      shortName: basic.displayName || undefined,
      zoneId: basic.zoneId || null,
      parentAssetId: basic.parentAssetId || null,
      activeFlag: basic.activeFlag,
      description: basic.notes || undefined,
    },
    restaurantMaster,
    masterProfile: mp,
    ...(templateId ? { templateId } : {}),
  }
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string' && v.trim() === '') return false
  return true
}

export function templateApplyPreview(
  template: EntityTypeTemplateRow | null,
  masterProfile: Record<string, unknown>,
  mode: TemplateApplyMode
): { filled: string[]; unchanged: string[]; missing: string[] } {
  const filled: string[] = []
  const unchanged: string[] = []
  if (!template) return { filled, unchanged, missing: [] }
  const defs = template.defaultValuesJson || {}
  for (const k of Object.keys(defs)) {
    const had = isPresent(masterProfile[k])
    if (mode === 'fill_empty') {
      if (had) unchanged.push(k)
      else filled.push(k)
    } else {
      filled.push(k)
    }
  }
  const req = Array.isArray(template.requiredFieldsJson) ? template.requiredFieldsJson : []
  const flat = { ...masterProfile, ...defs }
  const missing = req.filter((key) => !isPresent(flat[key]))
  return { filled, unchanged, missing }
}

export function profileCompletenessLabel(detail: Record<string, unknown> | null): string {
  if (!detail) return '—'
  const pres = detail.masterDataPresentation as { profile_completeness?: string } | undefined
  return pres?.profile_completeness || (detail.asset as { enrichment?: { profileCompleteness?: string } })?.enrichment?.profileCompleteness || (detail.park as { enrichment?: { profileCompleteness?: string } })?.enrichment?.profileCompleteness || '—'
}

export function draftStorageKey(tab: WizardEntityTab, entityId: string | null, mode: string): string {
  return `sp-mdm-wizard-${tab}-${mode}-${entityId || 'new'}`
}
