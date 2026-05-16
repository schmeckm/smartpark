/// <reference types="vite/client" />

declare module '@smartpark-root-utils/uns-mqtt-live-signal-match.js' {
  export function collectMatchingLiveEvents<T extends object>(signal: object, events: readonly T[]): T[]
}

declare module '@smartpark-root-utils/signal-availability-resolver.js' {
  export type SignalAvailabilityKind = 'LIVE_AVAILABLE' | 'LIVE_STALE' | 'MISSING' | 'NOT_EXPECTED'
  export const DEFAULT_FRESHNESS_MS: number
  export const DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES: Set<string>
  export function expectsRealtimeUns(signalSource: string): boolean
  export function resolveSignalAvailability(params: {
    nowMs: number
    freshnessThresholdMs?: number
    assetSlug: string
    signalCode: string
    canonicalUnsTopic: string | null | undefined
    sparkplugMetricPreview: string | null | undefined
    mqttLiveEvents: readonly object[]
    unsLatestStates: readonly object[]
    signalSource: string
    required: boolean
    enabled?: boolean
  }): {
    kind: SignalAvailabilityKind
    lastSeenIso: string | null
    lastValueDisplay: string | null
    quality: string | null
    required: boolean
  }
  export function computeReadiness(
    rows: Array<{
      kind: SignalAvailabilityKind
      required: boolean
      signalSource: string
      useForMl?: boolean
      useForForecast?: boolean
    }>,
  ): {
    operationalReady: boolean
    realtimeHealthy: boolean
    mlReady: boolean
    forecastReady: boolean
  }
}

declare module 'leaflet.heat'

declare module '@/utils/tomtomRouteGeometry.mjs' {
  export function extractTomTomRouteLatLngs(providerRawResponse: unknown): [number, number][]
  export function tomTomRawJsonMayExposeApiKey(root: unknown): boolean
}

declare module '@/utils/mlForecastHealthStrip.mjs' {
  export const DQ_MODEL_RELEVANT_PATTERN: RegExp
  export function reasonCodesList(reasonCodesJson: unknown): string[]
  export function countNoGovernedSnapshotHorizons(results: unknown[] | null | undefined): number
  export function hasMixedMlBaselineRows(results: unknown[] | null | undefined): boolean
  export function flattenFeatureDataQualityWarnings(dq: unknown): string[]
  export function dqHintsSuggestModelGap(warnings: readonly string[] | null | undefined): boolean
  export function computeMissingFeaturesTotal(kpis: unknown): number | null
  export function badgeFeatureCompleteness(avgCompletenessScore: unknown): 'ok' | 'warning' | 'critical' | 'unknown'
  export function badgeMissingFeatures(totalMissing: unknown): 'ok' | 'warning' | 'critical' | 'unknown'
  export function badgeTraceQuality(
    totalTraces: unknown,
    fallbackCount: unknown,
    opts?: { closedPeriodTraceCount?: number },
  ): 'ok' | 'warning' | 'critical' | 'unknown' | 'na'
  export function badgeModelDataMismatch(args: {
    results: unknown[] | null | undefined
    dqWarnings: readonly string[] | null | undefined
  }): 'ok' | 'warning'
  export function badgeCoefficientAvailability(
    engineMode: 'ridge' | 'baseline' | 'fallback' | 'unknown',
    coefRows: unknown,
    hasSelection: boolean,
    detailLoading: boolean,
  ): 'ok' | 'warning' | 'unknown' | 'na'
  export function badgeExplanationHealth(lowConfidenceForecastCount: unknown): 'ok' | 'warning' | 'critical' | 'unknown'
  export function badgeForecastAccuracyHealth(
    mapeDecimal: unknown,
    context?: { kpi?: unknown },
  ): 'ok' | 'warning' | 'critical' | 'unknown' | 'na'
  export function badgeStaleSignals(
    staleCount: unknown,
    liveCount: unknown,
    apiAvailable: boolean,
  ): 'ok' | 'warning' | 'critical' | 'unknown' | 'na'
}

interface Window {
  /** Injected in `index.html` by Vite when `VITE_LOGIN_HERO_IMAGE` is set at server start. */
  __SP_LOGIN_HERO__?: string
}

interface ImportMetaEnv {
  readonly VITE_USE_OPERATIONS_FACTS_FOR_RIDE_DASHBOARD?: string
  readonly VITE_API_URL?: string
  /** Optional login hero (`public/` path or absolute URL). */
  readonly VITE_LOGIN_HERO_IMAGE?: string
  /** Repository root semver (injected in vite.config.ts from ../package.json). */
  readonly VITE_REPO_VERSION?: string
  /** Optional Git SHA from build env GIT_COMMIT. */
  readonly VITE_GIT_COMMIT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
