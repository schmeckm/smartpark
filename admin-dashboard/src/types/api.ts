export type ZoneStatus = 'ACTIVE' | 'LIMITED' | 'CLOSED' | 'EVACUATION'
export type RideStatus = 'OPEN' | 'CLOSED' | 'MAINTENANCE'
export type StaffRole =
  | 'FOOD_SERVICE'
  | 'RIDE_OPERATOR'
  | 'CLEANING'
  | 'SECURITY'
  | 'GUEST_SERVICE'
export type RecommendationType =
  | 'REALLOCATE_STAFF'
  | 'OPEN_SERVICE_POINT'
  | 'SEND_SECURITY'
  | 'CLEANING_SUPPORT'
  | 'GUEST_ROUTING'
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RecommendationStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED'

/** Sentinel `zoneId` for rides sourced from external adapter canonical feed (not internal zones). */
export const RIDES_ADAPTER_ZONE_ID = '__adapter__'

export interface Ride {
  id: string
  name: string
  zoneId: string
  status: RideStatus
  waitTime: number
  capacityPerHour: number
  criticality: number
  zone?: Zone
}

export interface Staff {
  id: string
  firstName: string
  lastName: string
  /** Personalnummer (optional, server: `employee_number`) */
  employeeNumber?: string | null
  /** People Manager / Supervisor — andere Person aus `staff` */
  supervisorId?: string | null
  supervisor?: {
    id: string
    firstName: string
    lastName: string
    employeeNumber?: string | null
    role: StaffRole
  }
  role: StaffRole
  currentZoneId: string | null
  /**
   * Optional direct assignment to a ride / show / attraction (`rides` table).
   * When set, `currentZoneId` is auto-derived from the ride's zone server-side.
   */
  currentRideId?: string | null
  currentRide?: {
    id: string
    name: string
    zoneId: string
  }
  available: boolean
  skillLevel: number
  currentZone?: Zone
}

export interface Zone {
  id: string
  name: string
  type: string
  currentCrowdLevel: number
  forecastCrowdLevel: number
  maxCapacity: number
  status: ZoneStatus
  adjacentZoneIds?: string[]
  rides?: Ride[]
  staffMembers?: Staff[]
}

export interface CrowdEvent {
  id: string
  zoneId: string
  eventType: string
  crowdLevel: number
  severity: number
  source: string
  createdAt?: string
  zone?: Pick<Zone, 'id' | 'name'>
}

export type ScoreUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type ScoreImpact = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RecommendationScore {
  id: string
  recommendationId: string
  score: number
  urgency: ScoreUrgency
  impact: ScoreImpact
  confidence: number
  expectedBenefit: {
    waitTimeReductionMinutes?: number
    crowdReductionPercent?: number
    staffEfficiencyGainPercent?: number
  } | null
  explanation: { summary: string; reasons: string[] }
  factors: Record<string, unknown>
  modelVersionId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface Recommendation {
  id: string
  eventId: string
  recommendationType: RecommendationType
  priority: Priority
  message: string
  status: RecommendationStatus
  createdAt?: string
  updatedAt?: string
  score?: RecommendationScore | null
  event?: {
    id: string
    zoneId: string
    zone?: Pick<Zone, 'id' | 'name'>
  }
}

export type RecommendationScoringSummary = {
  topRiskyRecommendations: { recommendation: Recommendation; score: RecommendationScore }[]
  criticalRecommendationsCount: number
  averageConfidence: number | null
  generatedAt: string
}

export interface ApiListResponse<T> {
  data: T
}

export type CanonicalMessageStatus = 'RECEIVED' | 'VALIDATED' | 'APPLIED' | 'FAILED' | 'IGNORED'

export interface CanonicalInboundMessage {
  id: string
  messageType: string
  provider: string
  externalDestinationId: string | null
  externalParkId: string | null
  externalEntityId: string | null
  entityType: string | null
  occurredAt: string
  receivedAt: string
  payload: Record<string, unknown>
  rawPayload: Record<string, unknown>
  status: CanonicalMessageStatus
  errorMessage: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ProviderAdapterInfo {
  provider: string
  name: string
  baseUrl: string
  capabilities: Record<string, boolean>
  config?: Record<string, unknown> | null
  /** True when `src/integrations/adapter-packages` exposes a package runtime for this provider key (poll/health/emit path). Core integration lists/sync may still work via the built-in registry adapter. */
  runtimePackageAvailable?: boolean
}

export interface ExternalEntityMapping {
  id: string
  provider: string
  externalDestinationId: string | null
  externalParkId: string | null
  externalEntityId: string
  externalEntityName: string
  externalEntityType: string
  internalEntityType: string | null
  internalEntityId: string | null
  mappingStatus: 'UNMAPPED' | 'MAPPED' | 'IGNORED' | 'NEEDS_REVIEW'
  confidence: number | null
  metadata: Record<string, unknown>
}

export type AdapterQualityTier = 'CORE' | 'VERIFIED' | 'COMMUNITY' | 'CUSTOM'

/** Optional manifest UI metadata (Home Assistant–style). */
export interface AdapterManifestUi {
  logo?: string | null
  icon?: string | null
  category?: string | null
  website?: string | null
  documentationUrl?: string | null
  author?: string | null
  qualityTier?: AdapterQualityTier | null
  description?: string | null
  tags?: string[]
  logoPath?: string | null
  /** Package-relative README path (optional); default `README.md` if file exists */
  readmePath?: string | null
  /** Package-relative banner image (optional); convention `assets/banner.png` or `.svg` */
  bannerPath?: string | null
}

/** Normalized adapter package for UI (registry row and/or filesystem scan). */
export interface AdapterPackageDto {
  id?: string
  adapterKey: string
  name: string
  version: string
  /** Human text from manifest.description or DB metadata.description */
  description?: string | null
  runtime: string
  adapterType: string
  iotClass?: string | null
  capabilities: string[]
  providedDomains?: string[] | null
  providedMetrics?: string[] | null
  /** Filesystem manifest from package scan (includes defaultContextJson / defaultScheduleCron when present). */
  manifest?: Record<string, unknown> | null
  /** DB-synced JSON Schema from last package reload (properties.*.default drives UI starters). */
  configSchema?: Record<string, unknown> | null
  /** scan = from meta.localIntegrationPackages; registry = Sequelize adapter_packages only */
  source?: 'scan' | 'registry'
  manifestValid?: boolean
  manifestErrors?: string[]
  /** From filesystem scan (meta.localIntegrationPackages) */
  packageDir?: string | null
  /** From DB row adapter_packages (merged onto scan entries when present) */
  enabled?: boolean
  status?: string | null
  sourceType?: string | null
  sourcePath?: string | null
  /** Merged manifest + metadata.ui from API */
  ui?: AdapterManifestUi | null
  /** Absolute or API-relative logo URL when server enriches response */
  logoAssetUrl?: string | null
  /** GET …/adapters/packages/:key/asset?path=README.md */
  readmeAssetUrl?: string | null
  /** GET …/asset?path=… banner file */
  bannerAssetUrl?: string | null
  metadata?: Record<string, unknown> | null
  /** Placeholders until devices/entities APIs exist */
  deviceCount?: number
  entityCount?: number
  serviceCount?: number
}

/** Response body from POST /integrations/adapters/packages/:adapterKey/health */
export interface AdapterPackageHealthData {
  ok: boolean
  message?: string
  error?: string
}

/** POST /integrations/adapters/run-local */
export interface AdapterRunLocalBody {
  adapterKey: string
  mode?: 'poll'
  config?: Record<string, unknown>
  context: { parkSlug: string }
  profiles?: string[]
  /** If true, MQTT + canonical (unless emitMqtt / ingestCanonical are sent). */
  emit?: boolean
  /** Fine-grained: UNS/Sparkplug MQTT publish. Send with ingestCanonical (or alone) to override `emit`. */
  emitMqtt?: boolean
  /** Fine-grained: canonical historian ingest. */
  ingestCanonical?: boolean
  autoApply?: boolean
}

export interface AdapterRunLocalObservation {
  eventType?: string
  domain?: string
  assetSlug?: string
  metric?: string
  value?: string | number | boolean | null
  unit?: string | null
  eventTime?: string
  quality?: string | null
  confidence?: number | null
  source?: string
  provider?: string | null
  metadata?: Record<string, unknown>
  rawPayload?: Record<string, unknown>
}

export interface AdapterRunLocalEncodedRow {
  profile?: string
  topic?: string
  error?: string
  skipped?: boolean
  payload?: Record<string, unknown> | null
}

/** ThemeParks.wiki (and future adapters) may attach HTTP debug from poll. */
export interface AdapterRunLocalApiCallDebug {
  method?: string
  url?: string
  status?: number | null
  durationMs?: number
  requestAt?: string
  responsePreview?: unknown
  responseCount?: number
  error?: string | null
}

export interface AdapterRunLocalDebug {
  provider?: string
  parkId?: string
  parkName?: string | null
  apiCalls?: AdapterRunLocalApiCallDebug[]
  rawInput?: Record<string, unknown>
  /** Present when poll() never ran or failed before returning HTTP debug (see pollSkippedMessage). */
  pollSkipped?: boolean
  pollSkippedReason?: string
  pollSkippedMessage?: string
  run?: {
    startedAt?: string
    completedAt?: string
    durationMs?: number
  }
}

export interface AdapterRunLocalResult {
  success?: boolean
  adapterKey?: string
  mode?: string
  observations?: AdapterRunLocalObservation[]
  errors?: string[]
  validationErrors?: Array<{ index?: number; errors?: Array<{ path?: string; message?: string }> }>
  encodedOutputs?: Array<{ results?: AdapterRunLocalEncodedRow[] }>
  emittedOutputs?: Array<{
    results?: AdapterRunLocalEncodedRow[]
    actions?: { mqtt?: Array<Record<string, unknown>>; canonicalIngest?: unknown; skipped?: boolean; reason?: string }
  }>
  emitted?: AdapterRunLocalResult['emittedOutputs']
  manifest?: { name?: string; version?: string }
  debug?: AdapterRunLocalDebug | null
}

export interface AdapterPackagesResponse {
  packages: AdapterPackageDto[]
  meta: Record<string, unknown> | null
}

/** Master data: park (SAP-style MDM root). */
export interface MdmPark {
  id: string
  code: string
  name: string
  timezone?: string | null
  activeFlag: boolean
  futureHints?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface MdmParkZone {
  id: string
  parkId: string
  code: string
  name: string
  sortOrder?: number
  /** Typ, Attraktionen, operative Sicht (MDM Themengebiete) */
  zoneContext?: Record<string, unknown>
  legacyZoneId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface MdmRideType {
  id: string
  code: string
  name: string
  description?: string | null
}

export type MdmRideProfile = {
  operations?: Record<string, unknown>
  capacity?: Record<string, unknown>
  staffing?: Record<string, unknown>
  safety?: Record<string, unknown>
  guestRules?: Record<string, unknown>
  integration?: Record<string, unknown>
  kpi?: Record<string, unknown>
}

export interface PlatformPark {
  id: string
  name: string
  slug: string
  timezone?: string | null
  latitude?: number | null
  longitude?: number | null
  externalSource?: string
  externalEntityId?: string | null
  masterProfile?: Record<string, unknown>
}

export type TrafficCorridorDirection = 'inbound' | 'outbound'

/** Latest TomTom routing poll outcome (persisted on `traffic_corridors.last_poll_result`). */
export interface TrafficCorridorLastPollResult {
  polledAt?: string
  ok?: boolean
  code?: string | null
  message?: string | null
  snapshotId?: string | null
  httpStatus?: number | null
}

export interface TrafficCorridorSnapshotRow {
  id: string
  corridorId: string
  parkId: string
  snapshotTs: string
  source: string
  currentTravelTimeMin: number
  baselineTravelTimeMin: number
  delayMin?: number | null
  delayPercent?: number | null
  congestionScore?: number | null
  inboundPressureScore?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface TrafficCorridorLatestSnapshotDetail {
  routeDistanceMeters?: number | null
  travelTimeSeconds?: number | null
  trafficDelaySeconds?: number | null
  delayPercent: number
  delayMinutes: number
  currentTravelTimeMinutes?: number | null
  baselineTravelTimeMinutes?: number | null
  providerStatus: string
  providerErrorCode?: string | null
  providerErrorMessage?: string | null
  sampledAt?: string | null
  routeLooksUnrealistic?: boolean
}

export interface TrafficCorridorRow {
  id: string
  parkId: string
  name: string
  description?: string | null
  originLabel?: string | null
  originLat?: number | null
  originLng?: number | null
  destinationLabel?: string | null
  destinationLat?: number | null
  destinationLng?: number | null
  direction: TrafficCorridorDirection
  source: string
  baselineTravelTimeMin: number
  weight: number
  enabled: boolean
  latestSnapshot?: TrafficCorridorSnapshotRow | null
  latestSnapshotDetail?: TrafficCorridorLatestSnapshotDetail | null
  /** Set by `TrafficSnapshotService.pollEnabledCorridors` — latest routing attempt (for UI ampel on errors). */
  lastPollResult?: TrafficCorridorLastPollResult | null
  createdAt?: string
  updatedAt?: string
}

export interface TrafficCorridorSnapshotDebugPayload {
  corridor: TrafficCorridorRow
  latestSnapshot: TrafficCorridorSnapshotRow | null
  latestSnapshotDetail: TrafficCorridorLatestSnapshotDetail | null
  providerRawResponse: Record<string, unknown> | null
}

export type AttendanceRiskForecastStatus = 'normal' | 'elevated' | 'high' | 'critical'

export interface ParkDemandForecast5mRow {
  id: string
  parkId: string
  snapshotTs: string
  plannedDemand: number
  knownRegisteredExpected: number
  plannedTotal: number
  trafficPressureScore: number
  weatherScore: number
  holidayScore: number
  eventScore: number
  parkingPressureScore: number
  externalDemandPressureScore: number
  additionalDemandLow: number
  additionalDemandMid: number
  additionalDemandHigh: number
  expectedAttendanceLow: number
  expectedAttendanceMid: number
  expectedAttendanceHigh: number
  status: AttendanceRiskForecastStatus
  confidenceScore: number
  recommendationsJson?: string[] | null
  explanationJson?: Record<string, unknown> | null
  /** API aliases (same run as legacy fields). */
  knownRegisteredDemand?: number
  riskLevel?: AttendanceRiskForecastStatus
  estimatedAdditionalDemandLow?: number
  estimatedAdditionalDemandMid?: number
  estimatedAdditionalDemandHigh?: number
  totalExpectedAttendanceLow?: number
  totalExpectedAttendanceMid?: number
  totalExpectedAttendanceHigh?: number
  explanation?: Record<string, unknown> | null
  createdAt?: string
  updatedAt?: string
}

/** GET /api/v1/parks/:parkSlug/geo/pressure/live */
export interface GeoPressureContributor {
  assetId: string
  slug: string
  name: string
  contribution: number
}

export interface GeoPressureCell {
  lat: number
  lng: number
  pressureScore: number
  status: string
  topContributors: GeoPressureContributor[]
}

export interface GeoPressureEntity {
  assetId: string
  entityType: string
  slug: string
  name: string
  lat: number | null
  lng: number | null
  zoneSlug: string | null
  waitMinutes: number | null
  pressureScore: number
  status: string
  theoreticalQueuePeople: number | null
  stressFactor: number | null
  influenceRadiusM: number
  downtimeActive: boolean
  capacityPerHour: number | null
  cycleTimeSec?: number | null
  dispatchIntervalSec?: number | null
}

export interface GeoPressurePayload {
  park: {
    id: string
    slug: string
    name: string
    latitude: number | null
    longitude: number | null
    externalEntityId: string | null
  }
  generatedAt: string
  mode: string
  forecastProvider?: string | null
  entities: GeoPressureEntity[]
  cells: GeoPressureCell[]
  hotspots: Array<{
    assetId: string
    slug: string
    name: string
    entityType: string
    lat: number | null
    lng: number | null
    pressureScore: number
    status: string
    waitMinutes: number | null
  }>
  insights: string[]
  meta: {
    entityCount: number
    withCoords: number
    cellCount: number
    dataCompleteness: {
      ridesWithWaitObservation: number
      openDowntimeAssets: number
    }
  }
}

/** GET /api/v1/parks/:parkSlug/geo/flow/simulation — synthetic process-mining style paths */
export interface GeoFlowSimulationNode {
  id: string
  slug: string
  name: string
  entityType: string
  lat: number
  lng: number
  pressureScore: number
}

export interface GeoFlowSimulationEdge {
  source: string
  target: string
  sourceName: string
  targetName: string
  value: number
}

export interface GeoFlowSimulationTick {
  step: number
  label: string
  links: Array<{ source: string; target: string; value: number }>
}

export interface GeoFlowSimulationPayload {
  park: GeoPressurePayload['park']
  generatedAt: string
  mode: string
  parameters: {
    mode?: string
    guestCount?: number
    transitionCount?: number
    maxHopM?: number
    seed?: number
    topEdges?: number
    assetTypeCode: string | null
    from?: string
    to?: string
  }
  nodes: GeoFlowSimulationNode[]
  edges: GeoFlowSimulationEdge[]
  ticks: GeoFlowSimulationTick[]
  sampleCases: Array<Array<{ slug: string; name: string }>>
  meta: {
    totalEdges?: number
    edgesReturned?: number
    transitionsSimulated?: number
    guestsSimulated?: number
    /** e.g. LOG_NO_TRANSITIONS when from_log has no edges */
    code?: string
    message?: string
    eventsInWindow?: number
    casesWithPath?: number
    casesInWindow?: number
  }
}

/** GET /api/v1/parks/:parkId/operational-context */
export interface PlatformOperationalContext {
  park: {
    id: string
    name: string
    slug: string
    timezone?: string | null
    externalParkKey: string | null
  }
  at: string
  bucketAt: string
  localDate: string
  localHour: number
  /** Meteorologische Saison (1–4), gleiches Schema wie Feature Store */
  season: {
    code: number | null
    labelDe: string | null
    labelEn: string | null
  }
  calendar: Record<string, unknown> | null
  operatingHours: {
    /** `MASTER_DATA` when `parks.enrichment.defaultOperatingHours` overrides ThemeParks snapshots. */
    scheduleProvider: string | null
    scheduleRow: Record<string, unknown> | null
    summary: {
      date?: string | null
      type?: string
      summaryDe?: string | null
      openingTime?: string | null
      closingTime?: string | null
    } | null
    scheduleSampledAt: string | null
    withinScheduledOperatingHours: boolean | null
    interpretation: string
  }
  latestFeatureSnapshot: Record<string, unknown> | null
}

export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface IncidentUserBrief {
  id: string
  email: string
  firstName: string
  lastName: string
  displayName?: string | null
}

export interface Incident {
  id: string
  parkId: string
  status: IncidentStatus
  severity: IncidentSeverity
  title: string
  description: string | null
  ownerUserId: string | null
  createdByUserId: string
  linkedEntityType: string | null
  linkedEntityId: string | null
  slaDueAt: string | null
  createdAt: string
  updatedAt: string
  owner: IncidentUserBrief | null
  creator: IncidentUserBrief | null
}

export interface IncidentListPayload {
  items: Incident[]
  total: number
  limit: number
  offset: number
}

/** GET /api/v1/ai/forecast-accuracy/zone-crowd */
export interface ZoneCrowdForecastAccuracy {
  targetMetric: string
  subjectType: string
  horizonMinutes: number
  days: number
  matchedPoints: number
  forecastsConsidered: number
  overallMae: number | null
  zones: Array<{ zoneId: string; zoneName: string; mae: number; count: number }>
}

/** GET /api/v1/ai/timeseries/rides/:assetId (requires X-Park-Id) */
export interface RideWaitTimeseriesResponse {
  parkId: string
  assetId: string
  assetName: string
  range: { from: string; to: string }
  waitSamples: Array<{
    id: string
    waitTime: number | null
    sampledAt: string
    provider: string
    status: string | null
    isOpen: boolean | null
    parkAssetId: string | null
    externalEntityId: string
    externalParkId: string
  }>
  weather: Array<{
    id: string
    condition: string
    temperatureC: number | null
    rainMm: number | null
    windKmh: number | null
    source: string | null
    parkId: string | null
    internalParkId: string | null
    observedAt: string
  }>
  calendar: Array<{
    id: string
    contextDate: string
    isPublicHoliday: boolean
    isSchoolBreak: boolean
    holidayName: string | null
    regionCode: string | null
    source: string
    extra: Record<string, unknown>
  }>
}

export type PlatformAsset = Record<string, unknown>

/** GET /api/v1/assets/oee/reason-codes */
export interface OeeReasonCodeRow {
  code: string
  labelDe: string
}

/** asset_downtime_events row */
export interface AssetDowntimeEventRow {
  id: string
  assetId: string
  parkId: string
  startedAt: string
  endedAt: string | null
  planned: boolean
  reasonCode: string
  notes: string | null
  source: string
  createdByUserId: string | null
  createdAt?: string
  updatedAt?: string
  createdBy?: { id: string; email: string; firstName: string; lastName: string } | null
}

/** Verfügbarkeit nur innerhalb geplanter Parköffnung (Stammdaten / Kalender). */
export interface AssetAvailabilityDuringParkHours {
  available: boolean
  operatingWindowMinutes: number
  plannedDowntimeMinutes: number
  unplannedDowntimeMinutes: number
  availabilityPct: number | null
  labelDe: string | null
  scheduleProvider: string | null
  scheduleProviderLabelDe: string | null
  timezone: string | null
  localDates: string[]
  window: { from: string; to: string } | null
  methodology: string
}

/** GET /api/v1/assets/:assetId/oee/availability-summary */
export interface AssetAvailabilitySummary {
  assetId: string
  window: { from: string; to: string }
  windowMinutes: number
  plannedDowntimeMinutes: number
  unplannedDowntimeMinutes: number
  availabilityPct: number | null
  duringParkHours: AssetAvailabilityDuringParkHours
  effectiveAvailabilityPct: number | null
  targetAvailabilityPct: number | null
  deltaVsTargetPct: number | null
  methodology: string
}

/** GET …/oee/downtime-reason-pareto — Ausfallminuten je Grund im Fenster (Pareto). */
export interface AssetDowntimeParetoItem {
  reasonCode: string
  durationMs: number
  durationMinutes: number
  sharePct: number
  cumulativeSharePct: number
  labelDe: string
}

export interface AssetDowntimeParetoPayload {
  assetId: string
  window: { from: string; to: string }
  plannedScope: 'all' | 'planned' | 'unplanned'
  totalDowntimeMinutes: number
  items: AssetDowntimeParetoItem[]
}

/** Snapshot beim Speichern — Stillstände + optional Vorfälle (Feldname DB/Migration: downtime_snapshot). */
export interface ShiftHandoverIncidentSnapshot {
  createdInWindow: number
  /** Aktuell offene Vorfälle im Park (OPEN / IN_PROGRESS), Stand beim Speichern. */
  openActiveTotal: number
  openActiveHighOrCritical: number
}

export interface ShiftHandoverStoredSnapshot {
  window: { from: string; to: string }
  /** Nur bei neuen Einträgen; ältere Snapshots können scope ohne label haben */
  scope?: { kind: 'PARK' | 'PARK_ASSET'; assetId?: string; label?: string | null }
  downtimeEventCount?: number
  openDowntimeCount?: number
  plannedEventsInWindow?: number
  unplannedEventsInWindow?: number
  /** Ausfallminuten im Schichtfenster (gekappt), seit Backend-Erweiterung */
  plannedDowntimeMinutes?: number
  unplannedDowntimeMinutes?: number
  incidents?: ShiftHandoverIncidentSnapshot
}

export interface ShiftHandoverTask {
  id: string
  title: string
  ownerUserId?: string | null
  dueAt?: string | null
  status: 'OPEN' | 'DONE' | 'CANCELLED'
  doneAt?: string | null
  createdAt?: string | null
}

export interface ShiftHandoverDiffSnapshot {
  previousEntryId: string
  previousWindowFrom?: string | null
  previousWindowTo?: string | null
  currentWindowFrom?: string | null
  currentWindowTo?: string | null
  delta?: {
    downtimeEventCount?: number
    openDowntimeCount?: number
    plannedDowntimeMinutes?: number
    unplannedDowntimeMinutes?: number
    incidentsCreatedInWindow?: number
    incidentsOpenActiveTotal?: number
    incidentsOpenHighOrCritical?: number
  }
}

/** GET|POST /api/v1/parks/:parkId/shift-handovers */
export interface ShiftHandoverRow {
  id: string
  parkId: string
  windowFrom: string
  windowTo: string
  shiftLabel: string | null
  /** PARK_ASSET + UUID oder leer = parkweit */
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  downtimeSnapshot: ShiftHandoverStoredSnapshot | null
  followUpTasks?: ShiftHandoverTask[]
  diffSnapshot?: ShiftHandoverDiffSnapshot | null
  acknowledgedAt?: string | null
  acknowledgedByUserId?: string | null
  acknowledgementNote?: string | null
  reminderDueAt?: string | null
  reminderSentAt?: string | null
  notes: string
  createdByUserId: string | null
  createdAt?: string
  updatedAt?: string
  createdBy?: { id: string; email: string; firstName: string; lastName: string } | null
  acknowledgedBy?: { id: string; email: string; firstName: string; lastName: string } | null
}

export interface AssetRuntimeOverride {
  id: string
  assetId: string
  payload: Record<string, unknown>
  validFrom?: string | null
  validTo?: string | null
  active: boolean
  createdAt?: string
  updatedAt?: string
}

export interface PlatformObservation {
  id?: string
  assetId?: string
  metricCode?: string
  metricValue?: string
  unit?: string | null
  timestamp?: string
  source?: string
  asset?: { name?: string; parkId?: string }
}

export interface ThemeParksSyncResult {
  parkId: string
  zoneId: string
  assetsUpserted: number
  coordsBackfilled?: number
  parentsLinked: number
  observationsInserted: number
  mqttPublishes: number
  /** ThemeParks.wiki park entity UUID when sync was driven from Integration settings. */
  externalParkId?: string
}

export interface MdmRideMaster {
  id: string
  parkId: string
  parkZoneId: string
  rideTypeId: string
  internalRideId?: string | null
  externalId?: string | null
  name: string
  shortName?: string | null
  description?: string | null
  manufacturer?: string | null
  model?: string | null
  buildYear?: number | null
  commissioningDate?: string | null
  lifecycleStatus: string
  activeFlag: boolean
  park?: MdmPark
  parkZone?: MdmParkZone
  rideType?: MdmRideType
  operations?: Record<string, unknown>
  capacity?: Record<string, unknown>
  staffing?: Record<string, unknown>
  safety?: Record<string, unknown>
  guestRules?: Record<string, unknown>
  integration?: Record<string, unknown>
  kpiTargets?: Record<string, unknown>
  staffRoles?: Array<Record<string, unknown>>
  documents?: Array<Record<string, unknown>>
  createdAt?: string
  updatedAt?: string
}

/** Read-only UNS extension metadata (`GET .../extensions`). */
export interface RideMasterExtensionsCapabilities {
  hasQueueSignal: boolean
  hasCycleSignal: boolean
  hasEnergyMetering: boolean
  supportsGreenOptimization: boolean
}

export interface RideMasterExtensionsSignalEntry {
  enabled: boolean
  mlEligible: boolean
  boardEligible: boolean
}

export interface RideMasterExtensionsRead {
  entityType: 'ride' | 'park_asset'
  entityId: string
  domains: string[]
  signals: Record<string, RideMasterExtensionsSignalEntry>
  capabilities: RideMasterExtensionsCapabilities
}

/**
 * Phase F — Add-on Board widget: one row derived from extension metadata
 * (`enabled` + `boardEligible`, from `GET .../extensions`). Not a separate API envelope field.
 */
export interface AddonBoardSignalSourceCandidate {
  signalKey: string
  domain: string
  metric: string
  sourceType: 'SIGNAL_METADATA'
  boardEligible: true
  enabled: true
  mlEligible: boolean
}

/** PATCH `/mdm/rides/.../extensions` and `/assets/.../extensions` (Phase E). */
export interface RideMasterExtensionsPatchBody {
  schemaVersion?: number
  domains?: string[]
  signals?: Record<string, RideMasterExtensionsSignalEntry | null>
  capabilities?: Partial<RideMasterExtensionsCapabilities>
  /** When true, `signals` replaces the entire map (recommended for UI saves). */
  replaceSignals?: boolean
}

/** Persisted guest / ticket planning grid (visit planning versions API). */
export interface VisitPlanHotelRow {
  id: string
  name: string
}

export interface VisitPlanPayload {
  schemaVersion: 2
  hotels: VisitPlanHotelRow[]
  guestCounts: Record<string, number>
}

export interface VisitPlanVersionSummary {
  id: string
  name: string
  planYear: number
  createdAt: string
  updatedAt: string
}

export interface VisitPlanDetail extends VisitPlanVersionSummary {
  payload: VisitPlanPayload
}

export interface VisitPlanImportSummary {
  cellsWritten: number
  cellsCleared: number
  unknownRowKeys: string[]
  ignoredColumns: string[]
}

/** Stored actual visits (Ist) per park and calendar year (`/api/v1/visit-actuals`). */
export interface VisitActualYearRecord {
  actualYear: number
  guestCounts: Record<string, number>
  updatedAt: string | null
}

export interface VisitPlanForecastSummary {
  cellsFilled: number
  cellsSkippedExisting: number
  cellsSkippedNoSource: number
}

/** Agentic runs (`/api/v1/agent/...`), park-scoped via `X-Park-Id`. */
export type AgentSkillId =
  | 'daily_executive_brief'
  | 'crowd_spike_triage'
  | 'mapping_assistant'
  | 'weather_pivot'
  | 'ride_down_response'

export interface AgentRunBrief {
  id: string
  skillId: string
  mode?: string | null
  status: string
  startedAt: string | null
}

/** Phase C — persisted when proposal is applied/rejected (forecast bridge stub + resolution). */
export type AgentActionOutcomeMetric = Record<string, unknown>

export interface AgentPendingActionItem {
  id: string
  runId: string
  stepId: string | null
  actionType: string
  status: string
  payloadJson: Record<string, unknown> | null
  outcomeMetric?: AgentActionOutcomeMetric | null
  expiresAt: string | null
  createdAt: string | null
  run: AgentRunBrief | null
}

export interface AgentRunSummary {
  id: string
  parkId: string
  skillId: string
  mode: string
  triggerType: string
  triggerRef: string | null
  status: string
  startedAt: string | null
  finishedAt: string | null
  createdByUserId: string | null
  errorMessage: string | null
}

export interface AgentStepRow {
  id: string
  runId: string
  stepIndex: number
  stepType: string
  title: string | null
  detailJson: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

export interface AgentRunActionRow {
  id: string
  runId: string
  stepId: string | null
  actionType: string
  status: string
  payloadJson: Record<string, unknown> | null
  resultJson: Record<string, unknown> | null
  outcomeMetric?: AgentActionOutcomeMetric | null
  expiresAt: string | null
  targetType: string | null
  targetId: string | null
  approvedByUserId: string | null
  approvedAt: string | null
  rejectedReason: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface AgentRunDetail extends AgentRunSummary {
  inputJson: Record<string, unknown> | null
  outputSummary: string | null
  metaJson: Record<string, unknown> | null
  steps: AgentStepRow[]
  actions: AgentRunActionRow[]
}

export interface AgentRunsListPayload {
  items: AgentRunSummary[]
  total: number
  limit: number
  offset: number
}

export interface AgentPendingActionsPayload {
  items: AgentPendingActionItem[]
  total: number
  limit: number
  offset: number
}

/** `POST /api/v1/agent/preflight` — Phase C simulator / regression checklist (stub). */
export interface AgentPreflightChecklistItem {
  id: string
  ok: boolean
  detail?: string | null
}

export interface AgentPreflightSourceRunSummary {
  id: string
  skillId: string
  status: string
  mode?: string | null
  triggerType?: string | null
  stepCount: number
  actionCount: number
  skillMismatch?: boolean
}

export interface AgentPreflightDryRunToolRow {
  name: string
  ok: boolean
  ms: number
  summary?: string
  error?: string
}

/** Read-only tool chain executed during preflight (no persisted agent run). */
export interface AgentPreflightDryRun {
  allOk: boolean
  skipped: boolean
  tools: AgentPreflightDryRunToolRow[]
}

export interface AgentPreflightPayload {
  ok: boolean
  skillId: string
  parkId: string
  phase: string
  contextHints: string[]
  checklist: AgentPreflightChecklistItem[]
  sourceRun: AgentPreflightSourceRunSummary | null
  dryRun?: AgentPreflightDryRun | null
  /** Present after server adds Phase C approval gate (rolling write metrics). */
  approvalMetrics?: AgentApprovalMetricsPayload | null
  approvalGateMin?: number | null
}

/** `GET /api/v1/agent/approval-metrics` — write proposal counts / approval rate for the park window. */
export interface AgentApprovalMetricsPayload {
  parkId: string
  skillFilter: string | null
  windowDays: number
  since: string
  applied: number
  rejected: number
  failed: number
  expired: number
  pending: number
  decided: number
  approvalRate: number | null
  bySkill: Record<string, Record<string, number>>
}
