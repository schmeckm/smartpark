<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { io, type Socket } from 'socket.io-client'
import RecommendationAiSection from '@/components/RecommendationAiSection.vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import {
  getAiFactorConfigs,
  getCanonicalMessages,
  getIntegrationSettings,
  getParkForecastSummary,
  patchIntegrationSettings,
  type AiFactorConfig,
  type ParkForecastSummary,
} from '@/api/client'

const { t } = useI18n()
const { push: toast } = useToast()
const auth = useAuthStore()
const canManageIntegrations = () => auth.hasPermission('integrations', 'manage')

const scoringSectionRef = shallowRef<InstanceType<typeof RecommendationAiSection> | null>(null)

const apiOrigin = import.meta.env.VITE_API_URL || undefined
const extraSocket = shallowRef<Socket | null>(null)
const selectedExternalParkName = ref<string>('')
const selectedExternalParkId = ref<string>('')
const parkForecast = ref<ParkForecastSummary | null>(null)
const parkLoading = ref(false)
const parkForecastSource = ref<'selected' | 'auto' | 'none'>('none')
const externalLiveRows = ref<
  Array<{ id: string; name: string; waitTime: number | null; status: string | null; isOpen: boolean | null }>
>([])

const aiForecastFactors = ref<AiFactorConfig[]>([])
const aiFactorsLoading = ref(false)

async function loadAiFactors() {
  aiFactorsLoading.value = true
  try {
    const s = await getIntegrationSettings()
    aiForecastFactors.value = Array.isArray((s.aiForecastFactors as unknown[] | undefined))
      ? ((s.aiForecastFactors as AiFactorConfig[]) || [])
      : await getAiFactorConfigs()
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
    const settings = await getIntegrationSettings()
    const park = (settings.selectedPark as { externalParkId?: string; parkName?: string } | undefined) || {}
    const provider = (settings.selectedProvider as { provider?: string } | undefined)?.provider || 'themeparks_wiki'
    selectedExternalParkId.value = park.externalParkId || ''
    selectedExternalParkName.value = park.parkName || park.externalParkId || ''
    parkForecastSource.value = selectedExternalParkId.value ? 'selected' : 'none'
    if (!selectedExternalParkId.value) {
      const latest = await getCanonicalMessages({
        provider,
        messageType: 'WAIT_TIME_UPDATED',
        limit: 1,
      })
      const fallback = latest[0]
      if (fallback?.externalParkId) {
        selectedExternalParkId.value = fallback.externalParkId
        selectedExternalParkName.value = `Auto (${fallback.externalParkId.slice(0, 8)}...)`
        parkForecastSource.value = 'auto'
      }
    }
    if (!selectedExternalParkId.value) {
      parkForecast.value = null
      parkForecastSource.value = 'none'
      externalLiveRows.value = []
      return
    }
    parkForecast.value = await getParkForecastSummary(selectedExternalParkId.value, provider)
    const messages = await getCanonicalMessages({
      provider,
      externalParkId: selectedExternalParkId.value,
      messageType: 'WAIT_TIME_UPDATED',
      limit: 500,
    })
    const byEntity = new Map<string, { id: string; name: string; waitTime: number | null; status: string | null; isOpen: boolean | null }>()
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
    externalLiveRows.value = [...byEntity.values()]
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load selected park forecast', 'error')
  } finally {
    parkLoading.value = false
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
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <header class="space-y-2">
      <h1 class="font-display text-xl font-semibold text-white">AI insights</h1>
      <p class="max-w-3xl text-sm text-slate-400">
        Baseline crowd forecasts, scored recommendations, and tuning knobs on this page.
        Subpages cover grids, timeseries, accuracy, ML profiles, and data quality.
      </p>
    </header>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 class="text-base font-semibold text-white">{{ t('aiHub.title') }}</h2>
      <p class="mt-1 text-xs text-slate-500">{{ t('aiHub.navIntro') }}</p>
      <p class="mt-2 text-[11px] text-slate-600">{{ t('aiHub.adrHint') }}</p>

      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
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
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiHub.groupMl') }}</p>
          <ul class="mt-2 space-y-2 text-sm">
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-global-factors">{{ t('aiMl.navGlobal') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-park-factors">{{ t('aiMl.navPark') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/ml-profiles">{{ t('aiMl.navProfiles') }}</RouterLink>
            </li>
          </ul>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiHub.groupData') }}</p>
          <ul class="mt-2 space-y-2 text-sm">
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/feature-store-monitor">{{ t('aiMl.navMonitor') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights/data-quality">{{ t('aiDq.title') }}</RouterLink>
            </li>
            <li>
              <RouterLink class="font-medium text-brand-300 hover:text-white" to="/ai-insights/studio">{{ t('menu.aiStudio') }}</RouterLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-sm">
        <a href="#recommendations-engine" class="text-brand-400 hover:text-brand-300">{{ t('aiHub.recLink') }}</a>
        <RouterLink to="/" class="text-xs text-slate-500 hover:text-slate-300">{{ t('aiHub.opsDash') }}</RouterLink>
      </div>
    </section>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">{{ t('aiHub.factorSectionTitle') }}</h2>
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
            <tr v-for="f in aiForecastFactors" :key="f.code" class="border-t border-slate-800">
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
                  :disabled="f.source === 'derived' || !canManageIntegrations()"
                  class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:opacity-50"
                />
              </td>
              <td class="px-2 py-1 text-slate-400">{{ f.source }}</td>
            </tr>
            <tr v-if="!aiForecastFactors.length">
              <td colspan="7" class="px-2 py-3 text-center text-slate-500">No factors configured</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">{{ t('aiHub.parkSnapshotTitle') }}</h2>
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

        <div class="mt-8 border-t border-slate-800 pt-6">
          <h3 class="text-sm font-semibold text-white">{{ t('aiHub.parkLiveHeading') }}</h3>
          <p class="mt-1 text-xs text-slate-500">Canonical <span class="font-mono">WAIT_TIME_UPDATED</span> for this external park.</p>
        </div>
        <div class="mt-4 space-y-3">
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
    </section>

    <section id="recommendations-engine" class="scroll-mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 class="mb-3 text-base font-semibold text-white">{{ t('aiHub.recSectionTitle') }}</h3>
      <RecommendationAiSection ref="scoringSectionRef" />
    </section>
  </div>
</template>
