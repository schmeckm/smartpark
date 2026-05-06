<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDashboardSocket, type CanonicalMessageAppliedPayload } from '@/composables/useDashboardSocket'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useAiInsights } from '@/composables/useAiInsights'
import { getCanonicalMessages, getIntegrationSettings, getParkForecastSummary, type ParkForecastSummary } from '@/api/client'
import DashboardHeader from '@/components/DashboardHeader.vue'
import CrowdHeatmap from '@/components/CrowdHeatmap.vue'
import RidesTable from '@/components/RidesTable.vue'
import StaffBoard from '@/components/StaffBoard.vue'
import RecommendationsPanel from '@/components/RecommendationsPanel.vue'
import RecentEventsStrip from '@/components/RecentEventsStrip.vue'
import AiForecastWidget from '@/components/AiForecastWidget.vue'
import { RIDES_ADAPTER_ZONE_ID, type Ride, type RideStatus } from '@/types/api'

const auth = useAuthStore()
const { push: toast } = useToast()

type ExternalLiveRow = {
  id: string
  name: string
  waitTime: number | null
  status: string | null
  isOpen: boolean | null
}

const selectedExternalParkName = ref<string>('')
const selectedExternalParkId = ref<string>('')
const selectedIntegrationProvider = ref<string>('themeparks_wiki')
const externalLiveLoading = ref(false)
const parkForecast = ref<ParkForecastSummary | null>(null)
const externalLiveRows = ref<ExternalLiveRow[]>([])

function normalizeAdapterRideStatus(row: ExternalLiveRow): RideStatus {
  if (row.isOpen === false) return 'CLOSED'
  const s = (row.status || '').toUpperCase()
  if (s.includes('MAINT') || s.includes('DOWN') || s.includes('REFURB')) return 'MAINTENANCE'
  if (row.isOpen === true) return 'OPEN'
  if (s.includes('CLOSED') || s.includes('CLOSE')) return 'CLOSED'
  if (s.includes('OPEN') || s.includes('OPERAT')) return 'OPEN'
  return 'OPEN'
}

function externalRowToRide(row: ExternalLiveRow): Ride {
  const wait = typeof row.waitTime === 'number' ? row.waitTime : 0
  const status = normalizeAdapterRideStatus(row)
  return {
    id: row.id,
    name: row.name,
    zoneId: RIDES_ADAPTER_ZONE_ID,
    status,
    waitTime: wait,
    capacityPerHour: 0,
    criticality: Math.min(10, Math.max(1, Math.ceil(wait / 15) || 1)),
  }
}

function onCanonicalMessageApplied(payload: CanonicalMessageAppliedPayload) {
  if (!payload.applied || !payload.message) return
  const msg = payload.message as {
    messageType?: string
    provider?: string
    externalParkId?: string | null
    externalEntityId?: string | null
    payload?: Record<string, unknown>
  }
  if (msg.messageType !== 'WAIT_TIME_UPDATED') return
  if (!selectedExternalParkId.value || msg.externalParkId !== selectedExternalParkId.value) return
  if (selectedIntegrationProvider.value && msg.provider && msg.provider !== selectedIntegrationProvider.value) return
  const entityId = msg.externalEntityId
  if (!entityId) return
  const pl = (msg.payload || {}) as Record<string, unknown>
  const nextRow: ExternalLiveRow = {
    id: entityId,
    name: typeof pl.externalEntityName === 'string' ? pl.externalEntityName : entityId,
    waitTime: typeof pl.waitTime === 'number' ? pl.waitTime : null,
    status: typeof pl.status === 'string' ? pl.status : null,
    isOpen: typeof pl.isOpen === 'boolean' ? pl.isOpen : null,
  }
  const list = [...externalLiveRows.value]
  const idx = list.findIndex((x) => x.id === entityId)
  if (idx >= 0) list[idx] = nextRow
  else list.push(nextRow)
  externalLiveRows.value = list
}

const {
  zones,
  rides,
  staff,
  sortedRecommendations,
  recentEvents,
  connected,
  connectionLabel,
  loadError,
  openRecommendations,
  patchRecommendation,
  bootstrap,
} = useDashboardSocket({ onCanonicalMessageApplied })

const {
  summary: aiSummary,
  loading: aiLoading,
  busy: aiBusy,
  lastSocketAt: aiSocketAt,
  refresh: refreshAi,
} = useAiInsights({
  onError: (e) => {
    if (import.meta.env.DEV) {
      console.warn('AI insights load failed', e)
    }
  },
})

const openRecCount = computed(() => openRecommendations.value.length)

const ridesForTable = computed((): Ride[] => {
  if (selectedExternalParkId.value) {
    return externalLiveRows.value.map(externalRowToRide)
  }
  return rides.value
})

const externalLiveSummary = computed(() => {
  const all = externalLiveRows.value
  return {
    total: all.length,
    open: all.filter((x) => x.isOpen === true).length,
    avgWait: (() => {
      const waits = all.map((x) => x.waitTime).filter((x): x is number => typeof x === 'number')
      if (!waits.length) return null
      return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    })(),
    topWaits: [...all]
      .filter((x) => typeof x.waitTime === 'number')
      .sort((a, b) => (b.waitTime || 0) - (a.waitTime || 0))
      .slice(0, 5),
  }
})

async function loadSelectedParkLiveSnapshot() {
  externalLiveLoading.value = true
  try {
    const settings = await getIntegrationSettings()
    const park = (settings.selectedPark as { externalParkId?: string; parkName?: string } | undefined) || {}
    const provider = (settings.selectedProvider as { provider?: string } | undefined)?.provider || 'themeparks_wiki'
    selectedIntegrationProvider.value = provider
    selectedExternalParkId.value = park.externalParkId || ''
    selectedExternalParkName.value = park.parkName || park.externalParkId || ''
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
      }
    }
    if (!selectedExternalParkId.value) {
      externalLiveRows.value = []
      parkForecast.value = null
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
    toast(e instanceof Error ? e.message : 'Failed to load selected park live snapshot', 'error')
  } finally {
    externalLiveLoading.value = false
  }
}

async function onAiRefresh() {
  if (!auth.hasPermission('ai', 'refresh')) {
    toast('You do not have permission to refresh AI forecasts', 'error')
    return
  }
  const ok = await refreshAi()
  if (ok) {
    toast('AI forecasts refreshed', 'success')
  }
}

onMounted(() => {
  void loadSelectedParkLiveSnapshot()
})
</script>

<template>
  <div class="pb-12">
    <DashboardHeader
      :connected="connected"
      :connection-label="connectionLabel"
      :load-error="loadError"
      @retry="bootstrap"
    />

    <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-brand-400/90">Command view</p>
          <p class="mt-1 max-w-2xl text-sm text-slate-400">
            Unified snapshot of crowd pressure, attractions, staffing, and automated recommendations.
            Data streams over WebSocket as the API emits changes.
          </p>
        </div>
        <div
          class="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300"
        >
          <span class="text-slate-500">Open recommendations</span>
          <span class="font-display text-2xl font-bold text-white">{{ openRecCount }}</span>
        </div>
      </div>

      <RecentEventsStrip :events="recentEvents" />

      <AiForecastWidget
        v-if="auth.hasPermission('ai', 'read')"
        :summary="aiSummary"
        :loading="aiLoading || aiBusy"
        :last-socket-at="aiSocketAt"
        @refresh="onAiRefresh"
      />

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-white">Selected external park live</h3>
            <p class="mt-1 text-xs text-slate-400">
              {{ selectedExternalParkName || 'No park selected in Integrations' }}
            </p>
          </div>
          <button
            class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
            @click="loadSelectedParkLiveSnapshot"
          >
            Refresh
          </button>
        </div>
        <div v-if="externalLiveLoading" class="mt-3 text-xs text-slate-400">Loading selected park snapshot...</div>
        <div v-else-if="!selectedExternalParkId" class="mt-3 text-xs text-slate-500">
          Select a park under Integrations -> Save selection.
        </div>
        <div v-else class="mt-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Entities <span class="ml-2 text-white">{{ externalLiveSummary.total }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Open <span class="ml-2 text-white">{{ externalLiveSummary.open }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Avg wait <span class="ml-2 text-white">{{ externalLiveSummary.avgWait == null ? '—' : `${externalLiveSummary.avgWait}m` }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Crowd level
              <span class="ml-2 text-white">{{
                parkForecast?.crowdLevelPercent == null ? '—' : `${parkForecast.crowdLevelPercent}%`
              }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Forecast 60m
              <span class="ml-2 text-white">{{
                parkForecast?.forecast60Minutes == null ? '—' : `${parkForecast.forecast60Minutes}m`
              }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Trend <span class="ml-2 text-white">{{ parkForecast?.trend || '—' }}</span>
            </div>
            <div class="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              Confidence
              <span class="ml-2 text-white">{{
                parkForecast?.confidence == null ? '—' : `${Math.round(parkForecast.confidence * 100)}%`
              }}</span>
            </div>
          </div>
          <div v-if="parkForecast?.factors?.length" class="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span
              v-for="f in parkForecast.factors.slice(0, 3)"
              :key="f.code"
              class="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-300"
            >
              {{ f.code }}: {{ Number(f.value).toFixed(2) }}
            </span>
          </div>
          <div class="mt-3 space-y-2">
            <div
              v-for="r in externalLiveSummary.topWaits"
              :key="r.id"
              class="flex items-center justify-between rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs"
            >
              <span class="truncate text-slate-200">{{ r.name }}</span>
              <span class="rounded bg-fuchsia-600/20 px-2 py-0.5 text-fuchsia-300">{{ r.waitTime }}m</span>
            </div>
            <p v-if="!externalLiveSummary.topWaits.length" class="text-xs text-slate-500">
              No wait-time messages yet for selected park.
            </p>
          </div>
        </div>
      </section>

      <CrowdHeatmap
        :zones="zones"
        :park-wide-load-percent="parkForecast?.crowdLevelPercent ?? null"
        :external-park-label="selectedExternalParkId ? selectedExternalParkName || selectedExternalParkId : ''"
      />

      <div class="grid gap-6 xl:grid-cols-3">
        <div class="space-y-6 xl:col-span-2">
          <RidesTable
            :rides="ridesForTable"
            :zones="zones"
            :adapter-live="Boolean(selectedExternalParkId)"
          />
          <StaffBoard :zones="zones" :staff="staff" />
        </div>
        <div class="xl:col-span-1">
          <RecommendationsPanel
            :recommendations="sortedRecommendations"
            @updated="patchRecommendation"
          />
        </div>
      </div>
    </div>
  </div>
</template>
