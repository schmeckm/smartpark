<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { io, type Socket } from 'socket.io-client'
import RecommendationAiSection from '@/components/RecommendationAiSection.vue'
import RideAiExplainabilityCard from '@/components/RideAiExplainabilityCard.vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import {
  getAiFactorConfigs,
  getCanonicalMessages,
  getEntityForecastExplanation,
  getIntegrationSettings,
  getMlGlobalFactors,
  getMlParkFactors,
  getParkForecastSummary,
  patchMlParkFactors,
  patchIntegrationSettings,
  type AiFactorConfig,
  type MlGlobalFactorRow,
  type MlParkFactorRow,
  type ParkForecastSummary,
  type PredictionExplainability,
} from '@/api/client'
import { useParkContextStore } from '@/stores/parkContext'
import { resolveApiOrigin } from '@/utils/apiOrigin'

const { t } = useI18n()
const { push: toast } = useToast()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const canManageIntegrations = () => auth.hasPermission('integrations', 'manage')

const scoringSectionRef = shallowRef<InstanceType<typeof RecommendationAiSection> | null>(null)

const apiOrigin = resolveApiOrigin()
const extraSocket = shallowRef<Socket | null>(null)
const selectedExternalParkName = ref<string>('')
const selectedExternalParkId = ref<string>('')
const selectedProvider = ref<string>('themeparks_wiki')
const parkForecast = ref<ParkForecastSummary | null>(null)
const parkLoading = ref(false)
const parkForecastSource = ref<'selected' | 'auto' | 'none'>('none')
const externalLiveRows = ref<
  Array<{ id: string; name: string; waitTime: number | null; status: string | null; isOpen: boolean | null }>
>([])
const selectedExplainEntityId = ref<string>('')
const selectedExplainability = ref<PredictionExplainability | null>(null)
const explainabilityLoading = ref(false)
const explainabilityError = ref<string | null>(null)

const aiForecastFactors = ref<AiFactorConfig[]>([])
const aiFactorsLoading = ref(false)
const showHubNav = ref(false)
const showAllFactors = ref(false)
const showLiveAttractions = ref(false)
const currentFlowStep = ref<'input' | 'forecast' | 'result'>('input')

const primaryFactors = computed(() => (showAllFactors.value ? aiForecastFactors.value : aiForecastFactors.value.slice(0, 6)))
const hiddenFactorCount = computed(() => Math.max(0, aiForecastFactors.value.length - primaryFactors.value.length))
const parkContextId = computed(() => parkCtx.activeParkId)
const dynamicParkMode = computed(() => Boolean(parkContextId.value))
const needsParkSelection = computed(
  () => !parkContextId.value || !parkCtx.activePark?.externalEntityId,
)
type ProviderSettings = { provider?: string }
type ParkSettings = { externalParkId?: string; parkName?: string }
type LiveRow = { id: string; name: string; waitTime: number | null; status: string | null; isOpen: boolean | null }

const FACTOR_SOURCE_OVERRIDES: Record<string, { source: 'adapter' | 'manual' | 'derived'; provider: string | null }> = {
  weather_rain: { source: 'adapter', provider: 'weather_open_meteo' },
  holiday_index: { source: 'adapter', provider: 'calendar_school_holidays' },
}

function asRec(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return row && typeof row === 'object' ? row : {}
}

function sourceFromType(v: unknown): 'manual' | 'adapter' | 'derived' {
  const t = String(v || '').toUpperCase()
  if (t.includes('DERIV')) return 'derived'
  if (t.includes('ADAPTER') || t.includes('MQTT') || t.includes('CANON')) return 'adapter'
  return 'manual'
}

function sourceTypeFromSource(v: string | null | undefined): string {
  if (v === 'derived') return 'DERIVED'
  if (v === 'adapter') return 'ADAPTER'
  return 'MANUAL'
}

function normalizeFactorRow(f: AiFactorConfig): AiFactorConfig {
  const override = FACTOR_SOURCE_OVERRIDES[f.code]
  return override ? { ...f, source: override.source, provider: override.provider } : f
}

function mapDynamicRows(globalRows: MlGlobalFactorRow[], parkRows: MlParkFactorRow[]): AiFactorConfig[] {
  const parkByCode = new Map<string, Record<string, unknown>>()
  for (const p of parkRows) {
    const pr = asRec(p as Record<string, unknown>)
    const code = String(pr.factorCode ?? pr.factor_code ?? '').trim()
    if (code) parkByCode.set(code, pr)
  }
  const out: AiFactorConfig[] = []
  const seen = new Set<string>()
  for (const g of globalRows) {
    const gr = asRec(g as Record<string, unknown>)
    const code = String(gr.factorCode ?? gr.factor_code ?? '').trim()
    if (!code) continue
    seen.add(code)
    const pr = parkByCode.get(code) || {}
    const sourceType = pr.sourceType ?? pr.source_type ?? gr.sourceType ?? gr.source_type
    out.push(
      normalizeFactorRow({
        code,
        label: String(gr.factorName ?? gr.factor_name ?? code),
        enabled: (pr.activeFlag ?? pr.active_flag ?? gr.activeFlag ?? gr.active_flag) !== false,
        scope: 'PARK',
        weight: Number(pr.weightOverride ?? pr.weight_override ?? gr.weight ?? 1),
        lagMinutes: Number(gr.lagMinutes ?? gr.lag_minutes ?? 0),
        value: Number(pr.currentValue ?? pr.current_value ?? gr.currentValue ?? gr.current_value ?? gr.defaultValue ?? gr.default_value ?? 0),
        source: sourceFromType(sourceType),
        provider: String(pr.provider ?? gr.provider ?? '') || null,
      })
    )
  }
  for (const p of parkRows) {
    const pr = asRec(p as Record<string, unknown>)
    const code = String(pr.factorCode ?? pr.factor_code ?? '').trim()
    if (!code || seen.has(code)) continue
    out.push(
      normalizeFactorRow({
        code,
        label: code,
        enabled: (pr.activeFlag ?? pr.active_flag) !== false,
        scope: 'PARK',
        weight: Number(pr.weightOverride ?? pr.weight_override ?? 1),
        lagMinutes: 0,
        value: Number(pr.currentValue ?? pr.current_value ?? 0),
        source: sourceFromType(pr.sourceType ?? pr.source_type),
        provider: String(pr.provider ?? '') || null,
      })
    )
  }
  return out
}

async function loadAiFactors() {
  aiFactorsLoading.value = true
  try {
    if (dynamicParkMode.value && parkContextId.value) {
      const [globals, parkRows] = await Promise.all([getMlGlobalFactors(), getMlParkFactors(parkContextId.value)])
      aiForecastFactors.value = mapDynamicRows(globals, parkRows)
      return
    }
    const s = await getIntegrationSettings()
    const raw = Array.isArray((s.aiForecastFactors as unknown[] | undefined))
      ? ((s.aiForecastFactors as AiFactorConfig[]) || [])
      : await getAiFactorConfigs()
    aiForecastFactors.value = raw.map((f) => normalizeFactorRow(f))
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load forecast factors', 'error')
    aiForecastFactors.value = []
  } finally {
    aiFactorsLoading.value = false
  }
}

async function saveAiFactors() {
  if (!canManageIntegrations()) {
    toast('Saving factors requires Integrations (manage) permission.', 'error')
    return
  }
  try {
    if (dynamicParkMode.value && parkContextId.value) {
      await patchMlParkFactors(parkContextId.value, {
        factors: aiForecastFactors.value.map((f) => ({
          factorCode: f.code,
          weightOverride: Number(f.weight),
          currentValue: Number(f.value),
          activeFlag: Boolean(f.enabled),
          sourceType: sourceTypeFromSource(f.source),
          provider: f.provider || null,
        })),
      })
      toast('Park factors saved', 'success')
      await loadAiFactors()
      return
    }
    await patchIntegrationSettings({
      aiForecastFactors: aiForecastFactors.value.map((f) => ({
        ...f,
        weight: Number(f.weight),
        lagMinutes: Number(f.lagMinutes),
        value: Number(f.value),
      })),
    })
    toast('Forecast factors saved', 'success')
    await loadAiFactors()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to save factors', 'error')
  }
}

function readParkContext(settings: Record<string, unknown>) {
  const park = (settings.selectedPark as ParkSettings | undefined) || {}
  const provider = ((settings.selectedProvider as ProviderSettings | undefined)?.provider || 'themeparks_wiki').trim()
  return {
    provider,
    externalParkId: park.externalParkId || '',
    parkName: park.parkName || park.externalParkId || '',
  }
}

async function resolveFallbackParkId(provider: string) {
  const latest = await getCanonicalMessages({
    provider,
    messageType: 'WAIT_TIME_UPDATED',
    limit: 1,
  })
  const fallback = latest[0]
  if (!fallback?.externalParkId) return null
  return {
    externalParkId: fallback.externalParkId,
    parkName: `Auto (${fallback.externalParkId.slice(0, 8)}...)`,
  }
}

async function loadLiveRows(externalParkId: string, provider: string): Promise<LiveRow[]> {
  const messages = await getCanonicalMessages({
    provider,
    externalParkId,
    messageType: 'WAIT_TIME_UPDATED',
    limit: 500,
  })
  const byEntity = new Map<string, LiveRow>()
  for (const msg of messages) {
    if (!msg.externalEntityId) continue
    const payload = (msg.payload || {}) as Record<string, unknown>
    byEntity.set(msg.externalEntityId, {
      id: msg.externalEntityId,
      name: typeof payload.externalEntityName === 'string' ? payload.externalEntityName : msg.externalEntityId,
      waitTime: typeof payload.waitTime === 'number' ? payload.waitTime : null,
      status: typeof payload.status === 'string' ? payload.status : null,
      isOpen: typeof payload.isOpen === 'boolean' ? payload.isOpen : null,
    })
  }
  return [...byEntity.values()]
}

function clearForecastState() {
  parkForecast.value = null
  parkForecastSource.value = 'none'
  externalLiveRows.value = []
}

function sourceLabel(source: string | null | undefined) {
  if (source === 'derived') return 'Calculated'
  if (source === 'adapter') return 'Adapter/MQTT'
  return 'Manual'
}

function sourceProvider(provider: string | null | undefined, source: string | null | undefined) {
  if (source !== 'adapter') return ''
  return String(provider || 'adapter_provider')
}

function sourceClass(source: string | null | undefined) {
  if (source === 'derived') return 'border-fuchsia-700/50 bg-fuchsia-950/20 text-fuchsia-200'
  if (source === 'adapter') return 'border-emerald-700/50 bg-emerald-950/20 text-emerald-200'
  return 'border-amber-700/50 bg-amber-950/20 text-amber-200'
}

function connectExtraAiSocket() {
  const token = auth.accessToken
  if (!token || !auth.hasPermission('ai', 'read')) return
  const s = apiOrigin
    ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
  extraSocket.value = s
  s.on('ai:recommendation-scored', () => {
    toast('AI scoring updated for recommendation', 'info')
    scoringSectionRef.value?.load?.()
  })
  s.on('external:parkdata:updated', () => {
    void loadSelectedParkForecast()
  })
  s.on('external:mapping:updated', () => {
    void loadSelectedParkForecast()
  })
}

const externalLiveSummary = {
  total: () => externalLiveRows.value.length,
  open: () => externalLiveRows.value.filter((x) => x.isOpen === true).length,
  avgWait: () => {
    const waits = externalLiveRows.value.map((x) => x.waitTime).filter((x): x is number => typeof x === 'number')
    if (!waits.length) return null
    return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
  },
  topWaits: () =>
    [...externalLiveRows.value]
      .filter((x) => typeof x.waitTime === 'number')
      .sort((a, b) => (b.waitTime || 0) - (a.waitTime || 0))
      .slice(0, 8),
}

async function loadSelectedParkForecast() {
  parkLoading.value = true
  try {
    const extFromPark = parkCtx.activePark?.externalEntityId
      ? String(parkCtx.activePark.externalEntityId).trim()
      : ''
    if (!parkContextId.value || !extFromPark) {
      clearForecastState()
      parkForecastSource.value = 'none'
      return
    }

    const settings = (await getIntegrationSettings().catch(() => ({}))) as Record<string, unknown>
    const context = readParkContext(settings)
    const provider = context.provider || 'themeparks_wiki'
    selectedProvider.value = provider
    selectedExternalParkId.value = extFromPark
    selectedExternalParkName.value = parkCtx.activePark?.name || extFromPark
    parkForecastSource.value = 'selected'

    parkForecast.value = await getParkForecastSummary(selectedExternalParkId.value, provider)
    externalLiveRows.value = await loadLiveRows(selectedExternalParkId.value, provider)
    if (!externalLiveRows.value.length) {
      selectedExplainEntityId.value = ''
      selectedExplainability.value = null
      explainabilityError.value = null
      return
    }
    if (!selectedExplainEntityId.value || !externalLiveRows.value.some((x) => x.id === selectedExplainEntityId.value)) {
      selectedExplainEntityId.value = externalLiveRows.value[0].id
    }
    await loadSelectedEntityExplainability()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load selected park forecast', 'error')
  } finally {
    parkLoading.value = false
  }
}

const selectedExplainEntityName = computed(() => {
  if (!selectedExplainEntityId.value) return ''
  const row = externalLiveRows.value.find((x) => x.id === selectedExplainEntityId.value)
  return row ? row.name : selectedExplainEntityId.value
})

async function loadSelectedEntityExplainability() {
  if (!selectedExternalParkId.value || !selectedExplainEntityId.value) {
    selectedExplainability.value = null
    explainabilityError.value = null
    return
  }
  explainabilityLoading.value = true
  explainabilityError.value = null
  try {
    const data = await getEntityForecastExplanation(selectedExplainEntityId.value, {
      externalParkId: selectedExternalParkId.value,
      provider: selectedProvider.value,
      horizon: 60,
    })
    selectedExplainability.value = data.explainability ?? null
  } catch (e) {
    selectedExplainability.value = null
    explainabilityError.value = e instanceof Error ? e.message : 'Failed to load explainability'
  } finally {
    explainabilityLoading.value = false
  }
}

connectExtraAiSocket()

onMounted(() => {
  void loadSelectedParkForecast()
  void loadAiFactors()
})

onUnmounted(() => {
  extraSocket.value?.disconnect()
  extraSocket.value = null
})

watch(selectedExplainEntityId, () => {
  if (!selectedExplainEntityId.value) return
  void loadSelectedEntityExplainability()
})

watch(
  () => [parkCtx.activeParkId, parkCtx.activePark?.externalEntityId] as const,
  () => {
    void loadSelectedParkForecast()
    void loadAiFactors()
  },
)
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <header class="space-y-2">
      <h1 class="font-display text-xl font-semibold text-white">{{ t('aiInsightsHub.title') }}</h1>
      <p class="max-w-3xl text-sm text-slate-400">
        Process flow: input parameters (X) are configured first, then transformed into forecast and scoring results (Y).
      </p>
    </header>

    <div
      v-if="needsParkSelection"
      class="rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200"
      data-testid="ai-insights-need-park"
    >
      {{ t('aiInsightsHub.needPark') }}
    </div>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 class="text-base font-semibold text-white">X to Y process</h2>
      <p class="mt-1 text-xs text-slate-500">The page follows one direction: define X, compute, validate, produce Y.</p>
      <div class="mt-3 rounded-lg border border-brand-700/40 bg-brand-950/20 p-3 text-xs text-brand-100">
        <span class="font-semibold">Input X:</span> factor values, scope, lag, park context
        <span class="mx-2 text-brand-300">→</span>
        <span class="font-semibold">Model step:</span> forecast engine
        <span class="mx-2 text-brand-300">→</span>
        <span class="font-semibold">Output Y:</span> crowd/forecast/confidence + recommendation scores
      </div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-[11px] uppercase tracking-wide text-slate-500">Step 1</p>
          <p class="mt-1 text-sm font-medium text-slate-100">Input X: configure factors</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-[11px] uppercase tracking-wide text-slate-500">Step 2</p>
          <p class="mt-1 text-sm font-medium text-slate-100">Commit X to model config</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-[11px] uppercase tracking-wide text-slate-500">Step 3</p>
          <p class="mt-1 text-sm font-medium text-slate-100">Preview output Y (forecast)</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-[11px] uppercase tracking-wide text-slate-500">Step 4</p>
          <p class="mt-1 text-sm font-medium text-slate-100">Finalize output Y (scoring)</p>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs"
          :class="currentFlowStep === 'input' ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-200'"
          @click="currentFlowStep = 'input'"
        >
          1) Input X
        </button>
        <span class="text-slate-500">→</span>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs"
          :class="currentFlowStep === 'forecast' ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-200'"
          @click="currentFlowStep = 'forecast'"
        >
          2) Forecast Y
        </button>
        <span class="text-slate-500">→</span>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs"
          :class="currentFlowStep === 'result' ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-200'"
          @click="currentFlowStep = 'result'"
        >
          3) Ergebnis Y
        </button>
      </div>
      <button
        type="button"
        class="mt-4 text-xs text-brand-400 hover:text-brand-300"
        @click="showHubNav = !showHubNav"
      >
        {{ showHubNav ? 'Hide tools & subpages' : 'Show tools & subpages' }}
      </button>

      <div v-if="showHubNav" class="mt-4 grid gap-3 sm:grid-cols-3">
        <div
          v-if="currentFlowStep === 'forecast'"
          class="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiHub.groupForecasts') }}</p>
          <ul class="mt-2 space-y-2 text-sm">
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ride-waits">{{ t('aiRideGrid.navLink') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/timeseries">{{ t('aiTimeseries.navLink') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/accuracy">{{ t('aiAccuracy.navLink') }}</RouterLink>
            </li>
          </ul>
        </div>
        <div
          v-if="currentFlowStep === 'input'"
          class="rounded-lg border border-brand-700/50 bg-brand-950/20 p-3"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiHub.groupMl') }}</p>
          <ul class="mt-2 space-y-2 text-sm">
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-global-factors">
                {{ t('aiHub.navMlGlobalCatalog') }}
              </RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-park-factors">
                {{ t('aiHub.navMlParkWeights') }}
              </RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-profiles">
                {{ t('aiHub.navMlProfiles') }}
              </RouterLink>
            </li>
          </ul>
        </div>
        <div
          v-if="currentFlowStep === 'result'"
          class="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiHub.groupData') }}</p>
          <p class="mt-1 text-[11px] text-slate-500">{{ t('aiHub.resultFeatureStoreBlurb') }}</p>
          <ul class="mt-2 space-y-2 text-sm">
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/feature-store-monitor">
                {{ t('aiHub.resultFeatureStoreLink') }}
              </RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/data-quality">{{ t('aiDq.title') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="font-medium text-brand-300 hover:text-white" to="/ai-insights/studio">{{ t('menu.aiModelsTraining') }}</RouterLink>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="showHubNav" class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-sm">
        <a href="#recommendations-engine" class="text-brand-400 hover:text-brand-300">{{ t('aiHub.recLink') }}</a>
        <div class="max-w-xl text-right text-[11px] leading-snug text-slate-500">
          <RouterLink to="/" class="text-slate-400 hover:text-slate-300">{{ t('aiHub.opsDash') }}</RouterLink>
          <p class="mt-1">{{ t('aiHub.zoneHotspotSummaryHint') }}</p>
        </div>
      </div>
    </section>

    <section v-if="currentFlowStep === 'input'" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">Step 1–2: Input parameters (X)</h2>
          <p class="mt-1 text-xs text-slate-500">
            Stored in integration settings; they tune how external signals (weather, crowds, etc.) feed the forecast model. Park
            context comes from
            <RouterLink class="text-brand-400 hover:text-brand-300" to="/integrations">Integrations</RouterLink>
            (selected park).
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canManageIntegrations() || aiFactorsLoading"
          @click="saveAiFactors"
        >
          Save factors
        </button>
      </div>
      <p v-if="!canManageIntegrations()" class="mt-2 text-xs text-amber-200/90">
        View only: saving requires the <span class="font-mono">integrations</span> · <span class="font-mono">manage</span> permission.
      </p>
      <p class="mt-2 text-xs text-slate-500">
        Default view shows the most relevant factors first. Expand only when you need detailed tuning.
      </p>
      <p class="mt-1 text-xs text-slate-500">
        After saving, the system applies X to forecasting and generates output Y in the next section.
      </p>
      <p class="mt-1 text-xs text-slate-500">
        Enduser-Logik: Step A = X anlegen + Datenquelle, Step B = X fuer den aktuellen Prozess gewichten.
      </p>
      <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p class="text-xs font-semibold text-slate-200">Step A — X-Faktor anlegen & Datenquelle zuweisen</p>
        <p class="mt-1 text-xs text-slate-500">
          Neue X-Faktoren zuerst im Katalog anlegen (global oder entity-spezifisch). Dort wird auch die Datenquelle definiert.
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <RouterLink
            to="/ai-insights/ml-global-factors"
            class="inline-block rounded border border-brand-600/60 px-2 py-1 text-xs text-brand-300 hover:border-brand-400 hover:text-brand-200"
          >
            {{ t('aiHub.stepAaddGlobalFactor') }}
          </RouterLink>
          <RouterLink
            to="/ai-insights/ml-profiles"
            class="inline-block rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:border-slate-400 hover:text-white"
          >
            {{ t('aiHub.stepAprofiles') }}
          </RouterLink>
          <RouterLink
            to="/ai-insights/ml-park-factors"
            class="inline-block rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:border-slate-400 hover:text-white"
          >
            {{ t('aiHub.stepAparOverrides') }}
          </RouterLink>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span class="rounded border border-emerald-700/50 bg-emerald-950/20 px-2 py-0.5 text-emerald-200">
            Adapter/MQTT: adapter emits to MQTT topics, then Canonical Message Model
          </span>
          <span class="rounded border border-amber-700/50 bg-amber-950/20 px-2 py-0.5 text-amber-200">
            Manual: set by user/config
          </span>
          <span class="rounded border border-fuchsia-700/50 bg-fuchsia-950/20 px-2 py-0.5 text-fuchsia-200">
            Calculated: derived by system logic
          </span>
        </div>
      </div>
      <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p class="text-xs font-semibold text-slate-200">Step B — Input X gewichten (für den aktuellen Prozess)</p>
        <p class="mt-1 text-xs text-slate-500">
          Hier aktivierst du vorhandene Faktoren und definierst Gewichtung, Scope, Lag und Wert für die Berechnung.
        </p>
        <div class="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span class="rounded border border-slate-700 px-2 py-0.5 text-slate-300">PARK = parkweit</span>
          <span class="rounded border border-slate-700 px-2 py-0.5 text-slate-300">ENTITY_TYPE = z. B. alle Rides</span>
          <span class="rounded border border-slate-700 px-2 py-0.5 text-slate-300">ENTITY = einzelnes Fahrgeschäft</span>
        </div>
      </div>
      <div v-if="aiFactorsLoading" class="mt-3 text-xs text-slate-400">Loading factors…</div>
      <div v-else class="mt-3 overflow-auto">
        <table class="min-w-full text-xs">
          <thead class="text-slate-500">
            <tr>
              <th class="px-2 py-1 text-left">Enabled</th>
              <th class="px-2 py-1 text-left">Factor</th>
              <th class="px-2 py-1 text-left">Scope</th>
              <th class="px-2 py-1 text-left">Weight</th>
              <th class="px-2 py-1 text-left">Lag (min)</th>
              <th class="px-2 py-1 text-left">Value</th>
              <th class="px-2 py-1 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in primaryFactors" :key="f.code" class="border-t border-slate-800">
              <td class="px-2 py-1">
                <input v-model="f.enabled" type="checkbox" :disabled="!canManageIntegrations()" />
              </td>
              <td class="px-2 py-1">
                <div class="font-medium text-slate-200">{{ f.label }}</div>
                <div class="text-[11px] text-slate-500">{{ f.code }}</div>
              </td>
              <td class="px-2 py-1">
                <select v-model="f.scope" class="rounded border border-slate-700 bg-slate-950 px-2 py-1" :disabled="!canManageIntegrations()">
                  <option value="PARK">PARK</option>
                  <option value="ENTITY_TYPE">ENTITY_TYPE</option>
                  <option value="ENTITY">ENTITY</option>
                </select>
              </td>
              <td class="px-2 py-1">
                <input
                  v-model.number="f.weight"
                  type="number"
                  step="0.05"
                  min="-2"
                  max="2"
                  class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:opacity-50"
                  :disabled="!canManageIntegrations()"
                />
              </td>
              <td class="px-2 py-1">
                <input
                  v-model.number="f.lagMinutes"
                  type="number"
                  min="0"
                  max="360"
                  class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:opacity-50"
                  :disabled="!canManageIntegrations()"
                />
              </td>
              <td class="px-2 py-1">
                <input
                  v-model.number="f.value"
                  type="number"
                  step="0.05"
                  min="-1"
                  max="1"
                  :disabled="f.source === 'derived' || f.source === 'adapter' || !canManageIntegrations()"
                  class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:opacity-50"
                />
              </td>
              <td class="px-2 py-1">
                <span class="rounded border px-2 py-0.5 text-[11px]" :class="sourceClass(f.source)">
                  {{ sourceLabel(f.source) }}<template v-if="f.source === 'adapter'"> ({{ sourceProvider(f.provider, f.source) }})</template>
                </span>
                <RouterLink
                  v-if="f.source === 'adapter'"
                  :to="{
                    name: 'adapter-pipeline-log',
                    query: sourceProvider(f.provider, f.source) ? { adapterKey: sourceProvider(f.provider, f.source) } : {},
                  }"
                  class="mt-1 block text-[11px] text-brand-400 hover:text-brand-300"
                >
                  Letzte Werte / Laufstatus ansehen
                </RouterLink>
                <RouterLink
                  v-if="f.source === 'adapter' && sourceProvider(f.provider, f.source)"
                  :to="{ name: 'integration-detail', params: { id: sourceProvider(f.provider, f.source) } }"
                  class="mt-0.5 block text-[11px] text-slate-300 hover:text-white"
                >
                  Adapter konfigurieren (Polling/Config)
                </RouterLink>
              </td>
            </tr>
            <tr v-if="!aiForecastFactors.length">
              <td colspan="7" class="px-2 py-3 text-center text-slate-500">No factors configured</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="hiddenFactorCount > 0" class="mt-3">
        <button
          type="button"
          class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
          @click="showAllFactors = !showAllFactors"
        >
          {{ showAllFactors ? 'Show fewer factors' : `Show all factors (${hiddenFactorCount} more)` }}
        </button>
      </div>
      <div class="mt-4 flex justify-end border-t border-slate-800 pt-3">
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
          @click="currentFlowStep = 'forecast'"
        >
          Weiter zu Forecast Y →
        </button>
      </div>
    </section>

    <section v-if="currentFlowStep === 'forecast'" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">Step 3: Forecast output (Y preview)</h2>
          <p class="mt-1 text-xs text-slate-400">
            {{ selectedExternalParkName || 'No park selected in Integrations' }}
          </p>
          <p class="mt-1 text-[11px] text-slate-600">
            Configure park under
            <RouterLink class="text-brand-400 hover:text-brand-300" to="/integrations">Integrations</RouterLink>.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-300">
            Source:
            {{
              parkForecastSource === 'selected'
                ? 'selected park'
                : parkForecastSource === 'auto'
                  ? 'auto fallback'
                  : 'none'
            }}
          </span>
          <button
            type="button"
            class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
            @click="loadSelectedParkForecast"
          >
            Refresh
          </button>
        </div>
      </div>

      <div v-if="parkLoading" class="mt-4 text-xs text-slate-400">Loading park forecast & live waits…</div>
      <div v-else-if="!selectedExternalParkId" class="mt-4 text-xs text-slate-500">
        Select a park under Integrations, then save — or wait for adapter messages to populate a fallback.
      </div>
      <template v-else>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-xs text-slate-400">Crowd</p>
            <p class="mt-1 text-2xl font-semibold text-white">
              {{ parkForecast?.crowdLevelPercent == null ? '—' : `${parkForecast.crowdLevelPercent}%` }}
            </p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-xs text-slate-400">Forecast 15m</p>
            <p class="mt-1 text-2xl font-semibold text-white">
              {{ parkForecast?.forecast15Minutes == null ? '—' : `${parkForecast.forecast15Minutes}m` }}
            </p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-xs text-slate-400">Forecast 60m</p>
            <p class="mt-1 text-2xl font-semibold text-white">
              {{ parkForecast?.forecast60Minutes == null ? '—' : `${parkForecast.forecast60Minutes}m` }}
            </p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-xs text-slate-400">Trend</p>
            <p
              class="mt-1 text-2xl font-semibold"
              :class="
                parkForecast?.trend === 'RISING'
                  ? 'text-rose-300'
                  : parkForecast?.trend === 'FALLING'
                    ? 'text-emerald-300'
                    : 'text-amber-300'
              "
            >
              {{ parkForecast?.trend || '—' }}
            </p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-xs text-slate-400">Confidence</p>
            <p class="mt-1 text-2xl font-semibold text-white">
              {{ parkForecast?.confidence == null ? '—' : `${Math.round(parkForecast.confidence * 100)}%` }}
            </p>
          </div>
        </div>

        <section v-if="externalLiveRows.length" class="mt-4 rounded-lg border border-slate-800 bg-slate-950/35 p-3">
          <div class="mb-2 flex flex-wrap items-end gap-2">
            <h3 class="text-sm font-semibold text-slate-100">Entity explainability</h3>
            <span class="text-[11px] text-slate-500">Compact ADR explanation for selected external entity.</span>
          </div>
          <div class="mb-3 flex flex-wrap items-end gap-2">
            <label class="text-xs text-slate-400" for="ai-insights-entity-select">Entity</label>
            <select
              id="ai-insights-entity-select"
              v-model="selectedExplainEntityId"
              class="min-w-[18rem] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option v-for="r in externalLiveRows" :key="r.id" :value="r.id">
                {{ r.name }} ({{ r.id }})
              </option>
            </select>
            <button
              type="button"
              class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
              @click="loadSelectedEntityExplainability"
            >
              Refresh explanation
            </button>
          </div>
          <p v-if="explainabilityError" class="mb-2 text-xs text-rose-300">{{ explainabilityError }}</p>
          <RideAiExplainabilityCard
            :title="selectedExplainEntityName ? `ADR forecast — ${selectedExplainEntityName}` : 'ADR forecast'"
            :payload="selectedExplainability"
            :loading="explainabilityLoading"
          />
        </section>

        <div class="mt-8 border-t border-slate-800 pt-6">
          <h3 class="text-sm font-semibold text-white">{{ t('aiHub.parkLiveHeading') }}</h3>
          <p class="mt-1 text-xs text-slate-500">Canonical <span class="font-mono">WAIT_TIME_UPDATED</span> for this external park.</p>
          <button
            type="button"
            class="mt-3 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
            @click="showLiveAttractions = !showLiveAttractions"
          >
            {{ showLiveAttractions ? 'Hide live attractions' : 'Show live attractions' }}
          </button>
        </div>
        <div v-if="showLiveAttractions" class="mt-4 space-y-3">
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            Entities <span class="ml-2 text-white">{{ externalLiveSummary.total() }}</span>
          </div>
          <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            Open <span class="ml-2 text-white">{{ externalLiveSummary.open() }}</span>
          </div>
          <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            Avg wait
            <span class="ml-2 text-white">{{
              externalLiveSummary.avgWait() == null ? '—' : `${externalLiveSummary.avgWait()}m`
            }}</span>
          </div>
        </div>
        <div class="space-y-2">
          <div
            v-for="r in externalLiveSummary.topWaits()"
            :key="r.id"
            class="flex items-center justify-between rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs"
          >
            <span class="truncate text-slate-200">{{ r.name }}</span>
            <div class="flex items-center gap-2">
              <span class="text-slate-400">{{ r.status || '—' }}</span>
              <span class="rounded bg-fuchsia-600/20 px-2 py-0.5 text-fuchsia-300">{{
                r.waitTime == null ? '—' : `${r.waitTime}m`
              }}</span>
            </div>
          </div>
          <p v-if="externalLiveSummary.topWaits().length === 0" class="text-xs text-slate-500">
            No wait-time messages yet for selected park.
          </p>
        </div>
        </div>
      </template>
      <div class="mt-4 flex justify-between border-t border-slate-800 pt-3">
        <button
          type="button"
          class="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200"
          @click="currentFlowStep = 'input'"
        >
          ← Zurück zu Input X
        </button>
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
          @click="currentFlowStep = 'result'"
        >
          Weiter zu Ergebnis Y →
        </button>
      </div>
    </section>

    <section
      v-if="currentFlowStep === 'result'"
      id="recommendations-engine"
      class="scroll-mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
    >
      <h3 class="mb-1 text-base font-semibold text-white">Step 4: Final result (Y) — {{ t('aiHub.recSectionTitle') }}</h3>
      <p class="mb-3 text-xs text-slate-500">Recommendation scores are the final operational output from the X→Y process.</p>
      <RecommendationAiSection ref="scoringSectionRef" />
      <div class="mt-4 flex justify-start border-t border-slate-800 pt-3">
        <button
          type="button"
          class="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200"
          @click="currentFlowStep = 'forecast'"
        >
          ← Zurück zu Forecast Y
        </button>
      </div>
    </section>
  </div>
</template>
