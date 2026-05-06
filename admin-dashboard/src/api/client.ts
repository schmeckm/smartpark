import type {
  AdapterManifestUi,
  AdapterPackageDto,
  AdapterPackageHealthData,
  AdapterPackagesResponse,
  AdapterRunLocalBody,
  AdapterRunLocalResult,
  AssetRuntimeOverride,
  CanonicalInboundMessage,
  ExternalEntityMapping,
  MdmPark,
  MdmParkZone,
  MdmRideMaster,
  MdmRideProfile,
  MdmRideTemplate,
  MdmRideType,
  PlatformAsset,
  PlatformObservation,
  PlatformPark,
  GeoPressurePayload,
  GeoFlowSimulationPayload,
  PlatformOperationalContext,
  OeeReasonCodeRow,
  AssetDowntimeEventRow,
  AssetAvailabilitySummary,
  AssetDowntimeParetoPayload,
  ShiftHandoverRow,
  VisitActualYearRecord,
  VisitPlanDetail,
  VisitPlanForecastSummary,
  VisitPlanImportSummary,
  VisitPlanPayload,
  VisitPlanVersionSummary,
  Incident,
  IncidentListPayload,
  IncidentStatus,
  ThemeParksSyncResult,
  ZoneCrowdForecastAccuracy,
  RideWaitTimeseriesResponse,
  ProviderAdapterInfo,
  Recommendation,
  RecommendationScoringSummary,
  Ride,
  RideMasterExtensionsRead,
  RideMasterExtensionsPatchBody,
  Staff,
  Zone,
} from '@/types/api'
import type { AuditLogRow } from '@/types/auth'
import { apiParkHeaders } from '@/utils/apiParkContext'

function defaultHttpPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80'
}

function effectivePort(u: URL): string {
  return u.port || defaultHttpPort(u.protocol)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * In dev, use same-origin relative `/api/...` when VITE_API_URL is unset so Vite's `server.proxy`
 * forwards to the API (see vite.config.ts).
 *
 * Ignore VITE_API_URL when it clearly targets the dev UI instead of the API:
 * - Same origin as the page.
 * - Both loopback hosts and same port (e.g. `http://localhost:5173` in env but the tab is
 *   `http://127.0.0.1:5173`).
 * - Loopback in env, non-loopback page, same port (e.g. env `http://localhost:5173` but the tab
 *   is `http://192.168.x.x:5173` — calling localhost from that tab would be wrong; relative /api
 *   uses the Vite proxy on the tab host).
 */
function resolveApiOrigin(): string {
  const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  if (import.meta.env.DEV && typeof globalThis.window !== 'undefined') {
    try {
      const configured = new URL(raw)
      const page = new URL(globalThis.window.location.href)
      if (configured.origin === page.origin) {
        console.warn(
          '[Smart Park] VITE_API_URL matches the dev UI origin — ignoring it so /api uses the Vite proxy. Unset VITE_API_URL or set it to the API (e.g. http://localhost:3000).'
        )
        return ''
      }
      const samePort = effectivePort(configured) === effectivePort(page)
      const loopbackLoopbackSamePort =
        samePort && isLoopbackHost(configured.hostname) && isLoopbackHost(page.hostname)
      const loopbackEnvButLanUi =
        samePort && isLoopbackHost(configured.hostname) && !isLoopbackHost(page.hostname)
      if (loopbackLoopbackSamePort || loopbackEnvButLanUi) {
        console.warn(
          '[Smart Park] VITE_API_URL looks like the dev UI host/port — ignoring it so /api uses the Vite proxy. Point VITE_API_URL at the API (e.g. http://localhost:3000) or leave it unset.'
        )
        return ''
      }
    } catch {
      /* invalid URL — fall through */
    }
  }
  return raw
}

const origin = resolveApiOrigin()

function url(path: string) {
  if (path.startsWith('http')) return path
  return `${origin}${path}`
}

/** Non-OK API responses from {@link fetchEnvelope}; includes `code` and `details` when the API sends them. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem('sp_access_token')
}

export async function fetchAdapterAssetText(assetUrl: string): Promise<string> {
  const token = getAccessToken()
  const res = await fetch(url(assetUrl), {
    headers: {
      Accept: 'text/markdown, text/plain, */*',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(res.statusText || `HTTP ${res.status}`)
  }
  return res.text()
}

async function fetchEnvelope<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken()
  const res = await fetch(url(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...apiParkHeaders(),
      ...init?.headers,
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { message: text }
  }
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    }
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : res.statusText
    const code =
      typeof body === 'object' && body && 'code' in body && (body as { code?: unknown }).code != null
        ? String((body as { code: unknown }).code)
        : undefined
    const details =
      typeof body === 'object' && body && 'details' in body
        ? (body as { details: unknown }).details
        : undefined
    throw new ApiRequestError(msg || `HTTP ${res.status}`, res.status, code, details)
  }
  if (res.status === 204) return undefined as T
  const env = body as { success?: boolean; data: T }
  return env.data
}

export async function getZones(): Promise<Zone[]> {
  return fetchEnvelope<Zone[]>('/api/v1/zones')
}

export async function getRides(): Promise<Ride[]> {
  return fetchEnvelope<Ride[]>('/api/v1/rides')
}

export async function getStaff(): Promise<Staff[]> {
  return fetchEnvelope<Staff[]>('/api/v1/staff')
}

export type StaffWritePayload = {
  firstName: string
  lastName: string
  employeeNumber?: string | null
  supervisorId?: string | null
  role: Staff['role']
  currentZoneId?: string | null
  available?: boolean
  skillLevel?: number
}

export async function createStaff(payload: StaffWritePayload): Promise<Staff> {
  return fetchEnvelope<Staff>('/api/v1/staff', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateStaffMember(id: string, patch: Partial<StaffWritePayload>): Promise<Staff> {
  return fetchEnvelope<Staff>(`/api/v1/staff/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteStaffMember(id: string): Promise<void> {
  return fetchEnvelope<void>(`/api/v1/staff/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export type StaffExportBundle = {
  schemaVersion: number
  entityType: 'staff'
  generatedAt: string
  totalExported: number
  items: Staff[]
}

export type StaffImportResult = {
  entityType: string
  appliedCount: number
  appliedIds: string[]
  failedCount: number
  failed: Array<{ id?: string; error: string; code?: string }>
}

export async function exportStaffBundle(): Promise<StaffExportBundle> {
  return fetchEnvelope<StaffExportBundle>('/api/v1/staff/export')
}

export async function importStaffBundle(body: {
  schemaVersion?: number
  items: Array<StaffWritePayload & { id?: string }>
}): Promise<StaffImportResult> {
  return fetchEnvelope<StaffImportResult>('/api/v1/staff/import', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function readStaffImportErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string }
    if (j?.message) return j.message
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`
}

export async function exportStaffXlsxBlob(): Promise<Blob> {
  const token = getAccessToken()
  const res = await fetch(url('/api/v1/staff/export/xlsx'), {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readStaffImportErrorMessage(res))
  }
  return res.blob()
}

/** Multipart field name: `file` */
export async function importStaffXlsx(file: File): Promise<StaffImportResult> {
  const token = getAccessToken()
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(url('/api/v1/staff/import/xlsx'), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: fd,
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readStaffImportErrorMessage(res))
  }
  const env = (await res.json()) as { success?: boolean; data?: StaffImportResult }
  if (!env.success || !env.data) throw new Error('Invalid import response')
  return env.data
}

export async function getRecommendations(): Promise<Recommendation[]> {
  return fetchEnvelope<Recommendation[]>('/api/v1/recommendations')
}

export async function updateRecommendationStatus(
  id: string,
  status: Recommendation['status']
): Promise<Recommendation> {
  return fetchEnvelope<Recommendation>(`/api/v1/recommendations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function getAuditLogs(params?: { limit?: number; offset?: number }): Promise<{
  data: AuditLogRow[]
  meta: { total: number; limit: number; offset: number }
}> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/audit-logs${qs ? `?${qs}` : ''}`), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error((body as { message?: string }).message || res.statusText)
  }
  return {
    data: (body as { data: AuditLogRow[] }).data,
    meta: (body as { meta: { total: number; limit: number; offset: number } }).meta,
  }
}

export type MqttStatus = {
  enabled: boolean
  connected: boolean
  lastError: string | null
  broker: string | null
  clientId: string
  topics: string[]
}

export async function getMqttStatus(): Promise<MqttStatus> {
  return fetchEnvelope<MqttStatus>('/api/v1/mqtt/status')
}

export type IntegrationLog = {
  id: string
  eventType: string | null
  status: string
  topic: string | null
  sourceSystem: string
  errorMessage: string | null
  createdAt: string
}

export async function getIntegrationLogs(p?: { limit?: number; offset?: number }): Promise<{
  data: IntegrationLog[]
  meta: { total: number; limit: number; offset: number }
}> {
  const q = new URLSearchParams()
  if (p?.limit != null) q.set('limit', String(p.limit))
  if (p?.offset != null) q.set('offset', String(p.offset))
  const qs = q.toString()
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/integration/logs${qs ? `?${qs}` : ''}`), {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error((body as { message?: string }).message || res.statusText)
  }
  return {
    data: (body as { data: IntegrationLog[] }).data,
    meta: (body as { meta: { total: number; limit: number; offset: number } }).meta,
  }
}

export type WeatherCurrent = {
  id: string
  condition: string
  temperatureC: number | null
  rainMm: number | null
  windKmh: number | null
  source: string | null
  parkId: string | null
  observedAt: string
} | null

export async function getCurrentWeather(): Promise<WeatherCurrent> {
  return fetchEnvelope<WeatherCurrent>('/api/v1/weather/current')
}

export type DqIssue = {
  id: string
  issueType: string
  severity: string
  message: string | null
  resolved: boolean
  createdAt: string
}

export async function getDataQualityIssues(
  p?: { limit?: number; offset?: number; resolved?: boolean }
): Promise<{ data: DqIssue[]; meta: { total: number; limit: number; offset: number } }> {
  const q = new URLSearchParams()
  if (p?.limit != null) q.set('limit', String(p.limit))
  if (p?.offset != null) q.set('offset', String(p.offset))
  if (p?.resolved === true) q.set('resolved', 'true')
  if (p?.resolved === false) q.set('resolved', 'false')
  const qs = q.toString()
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/data-quality/issues${qs ? `?${qs}` : ''}`), {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error((body as { message?: string }).message || res.statusText)
  }
  return {
    data: (body as { data: DqIssue[] }).data,
    meta: (body as { meta: { total: number; limit: number; offset: number } }).meta,
  }
}

export async function resolveDataQualityIssue(id: string): Promise<DqIssue> {
  return fetchEnvelope<DqIssue>(`/api/v1/data-quality/issues/${id}/resolve`, { method: 'PATCH' })
}

export async function getSimulatorStatus(): Promise<{ running: boolean; scenarios: string[] }> {
  return fetchEnvelope('/api/v1/simulator/status')
}

export async function startSimulator(): Promise<unknown> {
  return fetchEnvelope('/api/v1/simulator/start', { method: 'POST' })
}

export async function stopSimulator(): Promise<unknown> {
  return fetchEnvelope('/api/v1/simulator/stop', { method: 'POST' })
}

export async function runScenario(name: string): Promise<unknown> {
  return fetchEnvelope('/api/v1/simulator/scenario', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export type AttractionOeeSimOeeWindow = {
  availability: number
  performance: number
  quality: number
  oee: number
  samples: number
}

export type AttractionOeeSimAttractionStatus = {
  assetId?: string | null
  slug: string
  displayName: string
  state: string
  scenario: string
  metricsPreview: {
    dispatches: number
    guestsIn: number
    guestsOut: number
    virtualLineEnabled?: boolean
    /** OEE sim: ISO reason when in FAULT / MAINTENANCE / WEATHER_HOLD */
    downtimeReasonCode?: string | null
    downtimeSec?: number | null
    disturbanceActive?: boolean
  }
  queue?: { occupancy: number; capacityLimit: number; overcapacity: boolean } | null
  oee: {
    oee5m: AttractionOeeSimOeeWindow
    oee15m: AttractionOeeSimOeeWindow
    shift: AttractionOeeSimOeeWindow
    daily: AttractionOeeSimOeeWindow
  }
}

export type AttractionOeeSimStatus = {
  running: boolean
  config: {
    parkSlug: string
    parkId?: string | null
    groupId: string
    edgeNodeId: string
    publishMs: number
    scenario: string
    randomSeed: number
    attractions: string[]
  }
  attractions: AttractionOeeSimAttractionStatus[]
}

export type AttractionOeeSimCandidate = {
  assetId: string
  slug: string
  name: string
  parkId: string
  rideMaster: Record<string, unknown>
}

export async function getAttractionOeeSimulatorCandidates(parkId: string): Promise<AttractionOeeSimCandidate[]> {
  return fetchEnvelope(
    `/api/v1/simulator/attraction-oee/candidates?parkId=${encodeURIComponent(parkId)}`
  )
}

export async function getAttractionOeeSimulatorStatus(): Promise<AttractionOeeSimStatus> {
  return fetchEnvelope('/api/v1/simulator/attraction-oee/status')
}

export async function startAttractionOeeSimulator(
  body?: Record<string, unknown>
): Promise<{ ok?: boolean; alreadyRunning?: boolean; config?: AttractionOeeSimStatus['config']; error?: string }> {
  return fetchEnvelope('/api/v1/simulator/attraction-oee/start', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  })
}

export async function stopAttractionOeeSimulator(): Promise<{ ok?: boolean; stopped?: boolean }> {
  return fetchEnvelope('/api/v1/simulator/attraction-oee/stop', { method: 'POST' })
}

export async function setAttractionOeeSimulatorScenario(
  name: string
): Promise<{ ok?: boolean; scenario?: string; error?: string }> {
  return fetchEnvelope('/api/v1/simulator/attraction-oee/scenario', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export type AiHotspotRow = {
  zoneId: string
  zoneName: string
  maxCapacity: number
  predictedCrowdLevel: number
  crowdRatio: number
  confidence: number | null
  forecastId: string
  producedAt: string
}

export type AiInsightsSummary = {
  topHotspotZones: AiHotspotRow[]
  highestPredictedCrowdRatio: number
  forecastHorizonMinutes: number
  averageConfidence: number | null
  confidence: number | null
  generatedAt: string
  model: { modelName: string; modelType: string; version: string }
}

export async function getAiInsightsSummary(): Promise<AiInsightsSummary> {
  return fetchEnvelope<AiInsightsSummary>('/api/v1/ai/insights/summary')
}

export type AiStudioCatalog = {
  entityTypes: Array<{ code: string; targets: string[]; assetTypeCode: string | null }>
  features: Array<{ code: string; label: string }>
  featureStoreTrainFeatures?: string[]
  datasets?: Array<{ code: string; description: string }>
  manualAlgorithms: Array<{ code: string; label: string }>
  hierarchy: Array<{ scope: string; description: string }>
  predictionOrder: string[]
}

export type AiStudioFeatureStorePreview = {
  snapshotBucketRows: number
  labeledHorizonRows: number
  dateFrom: string | null
  dateTo: string | null
  horizonMinutes: number
}

export type AiStudioDatasetStats = {
  parkId: string
  entityType: string
  entityId: string | null
  rowCount: number
  parkSnapshotCount: number
  entitySampleCount: number
  missingRate: number
  seasonalityScore: number
  volatilityScore: number
  windowDays: number
  featureStorePreview?: AiStudioFeatureStorePreview | null
}

/** Phase P — persisted ML Studio feature draft (app_settings), scoped by park + entity. */
export type AiStudioFeatureDraft = {
  entityType: 'ride' | 'park_asset'
  entityId: string
  datasetScope: 'single_asset'
  selectedSignalKeys: string[]
  updatedAt?: string
}

export type AiStudioModelRow = {
  id: string
  parkId: string
  modelScope: string
  entityType: string
  entityId: string | null
  targetVariable: string
  featuresJson: string[]
  strategy: string
  algorithm: string
  version: number
  mae: number | null
  rmse: number | null
  r2: number | null
  lastTrainingAt: string
  activeFlag: boolean
  modelPayload: Record<string, unknown>
  featureImportanceJson: Record<string, number>
  evalHoldoutJson: {
    points: Array<{ i: number; actual: number; predicted: number }>
    holdoutRows?: number
  } | null
  datasetSnapshotJson: AiStudioDatasetStats | null
}

export async function getAiStudioCatalog(): Promise<AiStudioCatalog> {
  return fetchEnvelope<AiStudioCatalog>('/api/v1/ai/studio/catalog')
}

export async function getAiStudioDatasetStats(params: {
  entityType: string
  entityId?: string | null
  dataset?: 'FEATURE_STORE' | 'SANDBOX'
}): Promise<AiStudioDatasetStats> {
  const q = new URLSearchParams()
  q.set('entityType', params.entityType)
  if (params.entityId) q.set('entityId', params.entityId)
  if (params.dataset) q.set('dataset', params.dataset)
  return fetchEnvelope<AiStudioDatasetStats>(`/api/v1/ai/studio/dataset-stats?${q}`)
}

export async function getAiStudioFeatureDraft(params: {
  entityType: 'ride' | 'park_asset'
  entityId: string
  datasetScope?: 'single_asset'
}): Promise<AiStudioFeatureDraft | null> {
  const q = new URLSearchParams()
  q.set('entityType', params.entityType)
  q.set('entityId', params.entityId)
  q.set('datasetScope', params.datasetScope ?? 'single_asset')
  return fetchEnvelope<AiStudioFeatureDraft | null>(`/api/v1/ai/studio/feature-drafts?${q}`)
}

export async function putAiStudioFeatureDraft(body: {
  entityType: 'ride' | 'park_asset'
  entityId: string
  datasetScope?: 'single_asset'
  selectedSignalKeys: string[]
}): Promise<AiStudioFeatureDraft> {
  return fetchEnvelope<AiStudioFeatureDraft>('/api/v1/ai/studio/feature-drafts', {
    method: 'PUT',
    body: JSON.stringify({
      ...body,
      datasetScope: body.datasetScope ?? 'single_asset',
    }),
  })
}

export async function listAiStudioModels(params?: {
  entityType?: string
  targetVariable?: string
  modelScope?: string
  activeOnly?: boolean
  limit?: number
}): Promise<AiStudioModelRow[]> {
  const q = new URLSearchParams()
  if (params?.entityType) q.set('entityType', params.entityType)
  if (params?.targetVariable) q.set('targetVariable', params.targetVariable)
  if (params?.modelScope) q.set('modelScope', params.modelScope)
  if (params?.activeOnly === true) q.set('activeOnly', 'true')
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<AiStudioModelRow[]>(`/api/v1/ai/studio/models${qs ? `?${qs}` : ''}`)
}

export async function getAiStudioModel(id: string): Promise<AiStudioModelRow> {
  return fetchEnvelope<AiStudioModelRow>(`/api/v1/ai/studio/models/${encodeURIComponent(id)}`)
}

export async function postAiStudioTrain(body: {
  entityType: string
  entityId?: string | null
  targetVariable: string
  features: string[]
  strategy: 'AUTO' | 'MANUAL'
  algorithm?: string | null
  dataset?: 'FEATURE_STORE' | 'SANDBOX'
  horizonMinutes?: number
}): Promise<AiStudioModelRow> {
  return fetchEnvelope<AiStudioModelRow>('/api/v1/ai/studio/models/train', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function patchAiStudioModelActivate(id: string, activeFlag: boolean): Promise<AiStudioModelRow> {
  return fetchEnvelope<AiStudioModelRow>(`/api/v1/ai/studio/models/${encodeURIComponent(id)}/activate`, {
    method: 'PATCH',
    body: JSON.stringify({ activeFlag }),
  })
}

export async function postAiStudioPredict(body: {
  entityType: string
  entityId?: string | null
  targetVariable: string
  features?: Record<string, number>
  featureSource?: 'manual' | 'latest_snapshot'
}): Promise<{
  value: number
  fallback: boolean
  featureSource: string
  resolvedSnapshotAt: string | null
  snapshotMeta?: Record<string, unknown> | null
  partialFeaturesWarning?: string | null
  model: {
    modelId: string
    modelScope: string
    entityType: string
    entityId: string | null
    algorithm: string
    version: number
    r2: number | null
    mae: number | null
    rmse: number | null
    stub?: boolean
    dataset?: string
  } | null
  resolution: string
}> {
  return fetchEnvelope('/api/v1/ai/studio/predict', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postAiForecastsRefresh(): Promise<{
  sampledZones: number
  forecastsCreated: number
  recommendationsScored?: number
  generatedAt: string
}> {
  return fetchEnvelope('/api/v1/ai/forecasts/refresh', { method: 'POST' })
}

export async function getRecommendationScoringSummary(): Promise<RecommendationScoringSummary> {
  return fetchEnvelope<RecommendationScoringSummary>('/api/v1/ai/recommendations/scoring-summary')
}

export type ForecastInfluencingFactor = {
  feature: string
  impact: string
  detail?: string
  factorGroup?: string
}

/** Per dynamic L1 factor after mergeMlEnterpriseLayer (API omits internal `meta`). */
export type MlFactorCurrentResolution = {
  current: number
  currentSource: string
  calculatedCurrent: number | null
  manualCurrentOverride: number | null
  l1ApiCurrent: number | null
}

export type ParkForecastSummary = {
  externalParkId: string
  externalEntityId?: string | null
  provider: string
  asOf: string | null
  crowdLevelPercent: number | null
  currentAvgWaitMinutes: number | null
  /** Optional explicit current wait from API when distinct from currentAvgWaitMinutes */
  currentWaitMinutes?: number | null
  forecast15Minutes: number | null
  forecast60Minutes: number | null
  trend: 'RISING' | 'STABLE' | 'FALLING'
  confidence: number
  confidenceLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  forecastSource?: string
  /** Present when backend attaches L3 profile code to entity forecast summary */
  mlProfileCode?: string | null
  topInfluencingFactors?: ForecastInfluencingFactor[]
  /**
   * Resolved L1 "Current" multipliers per dynamic factor code (may be `{}` when resolver had nothing to add).
   * Keys match `ml_global_factors.factor_code` (e.g. HOLIDAY_PRESSURE). Values omit server-only `meta`.
   */
  mlFactorCurrents: Record<string, MlFactorCurrentResolution>
  featureDataQuality?: string[]
  /** Informational only (e.g. traffic not wired, optional calendar row); does not set WARNING status */
  featureDataQualityNotes?: string[]
  /** OK = inputs complete enough; WARNING = forecast still returned but external/context features incomplete */
  forecastDataQualityStatus?: 'OK' | 'WARNING'
  snapshotCompletenessScore?: number | null
  snapshotContext?: {
    weather: {
      temperatureC: number | null
      precipitationMm: number | null
      windSpeedKmh: number | null
      weatherCondition: string | null
    }
    calendar: {
      calendarRowConfigured?: boolean
      isPublicHoliday: boolean
      isSchoolHoliday: boolean
      holidayName: string | null
    }
    traffic: { trafficIndex: number | null }
    staffing: { staffingGapNormal: number | null }
    capacity: { theoreticalCapacityPph: number | null }
    parkCrowdIndex: number | null
  }
  factors: Array<{
    code: string
    value: number
    normalized: number
    weight: number
    contribution: number
  }>
  model: { modelName: string; modelType: string; version: string }
  degraded?: boolean
  basis?: 'ENTITY' | 'ENTITY_TYPE' | 'PARK' | 'NONE'
  entityType?: string
}

export type AiFactorConfig = {
  code: string
  label: string
  enabled: boolean
  scope: 'PARK' | 'ENTITY_TYPE' | 'ENTITY'
  weight: number
  lagMinutes: number
  value: number
  source: 'manual' | 'derived'
}

export async function getParkForecastSummary(
  externalParkId: string,
  provider?: string
): Promise<ParkForecastSummary> {
  const q = new URLSearchParams()
  if (provider) q.set('provider', provider)
  const qs = q.toString()
  return fetchEnvelope<ParkForecastSummary>(
    `/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/forecast/summary${qs ? `?${qs}` : ''}`
  )
}

/** Per-ride baseline forecasts (requires ThemeParks-style external park id). */
export async function getParkRideForecastSummaries(
  externalParkId: string,
  params?: { provider?: string; limit?: number }
): Promise<ParkForecastSummary[]> {
  const q = new URLSearchParams()
  if (params?.provider) q.set('provider', params.provider)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<ParkForecastSummary[]>(
    `/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/entities/forecast/summary${qs ? `?${qs}` : ''}`
  )
}

/** Per-entity baseline forecast (includes park/type fallbacks when entity series is thin). */
export async function getEntityForecastSummary(
  externalEntityId: string,
  params: { externalParkId: string; provider?: string; entityType?: string }
): Promise<ParkForecastSummary> {
  const q = new URLSearchParams()
  q.set('externalParkId', params.externalParkId)
  if (params.provider) q.set('provider', params.provider)
  if (params.entityType) q.set('entityType', params.entityType)
  return fetchEnvelope<ParkForecastSummary>(
    `/api/v1/ai/entities/${encodeURIComponent(externalEntityId)}/forecast/summary?${q.toString()}`
  )
}

export async function getAiFactorConfigs(): Promise<AiFactorConfig[]> {
  return fetchEnvelope<AiFactorConfig[]>('/api/v1/ai/factors/config')
}

export type AiTrainingDatasetRow = {
  timestamp: string
  assetId: string | null
  externalEntityId: string
  features: Record<string, unknown>
  target: number | null
  targetQuality: string
}

export type AiTrainingDatasetResponse = {
  target: string
  horizonMinutes: number
  parkId: string
  rows: AiTrainingDatasetRow[]
}

/** ML-ready rows: X = ride_feature_snapshots_5m columns, Y = wait at horizon (nearest bucket). Park from session context. */
export async function getAiTrainingDataset(params?: {
  target?: 'queue_time_15m' | 'queue_time_60m' | 'queue_time_120m'
  limit?: number
}): Promise<AiTrainingDatasetResponse> {
  const q = new URLSearchParams()
  if (params?.target) q.set('target', params.target)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<AiTrainingDatasetResponse>(`/api/v1/ai/training-dataset${qs ? `?${qs}` : ''}`)
}

/** Enterprise ML influence (L1 global factors). */
export type MlGlobalFactorRow = Record<string, unknown>
export async function getMlGlobalFactors(): Promise<MlGlobalFactorRow[]> {
  return fetchEnvelope<MlGlobalFactorRow[]>('/api/v1/ai/global-factors')
}

export type MlGlobalFactorPatch = Partial<{
  factorName: string
  factorGroup: string | null
  description: string | null
  activeFlag: boolean
  weight: number
  lagMinutes: number
  defaultValue: number | null
  currentValue: number | null
  sourceType: string
  unit: string | null
  validFrom: string | null
  validTo: string | null
  notes: string | null
}>

export async function patchMlGlobalFactor(id: string, body: MlGlobalFactorPatch): Promise<MlGlobalFactorRow> {
  return fetchEnvelope<MlGlobalFactorRow>(`/api/v1/ai/global-factors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export type MlParkFactorRow = Record<string, unknown>
export async function getMlParkFactors(parkId: string): Promise<MlParkFactorRow[]> {
  return fetchEnvelope<MlParkFactorRow[]>(`/api/v1/ai/parks/${encodeURIComponent(parkId)}/factors`)
}

export async function patchMlParkFactors(
  parkId: string,
  body: { factors: Array<Record<string, unknown>> }
): Promise<MlParkFactorRow[]> {
  return fetchEnvelope<MlParkFactorRow[]>(`/api/v1/ai/parks/${encodeURIComponent(parkId)}/factors`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** Row from GET /api/v1/ai/ml-profiles (camelCase in JSON). */
export type MlProfileRow = {
  id: string
  profileCode: string
  profileName: string
  entityType: string
  category?: string | null
  activeFlag?: boolean
  modelType?: string | null
  featureSetCode?: string | null
  weatherSensitive?: boolean
  rainSensitive?: boolean
  windSensitive?: boolean
  heatSensitive?: boolean
  weatherSensitivityScore?: number | null
  rainImpactScore?: number | null
  windImpactScore?: number | null
  heatImpactScore?: number | null
  queueElasticityScore?: number | null
  capacityElasticityScore?: number | null
  staffDependencyScore?: number | null
  downtimeRiskScore?: number | null
  maintenanceCriticality?: number | null
  downtimeImpactLevel?: string | null
  maxQueueTargetMin?: number | null
  availabilityTargetPercent?: number | null
  targetThroughputFactor?: number | null
  notes?: string | null
}

export type MlProfileWriteBody = {
  profileCode: string
  profileName: string
  entityType: string
  category?: string | null
  activeFlag?: boolean
  modelType?: string | null
  featureSetCode?: string | null
  weatherSensitive?: boolean
  rainSensitive?: boolean
  windSensitive?: boolean
  heatSensitive?: boolean
  weatherSensitivityScore?: number | null
  rainImpactScore?: number | null
  windImpactScore?: number | null
  heatImpactScore?: number | null
  queueElasticityScore?: number | null
  capacityElasticityScore?: number | null
  staffDependencyScore?: number | null
  downtimeRiskScore?: number | null
  maintenanceCriticality?: number | null
  downtimeImpactLevel?: string | null
  maxQueueTargetMin?: number | null
  availabilityTargetPercent?: number | null
  targetThroughputFactor?: number | null
  notes?: string | null
}

export type MlProfilePatchBody = Partial<Omit<MlProfileWriteBody, 'profileCode'>>

export async function getMlProfiles(params?: {
  entityType?: string
  activeFlag?: boolean
  search?: string
}): Promise<MlProfileRow[]> {
  const q = new URLSearchParams()
  if (params?.entityType) q.set('entityType', params.entityType)
  if (params?.activeFlag != null) q.set('activeFlag', String(params.activeFlag))
  if (params?.search) q.set('search', params.search)
  const qs = q.toString()
  return fetchEnvelope<MlProfileRow[]>(`/api/v1/ai/ml-profiles${qs ? `?${qs}` : ''}`)
}

export async function postMlProfile(body: MlProfileWriteBody): Promise<MlProfileRow> {
  return fetchEnvelope<MlProfileRow>('/api/v1/ai/ml-profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function patchMlProfile(id: string, body: MlProfilePatchBody): Promise<MlProfileRow> {
  return fetchEnvelope<MlProfileRow>(`/api/v1/ai/ml-profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** Sets activeFlag=false (soft deactivate). */
export async function deleteMlProfile(id: string): Promise<MlProfileRow> {
  return fetchEnvelope<MlProfileRow>(`/api/v1/ai/ml-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function putAssetMlProfile(assetId: string, body: { profileId: string }): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/ai/assets/${encodeURIComponent(assetId)}/ml-profile`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function getEffectiveMlConfig(assetId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/ai/assets/${encodeURIComponent(assetId)}/effective-ml-config`)
}

export type AiFeatureStoreMonitor = {
  parkId: string
  latestParkSnapshotAt: string | null
  latestRideSnapshotAt: string | null
  snapshotFreshnessOk: boolean
  missingWeather: boolean
  missingHoliday: boolean
  missingTraffic: boolean
  rideAssets: number
  assetsWithMlProfileApprox: number
  assetsWithoutProfileApprox: number
}

export async function getAiFeatureStoreMonitor(): Promise<AiFeatureStoreMonitor> {
  return fetchEnvelope<AiFeatureStoreMonitor>('/api/v1/ai/feature-store/monitor')
}

export type AiPipelineHealthLastRun = {
  id: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: string
  parkSnapshotsWritten: number
  rideSnapshotsWritten: number
  labelsWritten: number
  featureStoreError: string | null
  scoringError: string | null
}

export type AiPipelineHealthSmoke = {
  passed: boolean
  checkedAt: string
} | null

export type AiPipelineHealthSmokeRideAll = {
  passed: boolean
  checkedAt: string
  summary: Record<string, number | string | null | undefined> | null
  topIssues?: { issue: string; count: number }[]
} | null

export type SettingResolutionSource = 'DB' | 'ENV' | 'DEFAULT'

export type AiPipelineHealthAiSampling = {
  enabled: boolean
  intervalSeconds: number
  enabledSource: SettingResolutionSource
  intervalSecondsSource: SettingResolutionSource
}

export type AiPipelineHealth = {
  lastRun: AiPipelineHealthLastRun | null
  schedulerEnabled: boolean
  intervalSeconds: number
  aiSampling?: AiPipelineHealthAiSampling
  weatherOpenMeteoConfig?: {
    enabled: boolean
    intervalSeconds: number
    rebuildSnapshots: boolean
    enabledSource: SettingResolutionSource
    intervalSecondsSource: SettingResolutionSource
    rebuildSnapshotsSource: SettingResolutionSource
  }
  externalParkData?: {
    enabled: boolean
    pollIntervalSeconds: number
    enabledSource: SettingResolutionSource
    pollIntervalSecondsSource: SettingResolutionSource
  }
  adapterScheduler?: {
    enabled: boolean
    enabledSource: SettingResolutionSource
  }
  smokeEuromir: AiPipelineHealthSmoke
  smokeWodan: AiPipelineHealthSmoke
  smokeRideForecastAll: AiPipelineHealthSmokeRideAll
}

export async function getAiPipelineHealth(): Promise<AiPipelineHealth> {
  return fetchEnvelope<AiPipelineHealth>('/api/v1/ai/pipeline-health')
}

/** Rows from `ai_pipeline_runs` (recent orchestrator runs; may include in-progress). */
export type AiPipelineRunHistoryRow = {
  id: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: string
  parkSnapshotsWritten: number
  rideSnapshotsWritten: number
  labelsWritten: number
  featureStoreError: string | null
  scoringError: string | null
}

export async function getAiPipelineRuns(limit = 25): Promise<AiPipelineRunHistoryRow[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  return fetchEnvelope<AiPipelineRunHistoryRow[]>(`/api/v1/ai/pipeline-runs?${q}`)
}

export type PlatformSettingRow = {
  settingKey: string
  settingValue: string | null
  valueType: string
  category: string
  description: string | null
  activeFlag: boolean
  effectiveValue: boolean | number | string
  resolvedSource: SettingResolutionSource
}

export type AdminPlatformSettingsPayload = {
  settings: PlatformSettingRow[]
  mqtt: {
    mqttEnabled: boolean
    mqttBrokerUrl: string
    mqttClientId: string
    mqttUsernameConfigured: boolean
  }
  general: {
    nodeEnv: string
    port: number
    corsOrigin: string
  }
}

export async function getAdminPlatformSettings(
  category?: string
): Promise<AdminPlatformSettingsPayload> {
  const q = category ? `?category=${encodeURIComponent(category)}` : ''
  return fetchEnvelope<AdminPlatformSettingsPayload>(`/api/v1/admin/platform-settings${q}`)
}

export async function patchAdminPlatformSetting(
  settingKey: string,
  value: boolean | number | string
): Promise<{ settingKey: string; effectiveValue: unknown; resolvedSource: SettingResolutionSource }> {
  return fetchEnvelope(`/api/v1/admin/platform-settings/${encodeURIComponent(settingKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  })
}

export type AiFeatureDataQualityKpis = {
  snapshotFreshnessOk: boolean
  latestParkSnapshotAt: string | null
  latestRideSnapshotAt: string | null
  avgCompletenessScore: number | null
  assetsWithoutMlProfile: number
  assetsWithMlProfileApprox: number
  rideAssets: number
  missingWeatherLatest: boolean
  missingCalendarLatest: boolean
  missingTrafficLatest: boolean
  snapshotsMissingWeatherCount: number
  snapshotsMissingCalendarCount: number
  snapshotsMissingTrafficCount: number
  snapshotsMissingStaffingCount: number
  lowConfidenceForecastCount: number
}

export type AiFeatureDataQualityParkRow = {
  id: string
  snapshotAt: string
  completenessScore: number | null
  temperatureC: number | null
  precipitationMm: number | null
  trafficIndex: number | null
  isPublicHoliday: boolean | null
  isSchoolHoliday: boolean | null
  holidayName: string | null
  parkCrowdIndex: number | null
  featureDataQuality: string[]
}

export type AiFeatureDataQualityRideRow = {
  id: string
  snapshotAt: string
  externalEntityId: string
  entityType: string
  internalAssetId: string | null
  completenessScore: number | null
  staffingGapNormal: number | null
  temperatureC: number | null
  precipitationMm: number | null
  trafficIndex: number | null
  mlProfileCode: string | null
  featureDataQuality: string[]
}

export type AiFeatureDataQualityAssetRow = {
  assetId: string
  name: string
  externalEntityId: string | null
  entityType: string | null
}

export type AiFeatureDataQualityLowConfRow = {
  externalEntityId: string | null
  entityType: string | null
  name: string
  confidence: number | null
  confidenceLevel: string | null
  forecastSource: string | null
  featureDataQuality: string[]
  snapshotCompletenessScore: number | null
}

export type AiFeatureDataQualityDashboard = {
  range: { from: string; to: string }
  monitor: AiFeatureStoreMonitor
  kpis: AiFeatureDataQualityKpis
  parkFeatureQuality: AiFeatureDataQualityParkRow[]
  rideFeatureQuality: AiFeatureDataQualityRideRow[]
  assetsMissingMlProfile: AiFeatureDataQualityAssetRow[]
  lowConfidenceForecasts: AiFeatureDataQualityLowConfRow[]
}

export async function getAiFeatureDataQualityDashboard(params?: {
  from?: string
  to?: string
  entityType?: string
  completenessMax?: number
  missingFeature?: string
  confidenceMax?: number
  provider?: string
  summariesLimit?: number
}): Promise<AiFeatureDataQualityDashboard> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.entityType) q.set('entityType', params.entityType)
  if (params?.completenessMax != null) q.set('completenessMax', String(params.completenessMax))
  if (params?.missingFeature) q.set('missingFeature', params.missingFeature)
  if (params?.confidenceMax != null) q.set('confidenceMax', String(params.confidenceMax))
  if (params?.provider) q.set('provider', params.provider)
  if (params?.summariesLimit != null) q.set('summariesLimit', String(params.summariesLimit))
  const qs = q.toString()
  return fetchEnvelope<AiFeatureDataQualityDashboard>(`/api/v1/ai/feature-data-quality${qs ? `?${qs}` : ''}`)
}

export async function deleteAiParkFeatureSnapshot(id: string): Promise<{ deleted: number }> {
  return fetchEnvelope<{ deleted: number }>(
    `/api/v1/ai/feature-store/park-snapshots/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
}

export async function purgeAiParkFeatureSnapshots(body: {
  from: string
  to: string
}): Promise<{ deleted: number }> {
  return fetchEnvelope<{ deleted: number }>('/api/v1/ai/feature-store/park-snapshots/purge', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function bulkDeleteAiParkFeatureSnapshots(body: {
  ids: string[]
}): Promise<{ deleted: number; requested: number }> {
  return fetchEnvelope<{ deleted: number; requested: number }>(
    '/api/v1/ai/feature-store/park-snapshots/bulk-delete',
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  )
}

export async function getZoneCrowdForecastAccuracy(params?: {
  days?: number
  horizonMinutes?: 15 | 60 | 180
  limitForecasts?: number
}): Promise<ZoneCrowdForecastAccuracy> {
  const q = new URLSearchParams()
  if (params?.days != null) q.set('days', String(params.days))
  if (params?.horizonMinutes != null) q.set('horizonMinutes', String(params.horizonMinutes))
  if (params?.limitForecasts != null) q.set('limitForecasts', String(params.limitForecasts))
  const qs = q.toString()
  return fetchEnvelope<ZoneCrowdForecastAccuracy>(`/api/v1/ai/forecast-accuracy/zone-crowd${qs ? `?${qs}` : ''}`)
}

export async function getRideWaitTimeseries(
  assetId: string,
  params: { from: string; to: string; includeContext?: boolean }
): Promise<RideWaitTimeseriesResponse> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  if (params.includeContext === false) q.set('includeContext', 'false')
  return fetchEnvelope<RideWaitTimeseriesResponse>(
    `/api/v1/ai/timeseries/rides/${encodeURIComponent(assetId)}?${q.toString()}`
  )
}

export async function getRideCurrentWaits(params?: { hours?: number }): Promise<
  Array<{
    assetId: string
    name: string
    externalEntityId: string | null
    current: {
      assetId: string
      waitTime: number | null
      sampledAt: string
      status: string | null
      isOpen: boolean | null
    } | null
  }>
> {
  const q = new URLSearchParams()
  if (params?.hours != null) q.set('hours', String(params.hours))
  const qs = q.toString()
  return fetchEnvelope(`/api/v1/ai/timeseries/rides-current${qs ? `?${qs}` : ''}`)
}

export async function upsertParkCalendarContext(body: {
  contextDate: string
  isPublicHoliday?: boolean
  isSchoolBreak?: boolean
  holidayName?: string | null
  regionCode?: string | null
  source?: string
  extra?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/ai/timeseries/calendar`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postScoreAllRecommendations(): Promise<{ scored: number }> {
  return fetchEnvelope('/api/v1/ai/recommendations/score', { method: 'POST' })
}

export async function getIntegrationProviders(): Promise<ProviderAdapterInfo[]> {
  return fetchEnvelope<ProviderAdapterInfo[]>('/api/v1/integrations/providers')
}

function normalizeScanPackage(raw: unknown): AdapterPackageDto | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const manifest = (o.manifest && typeof o.manifest === 'object' ? o.manifest : {}) as Record<string, unknown>
  const key = String(manifest.adapterKey || o.adapterKey || '').trim()
  if (!key) return null
  const caps = Array.isArray(manifest.capabilities) ? (manifest.capabilities as string[]) : []
  const provD = Array.isArray(manifest.providedDomains) ? (manifest.providedDomains as string[]) : null
  const provM = Array.isArray(manifest.providedMetrics) ? (manifest.providedMetrics as string[]) : null
  const desc =
    typeof manifest.description === 'string' && manifest.description.trim()
      ? manifest.description.trim()
      : null
  const dto: AdapterPackageDto = {
    adapterKey: key,
    name: String(manifest.name || key),
    version: String(manifest.version || '—'),
    description: desc,
    runtime: String(manifest.runtime || 'NODE'),
    adapterType: String(manifest.adapterType || '—'),
    iotClass: manifest.iotClass != null ? String(manifest.iotClass) : null,
    capabilities: caps,
    providedDomains: provD,
    providedMetrics: provM,
    manifest,
    source: 'scan',
    manifestValid: typeof o.manifestValid === 'boolean' ? o.manifestValid : undefined,
    manifestErrors: Array.isArray(o.manifestErrors) ? (o.manifestErrors as string[]) : [],
    packageDir: typeof o.packageDir === 'string' ? o.packageDir : null,
  }
  if (o.ui && typeof o.ui === 'object') dto.ui = o.ui as AdapterManifestUi
  if (typeof o.logoAssetUrl === 'string') dto.logoAssetUrl = o.logoAssetUrl
  if (typeof o.readmeAssetUrl === 'string') dto.readmeAssetUrl = o.readmeAssetUrl
  if (typeof o.bannerAssetUrl === 'string') dto.bannerAssetUrl = o.bannerAssetUrl
  return dto
}

function normalizeRegistryPackage(raw: unknown): AdapterPackageDto | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const key = String(r.adapterKey || '').trim()
  if (!key) return null
  const caps = Array.isArray(r.capabilities) ? (r.capabilities as string[]) : []
  const dto: AdapterPackageDto = {
    adapterKey: key,
    name: String(r.name || key),
    version: String(r.version || '—'),
    runtime: String(r.runtime || 'NODE'),
    adapterType: String(r.adapterType || '—'),
    iotClass: null,
    capabilities: caps,
    providedDomains: null,
    providedMetrics: null,
    manifest: null,
    source: 'registry',
  }
  if (typeof r.enabled === 'boolean') dto.enabled = r.enabled
  if (typeof r.status === 'string') dto.status = r.status
  if (typeof r.sourceType === 'string') dto.sourceType = r.sourceType
  if (typeof r.sourcePath === 'string') dto.sourcePath = r.sourcePath
  const metadata = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null
  const fromMeta =
    metadata && typeof metadata.description === 'string' && metadata.description.trim()
      ? metadata.description.trim()
      : null
  if (typeof r.description === 'string' && r.description.trim()) dto.description = r.description.trim()
  else if (fromMeta) dto.description = fromMeta
  if (metadata) {
    const dom = metadata.providedDomains
    if (Array.isArray(dom) && dom.length) dto.providedDomains = dom.map((x) => String(x))
    const met = metadata.providedMetrics
    if (Array.isArray(met) && met.length) dto.providedMetrics = met.map((x) => String(x))
    if (metadata.iotClass != null && String(metadata.iotClass).trim()) dto.iotClass = String(metadata.iotClass).trim()
  }
  if (typeof r.id === 'string') dto.id = r.id
  if (r.metadata && typeof r.metadata === 'object') dto.metadata = r.metadata as Record<string, unknown>
  if (r.ui && typeof r.ui === 'object') dto.ui = r.ui as AdapterManifestUi
  if (typeof r.logoAssetUrl === 'string') dto.logoAssetUrl = r.logoAssetUrl
  if (typeof r.readmeAssetUrl === 'string') dto.readmeAssetUrl = r.readmeAssetUrl
  if (typeof r.bannerAssetUrl === 'string') dto.bannerAssetUrl = r.bannerAssetUrl
  return dto
}

function mergeAdapterPackagesFromBody(body: {
  data?: unknown
  meta?: Record<string, unknown> | null
}): AdapterPackagesResponse {
  const registry = Array.isArray(body.data) ? body.data : []
  const meta = body.meta !== undefined ? body.meta : null
  const scanList = Array.isArray(
    (meta as { localIntegrationPackages?: unknown[] } | null)?.localIntegrationPackages
  )
    ? (meta as { localIntegrationPackages: unknown[] }).localIntegrationPackages
    : []

  const registryByKey = new Map<string, AdapterPackageDto>()
  for (const row of registry) {
    const dto = normalizeRegistryPackage(row)
    if (dto) registryByKey.set(dto.adapterKey, dto)
  }

  const byKey = new Map<string, AdapterPackageDto>()
  for (const item of scanList) {
    const dto = normalizeScanPackage(item)
    if (!dto) continue
    const reg = registryByKey.get(dto.adapterKey)
    if (reg) {
      dto.enabled = reg.enabled
      dto.status = reg.status
      dto.sourceType = reg.sourceType
      dto.sourcePath = reg.sourcePath
      if (!dto.description && reg.description) dto.description = reg.description
      if (!dto.providedDomains?.length && reg.providedDomains?.length) dto.providedDomains = reg.providedDomains
      if (!dto.providedMetrics?.length && reg.providedMetrics?.length) dto.providedMetrics = reg.providedMetrics
      if (!dto.iotClass && reg.iotClass) dto.iotClass = reg.iotClass
      if (reg.id) dto.id = reg.id
      if (reg.metadata) dto.metadata = reg.metadata
      if (!dto.ui && reg.ui) dto.ui = reg.ui
      if (!dto.logoAssetUrl && reg.logoAssetUrl) dto.logoAssetUrl = reg.logoAssetUrl
      if (!dto.readmeAssetUrl && reg.readmeAssetUrl) dto.readmeAssetUrl = reg.readmeAssetUrl
      if (!dto.bannerAssetUrl && reg.bannerAssetUrl) dto.bannerAssetUrl = reg.bannerAssetUrl
    }
    byKey.set(dto.adapterKey, dto)
  }
  for (const [, reg] of registryByKey) {
    if (!byKey.has(reg.adapterKey)) byKey.set(reg.adapterKey, reg)
  }

  return {
    packages: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    meta: meta && typeof meta === 'object' ? meta : null,
  }
}

async function fetchAdapterPackagesResource(apiPath: string): Promise<AdapterPackagesResponse> {
  const token = getAccessToken()
  const res = await fetch(url(apiPath), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  let body: {
    success?: boolean
    data?: unknown
    meta?: Record<string, unknown> | null
    message?: string
  } = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text }
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : res.statusText
    throw new Error(msg || `HTTP ${res.status}`)
  }

  return mergeAdapterPackagesFromBody(body)
}

/**
 * GET /integrations/adapters/packages — preserves optional `meta` (e.g. localIntegrationPackages scan).
 */
export async function getAdapterPackages(): Promise<AdapterPackagesResponse> {
  return fetchAdapterPackagesResource('/api/v1/integrations/adapters/packages')
}

/** GET /integrations/installed-adapters — same enrichment shape as packages list. */
export async function getInstalledAdapters(): Promise<AdapterPackagesResponse> {
  return fetchAdapterPackagesResource('/api/v1/integrations/installed-adapters')
}

export type InstallLocalAdapterBody = {
  adapterKey: string
  name?: string | null
  configJson?: Record<string, unknown>
  contextJson?: Record<string, unknown>
  outputProfiles?: string[]
  emitEnabled?: boolean
  ingestCanonicalEnabled?: boolean
  scheduleCron?: string | null
}

export async function postInstallLocalAdapter(body: InstallLocalAdapterBody): Promise<AdapterPackageDto> {
  // Prefer `/adapters/install-local` (next to run-local/discover-local); legacy path kept on server too.
  return fetchEnvelope<AdapterPackageDto>('/api/v1/integrations/adapters/install-local', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function getInstalledAdapter(idOrKey: string): Promise<AdapterPackageDto> {
  return fetchEnvelope<AdapterPackageDto>(
    `/api/v1/integrations/installed-adapters/${encodeURIComponent(idOrKey)}`
  )
}

export type PatchInstalledAdapterBody = {
  configJson?: Record<string, unknown>
  contextJson?: Record<string, unknown>
  outputProfiles?: string[]
  emitEnabled?: boolean
  ingestCanonicalEnabled?: boolean
  scheduleCron?: string | null
}

export async function patchInstalledAdapter(
  idOrKey: string,
  body: PatchInstalledAdapterBody
): Promise<AdapterPackageDto> {
  return fetchEnvelope<AdapterPackageDto>(
    `/api/v1/integrations/installed-adapters/${encodeURIComponent(idOrKey)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deleteInstalledAdapter(idOrKey: string): Promise<{ adapterKey: string; removed: boolean }> {
  return fetchEnvelope<{ adapterKey: string; removed: boolean }>(
    `/api/v1/integrations/installed-adapters/${encodeURIComponent(idOrKey)}`,
    { method: 'DELETE' }
  )
}

export type AdapterPipelineLogEntry = {
  ts: string
  adapterKey: string | null
  source: string
  level: string
  event: string
  message: string
  detail?: unknown
}

export type AdapterPipelineLogResponse = {
  logPath: string
  loggingEnabled: boolean
  fileExists: boolean
  truncatedTail: boolean
  entries: AdapterPipelineLogEntry[]
  totalParsedInTail?: number
  message?: string
  readError?: string
}

/** GET tail of server NDJSON adapter pipeline log (integrations:read). */
export async function getAdapterPipelineLog(params?: {
  adapterKey?: string
  limit?: number
}): Promise<AdapterPipelineLogResponse> {
  const q = new URLSearchParams()
  if (params?.adapterKey) q.set('adapterKey', params.adapterKey)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<AdapterPipelineLogResponse>(`/api/v1/integrations/adapters/pipeline-log${qs}`)
}

export type AdapterOpsKpis = {
  totalAdapters: number
  activeAdapters: number
  healthyAdapters: number
  warningAdapters: number
  failedAdapters: number
  pausedAdapters: number
  runsToday: number
  mqttPublishErrorsToday: number
  avgRuntimeSecToday: number | null
  lastSchedulerRun: string | null
  nextScheduledRun: string | null
}

export type AdapterOpsGridRow = {
  adapterKey: string
  name: string
  adapterType: string | null
  provider: string | null
  status: string
  installStatus: string
  active: boolean
  enabled: boolean
  lastRun: string | null
  nextRun: string | null
  runtimeMs: number | null
  messagesProcessed: number
  errorsCount: number
  successRate: number | null
  scheduleCron: string | null
  emitMqtt: boolean
  ingestCanonical: boolean
  parkSlug: string | null
}

export type AdapterOpsHourCount = { hour: string; count: number }
export type AdapterOpsRuntimePoint = { hour: string; avgMs: number }
export type AdapterOpsMessagesPoint = { hour: string; total: number }

export type AdapterOpsEvent = {
  ts: string
  adapterKey: string | null
  level: string
  message: string
}

export type AdapterOpsDashboard = {
  kpis: AdapterOpsKpis
  adapters: AdapterOpsGridRow[]
  charts: {
    runsPerHour: AdapterOpsHourCount[]
    errorsPerHour: AdapterOpsHourCount[]
    runtimeTrend: AdapterOpsRuntimePoint[]
    messagesTrend: AdapterOpsMessagesPoint[]
  }
  events: AdapterOpsEvent[]
  pipeline: {
    logPath: string
    loggingEnabled: boolean
    fileExists: boolean
  }
}

export type AdapterOpsThemeParksDetail = {
  adapterKey: string
  selectedParkId: string | null
  selectedParkName: string | null
  lastEntitiesSyncedAt: string | null
  lastLiveObservationsAt: string | null
  lastLiveObservationCount: number | null
  mappedEntityTotal: number
  childrenCount: number
  attractionsCount: number
  showsCount: number
  restaurantsCount: number
}

export type AdapterOpsStatusDetail = {
  adapterKey: string
  name: string
  adapterType: string | null
  enabled: boolean
  installStatus: string
  configSummary: {
    keys: string[]
    outputProfiles: string[]
    emitEnabled: boolean
    ingestCanonicalEnabled: boolean
  }
  selectedPark: string | null
  cronSchedule: string | null
  last10Runs: Array<{
    id: string
    status: string
    observationCount: number
    validCount: number
    invalidCount: number
    durationMs: number | null
    errorMessage: string | null
    createdAt: string
  }>
  avgRuntimeMs24h: number | null
  outputs: { mqtt: boolean; canonical: boolean }
  lastError: string | null
  themeParks: AdapterOpsThemeParksDetail | null
}

export async function getAdapterOpsDashboard(): Promise<AdapterOpsDashboard> {
  return fetchEnvelope<AdapterOpsDashboard>('/api/v1/adapters/dashboard')
}

export async function getAdapterOpsHealth(): Promise<AdapterOpsKpis> {
  return fetchEnvelope<AdapterOpsKpis>('/api/v1/adapters/health')
}

export type AdapterOpsRunRow = {
  id: string
  adapterKey: string
  status: string
  observationCount: number
  validCount: number
  invalidCount: number
  summary?: Record<string, unknown> | null
  errorMessage: string | null
  createdAt: string
}

export async function getAdapterOpsRuns(params?: {
  adapterKey?: string
  limit?: number
}): Promise<AdapterOpsRunRow[]> {
  const q = new URLSearchParams()
  if (params?.adapterKey) q.set('adapterKey', params.adapterKey)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope(`/api/v1/adapters/runs${qs}`)
}

export async function getAdapterOpsStatus(adapterKey: string): Promise<AdapterOpsStatusDetail> {
  return fetchEnvelope<AdapterOpsStatusDetail>(
    `/api/v1/adapters/${encodeURIComponent(adapterKey)}/status`
  )
}

export async function postAdapterOpsRunNow(adapterKey: string): Promise<unknown> {
  return fetchEnvelope(`/api/v1/adapters/${encodeURIComponent(adapterKey)}/run-now`, { method: 'POST' })
}

export async function postAdapterOpsPause(adapterKey: string): Promise<unknown> {
  return fetchEnvelope(`/api/v1/adapters/${encodeURIComponent(adapterKey)}/pause`, { method: 'POST' })
}

export async function postAdapterOpsActivate(adapterKey: string): Promise<unknown> {
  return fetchEnvelope(`/api/v1/adapters/${encodeURIComponent(adapterKey)}/activate`, { method: 'POST' })
}

export async function postAdapterOpsDisable(adapterKey: string): Promise<unknown> {
  return fetchEnvelope(`/api/v1/adapters/${encodeURIComponent(adapterKey)}/disable`, { method: 'POST' })
}

/** Poll adapter locally (validate, encode); `emit: false` avoids MQTT/canonical ingest. */
export async function postAdapterRunLocal(body: AdapterRunLocalBody): Promise<AdapterRunLocalResult> {
  return fetchEnvelope<AdapterRunLocalResult>('/api/v1/integrations/adapters/run-local', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postAdapterPackageHealth(
  adapterKey: string,
  body: Record<string, unknown> = {}
): Promise<AdapterPackageHealthData> {
  return fetchEnvelope<AdapterPackageHealthData>(
    `/api/v1/integrations/adapters/packages/${encodeURIComponent(adapterKey)}/health`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function getAdapterInventory(adapterKey: string): Promise<{
  adapterKey: string
  deviceCount: number | null
  entityCount: number | null
  serviceCount: number | null
  devices: Array<Record<string, unknown>>
  entities: Array<Record<string, unknown>>
  services: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
}> {
  return fetchEnvelope(`/api/v1/integrations/adapters/${encodeURIComponent(adapterKey)}/inventory`)
}

export type ExternalDestinationOption = {
  id: string
  name: string
  slug: string | null
  entityType?: string | null
  timezone?: string | null
  parks: Array<{ id: string; name: string }>
}

export type ExternalParkOption = {
  id: string
  name: string
  slug?: string | null
  entityType?: string | null
  timezone?: string | null
  destinationId: string | null
  destinationName?: string | null
}

export type ProviderEntitySummary = {
  id: string
  name: string | null
  slug: string | null
  entityType: string | null
  parentId: string | null
  destinationId: string | null
  parkId: string | null
  timezone: string | null
  externalId: string | null
  location: unknown
  raw?: Record<string, unknown>
}

export async function getProviderDestinations(provider: string): Promise<ExternalDestinationOption[]> {
  return fetchEnvelope<ExternalDestinationOption[]>(`/api/v1/integrations/${provider}/destinations`)
}

export async function getProviderParks(
  provider: string,
  destinationId?: string | null
): Promise<ExternalParkOption[]> {
  const q = new URLSearchParams()
  if (destinationId) q.set('destinationId', destinationId)
  const qs = q.toString()
  return fetchEnvelope<ExternalParkOption[]>(
    `/api/v1/integrations/${provider}/parks${qs ? `?${qs}` : ''}`
  )
}

export async function getProviderEntity(
  provider: string,
  entityId: string
): Promise<ProviderEntitySummary> {
  return fetchEnvelope<ProviderEntitySummary>(
    `/api/v1/integrations/${encodeURIComponent(provider)}/entity/${encodeURIComponent(entityId)}`
  )
}

export async function getProviderEntityChildren(
  provider: string,
  entityId: string
): Promise<Array<Record<string, unknown>>> {
  return fetchEnvelope<Array<Record<string, unknown>>>(
    `/api/v1/integrations/${encodeURIComponent(provider)}/entity/${encodeURIComponent(entityId)}/children`
  )
}

export async function syncProviderDestinations(provider: string): Promise<{ count: number; provider: string }> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/destinations`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function syncProviderParks(
  provider: string,
  destinationId?: string | null
): Promise<{ count: number; provider: string }> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/parks`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationId || null }),
  })
}

export async function syncProviderEntities(
  provider: string,
  parkId?: string | null
): Promise<{ count: number; provider: string }> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/entities`, {
    method: 'POST',
    body: JSON.stringify({ parkId: parkId || null }),
  })
}

export async function syncProviderLive(
  provider: string,
  parkId?: string | null
): Promise<{ count: number; provider: string }> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/live`, {
    method: 'POST',
    body: JSON.stringify({ parkId: parkId || null }),
  })
}

export async function syncProviderCalendar(
  provider: string,
  parkId?: string | null
): Promise<{ count: number; provider: string }> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/calendar`, {
    method: 'POST',
    body: JSON.stringify({ parkId: parkId || null }),
  })
}

export async function syncProviderAllParks(
  provider: string,
  destinationId?: string | null
): Promise<{
  provider: string
  destinationId: string | null
  parksTotal: number
  parksProcessed: number
  entitiesMessages: number
  calendarMessages: number
  liveMessages: number
  failedParks: Array<{ parkId: string; parkName: string; error: string }>
}> {
  return fetchEnvelope(`/api/v1/integrations/${provider}/sync/all-parks`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationId || null }),
  })
}

export async function getIntegrationSettings(): Promise<Record<string, unknown>> {
  return fetchEnvelope('/api/v1/integrations/settings')
}

export async function patchIntegrationSettings(value: Record<string, unknown>): Promise<Record<string, unknown>> {
  return fetchEnvelope('/api/v1/integrations/settings', {
    method: 'PATCH',
    body: JSON.stringify(value),
  })
}

export async function getCanonicalMessages(params?: {
  provider?: string
  externalParkId?: string
  status?: string
  messageType?: string
  limit?: number
  offset?: number
}): Promise<CanonicalInboundMessage[]> {
  const q = new URLSearchParams()
  if (params?.provider) q.set('provider', params.provider)
  if (params?.externalParkId) q.set('externalParkId', params.externalParkId)
  if (params?.status) q.set('status', params.status)
  if (params?.messageType) q.set('messageType', params.messageType)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return fetchEnvelope<CanonicalInboundMessage[]>(`/api/v1/integrations/canonical/messages${qs ? `?${qs}` : ''}`)
}

export async function reprocessCanonicalMessage(id: string): Promise<CanonicalInboundMessage> {
  return fetchEnvelope(`/api/v1/integrations/canonical/messages/${id}/reprocess`, { method: 'POST' })
}

export async function getExternalEntityMappings(params?: {
  provider?: string
  externalParkId?: string
  mappingStatus?: string
}): Promise<ExternalEntityMapping[]> {
  const q = new URLSearchParams()
  if (params?.provider) q.set('provider', params.provider)
  if (params?.externalParkId) q.set('externalParkId', params.externalParkId)
  if (params?.mappingStatus) q.set('mappingStatus', params.mappingStatus)
  const qs = q.toString()
  return fetchEnvelope<ExternalEntityMapping[]>(`/api/v1/integrations/mappings${qs ? `?${qs}` : ''}`)
}

export async function patchExternalEntityMapping(
  id: string,
  patch: Partial<ExternalEntityMapping>
): Promise<ExternalEntityMapping> {
  return fetchEnvelope(`/api/v1/integrations/mappings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export type UnsSuggestedTopic = {
  id?: string
  provider: string
  externalParkId: string
  externalEntityId: string | null
  entityName: string
  entityType: string
  domain: string
  assetSlug: string
  metric: string
  topicPath: string
  sparkplugTopic?: string
  source: 'MAPPING' | 'CANONICAL' | 'MANUAL' | 'SCHEMA_UPLOAD' | 'MASTER_DATA'
}

export type UnsSuggestions = {
  provider: string
  externalParkId: string
  parkSlug: string
  schemaOverrideActive?: boolean
  sparkplug?: { groupId: string; edgeNodeId: string }
  tree: Array<{ domain: string; items: UnsSuggestedTopic[] }>
  totalTopics: number
  dynamicTopics: number
  manualTopics: number
}

export type UnsSparkplugTopicSchema = {
  schemaVersion: number
  kind: string
  provider: string
  externalParkId: string
  parkSlug: string
  updatedAt?: string | null
  sparkplug: { groupId: string; edgeNodeId: string }
  entries: Array<Record<string, unknown>>
}

export type ManualUnsNodePayload = {
  domain: string
  assetSlug?: string | null
  assetName?: string | null
  metric: string
  entityType?: string | null
}

export async function getUnsSuggestions(): Promise<UnsSuggestions> {
  return fetchEnvelope<UnsSuggestions>('/api/v1/integrations/uns/suggestions')
}

export async function getManualUnsNodes(): Promise<Record<string, unknown>[]> {
  return fetchEnvelope<Record<string, unknown>[]>('/api/v1/integrations/uns/manual')
}

export async function createManualUnsNode(payload: ManualUnsNodePayload): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>('/api/v1/integrations/uns/manual', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteManualUnsNode(id: string): Promise<void> {
  return fetchEnvelope<void>(`/api/v1/integrations/uns/manual/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function downloadUnsSparkplugSchema(params?: { source?: 'baseline' | 'active' }): Promise<void> {
  const q = new URLSearchParams()
  if (params?.source) q.set('source', params.source)
  const qs = q.toString() ? `?${q.toString()}` : ''
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/integrations/uns/sparkplug-schema${qs}`), {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    const t = await res.text()
    throw new Error(t || res.statusText)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition')
  let filename = 'uns-sparkplug-schema.json'
  const m = cd?.match(/filename="([^"]+)"/)
  if (m?.[1]) filename = m[1]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function uploadUnsSparkplugSchema(doc: UnsSparkplugTopicSchema): Promise<{ entryCount: number }> {
  return fetchEnvelope<{ entryCount: number }>('/api/v1/integrations/uns/sparkplug-schema', {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
}

export async function deleteUnsSparkplugSchema(): Promise<void> {
  return fetchEnvelope<void>('/api/v1/integrations/uns/sparkplug-schema', { method: 'DELETE' })
}

export async function materializeUnsNodesFromIntegration(): Promise<{
  domainsCreated: number
  leavesCreated: number
  leavesUpdated: number
  pruned: number
  totalLeaves: number
}> {
  return fetchEnvelope('/api/v1/integrations/uns/materialize-nodes', { method: 'POST' })
}

/** Phase 3: hierarchical UNS tree document (export/import). */
export type UnsHierarchySchemaDoc = {
  schemaVersion: 1
  kind: 'smartpark.uns.hierarchy'
  parkId: string
  exportedAt?: string
  roots: Array<Record<string, unknown>>
}

export type UnsHierarchyImportSummary = {
  mode: string
  created: number
  updated: number
  skippedLocked: number
}

export type UnsHierarchyPreviewEntry =
  | { action: 'replace_would_delete_all'; nodeCount: number }
  | {
      action: 'create' | 'update' | 'skip_locked'
      path: string
      parentId?: string | null
      id?: string
      name?: string
      isLeaf?: boolean
      entityKind?: string
      topicPath?: string | null
      note?: string
    }

export type UnsHierarchyPreviewResult = {
  dryRun: true
  mode: string
  created: number
  updated: number
  skippedLocked: number
  preview: UnsHierarchyPreviewEntry[]
}

export async function downloadUnsHierarchySchema(parkId: string): Promise<void> {
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/uns/parks/${encodeURIComponent(parkId)}/hierarchy-schema`), {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    const t = await res.text()
    throw new Error(t || res.statusText)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition')
  let filename = 'uns-hierarchy.json'
  const m = cd?.match(/filename="([^"]+)"/)
  if (m?.[1]) filename = m[1]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function uploadUnsHierarchySchema(
  parkId: string,
  doc: UnsHierarchySchemaDoc,
  opts?: { mode?: 'merge' | 'replace' }
): Promise<UnsHierarchyImportSummary> {
  const q = opts?.mode === 'replace' ? '?mode=replace' : ''
  return fetchEnvelope<UnsHierarchyImportSummary>(
    `/api/v1/uns/parks/${encodeURIComponent(parkId)}/hierarchy-schema${q}`,
    {
      method: 'PUT',
      body: JSON.stringify(doc),
    }
  )
}

export async function previewUnsHierarchySchema(
  parkId: string,
  doc: UnsHierarchySchemaDoc,
  opts?: { mode?: 'merge' | 'replace' }
): Promise<UnsHierarchyPreviewResult> {
  const q = opts?.mode === 'replace' ? '?mode=replace' : ''
  return fetchEnvelope<UnsHierarchyPreviewResult>(
    `/api/v1/uns/parks/${encodeURIComponent(parkId)}/hierarchy-schema/preview${q}`,
    {
      method: 'POST',
      body: JSON.stringify(doc),
    }
  )
}

export type UnsNode = {
  id: string
  parkId: string
  parentId: string | null
  name: string
  slug: string
  nodeType: string
  domain: string | null
  metric: string | null
  topicPath: string | null
  description: string | null
  isLeaf: boolean
  isActive: boolean
  /** Phase 1 hierarchy: ORGANIZATION | PARK | ZONE | ASSET | METRIC */
  entityKind?: string | null
  sparkplugEnabled?: boolean
  /** DDATA topic; set on tree API for leaves (same rules as Integrations UNS preview / UNS Topics). */
  sparkplugTopic?: string | null
  sparkplugMessageType?: string | null
  sparkplug?: { groupId: string; edgeNodeId: string }
  isStructureLocked?: boolean
  sortOrder?: number
  children?: UnsNode[]
}

export type UnsLatestState = {
  id: string
  parkId: string
  topicPath: string
  payloadJson: Record<string, unknown>
  eventTime: string
  quality: string | null
  source: string | null
}

export async function getUnsTree(parkId: string): Promise<UnsNode[]> {
  return fetchEnvelope<UnsNode[]>(`/api/v1/uns/parks/${encodeURIComponent(parkId)}/tree`)
}

export async function createUnsNode(
  parkId: string,
  payload: Record<string, unknown>
): Promise<UnsNode> {
  return fetchEnvelope<UnsNode>(`/api/v1/uns/parks/${encodeURIComponent(parkId)}/nodes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateUnsNode(id: string, payload: Record<string, unknown>): Promise<UnsNode> {
  return fetchEnvelope<UnsNode>(`/api/v1/uns/nodes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteUnsNode(id: string): Promise<void> {
  return fetchEnvelope<void>(`/api/v1/uns/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getUnsLatestState(parkId: string): Promise<UnsLatestState[]> {
  return fetchEnvelope<UnsLatestState[]>(`/api/v1/uns/parks/${encodeURIComponent(parkId)}/latest-state`)
}

/** One row per Sparkplug metric after flattening (UNS Live / MQTT subscriber). */
export type UnsMqttLiveEvent = {
  id: string
  timestamp: string
  receivedAt: string
  source: string
  messageType: string
  sparkplugTopic: string
  groupId: string | null
  edgeNodeId: string | null
  deviceId: string | null
  metric: string | null
  value: unknown
  /** Formatted queue row e.g. `25 → ▲ +5` when delta known */
  valueDisplay?: string | null
  queueDelta?: number | null
  quality: string | null
  /** UNS domain segment used for canonical topic (rides, restaurants, shows, entities, …). */
  unsDomain?: string | null
  canonicalUnsTopic: string | null
  payloadPreview: string
}

export type UnsMqttLiveStatus = {
  mqtt: Record<string, unknown>
  buffer: { bufferSize: number; eventsPerSec: number; lastEventTime: string | null }
  adapterSimulationActive: boolean
}

export async function getUnsMqttLiveEvents(
  parkId: string,
  params?: { limit?: number }
): Promise<UnsMqttLiveEvent[]> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString() ? `?${q.toString()}` : ''
  const data = await fetchEnvelope<{ events: UnsMqttLiveEvent[] }>(
    `/api/v1/uns/parks/${encodeURIComponent(parkId)}/mqtt-live/events${qs}`
  )
  return data.events
}

export async function getUnsMqttLiveStatus(parkId: string): Promise<UnsMqttLiveStatus> {
  return fetchEnvelope<UnsMqttLiveStatus>(
    `/api/v1/uns/parks/${encodeURIComponent(parkId)}/mqtt-live/status`
  )
}

export async function postUnsMqttLiveTestEvent(parkId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(
    `/api/v1/uns/parks/${encodeURIComponent(parkId)}/mqtt-live/test-event`,
    { method: 'POST' }
  )
}

/** Sparkplug B message types (MQTT topic segment). Mirrors `SPARKPLUG_MESSAGE_TYPES` in the API. */
export const SPARKPLUG_MESSAGE_TYPES = [
  'NBIRTH',
  'NDEATH',
  'DBIRTH',
  'DDEATH',
  'DDATA',
  'NCMD',
  'DCMD',
  'STATE',
] as const

export type SparkplugMessageType = (typeof SPARKPLUG_MESSAGE_TYPES)[number]

export type UnsTopicRow = {
  id: string
  name: string | null
  topicPath?: string | null
  canonicalUnsTopic?: string | null
  domain?: string | null
  metric?: string | null
  nodeType?: string | null
  entityKind?: string | null
  sparkplugEnabled?: boolean
  sparkplugTopic?: string | null
  sparkplugMessageType?: string
}

export async function getUnsTopics(
  parkId: string,
  params?: { sparkplugMessageType?: string }
): Promise<UnsTopicRow[]> {
  const q = new URLSearchParams()
  if (params?.sparkplugMessageType) q.set('sparkplugMessageType', params.sparkplugMessageType)
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsTopicRow[]>(`/api/v1/uns/parks/${encodeURIComponent(parkId)}/topics${qs}`)
}

export async function publishUnsTest(topic: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>('/api/v1/uns/test/publish', {
    method: 'POST',
    body: JSON.stringify({ topic, payload }),
  })
}

/** Read-only UNS registry mirror (GET /api/v1/uns-registry/*, integrations:read). */
export type UnsRegistryMirrorSummary = {
  registrySource: string
  counts: {
    entities: number
    mappings: number
    topics: number
    metadata: number
    signalCatalog: number
    rideSignalCapabilities: number
    sparkplugMetricDefinitions: number
  }
  lastMirroredAt: string | null
}

export type UnsRegistryEntityRow = {
  id: string
  registrySource: string
  entityKind: string
  legacyTable: string
  legacyId: string
  parkId: string | null
  slug?: string | null
  name?: string | null
  externalEntityId?: string | null
  payloadJson: Record<string, unknown>
  mirroredAt: string
  createdAt?: string
  updatedAt?: string
}

export type UnsRegistryTopicRow = {
  id: string
  registrySource: string
  topicPath: string
  unsNodeLegacyId?: string | null
  parkId?: string | null
  registryEntityId?: string | null
  payloadJson: Record<string, unknown>
  mirroredAt: string
  createdAt?: string
  updatedAt?: string
  /** Present on operator-prepared registry topics (mirror API may include these). */
  isPrepared?: boolean
  isActive?: boolean
  activatedAt?: string | null
}

export type UnsRegistryPaged<T> = {
  total: number
  limit: number
  offset: number
  items: T[]
}

export async function getUnsRegistryMirrorSummary(): Promise<UnsRegistryMirrorSummary> {
  return fetchEnvelope<UnsRegistryMirrorSummary>('/api/v1/uns-registry/mirror/summary')
}

export async function getUnsRegistryEntities(params?: {
  parkId?: string
  entityKind?: string
  limit?: number
  offset?: number
}): Promise<UnsRegistryPaged<UnsRegistryEntityRow>> {
  const q = new URLSearchParams()
  if (params?.parkId) q.set('parkId', params.parkId)
  if (params?.entityKind) q.set('entityKind', params.entityKind)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<UnsRegistryEntityRow>>(`/api/v1/uns-registry/entities${qs}`)
}

export async function getUnsRegistryTopics(params?: {
  parkId?: string
  limit?: number
  offset?: number
}): Promise<UnsRegistryPaged<UnsRegistryTopicRow>> {
  const q = new URLSearchParams()
  if (params?.parkId) q.set('parkId', params.parkId)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<UnsRegistryTopicRow>>(`/api/v1/uns-registry/topics${qs}`)
}

export type MqttInboundRow = {
  id: string
  topic: string
  payloadPreview?: string | null
  payloadLength?: number
  qos?: number
  spyClassification?: string | null
  spyDetails?: Record<string, unknown> | null
  capabilityGuardMode?: string | null
  capabilityGuardDecision?: 'ALLOW' | 'WARN' | 'BLOCK' | 'SKIP' | null
  capabilityGuardReason?: string | null
  capabilityGuardDetails?: Record<string, unknown> | null
  createdAt: string
  updatedAt?: string
}

export type UnsDiscoveryEventRow = {
  id: string
  classification: string
  topicPath: string
  mqttInboundMessageId?: string | null
  details: Record<string, unknown>
  createdAt: string
  updatedAt?: string
  mqttInboundMessage?: MqttInboundRow | null
}

export type UnsTopicProposalRow = {
  id: string
  discoveryEventId: string
  proposedTopic: string
  status: string
  payloadSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt?: string
}

export async function getUnsSpyEvents(params?: {
  limit?: number
  offset?: number
  classification?: string
  topicPrefix?: string
  eventSource?: 'mqtt' | 'adapter' | 'all'
}): Promise<UnsRegistryPaged<UnsDiscoveryEventRow>> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.classification) q.set('classification', params.classification)
  if (params?.topicPrefix) q.set('topicPrefix', params.topicPrefix)
  if (params?.eventSource && params.eventSource !== 'all') q.set('eventSource', params.eventSource)
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<UnsDiscoveryEventRow>>(`/api/v1/uns-spy/events${qs}`)
}

export type IntegrationFeatureFlags = {
  adapterDiscoverySpyEnabled: boolean
  mqttEnforceCapabilities: boolean
  mqttCapabilityGuardMode?: string
}

export type MqttCapabilityGuardStatus = {
  mode: string
  allowedRideCount: number
  lastBlockedAt: string | null
  blockedLast24h: number
  warnedLast24h: number
  allowedLast24h: number
}

export async function getMqttCapabilityGuardStatus(): Promise<MqttCapabilityGuardStatus> {
  return fetchEnvelope<MqttCapabilityGuardStatus>('/api/v1/mqtt/capability-guard/status')
}

export async function getIntegrationFeatureFlags(): Promise<IntegrationFeatureFlags> {
  return fetchEnvelope<IntegrationFeatureFlags>('/api/v1/integrations/feature-flags')
}

export async function postThemeparksDiscoveryScanFromSettings(): Promise<{
  created: number
  updated: number
  skipped?: boolean
  items: unknown[]
}> {
  return fetchEnvelope('/api/v1/sync/themeparks/discovery/from-settings', { method: 'POST' })
}

export async function postUnsSpyDiscoveryApprove(
  eventId: string,
  body: {
    createEntity?: boolean
    mapToExistingEntityId: string
    applyTemplateKey?: string | null
    createMapping?: boolean
  }
): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/uns-spy/events/${encodeURIComponent(eventId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postUnsSpyDiscoveryReject(eventId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/uns-spy/events/${encodeURIComponent(eventId)}/reject`, { method: 'POST' })
}

export async function postUnsSpyDiscoveryIgnore(eventId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/uns-spy/events/${encodeURIComponent(eventId)}/ignore`, { method: 'POST' })
}

export async function getUnsSpyProposals(params?: {
  limit?: number
  offset?: number
  status?: string
}): Promise<UnsRegistryPaged<UnsTopicProposalRow>> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.status) q.set('status', params.status)
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<UnsTopicProposalRow>>(`/api/v1/uns-spy/proposals${qs}`)
}

export async function getMqttInbound(params?: {
  limit?: number
  offset?: number
  topicPrefix?: string
  spyClassification?: string
  capabilityDecision?: 'ALLOW' | 'WARN' | 'BLOCK' | 'SKIP'
}): Promise<UnsRegistryPaged<MqttInboundRow>> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.topicPrefix) q.set('topicPrefix', params.topicPrefix)
  if (params?.spyClassification) q.set('spyClassification', params.spyClassification)
  if (params?.capabilityDecision) q.set('capabilityDecision', params.capabilityDecision)
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<MqttInboundRow>>(`/api/v1/mqtt/inbound${qs}`)
}

export async function getMqttInboundUnknown(params?: {
  limit?: number
  offset?: number
  topicPrefix?: string
}): Promise<UnsRegistryPaged<UnsDiscoveryEventRow>> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.topicPrefix) q.set('topicPrefix', params.topicPrefix)
  const qs = q.toString() ? `?${q.toString()}` : ''
  return fetchEnvelope<UnsRegistryPaged<UnsDiscoveryEventRow>>(`/api/v1/mqtt/inbound/unknown${qs}`)
}

export type RideSignalSource =
  | 'NOT_AVAILABLE'
  | 'MASTER_DATA'
  | 'MANUAL'
  | 'ADAPTER'
  | 'MQTT_EDGE'
  | 'SIMULATION'
  | 'ML'

export type UnsSpyMqttProposalApproveBody = {
  rideAssetId: string
  signalCatalogId: string
  signalSource: RideSignalSource
  valueType?: string
  activatePrepared?: boolean
}

export async function postUnsSpyProposalApprove(
  proposalId: string,
  body: UnsSpyMqttProposalApproveBody
): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/uns-spy/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postUnsSpyProposalReject(
  proposalId: string,
  body?: { reason?: string | null }
): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/uns-spy/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export type RideSignalCapabilitySignalRow = {
  signalCatalogId: string
  signalCode: string
  label: string | null
  description: string | null
  unit: string | null
  valueType: string
  signalSource: RideSignalSource
  unsTopicPreview: string | null
  sparkplugMetricPreview: string | null
  capabilityId: string | null
  registrySource: string | null
  isPreparedTopic: boolean
  isActiveTopic: boolean
  topicRowId: string | null
  isPreparedSparkplug: boolean
  isActiveSparkplug: boolean
  sparkplugRowId: string | null
}

export type RideTopicActivationStatus = {
  rideAssetId: string
  parkId: string
  preparedUnsTopicCount: number
  activeUnsTopicCount: number
  preparedSparkplugMetricCount: number
  activeSparkplugMetricCount: number
  activeSignalKeys: string[]
  warnings: { code: string; message: string }[]
}

export type RideSignalCapabilitiesPayload = {
  rideAssetId: string
  registryEntityId: string | null
  parkId: string
  signals: RideSignalCapabilitySignalRow[]
}

export async function getRideSignalCapabilities(rideAssetId: string): Promise<RideSignalCapabilitiesPayload> {
  return fetchEnvelope<RideSignalCapabilitiesPayload>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/signal-capabilities`
  )
}

export async function putRideSignalCapabilities(
  rideAssetId: string,
  body: { capabilities: { signalCatalogId: string; signalSource: RideSignalSource; valueType?: string }[] }
): Promise<RideSignalCapabilitiesPayload> {
  return fetchEnvelope<RideSignalCapabilitiesPayload>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/signal-capabilities`,
    { method: 'PUT', body: JSON.stringify(body) }
  )
}

export async function postPrepareRideUnsTopics(rideAssetId: string): Promise<{ created: number; updated: number; rideAssetId: string }> {
  return fetchEnvelope<{ created: number; updated: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/prepare-uns-topics`,
    { method: 'POST' }
  )
}

export async function postPrepareRideSparkplugMetrics(
  rideAssetId: string
): Promise<{ created: number; updated: number; rideAssetId: string }> {
  return fetchEnvelope<{ created: number; updated: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/prepare-sparkplug-metrics`,
    { method: 'POST' }
  )
}

export async function getRideTopicActivationStatus(rideAssetId: string): Promise<RideTopicActivationStatus> {
  return fetchEnvelope<RideTopicActivationStatus>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/topic-activation-status`
  )
}

export async function postActivatePreparedRideUnsTopics(
  rideAssetId: string
): Promise<{ activated: number; skipped: number; rideAssetId: string }> {
  return fetchEnvelope<{ activated: number; skipped: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/activate-prepared-uns-topics`,
    { method: 'POST' }
  )
}

export async function postDeactivatePreparedRideUnsTopics(
  rideAssetId: string
): Promise<{ deactivated: number; rideAssetId: string }> {
  return fetchEnvelope<{ deactivated: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/deactivate-prepared-uns-topics`,
    { method: 'POST' }
  )
}

export async function postActivatePreparedRideSparkplugMetrics(
  rideAssetId: string
): Promise<{ activated: number; skipped: number; rideAssetId: string }> {
  return fetchEnvelope<{ activated: number; skipped: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/activate-prepared-sparkplug-metrics`,
    { method: 'POST' }
  )
}

export async function postDeactivatePreparedRideSparkplugMetrics(
  rideAssetId: string
): Promise<{ deactivated: number; rideAssetId: string }> {
  return fetchEnvelope<{ deactivated: number; rideAssetId: string }>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/deactivate-prepared-sparkplug-metrics`,
    { method: 'POST' }
  )
}

export type RegistrySignalDeprecationHealthCheck = { id: string; ok: boolean; detail: string }

export type RegistrySignalDeprecationHealth = {
  ok: boolean
  checks: RegistrySignalDeprecationHealthCheck[]
}

export type RegistrySignalDeprecationState = {
  id: string | null
  registryAuthoritative: boolean
  legacyFallbackDisabled: boolean
  legacyPublishDisabled: boolean
  validationStartedAt?: string | null
  authoritativeMarkedAt?: string | null
  legacyFallbackDisabledAt?: string | null
  legacyPublishDisabledAt?: string | null
  lastHealthPassAt?: string | null
  stabilityWindowStartedAt?: string | null
  updatedByUserId?: string | null
}

export type RegistrySignalDeprecationListRow = {
  signalKey: string
  signalCatalogId: string
  signalSource: RideSignalSource
  isActiveTopic: boolean
  isActiveSparkplug: boolean
  deprecation: RegistrySignalDeprecationState
  health: RegistrySignalDeprecationHealth
}

export type RegistrySignalDeprecationsPayload = {
  rideAssetId: string
  signals: RegistrySignalDeprecationListRow[]
}

export type RegistrySignalDeprecationHealthPayload = {
  rideAssetId: string
  evaluatedAt: string
  signals: { signalKey: string; signalCatalogId: string; health: RegistrySignalDeprecationHealth }[]
}

export async function getRegistrySignalDeprecations(
  rideAssetId: string
): Promise<RegistrySignalDeprecationsPayload> {
  return fetchEnvelope<RegistrySignalDeprecationsPayload>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/registry-signal-deprecations`
  )
}

/** Alias for diagnostics views (read-only). */
export const getRideSignalDeprecations = getRegistrySignalDeprecations

export async function getRegistrySignalDeprecationHealthHttp(
  rideAssetId: string
): Promise<RegistrySignalDeprecationHealthPayload> {
  return fetchEnvelope<RegistrySignalDeprecationHealthPayload>(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/registry-signal-deprecations/health`
  )
}

/** Alias for diagnostics views (read-only). */
export const getRideSignalDeprecationHealth = getRegistrySignalDeprecationHealthHttp

/**
 * Future Phase 11 path (may 404). Returns null when not implemented or unreachable — keeps UI stable.
 */
export async function tryGetRideSignalDeprecationHealthBySignalKey(
  rideAssetId: string,
  signalKey: string
): Promise<RegistrySignalDeprecationHealth | null> {
  try {
    return await fetchEnvelope<RegistrySignalDeprecationHealth>(
      `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/signal-deprecation/${encodeURIComponent(signalKey)}/health`
    )
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null
    return null
  }
}

/**
 * Future Phase 11 list path (may 404).
 */
export async function tryGetRideSignalDeprecationsAlt(
  rideAssetId: string
): Promise<unknown | null> {
  try {
    return await fetchEnvelope<unknown>(
      `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/signal-deprecation`
    )
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null
    return null
  }
}

export async function postRegistrySignalDeprecate(
  rideAssetId: string,
  body: {
    signalKey: string
    registryAuthoritative?: boolean
    disableLegacyFallback?: boolean
    legacyPublishDisabled?: boolean
  }
): Promise<{
  rideAssetId: string
  signalKey: string
  signalCatalogId: string
  deprecation: RegistrySignalDeprecationState
  health: RegistrySignalDeprecationHealth
}> {
  return fetchEnvelope(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/registry-signal-deprecations/deprecate`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function postRegistrySignalReactivate(
  rideAssetId: string,
  body: { signalKey: string }
): Promise<{
  rideAssetId: string
  signalKey: string
  signalCatalogId: string
  deprecation: RegistrySignalDeprecationState
  touched: boolean
}> {
  return fetchEnvelope(
    `/api/v1/master-data/rides/${encodeURIComponent(rideAssetId)}/registry-signal-deprecations/reactivate`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export type RegistryPublisherStatus = {
  registryPublishEnabled: boolean
  registryPublishMode: 'dry_run' | 'parallel'
  registrySparkplugFormat: 'json' | 'protobuf_ready'
  allowedRideAssetIds: string[]
  mqttConnected: boolean
  mqttEnabled: boolean
}

export type RegistryPublishEventRow = {
  id: string
  rideAssetId: string
  registryTopicId: string | null
  sparkplugMetricDefinitionId: string | null
  topic: string
  payloadPreview: string | null
  publishMode: string
  publishFormat: string
  status: string
  reason: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RegistryPublisherRunSummary = {
  rideAssetId: string
  mode: string
  sparkplugFormat: string
  warnings: string[]
  previews: unknown[]
  unsPublished: number
  sparkPublished: number
  skipped: number
  failed: number
}

export type RegistryPublisherHealth = {
  registryPublishEnabled: boolean
  registryPublishMode: 'dry_run' | 'parallel'
  allowedRideCount: number
  mqttConnected: boolean
  mqttEnabled: boolean
  lastDryRunAt: string | null
  lastPublishAt: string | null
  failedEventsLast24h: number
  skippedEventsLast24h: number
  publishedEventsLast24h: number
}

export type RegistryPublisherDisablePilotResult = {
  rideAssetId: string
  unsDeactivated: number
  sparkplugDeactivated: number
}

export async function getRegistryPublisherStatus(): Promise<RegistryPublisherStatus> {
  return fetchEnvelope<RegistryPublisherStatus>('/api/v1/registry-publisher/status')
}

export async function getRegistryPublisherHealth(): Promise<RegistryPublisherHealth> {
  return fetchEnvelope<RegistryPublisherHealth>('/api/v1/registry-publisher/health')
}

export async function getRegistryPublisherEvents(params?: {
  rideAssetId?: string
  limit?: number
}): Promise<RegistryPublishEventRow[]> {
  const q = new URLSearchParams()
  if (params?.rideAssetId) q.set('rideAssetId', params.rideAssetId)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<RegistryPublishEventRow[]>(`/api/v1/registry-publisher/events${qs ? `?${qs}` : ''}`)
}

export async function postRegistryPublisherDryRun(rideAssetId: string): Promise<RegistryPublisherRunSummary> {
  return fetchEnvelope<RegistryPublisherRunSummary>(
    `/api/v1/registry-publisher/rides/${encodeURIComponent(rideAssetId)}/dry-run`,
    { method: 'POST' }
  )
}

export async function postRegistryPublisherPublishOnce(rideAssetId: string): Promise<RegistryPublisherRunSummary> {
  return fetchEnvelope<RegistryPublisherRunSummary>(
    `/api/v1/registry-publisher/rides/${encodeURIComponent(rideAssetId)}/publish-once`,
    { method: 'POST' }
  )
}

export async function postRegistryPublisherDisablePilot(
  rideAssetId: string
): Promise<RegistryPublisherDisablePilotResult> {
  return fetchEnvelope<RegistryPublisherDisablePilotResult>(
    `/api/v1/registry-publisher/rides/${encodeURIComponent(rideAssetId)}/disable-pilot`,
    { method: 'POST' }
  )
}

export async function getMdmParks(): Promise<MdmPark[]> {
  return fetchEnvelope<MdmPark[]>('/api/v1/mdm/parks')
}

export async function getMdmZones(parkId: string): Promise<MdmParkZone[]> {
  return fetchEnvelope<MdmParkZone[]>(`/api/v1/mdm/parks/${encodeURIComponent(parkId)}/zones`)
}

export async function getMdmRideTypes(): Promise<MdmRideType[]> {
  return fetchEnvelope<MdmRideType[]>('/api/v1/mdm/ride-types')
}

export async function getMdmRideTemplates(params?: { rideTypeId?: string }): Promise<MdmRideTemplate[]> {
  const q = new URLSearchParams()
  if (params?.rideTypeId) q.set('rideTypeId', params.rideTypeId)
  const qs = q.toString()
  return fetchEnvelope<MdmRideTemplate[]>(`/api/v1/mdm/ride-templates${qs ? `?${qs}` : ''}`)
}

export async function getMdmRideTemplate(id: string): Promise<MdmRideTemplate> {
  return fetchEnvelope<MdmRideTemplate>(`/api/v1/mdm/ride-templates/${encodeURIComponent(id)}`)
}

export async function putMdmRideTemplate(
  id: string,
  body: Partial<Pick<MdmRideTemplate, 'displayName' | 'defaultProfile' | 'isSystem' | 'rideTypeId' | 'code'>>
): Promise<MdmRideTemplate> {
  return fetchEnvelope<MdmRideTemplate>(`/api/v1/mdm/ride-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function getMdmRides(params?: {
  parkId?: string
  parkZoneId?: string
  activeFlag?: boolean
}): Promise<MdmRideMaster[]> {
  const q = new URLSearchParams()
  if (params?.parkId) q.set('parkId', params.parkId)
  if (params?.parkZoneId) q.set('parkZoneId', params.parkZoneId)
  if (params?.activeFlag !== undefined) q.set('activeFlag', String(params.activeFlag))
  const qs = q.toString()
  return fetchEnvelope<MdmRideMaster[]>(`/api/v1/mdm/rides${qs ? `?${qs}` : ''}`)
}

export async function getMdmRide(id: string): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>(`/api/v1/mdm/rides/${encodeURIComponent(id)}`)
}

export async function getMdmRideExtensions(id: string): Promise<RideMasterExtensionsRead> {
  return fetchEnvelope<RideMasterExtensionsRead>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/extensions`)
}

export async function getPlatformAssetExtensions(assetId: string): Promise<RideMasterExtensionsRead> {
  return fetchEnvelope<RideMasterExtensionsRead>(`/api/v1/assets/${encodeURIComponent(assetId)}/extensions`)
}

export async function patchMdmRideExtensions(
  id: string,
  body: RideMasterExtensionsPatchBody
): Promise<RideMasterExtensionsRead> {
  return fetchEnvelope<RideMasterExtensionsRead>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/extensions`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function patchPlatformAssetExtensions(
  assetId: string,
  body: RideMasterExtensionsPatchBody
): Promise<RideMasterExtensionsRead> {
  return fetchEnvelope<RideMasterExtensionsRead>(`/api/v1/assets/${encodeURIComponent(assetId)}/extensions`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function postMdmRide(body: {
  parkId: string
  parkZoneId: string
  rideTypeId: string
  name: string
  internalRideId?: string | null
  externalId?: string | null
  shortName?: string | null
  description?: string | null
  manufacturer?: string | null
  model?: string | null
  buildYear?: number | null
  commissioningDate?: string | null
  lifecycleStatus?: string
  activeFlag?: boolean
  profile?: MdmRideProfile
}): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>('/api/v1/mdm/rides', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function putMdmRide(
  id: string,
  body: Record<string, unknown>
): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>(`/api/v1/mdm/rides/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function patchMdmRideActive(id: string, activeFlag: boolean): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ activeFlag }),
  })
}

export async function postMdmCloneRideFromTemplate(
  templateId: string,
  body: { parkZoneId: string; name: string; externalId?: string | null; shortName?: string | null; description?: string | null }
): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>(
    `/api/v1/mdm/ride-templates/${encodeURIComponent(templateId)}/clone-ride`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function getMdmCapacityModel(id: string): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/capacity-model`)
}

export async function getMdmStaffingModel(id: string): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/staffing-model`)
}

export async function patchMdmRideZone(id: string, parkZoneId: string): Promise<MdmRideMaster> {
  return fetchEnvelope<MdmRideMaster>(`/api/v1/mdm/rides/${encodeURIComponent(id)}/zone`, {
    method: 'PATCH',
    body: JSON.stringify({ parkZoneId }),
  })
}

export async function getPlatformParks(): Promise<PlatformPark[]> {
  return fetchEnvelope<PlatformPark[]>('/api/v1/parks')
}

export async function getPlatformParkOperationalContext(
  parkId: string,
  params?: { at?: string }
): Promise<PlatformOperationalContext> {
  const q = new URLSearchParams()
  if (params?.at) q.set('at', params.at)
  const qs = q.toString()
  return fetchEnvelope<PlatformOperationalContext>(
    `/api/v1/parks/${encodeURIComponent(parkId)}/operational-context${qs ? `?${qs}` : ''}`
  )
}

export async function listIncidents(params?: {
  status?: IncidentStatus
  limit?: number
  offset?: number
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  createdFrom?: string
  createdTo?: string
}): Promise<IncidentListPayload> {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.linkedEntityType) q.set('linkedEntityType', params.linkedEntityType)
  if (params?.linkedEntityId) q.set('linkedEntityId', params.linkedEntityId)
  if (params?.createdFrom) q.set('createdFrom', params.createdFrom)
  if (params?.createdTo) q.set('createdTo', params.createdTo)
  const qs = q.toString()
  return fetchEnvelope<IncidentListPayload>(`/api/v1/incidents${qs ? `?${qs}` : ''}`)
}

export async function getIncident(id: string): Promise<Incident> {
  return fetchEnvelope<Incident>(`/api/v1/incidents/${encodeURIComponent(id)}`)
}

export async function createIncident(body: {
  title: string
  description?: string | null
  severity?: string
  status?: string
  ownerUserId?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  slaDueAt?: string | null
}): Promise<Incident> {
  return fetchEnvelope<Incident>('/api/v1/incidents', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function patchIncident(
  id: string,
  body: Partial<{
    title: string
    description: string | null
    severity: string
    status: string
    ownerUserId: string | null
    linkedEntityType: string | null
    linkedEntityId: string | null
    slaDueAt: string | null
  }>
): Promise<Incident> {
  return fetchEnvelope<Incident>(`/api/v1/incidents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function deleteIncident(id: string): Promise<{ deleted: boolean; id: string }> {
  return fetchEnvelope<{ deleted: boolean; id: string }>(`/api/v1/incidents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/** SQDCP board (Safety, Quality, Delivery, Customer, Cost, People) — park-scoped via `X-Park-Id`. */
export type SqdcMood = 'great' | 'good' | 'neutral' | 'low' | 'bad'

export type SqdcMoodSummary = {
  counts: Record<string, number>
  averageScore: number | null
  total: number
}

export type SqdcBoardResponse = {
  businessDate: string
  assetId: string | null
  meta: { moods: string[]; safetyKinds: string[] }
  safety: {
    moodSummary: SqdcMoodSummary
    moodRatings: Array<{
      id: string
      mood: string
      businessDate: string
      assetId: string | null
      userId: string
      user: { id: string; displayName: string | null; firstName: string; lastName: string } | null
      createdAt: string | null
    }>
    events: Array<{
      id: string
      kind: string
      title: string
      description: string | null
      occurredAt: string | null
      assetId: string | null
      createdBy: { id: string; displayName: string | null; firstName: string; lastName: string } | null
      createdAt: string | null
    }>
  }
  quality: {
    incidents: Array<{
      id: string
      title: string
      severity: string
      status: string
      createdAt: string | null
      description?: string | null
    }>
    incidentTotal: number
  }
  delivery: {
    oee5m: number | null
    leadTechnicianName: string | null
    snapshot: {
      id: string
      deliveryOee5m: number | null
      customerGuestCount: number | null
      leadTechnicianName: string | null
      notes: string | null
    } | null
  }
  customer: { guestCount: number | null }
}

export type SqdcHistoryResponse = {
  assetId: string
  days: number
  series: Array<{
    businessDate: string
    deliveryOee5m: number | null
    customerGuestCount: number | null
    leadTechnicianName: string | null
    mood: SqdcMoodSummary
    hasSnapshot: boolean
  }>
}

export async function getSqdcBoard(params: { businessDate: string; assetId?: string | null }): Promise<SqdcBoardResponse> {
  const q = new URLSearchParams()
  q.set('businessDate', params.businessDate)
  if (params.assetId) q.set('assetId', params.assetId)
  return fetchEnvelope<SqdcBoardResponse>(`/api/v1/sqdc/board?${q.toString()}`)
}

export async function getSqdcHistory(params: { assetId: string; days?: number }): Promise<SqdcHistoryResponse> {
  const q = new URLSearchParams()
  q.set('assetId', params.assetId)
  if (params.days != null) q.set('days', String(params.days))
  return fetchEnvelope<SqdcHistoryResponse>(`/api/v1/sqdc/history?${q.toString()}`)
}

export type SqdcMoodRatingRow = SqdcBoardResponse['safety']['moodRatings'][number]
export type SqdcSafetyEventRow = SqdcBoardResponse['safety']['events'][number]

export async function postSqdcMood(body: {
  businessDate: string
  mood: SqdcMood
  assetId?: string | null
}): Promise<SqdcMoodRatingRow> {
  return fetchEnvelope(`/api/v1/sqdc/mood`, { method: 'POST', body: JSON.stringify(body) })
}

export async function postSqdcSafetyEvent(body: {
  kind: 'near_miss' | 'accident'
  title: string
  description?: string | null
  assetId?: string | null
  occurredAt?: string | null
}): Promise<SqdcSafetyEventRow> {
  return fetchEnvelope(`/api/v1/sqdc/safety-events`, { method: 'POST', body: JSON.stringify(body) })
}

export async function postSqdcSnapshot(body: {
  assetId: string
  businessDate: string
  deliveryOee5m?: number | null
  customerGuestCount?: number | null
  leadTechnicianName?: string | null
  notes?: string | null
}): Promise<NonNullable<SqdcBoardResponse['delivery']['snapshot']>> {
  return fetchEnvelope(`/api/v1/sqdc/snapshots`, { method: 'POST', body: JSON.stringify(body) })
}

/** Hierarchical SQDCP board (park / asset). `X-Park-Id` must equal `parkId`. */
export type SqdcAiRecommendation = {
  recommendationId: string
  category: string
  severity: string
  message: string
  suggestedAction: string
  confidence: number
}

export type SqdcParkBoardResponse = {
  level: 'PARK'
  parkId: string
  date: string
  lastUpdate: string
  scores: {
    safety: number
    quality: number
    delivery: number
    customer: number
    overall: number
    source: 'STORED_SNAPSHOT' | 'COMPUTED'
  }
  kpis: Record<string, number | boolean>
  incidents: unknown[]
  activeEvents: Array<Record<string, unknown>>
  /** Park-level mood entries only (`assetId` null), newest first. */
  moodFeedback: Array<Record<string, unknown>>
  shiftHandovers: Array<Record<string, unknown>>
  downtimeEvents: Array<Record<string, unknown>>
  topRiskAssets: Array<{ assetId: string; label: string; deliveryScore: number | null }>
  aiRecommendations: SqdcAiRecommendation[]
  rollup: {
    parkScore: number
    assetCount: number
    openAssetIncidents: number
    criticalAssets: number
    averageOee: number | null
    averageQueueTime: number | null
    worstAssets: Array<{ assetId: string; label: string; deliveryScore: number | null }>
    averageDeliveryFromSnapshots: number | null
  }
  /** UTC calendar month of `date`: daily S/Q/D tones from PARK snapshots + C from `delivery_json` + P from park mood. */
  monthRingOverview?: { yearMonth: string; days: SqdcMonthRingDay[] }
  /** Up to ~30 days ending on selected board date; PARK daily snapshots for gauge + sparkline. */
  overallScoreHistory?: SqdcScoreHistoryPoint[]
  /** Selected day PARK snapshot `delivery_json` electricity cost (EUR), when present. */
  electricityCostEurPerDay?: number | null
  /** Effective band thresholds (from platform_settings); UI + rings stay aligned with API. */
  uiThresholds?: SqdcUiThresholds
}

export type SqdcScoreHistoryPoint = { snapshotDate: string; overallScore: number | null }

export type SqdcRingTone = 'green' | 'amber' | 'red' | 'empty'

export type SqdcMonthRingDay = {
  date: string
  safety: SqdcRingTone
  quality: SqdcRingTone
  delivery: SqdcRingTone
  cost: SqdcRingTone
  /** People / mood from `sqdc_mood_feedback` (avg 1–5 per UTC day). */
  people: SqdcRingTone
}

export type SqdcUiThresholds = {
  scoreRingPark: { greenMin: number; amberMin: number }
  scoreRingAsset: { greenMin: number; amberMin: number }
  ringCostEur: { greenAtMost: number; amberAtMost: number }
  ringPeopleMood: { greenAtLeast: number; amberAtLeast: number }
}

export type SqdcAssetBoardResponse = {
  level: 'ASSET'
  parkId: string
  assetId: string
  date: string
  lastUpdate: string
  asset: Record<string, unknown>
  scores: SqdcParkBoardResponse['scores']
  delivery: {
    oee01: number | null
    theoreticalCapacityPph: unknown
    plannedCapacityPph: unknown
    /** kWh per UTC day; from `delivery_json` until energy metering integration. */
    electricityKwhPerDay?: number | null
    electricityCostEurPerDay?: number | null
  }
  /** Persisted ASSET `delivery_json` (merge client-side when saving snapshots). */
  deliveryJson?: Record<string, unknown>
  /** Up to ~30 days ending on selected board date; for gauge + sparkline. */
  overallScoreHistory?: SqdcScoreHistoryPoint[]
  /** UTC calendar month of `date`: daily S/Q/D tones + cost from snapshots (`delivery_json` cost). */
  monthRingOverview?: { yearMonth: string; days: SqdcMonthRingDay[] }
  customer: { queueMinutes: number | null; guestCount?: number | null }
  /** Where `delivery.oee01` was resolved from (classic board snapshot vs hierarchical daily JSON). */
  deliveryProvenance?: { oeeFrom: 'DAILY_SNAPSHOT_JSON' | 'LEGACY_BOARD_SNAPSHOT' | null }
  shiftHandovers: Array<Record<string, unknown>>
  downtimeEvents: Array<Record<string, unknown>>
  operationalKpis?: {
    shiftHandoverCount: number
    downtimeEventCount: number
    openUnplannedDowntime: number
  }
  incidents: unknown[]
  activeEvents: Array<Record<string, unknown>>
  moodFeedback: Array<Record<string, unknown>>
  aiRecommendations: SqdcAiRecommendation[]
  uiThresholds?: SqdcUiThresholds
  integrationHooks: Record<string, string>
}

export async function getSqdcParkBoardHierarchical(
  parkId: string,
  date: string
): Promise<SqdcParkBoardResponse> {
  const q = new URLSearchParams({ date })
  return fetchEnvelope<SqdcParkBoardResponse>(
    `/api/v1/sqdc/parks/${encodeURIComponent(parkId)}/board?${q.toString()}`
  )
}

export async function getSqdcAssetBoardHierarchical(
  parkId: string,
  assetId: string,
  date: string
): Promise<SqdcAssetBoardResponse> {
  const q = new URLSearchParams({ date })
  return fetchEnvelope<SqdcAssetBoardResponse>(
    `/api/v1/sqdc/parks/${encodeURIComponent(parkId)}/assets/${encodeURIComponent(assetId)}/board?${q.toString()}`
  )
}

export async function postSqdcBoardEvent(body: {
  assetId?: string | null
  eventType: 'SAFETY' | 'QUALITY' | 'DELIVERY' | 'CUSTOMER' | 'PEOPLE' | 'MAINTENANCE'
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  title: string
  description?: string | null
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  source?: 'MANUAL' | 'MQTT' | 'ADAPTER' | 'AI' | 'SYSTEM'
  eventTime?: string | null
  metadataJson?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/sqdc/events`, { method: 'POST', body: JSON.stringify(body) })
}

export async function postSqdcMoodFeedback(body: {
  assetId?: string | null
  feedbackDate: string
  moodScore: number
  comment?: string | null
}): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/sqdc/mood-feedback`, { method: 'POST', body: JSON.stringify(body) })
}

export async function postSqdcDailySnapshot(body: {
  level: 'PARK' | 'ASSET'
  snapshotDate: string
  assetId?: string | null
  safetyScore?: number | null
  qualityScore?: number | null
  deliveryScore?: number | null
  customerScore?: number | null
  overallScore?: number | null
  safetyJson?: Record<string, unknown>
  qualityJson?: Record<string, unknown>
  deliveryJson?: Record<string, unknown>
  customerJson?: Record<string, unknown>
  aiRecommendationsJson?: SqdcAiRecommendation[]
}): Promise<Record<string, unknown>> {
  return fetchEnvelope(`/api/v1/sqdc/daily-snapshots`, { method: 'POST', body: JSON.stringify(body) })
}

/** Add-on Board (L0/L1/L3) — park-scoped via `X-Park-Id`. */
export type AddonBoardParkSummary = {
  parkId: string
  timestamp: string
  parkHealthScore: number
  status: string
  openRides: number
  totalRides: number
  averageWaitTimeMinutes: number | null
  criticalRides: number
  /** Count of open rides with 60m forecast ≥ threshold (operations risk). */
  forecastCriticalRides60?: number
  forecastCriticalAtMinutes?: number
  averageForecastWaitTime60?: number | null
  actualThroughputPph: number | null
  forecastDemandIndex: string
}

export type AddonBoardRideCard = {
  rideId: string
  rideName: string
  zone: string | null
  zoneId: string | null
  swdec: Record<string, unknown>
  severity: string
  aiRecommendation: { title: string; expectedImpact: string; confidence: number }
  predictionMode?: string | null
  forecastSource?: string | null
  mlModelId?: string | null
  mlForecastConfidence?: number | null
  mlTopFactors?: { feature: string; impact: string }[]
}

export type AddonBoardRidesPayload = {
  parkId: string
  timestamp: string
  rides: AddonBoardRideCard[]
}

export type AddonBoardZoneSummary = {
  parkId: string
  zoneId: string
  zoneName: string
  timestamp: string
  zoneHealthScore: number
  zoneAverageWaitTimeMinutes: number | null
  zoneForecastWaitTime60: number | null
  /** Open rides in zone with 60m forecast ≥ threshold. */
  zoneForecastCriticalRides: number
  forecastCriticalAtMinutes?: number
  zoneDemandForecastIndex?: string
  ridesInZone: number
}

export type AddonBoardZoneListRow = {
  zoneId: string
  zoneName: string
  zoneSlug: string | null
  rideCount: number
}

export type AddonBoardZonesListPayload = {
  parkId: string
  timestamp: string
  zones: AddonBoardZoneListRow[]
}

export type AddonBoardHeatmapPayload = {
  parkId: string
  generatedAt: string
  error?: string
  park: Record<string, unknown> | null
  hotspots: Record<string, unknown>[]
  cells: Record<string, unknown>[]
  insights: Record<string, unknown>[]
}

export type AddonBoardLayoutWidget = { id: string; title?: string; roles?: string[] }

export type AddonBoardLayoutPayload = {
  boardId: string
  label: string | null
  widgets: AddonBoardLayoutWidget[]
  /** Present only when calling template loader directly; `/addon-board/layout` omits this. */
  template?: Record<string, unknown>
}

/** Phase G — `park_assets.master_profile.addonBoardWidgetSourceDraft`. */
export interface AddonBoardWidgetSourceDraft {
  sourceType: 'SIGNAL_METADATA'
  entityType: 'park_asset'
  entityId: string
  signalKey: string
}

/** Phase H — current extensions vs saved draft (read-only preview). */
export interface AddonBoardWidgetSourceResolvedPreview {
  valid: boolean
  domain: string
  metric: string
  enabled: boolean
  boardEligible: boolean
}

/** Phase I — read-only live scalar from UNS / canonical / snapshot (no MQTT in browser). */
export interface AddonBoardWidgetSourceLatestValue {
  value: unknown
  unit: string | null
  ts: string
  quality: string
  source: string
}

export interface AddonBoardWidgetSourcePreviewResponse {
  draft: AddonBoardWidgetSourceDraft
  resolved: AddonBoardWidgetSourceResolvedPreview
  /** Present when a draft exists; `null` when source is valid but no persisted live row yet. */
  latestValue?: AddonBoardWidgetSourceLatestValue | null
}

/** Phase J — persisted L3 custom widget (metadata only; latest-value display intent). */
export type AddonBoardRideCustomWidgetDisplay = {
  type: 'latest_value'
  unitMode: 'fromSource'
  refreshMode: 'manual_or_existing_board_refresh'
}

/** Phase M — derived on server from Phase K fields; no extra storage. */
export type AddonBoardCustomWidgetHealth =
  | 'ok'
  | 'invalid_source'
  | 'disabled'
  | 'no_live_value'
  | 'entity_mismatch'

/** Phase J persisted row; **Phase K** adds `resolved` / `latestValue`; **Phase M** adds `health` on list/PATCH. */
export type AddonBoardRideCustomWidget = {
  widgetId: string
  title: string
  source: AddonBoardWidgetSourceDraft
  display: AddonBoardRideCustomWidgetDisplay
  enabled: boolean
  resolved?: AddonBoardWidgetSourceResolvedPreview | null
  latestValue?: AddonBoardWidgetSourceLatestValue | null
  /** Persisted `source.entityId` does not match the ride in the URL. */
  sourceEntityMismatch?: boolean
  /** Phase M — observability only. */
  health?: AddonBoardCustomWidgetHealth
}

export async function getAddonBoardSummary(): Promise<AddonBoardParkSummary> {
  return fetchEnvelope<AddonBoardParkSummary>('/api/v1/addon-board/summary')
}

export async function getAddonBoardRides(): Promise<AddonBoardRidesPayload> {
  return fetchEnvelope<AddonBoardRidesPayload>('/api/v1/addon-board/rides')
}

export async function getAddonBoardCriticalRides(params?: { limit?: number }): Promise<AddonBoardRidesPayload> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<AddonBoardRidesPayload>(`/api/v1/addon-board/critical-rides${qs ? `?${qs}` : ''}`)
}

export async function getAddonBoardZoneSummary(zoneId: string): Promise<AddonBoardZoneSummary> {
  return fetchEnvelope<AddonBoardZoneSummary>(
    `/api/v1/addon-board/zones/${encodeURIComponent(zoneId)}/summary`
  )
}

export async function getAddonBoardRideDetail(rideId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/addon-board/rides/${encodeURIComponent(rideId)}/detail`)
}

/** Phase 9 registry-first Operations Facts (`GET /operations-facts/rides`). */
export type OperationFactSourceKind =
  | 'REGISTRY'
  | 'LEGACY_UNS'
  | 'CANONICAL'
  | 'OBSERVATION'
  | 'MISSING'
  | string

export type OperationFactBreakdownEntry = {
  source: OperationFactSourceKind
  confidence: string
  reason: string
  policy?: Record<string, boolean>
}

export type OperationFactRide = {
  rideAssetId: string
  parkId: string
  name: string | null
  slug: string | null
  status: unknown
  queueTime: unknown
  predictedWaitTime: unknown
  throughputActual: unknown
  throughputTheoretical: unknown
  capacityUtilization: unknown
  vehiclesActive: unknown
  staffActual: unknown
  downtimeMinutes: unknown
  sourceBreakdown: Record<string, OperationFactBreakdownEntry>
  warnings: string[]
  registryAuthoritativeSignals?: number
  legacyFallbackDisabledSignals?: number
}

/**
 * Registry-first Operations Facts — rides in park.
 * `parkId` query must match `X-Park-Id` from {@link apiParkHeaders}.
 */
export async function getOperationsFactsRides(params: { parkId: string }): Promise<OperationFactRide[]> {
  const q = new URLSearchParams({ parkId: params.parkId })
  return fetchEnvelope<OperationFactRide[]>(`/api/v1/operations-facts/rides?${q}`)
}

/**
 * Registry-first Operations Facts — single ride (`id` = ride asset UUID).
 * Park scope comes from `X-Park-Id`; backend rejects rides outside that park.
 */
export async function getOperationsFactsRide(id: string): Promise<OperationFactRide> {
  return fetchEnvelope<OperationFactRide>(`/api/v1/operations-facts/rides/${encodeURIComponent(id)}`)
}

/** Park-scoped Operations Facts (`X-Park-Id` must match `parkId`). Shape may evolve; often stub `facts` until backend fills it. */
export type OperationsFactsParkRidePayload = {
  parkId: string
  rideId: string
  timestamp: string
  facts: Record<string, unknown>
}

export async function getOperationsFactsRideParkScoped(params: {
  parkId: string
  rideAssetId: string
}): Promise<OperationsFactsParkRidePayload> {
  const { parkId, rideAssetId } = params
  return fetchEnvelope<OperationsFactsParkRidePayload>(
    `/api/v1/operations-facts/parks/${encodeURIComponent(parkId)}/rides/${encodeURIComponent(rideAssetId)}`
  )
}

export async function getAddonBoardZones(): Promise<AddonBoardZonesListPayload> {
  return fetchEnvelope<AddonBoardZonesListPayload>('/api/v1/addon-board/zones')
}

export async function getAddonBoardHeatmap(): Promise<AddonBoardHeatmapPayload> {
  return fetchEnvelope<AddonBoardHeatmapPayload>('/api/v1/addon-board/heatmap')
}

export async function getAddonBoardLayout(params?: { boardId?: string }): Promise<AddonBoardLayoutPayload> {
  const q = new URLSearchParams()
  if (params?.boardId) q.set('boardId', params.boardId)
  const qs = q.toString()
  return fetchEnvelope<AddonBoardLayoutPayload>(`/api/v1/addon-board/layout${qs ? `?${qs}` : ''}`)
}

/**
 * Phase G+H+I — GET returns `null` when no draft; otherwise `{ draft, resolved, latestValue }` for L3 preview.
 * `latestValue` is read-only (UNS / canonical / snapshot); it does not drive Add-on Board KPI runtime.
 */
export async function getAddonBoardWidgetSourceDraft(
  rideAssetId: string
): Promise<AddonBoardWidgetSourcePreviewResponse | null> {
  return fetchEnvelope<AddonBoardWidgetSourcePreviewResponse | null>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/widget-source-draft`
  )
}

export async function putAddonBoardWidgetSourceDraft(
  rideAssetId: string,
  body: AddonBoardWidgetSourceDraft
): Promise<AddonBoardWidgetSourceDraft> {
  return fetchEnvelope<AddonBoardWidgetSourceDraft>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/widget-source-draft`,
    { method: 'PUT', body: JSON.stringify(body) }
  )
}

/**
 * Phase J — list promoted custom widgets (`master_profile.addonBoardCustomWidgets`).
 * **Phase K:** enabled `SIGNAL_METADATA` + `latest_value` rows include `resolved` + `latestValue` (same read path as draft preview).
 * **Phase M:** each row includes derived `health` for UI summaries and badges.
 */
export async function getAddonBoardRideCustomWidgets(
  rideAssetId: string
): Promise<AddonBoardRideCustomWidget[]> {
  const data = await fetchEnvelope<{ widgets: AddonBoardRideCustomWidget[] }>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/custom-widgets`
  )
  return data.widgets
}

/** Phase J — promote current valid widget source draft to a persisted custom widget (201). */
export async function postAddonBoardPromoteWidgetFromDraft(
  rideAssetId: string
): Promise<AddonBoardRideCustomWidget> {
  const data = await fetchEnvelope<{ widget: AddonBoardRideCustomWidget }>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/widgets/from-source-draft`,
    { method: 'POST' }
  )
  return data.widget
}

export type AddonBoardCustomWidgetPatchBody = {
  title?: string
  enabled?: boolean
}

/** Phase L — update `title` and/or `enabled` only (204 never returned). */
export async function patchAddonBoardRideCustomWidget(
  rideAssetId: string,
  widgetId: string,
  body: AddonBoardCustomWidgetPatchBody
): Promise<AddonBoardRideCustomWidget> {
  const data = await fetchEnvelope<{ widget: AddonBoardRideCustomWidget }>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/custom-widgets/${encodeURIComponent(widgetId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
  return data.widget
}

/** Phase L — remove custom widget from ride asset profile. */
export async function deleteAddonBoardRideCustomWidget(
  rideAssetId: string,
  widgetId: string
): Promise<void> {
  await fetchEnvelope<void>(
    `/api/v1/addon-board/rides/${encodeURIComponent(rideAssetId)}/custom-widgets/${encodeURIComponent(widgetId)}`,
    { method: 'DELETE' }
  )
}

/** Raw ML L0/L1 roll-up (`ai.read`). Optional paging via `limit` / `offset`. */
export async function getMlParkForecastSummary(params?: {
  zoneId?: string
  criticalAtMinutes?: number
  limit?: number
  offset?: number
}): Promise<Record<string, unknown>> {
  const q = new URLSearchParams()
  if (params?.zoneId) q.set('zoneId', params.zoneId)
  if (params?.criticalAtMinutes != null) q.set('criticalAtMinutes', String(params.criticalAtMinutes))
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/ml/predict/park-summary${qs ? `?${qs}` : ''}`)
}

export async function listVisitPlans(year: number): Promise<VisitPlanVersionSummary[]> {
  return fetchEnvelope<VisitPlanVersionSummary[]>(
    `/api/v1/visit-plans?year=${encodeURIComponent(String(year))}`
  )
}

export async function getVisitPlan(id: string): Promise<VisitPlanDetail> {
  return fetchEnvelope<VisitPlanDetail>(`/api/v1/visit-plans/${encodeURIComponent(id)}`)
}

export async function createVisitPlan(body: {
  name: string
  planYear: number
  payload?: VisitPlanPayload
}): Promise<VisitPlanDetail> {
  return fetchEnvelope<VisitPlanDetail>('/api/v1/visit-plans', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function patchVisitPlan(
  id: string,
  body: Partial<{ name: string; payload: VisitPlanPayload }>
): Promise<VisitPlanDetail> {
  return fetchEnvelope<VisitPlanDetail>(`/api/v1/visit-plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function deleteVisitPlan(id: string): Promise<{ deleted: boolean; id: string }> {
  return fetchEnvelope<{ deleted: boolean; id: string }>(
    `/api/v1/visit-plans/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
}

async function readVisitPlanXlsxErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string }
    if (j?.message) return j.message
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`
}

export async function exportVisitPlanXlsxBlob(planId: string): Promise<{ blob: Blob; filename: string }> {
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/visit-plans/${encodeURIComponent(planId)}/export/xlsx`), {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...apiParkHeaders(),
    },
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readVisitPlanXlsxErrorMessage(res))
  }
  let filename = `visit-plan-${planId}.xlsx`
  const cd = res.headers.get('Content-Disposition')
  if (cd) {
    const m = /filename="([^"]+)"/.exec(cd)
    if (m?.[1]) filename = m[1]
  }
  return { blob: await res.blob(), filename }
}

/** Multipart field name: `file` */
export async function importVisitPlanXlsx(
  planId: string,
  file: File
): Promise<{ detail: VisitPlanDetail; importSummary: VisitPlanImportSummary }> {
  const token = getAccessToken()
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(url(`/api/v1/visit-plans/${encodeURIComponent(planId)}/import/xlsx`), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...apiParkHeaders(),
    },
    body: fd,
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readVisitPlanXlsxErrorMessage(res))
  }
  const body = (await res.json()) as {
    success?: boolean
    data?: VisitPlanDetail
    meta?: { importSummary?: VisitPlanImportSummary }
  }
  if (!body.success || !body.data) throw new Error('Invalid import response')
  const importSummary = body.meta?.importSummary ?? {
    cellsWritten: 0,
    cellsCleared: 0,
    unknownRowKeys: [],
    ignoredColumns: [],
  }
  return { detail: body.data, importSummary }
}

export async function getVisitActualYear(actualYear: number): Promise<VisitActualYearRecord> {
  return fetchEnvelope<VisitActualYearRecord>(
    `/api/v1/visit-actuals/${encodeURIComponent(String(actualYear))}`
  )
}

export async function putVisitActualYear(
  actualYear: number,
  guestCounts: Record<string, number>
): Promise<VisitActualYearRecord> {
  return fetchEnvelope<VisitActualYearRecord>(
    `/api/v1/visit-actuals/${encodeURIComponent(String(actualYear))}`,
    {
      method: 'PUT',
      body: JSON.stringify({ guestCounts }),
    }
  )
}

export async function postVisitPlanForecast(
  planId: string,
  body: {
    method?: 'prior_year_actuals'
    sourceYear: number
    scale?: number
    emptyOnly?: boolean
  }
): Promise<{ detail: VisitPlanDetail; forecastSummary: VisitPlanForecastSummary }> {
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/visit-plans/${encodeURIComponent(planId)}/forecast`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...apiParkHeaders(),
    },
    body: JSON.stringify({
      method: body.method ?? 'prior_year_actuals',
      sourceYear: body.sourceYear,
      scale: body.scale ?? 1,
      emptyOnly: body.emptyOnly ?? true,
    }),
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { message: text }
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    const msg =
      typeof parsed === 'object' && parsed && 'message' in parsed
        ? String((parsed as { message: string }).message)
        : res.statusText
    const code =
      typeof parsed === 'object' && parsed && 'code' in parsed && (parsed as { code?: unknown }).code != null
        ? String((parsed as { code: unknown }).code)
        : undefined
    const details =
      typeof parsed === 'object' && parsed && 'details' in parsed
        ? (parsed as { details: unknown }).details
        : undefined
    throw new ApiRequestError(msg || `HTTP ${res.status}`, res.status, code, details)
  }
  const env = parsed as {
    success?: boolean
    data?: VisitPlanDetail
    meta?: { forecastSummary?: VisitPlanForecastSummary }
  }
  if (!env.success || !env.data) throw new Error('Invalid forecast response')
  const forecastSummary = env.meta?.forecastSummary ?? {
    cellsFilled: 0,
    cellsSkippedExisting: 0,
    cellsSkippedNoSource: 0,
  }
  return { detail: env.data, forecastSummary }
}

export async function getPlatformAssets(params?: {
  parkId?: string
  assetTypeCode?: string
  limit?: number
  offset?: number
}): Promise<PlatformAsset[]> {
  const q = new URLSearchParams()
  if (params?.parkId) q.set('parkId', params.parkId)
  if (params?.assetTypeCode) q.set('assetTypeCode', params.assetTypeCode)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return fetchEnvelope<PlatformAsset[]>(`/api/v1/assets${qs ? `?${qs}` : ''}`)
}

/** @param parkKey Park slug or internal UUID (same resolver as other geo routes). */
export async function getGeoPressureLive(
  parkKey: string,
  params?: { assetTypeCode?: string }
): Promise<GeoPressurePayload> {
  const q = new URLSearchParams()
  if (params?.assetTypeCode) q.set('assetTypeCode', params.assetTypeCode)
  const qs = q.toString()
  return fetchEnvelope<GeoPressurePayload>(
    `/api/v1/parks/${encodeURIComponent(parkKey)}/geo/pressure/live${qs ? `?${qs}` : ''}`
  )
}

export async function getGeoPressureForecast(
  parkSlug: string,
  params?: { assetTypeCode?: string; provider?: string }
): Promise<GeoPressurePayload> {
  const q = new URLSearchParams()
  if (params?.assetTypeCode) q.set('assetTypeCode', params.assetTypeCode)
  if (params?.provider) q.set('provider', params.provider)
  const qs = q.toString()
  return fetchEnvelope<GeoPressurePayload>(
    `/api/v1/parks/${encodeURIComponent(parkSlug)}/geo/pressure/forecast${qs ? `?${qs}` : ''}`
  )
}

/** @param parkKey Park slug (e.g. `europa_park`) or internal park UUID — both resolve on the server. */
export async function getGeoFlowSimulation(
  parkKey: string,
  params?: {
    mode?: 'synthetic' | 'from_log'
    from?: string
    to?: string
    guestCount?: number
    transitionCount?: number
    maxHopM?: number
    seed?: number
    assetTypeCode?: string
    topEdges?: number
  }
): Promise<GeoFlowSimulationPayload> {
  const q = new URLSearchParams()
  if (params?.mode) q.set('mode', params.mode)
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.guestCount != null) q.set('guestCount', String(params.guestCount))
  if (params?.transitionCount != null) q.set('transitionCount', String(params.transitionCount))
  if (params?.maxHopM != null) q.set('maxHopM', String(params.maxHopM))
  if (params?.seed != null) q.set('seed', String(params.seed))
  if (params?.assetTypeCode) q.set('assetTypeCode', params.assetTypeCode)
  if (params?.topEdges != null) q.set('topEdges', String(params.topEdges))
  const qs = q.toString()
  return fetchEnvelope<GeoFlowSimulationPayload>(
    `/api/v1/parks/${encodeURIComponent(parkKey)}/geo/flow/simulation${qs ? `?${qs}` : ''}`
  )
}

export async function postGeoFlowEventsBatch(
  parkKey: string,
  body: {
    events: Array<{
      caseId: string
      assetId: string
      occurredAt: string
      eventType?: string
      source?: string
      payload?: Record<string, unknown>
    }>
  }
): Promise<{ inserted: number }> {
  return fetchEnvelope<{ inserted: number }>(
    `/api/v1/parks/${encodeURIComponent(parkKey)}/geo/flow/events/batch`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function getPlatformAsset(assetId: string): Promise<PlatformAsset> {
  return fetchEnvelope<PlatformAsset>(`/api/v1/assets/${encodeURIComponent(assetId)}`)
}

export async function getOeeReasonCodes(): Promise<OeeReasonCodeRow[]> {
  return fetchEnvelope<OeeReasonCodeRow[]>('/api/v1/assets/oee/reason-codes')
}

export async function listAssetDowntimeEvents(
  assetId: string,
  params: { from: string; to: string; limit?: number }
): Promise<AssetDowntimeEventRow[]> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  if (params.limit != null) q.set('limit', String(params.limit))
  return fetchEnvelope<AssetDowntimeEventRow[]>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/downtime-events?${q.toString()}`
  )
}

export async function createAssetDowntimeEvent(
  assetId: string,
  body: {
    startedAt: string
    endedAt?: string | null
    planned: boolean
    reasonCode: string
    notes?: string | null
    source?: string
  }
): Promise<AssetDowntimeEventRow> {
  return fetchEnvelope<AssetDowntimeEventRow>(`/api/v1/assets/${encodeURIComponent(assetId)}/downtime-events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export type AssetDowntimeEventPatchBody = {
  startedAt?: string
  endedAt?: string | null
  planned?: boolean
  reasonCode?: string
  notes?: string | null
}

export async function patchAssetDowntimeEvent(
  assetId: string,
  eventId: string,
  body: AssetDowntimeEventPatchBody
): Promise<AssetDowntimeEventRow> {
  return fetchEnvelope<AssetDowntimeEventRow>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/downtime-events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deleteAssetDowntimeEvent(assetId: string, eventId: string): Promise<void> {
  await fetchEnvelope<void>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/downtime-events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  )
}

export async function getAssetAvailabilitySummary(
  assetId: string,
  params: { from: string; to: string }
): Promise<AssetAvailabilitySummary> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  return fetchEnvelope<AssetAvailabilitySummary>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/oee/availability-summary?${q.toString()}`
  )
}

export async function getAssetDowntimeReasonPareto(
  assetId: string,
  params: { from: string; to: string; plannedScope?: 'all' | 'planned' | 'unplanned' }
): Promise<AssetDowntimeParetoPayload> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  q.set('to', params.to)
  if (params.plannedScope) q.set('plannedScope', params.plannedScope)
  return fetchEnvelope<AssetDowntimeParetoPayload>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/oee/downtime-reason-pareto?${q.toString()}`
  )
}

export async function listShiftHandovers(
  parkId: string,
  params?: {
    from?: string
    to?: string
    q?: string
    scope?: 'all' | 'park' | 'asset'
    linkedAssetId?: string
    limit?: number
  }
): Promise<ShiftHandoverRow[]> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.q != null && params.q.trim()) q.set('q', params.q.trim())
  if (params?.scope && params.scope !== 'all') q.set('scope', params.scope)
  if (params?.linkedAssetId) q.set('linkedAssetId', params.linkedAssetId)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  return fetchEnvelope<ShiftHandoverRow[]>(
    `/api/v1/parks/${encodeURIComponent(parkId)}/shift-handovers${qs ? `?${qs}` : ''}`
  )
}

export async function createShiftHandover(
  parkId: string,
  body: {
    windowFrom: string
    windowTo: string
    shiftLabel?: string | null
    notes?: string | null
    includeDowntimeSnapshot?: boolean
    includeIncidentSnapshot?: boolean
    /** Optional: nur dieses Park-Objekt (Attraktion, Restaurant, Show, …) */
    linkedParkAssetId?: string | null
  }
): Promise<ShiftHandoverRow> {
  return fetchEnvelope<ShiftHandoverRow>(`/api/v1/parks/${encodeURIComponent(parkId)}/shift-handovers`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function putPlatformRideMaster(
  assetId: string,
  body: Record<string, unknown>
): Promise<PlatformAsset> {
  return fetchEnvelope<PlatformAsset>(`/api/v1/assets/${encodeURIComponent(assetId)}/ride-master`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function postPlatformRideEnrichTemplate(
  assetId: string,
  templateCode?: string
): Promise<{ data: PlatformAsset; meta: { applied?: boolean; templateCode?: string } }> {
  const token = getAccessToken()
  const res = await fetch(url(`/api/v1/assets/${encodeURIComponent(assetId)}/ride-master/enrich-template`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ templateCode: templateCode || 'RIDE_DEFAULT' }),
  })
  const text = await res.text()
  const env = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(env.message || res.statusText)
  return env as { data: PlatformAsset; meta: { applied?: boolean; templateCode?: string } }
}

export async function getPlatformRuntimeOverrides(assetId: string): Promise<AssetRuntimeOverride[]> {
  return fetchEnvelope<AssetRuntimeOverride[]>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/runtime-overrides`
  )
}

export async function postPlatformRuntimeOverride(
  assetId: string,
  body: { payload: Record<string, unknown>; validFrom?: string | null; validTo?: string | null; active?: boolean }
): Promise<AssetRuntimeOverride> {
  return fetchEnvelope<AssetRuntimeOverride>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/runtime-overrides`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function patchPlatformRuntimeOverride(
  assetId: string,
  overrideId: string,
  body: { payload?: Record<string, unknown>; validFrom?: string | null; validTo?: string | null; active?: boolean }
): Promise<AssetRuntimeOverride> {
  return fetchEnvelope<AssetRuntimeOverride>(
    `/api/v1/assets/${encodeURIComponent(assetId)}/runtime-overrides/${encodeURIComponent(overrideId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function getPlatformParkRides(parkId?: string): Promise<PlatformAsset[]> {
  const q = parkId ? `?parkId=${encodeURIComponent(parkId)}` : ''
  return fetchEnvelope<PlatformAsset[]>(`/api/v1/park-rides${q}`)
}

export async function getPlatformLiveObservations(params?: {
  parkId?: string
  limit?: number
  metricCode?: string
}): Promise<PlatformObservation[]> {
  const q = new URLSearchParams()
  if (params?.parkId) q.set('parkId', params.parkId)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.metricCode) q.set('metricCode', params.metricCode)
  const qs = q.toString()
  return fetchEnvelope<PlatformObservation[]>(`/api/v1/observations/live${qs ? `?${qs}` : ''}`)
}

export async function postSyncThemeParksPark(themeParksParkUuid: string): Promise<ThemeParksSyncResult> {
  return fetchEnvelope<ThemeParksSyncResult>(
    `/api/v1/sync/themeparks/${encodeURIComponent(themeParksParkUuid)}`,
    { method: 'POST' }
  )
}

/** Full platform MDM sync using the park UUID from Integration settings (ThemeParks + Save selection). */
export async function postSyncThemeParksFromSettings(): Promise<ThemeParksSyncResult> {
  return fetchEnvelope<ThemeParksSyncResult>('/api/v1/sync/themeparks/from-settings', { method: 'POST' })
}

export async function getRideTemplates(): Promise<Array<Record<string, unknown>>> {
  return fetchEnvelope<Array<Record<string, unknown>>>('/api/v1/templates/ride')
}

export async function getStaffingTemplates(): Promise<Array<Record<string, unknown>>> {
  return fetchEnvelope<Array<Record<string, unknown>>>('/api/v1/templates/staffing')
}

export async function getMaintenanceTemplates(): Promise<Array<Record<string, unknown>>> {
  return fetchEnvelope<Array<Record<string, unknown>>>('/api/v1/templates/maintenance')
}

export type MasterDataEntityType =
  | 'parks'
  | 'rides'
  | 'shows'
  | 'restaurants'
  | 'shops'
  | 'zones'
  | 'templates'

export type MasterDataGridRow = {
  id: string
  entityKind: string
  name: string
  /** Platform slug when present (parks, zones, assets). */
  slug?: string | null
  type: string
  parkName: string | null
  parentName: string | null
  zoneName?: string | null
  provider: string | null
  externalId: string | null
  status: string
  waitTimeMin?: number | null
  active?: boolean
  templateId?: string | null
  templateCode?: string | null
  enrichmentStatus: string
  lastSyncedAt: string | null
  updatedAt: string | null
}

export type EntityTypeTemplateRow = {
  id: string
  entityType: string
  templateCode: string
  templateName: string
  description?: string | null
  defaultValuesJson: Record<string, unknown>
  requiredFieldsJson: string[]
  calculatedFieldsJson: string[]
  validationRulesJson: Record<string, unknown>
  activeFlag: boolean
  createdAt?: string
  updatedAt?: string
}

export type MasterDataListResponse = {
  rows: MasterDataGridRow[]
  total: number
  page: number
  pageSize: number
}

export type MasterDataExportItem = {
  id: string
  detail: Record<string, unknown>
  patch: Record<string, unknown>
}

export type MasterDataExportBundle = {
  schemaVersion: number
  entityType: string
  exportedAt: string
  filterEcho: Record<string, unknown>
  totalExported: number
  maxCap: number
  items: MasterDataExportItem[]
}

export type MasterDataImportResult = {
  entityType: string
  appliedCount: number
  appliedIds: string[]
  failedCount: number
  failed: Array<{ id?: string; error: string; code?: string }>
}

/** Full JSON export for the given tab (same filters as the grid; capped server-side, paged internally). */
export async function exportMasterDataBundle(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  params?: Record<string, string | number | undefined>
): Promise<MasterDataExportBundle> {
  const q = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v))
    }
  }
  const qs = q.toString()
  return fetchEnvelope<MasterDataExportBundle>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/export${qs ? `?${qs}` : ''}`
  )
}

/** Apply PATCH payloads from an export file (or any body with `items: [{ id, patch }]`). */
export async function importMasterDataBundle(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  body: { schemaVersion?: number; entityType?: string; items: { id: string; patch: Record<string, unknown> }[] }
): Promise<MasterDataImportResult> {
  return fetchEnvelope<MasterDataImportResult>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/import`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export type MasterDataSpreadsheetEntityType = 'rides' | 'shows' | 'restaurants' | 'shops'

async function readFailedResponseMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string }
    if (j?.message) return j.message
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`
}

/** Excel workbook — same filters as the grid; attractions / shows / restaurants / shops only. */
export async function exportMasterDataXlsxBlob(
  entityType: MasterDataSpreadsheetEntityType,
  params?: Record<string, string | number | undefined>
): Promise<Blob> {
  const q = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v))
    }
  }
  const qs = q.toString()
  const token = getAccessToken()
  const res = await fetch(
    url(`/api/v1/master-data/${encodeURIComponent(entityType)}/export/xlsx${qs ? `?${qs}` : ''}`),
    {
      headers: {
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  )
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readFailedResponseMessage(res))
  }
  return res.blob()
}

/** Multipart upload field name: `file` */
export async function importMasterDataXlsx(
  entityType: MasterDataSpreadsheetEntityType,
  file: File
): Promise<MasterDataImportResult> {
  const token = getAccessToken()
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(url(`/api/v1/master-data/${encodeURIComponent(entityType)}/import/xlsx`), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: fd,
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sp:unauthorized'))
    throw new Error(await readFailedResponseMessage(res))
  }
  const env = (await res.json()) as { success?: boolean; data?: MasterDataImportResult }
  if (!env.success || !env.data) throw new Error('Invalid import response')
  return env.data
}

export async function listMasterData(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  params?: Record<string, string | number | undefined>
): Promise<MasterDataListResponse> {
  const q = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v))
    }
  }
  const qs = q.toString()
  return fetchEnvelope<MasterDataListResponse>(`/api/v1/master-data/${encodeURIComponent(entityType)}${qs ? `?${qs}` : ''}`)
}

export async function listEntityTypeTemplates(entityType?: string): Promise<EntityTypeTemplateRow[]> {
  const q = new URLSearchParams()
  if (entityType) q.set('entityType', entityType)
  const qs = q.toString()
  return fetchEnvelope<EntityTypeTemplateRow[]>(`/api/v1/master-data/templates${qs ? `?${qs}` : ''}`)
}

export async function getEntityTypeTemplate(id: string): Promise<EntityTypeTemplateRow> {
  return fetchEnvelope<EntityTypeTemplateRow>(`/api/v1/master-data/templates/${encodeURIComponent(id)}`)
}

export async function applyMasterDataTemplate(
  entityType: Exclude<MasterDataEntityType, 'templates' | 'zones'>,
  entityId: string,
  templateId: string,
  options?: { mode?: 'fill_empty' | 'override' }
): Promise<Record<string, unknown>> {
  const body: Record<string, string> = { templateId }
  if (options?.mode) body.mode = options.mode
  return fetchEnvelope<Record<string, unknown>>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/apply-template`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function getMasterDataAssetDetail(assetId: string): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/master-data/assets/${encodeURIComponent(assetId)}`)
}

export async function getMasterDataDetail(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  id: string
): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`
  )
}

export async function patchMasterData(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  id: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deactivateMasterData(
  entityType: Exclude<MasterDataEntityType, 'templates'>,
  id: string
): Promise<{ ok: boolean }> {
  return fetchEnvelope<{ ok: boolean }>(
    `/api/v1/master-data/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
}

export async function createManualMasterDataAsset(
  entityType: 'rides' | 'shows' | 'restaurants' | 'shops',
  body: { parkId: string; name: string; slug?: string; asset?: { status?: string } }
): Promise<Record<string, unknown>> {
  return fetchEnvelope<Record<string, unknown>>(`/api/v1/master-data/${encodeURIComponent(entityType)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function getMasterDataAssetEnrichment(assetId: string): Promise<{
  assetId: string
  enrichment: Record<string, unknown>
  locks: Record<string, unknown>
}> {
  return fetchEnvelope(`/api/v1/master-data/assets/${encodeURIComponent(assetId)}/enrichment`)
}

export async function patchMasterDataAssetEnrichment(
  assetId: string,
  body: { enrichment?: Record<string, unknown>; locks?: Record<string, string[]> }
): Promise<{ assetId: string; enrichment: Record<string, unknown>; locks: Record<string, unknown> }> {
  return fetchEnvelope(`/api/v1/master-data/assets/${encodeURIComponent(assetId)}/enrichment`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
