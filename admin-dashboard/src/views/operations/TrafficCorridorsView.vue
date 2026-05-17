<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useParkContextStore } from '@/stores/parkContext'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { clampScore0to100, wgs84CoordErrorMessage } from '@/composables/trafficCorridorFormValidation'
import TrafficCorridorMapPicker from '@/components/operations/TrafficCorridorMapPicker.vue'
import TrafficCorridorSnapshotRouteMap from '@/components/operations/TrafficCorridorSnapshotRouteMap.vue'
import {
  createManualTrafficSnapshot,
  createTrafficCorridor,
  deleteTrafficCorridor,
  getLatestTrafficSnapshotDebug,
  listTrafficCorridorSnapshots,
  listTrafficCorridors,
  runAttendanceRiskForecast,
  updateTrafficCorridor,
} from '@/api/client'
import type {
  ParkDemandForecast5mRow,
  TrafficCorridorLastPollResult,
  TrafficCorridorRow,
  TrafficCorridorSnapshotDebugPayload,
  TrafficCorridorSnapshotRow,
} from '@/types/api'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import {
  corridorAmpelDotClass,
  corridorAmpelLabelDe,
  corridorAmpelTitleDe,
  corridorTrafficAmpel,
  snapshotAgeMinutes,
  snapshotAgeTextClass,
} from '@/composables/trafficCorridorSnapshotDisplay'

const { t } = useI18n()
const parkCtx = useParkContextStore()
const auth = useAuthStore()
const { formatDateTime, formatRelativeTime } = useRegionalDateTime()
const { push: toast } = useToast()

const corridors = ref<TrafficCorridorRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const saving = ref(false)
const snapshotSaving = ref(false)
const forecastRunning = ref(false)
const lastForecast = ref<ParkDemandForecast5mRow | null>(null)
let loadSeq = 0

const showEditor = ref(false)
const editing = ref<TrafficCorridorRow | null>(null)
const form = ref({
  name: '',
  description: '',
  originLabel: '',
  destinationLabel: '',
  originLat: '' as string | number,
  originLng: '' as string | number,
  destinationLat: '' as string | number,
  destinationLng: '' as string | number,
  direction: 'inbound' as 'inbound' | 'outbound',
  baselineTravelTimeMin: 20,
  weight: 1,
  enabled: true,
})

const snapshotCorridor = ref<TrafficCorridorRow | null>(null)
const snapshotTravel = ref(25)

const detailsOpen = ref(false)
const detailsLoading = ref(false)
const detailsError = ref<string | null>(null)
const detailsPayload = ref<TrafficCorridorSnapshotDebugPayload | null>(null)
const historyRows = ref<TrafficCorridorSnapshotRow[]>([])
const historyLoading = ref(false)
const historyError = ref<string | null>(null)
const detailsCorridorId = ref<string | null>(null)

const trafficMapRef = ref<InstanceType<typeof TrafficCorridorMapPicker> | null>(null)
const snapshotDetailsRouteMapRef = ref<InstanceType<typeof TrafficCorridorSnapshotRouteMap> | null>(null)

/** Sanitized provider JSON dump — audit trail / admin debug only. */
const showSanitizedProviderRawJson = computed(() => auth.hasPermission('audit', 'read'))

const runPlanned = ref(12000)
const runKnown = ref(800)
const runWeather = ref('' as string | number)
const runHoliday = ref('' as string | number)
const runEvent = ref('' as string | number)
const runParking = ref('' as string | number)

const selectedParkId = computed({
  get: () => parkCtx.activeParkId || '',
  set: (v: string) => {
    if (v) parkCtx.setActivePark(v)
  },
})

function resetForm() {
  form.value = {
    name: '',
    description: '',
    originLabel: '',
    destinationLabel: '',
    originLat: '',
    originLng: '',
    destinationLat: '',
    destinationLng: '',
    direction: 'inbound',
    baselineTravelTimeMin: 20,
    weight: 1,
    enabled: true,
  }
}

function openCreate() {
  editing.value = null
  resetForm()
  showEditor.value = true
}

function openEdit(row: TrafficCorridorRow) {
  editing.value = row
  form.value = {
    name: row.name,
    description: (row.description as string) || '',
    originLabel: row.originLabel || '',
    destinationLabel: row.destinationLabel || '',
    originLat: row.originLat ?? '',
    originLng: row.originLng ?? '',
    destinationLat: row.destinationLat ?? '',
    destinationLng: row.destinationLng ?? '',
    direction: row.direction,
    baselineTravelTimeMin: Number(row.baselineTravelTimeMin),
    weight: Number(row.weight),
    enabled: row.enabled,
  }
  showEditor.value = true
}

function numOrUndef(v: string | number): number | undefined {
  if (v === '' || v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function numFromForm(v: string | number): number | null {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function coordString(n: number) {
  return String(Math.round(n * 1e6) / 1e6)
}

function rowLastPoll(c: TrafficCorridorRow): TrafficCorridorLastPollResult | null {
  const raw = c.lastPollResult
  return raw && typeof raw === 'object' ? raw : null
}

function rowTrafficAmpel(c: TrafficCorridorRow) {
  return corridorTrafficAmpel(rowLastPoll(c), c.latestSnapshot?.congestionScore ?? null)
}

function rowSnapshotAgeMinutes(c: TrafficCorridorRow) {
  return snapshotAgeMinutes(c.latestSnapshot?.snapshotTs)
}

function rowSnapshotRelativeClass(c: TrafficCorridorRow) {
  return snapshotAgeTextClass(rowSnapshotAgeMinutes(c))
}

function formatDelayPercentDisplay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const pct = n <= 1 ? n * 100 : n
  return `${pct.toFixed(0)}%`
}

function routeKmFromRow(c: TrafficCorridorRow): string {
  const m = c.latestSnapshotDetail?.routeDistanceMeters
  if (m == null || !Number.isFinite(Number(m))) return '—'
  return `${(Number(m) / 1000).toFixed(1)}`
}

async function loadSnapshotHistory(corridorId: string) {
  historyLoading.value = true
  historyError.value = null
  historyRows.value = []
  try {
    const data = await listTrafficCorridorSnapshots(corridorId, { limit: 48 })
    if (detailsCorridorId.value !== corridorId) return
    historyRows.value = data.snapshots || []
  } catch (e) {
    if (detailsCorridorId.value !== corridorId) return
    historyError.value = e instanceof Error ? e.message : t('trafficCorridorsPage.historyLoadFailed')
  } finally {
    if (detailsCorridorId.value === corridorId) historyLoading.value = false
  }
}

async function openSnapshotDetails(corridorId: string) {
  detailsOpen.value = true
  detailsCorridorId.value = corridorId
  detailsLoading.value = true
  detailsError.value = null
  detailsPayload.value = null
  void loadSnapshotHistory(corridorId)
  try {
    const payload = await getLatestTrafficSnapshotDebug(corridorId)
    if (detailsCorridorId.value !== corridorId) return
    detailsPayload.value = payload
  } catch (e) {
    if (detailsCorridorId.value !== corridorId) return
    detailsError.value = e instanceof Error ? e.message : 'Failed to load snapshot details'
  } finally {
    if (detailsCorridorId.value === corridorId) detailsLoading.value = false
  }
}

function closeSnapshotDetails() {
  detailsOpen.value = false
  detailsCorridorId.value = null
  detailsPayload.value = null
  detailsError.value = null
  historyRows.value = []
  historyError.value = null
}

function onMapPickOrigin({ lat, lng }: { lat: number; lng: number }) {
  form.value.originLat = coordString(lat)
  form.value.originLng = coordString(lng)
}

function onMapPickDestination({ lat, lng }: { lat: number; lng: number }) {
  form.value.destinationLat = coordString(lat)
  form.value.destinationLng = coordString(lng)
}

/** Backend: each of origin / destination must have both lat+lng or both empty (COORD_PAIR_INCOMPLETE). */
function coordPairErrorMessage(): string | null {
  const oLat = numFromForm(form.value.originLat)
  const oLng = numFromForm(form.value.originLng)
  const dLat = numFromForm(form.value.destinationLat)
  const dLng = numFromForm(form.value.destinationLng)
  const oAny = oLat != null || oLng != null
  const oOk = oLat != null && oLng != null
  if (oAny && !oOk) return t('trafficCorridorsPage.coordPairOrigin')
  const dAny = dLat != null || dLng != null
  const dOk = dLat != null && dLng != null
  if (dAny && !dOk) return t('trafficCorridorsPage.coordPairDest')
  const wgs = wgs84CoordErrorMessage(oLat, oLng, dLat, dLng)
  if (wgs) return t('trafficCorridorsPage.wgs84Invalid')
  return null
}

function forecastScoreOutOfRange(): boolean {
  for (const v of [runWeather.value, runHoliday.value, runEvent.value, runParking.value]) {
    if (v === '' || v == null) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 100) return true
  }
  return false
}

async function loadCorridors() {
  if (!parkCtx.activeParkId) {
    corridors.value = []
    loadError.value = null
    return
  }
  const seq = ++loadSeq
  loading.value = true
  loadError.value = null
  try {
    const rows = await listTrafficCorridors(parkCtx.activeParkId)
    if (seq !== loadSeq) return
    corridors.value = rows
  } catch (e) {
    if (seq !== loadSeq) return
    loadError.value = e instanceof Error ? e.message : t('trafficCorridorsPage.loadFailed')
    corridors.value = []
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function saveCorridor() {
  if (!parkCtx.activeParkId || saving.value) return
  const pairErr = coordPairErrorMessage()
  if (pairErr) {
    toast(pairErr, 'error')
    return
  }
  saving.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      originLabel: form.value.originLabel.trim() || null,
      destinationLabel: form.value.destinationLabel.trim() || null,
      originLat: numOrUndef(form.value.originLat) ?? null,
      originLng: numOrUndef(form.value.originLng) ?? null,
      destinationLat: numOrUndef(form.value.destinationLat) ?? null,
      destinationLng: numOrUndef(form.value.destinationLng) ?? null,
      direction: form.value.direction,
      baselineTravelTimeMin: Number(form.value.baselineTravelTimeMin),
      weight: Number(form.value.weight),
      enabled: form.value.enabled,
    }
    if (editing.value) {
      await updateTrafficCorridor(editing.value.id, body)
      toast(t('trafficCorridorsPage.corridorUpdated'), 'success')
    } else {
      await createTrafficCorridor(parkCtx.activeParkId, body)
      toast(t('trafficCorridorsPage.corridorCreated'), 'success')
    }
    showEditor.value = false
    await loadCorridors()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('trafficCorridorsPage.saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

async function removeCorridor(row: TrafficCorridorRow) {
  if (!globalThis.confirm(t('trafficCorridorsPage.deleteConfirm', { name: row.name }))) return
  try {
    await deleteTrafficCorridor(row.id)
    toast(t('trafficCorridorsPage.deleted'), 'success')
    await loadCorridors()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('trafficCorridorsPage.deleteFailed'), 'error')
  }
}

async function submitSnapshot() {
  if (!snapshotCorridor.value || snapshotSaving.value) return
  snapshotSaving.value = true
  try {
    await createManualTrafficSnapshot(snapshotCorridor.value.id, {
      currentTravelTimeMin: Number(snapshotTravel.value),
    })
    toast(t('trafficCorridorsPage.snapshotSaved'), 'success')
    const corridorId = snapshotCorridor.value.id
    snapshotCorridor.value = null
    await loadCorridors()
    if (detailsOpen.value && detailsCorridorId.value === corridorId) {
      void loadSnapshotHistory(corridorId)
      try {
        detailsPayload.value = await getLatestTrafficSnapshotDebug(corridorId)
      } catch {
        /* keep prior debug payload */
      }
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('trafficCorridorsPage.snapshotFailed'), 'error')
  } finally {
    snapshotSaving.value = false
  }
}

async function submitRunForecast() {
  if (!parkCtx.activeParkId || forecastRunning.value) return
  if (forecastScoreOutOfRange()) {
    toast(t('trafficCorridorsPage.scoreRange'), 'error')
    return
  }
  forecastRunning.value = true
  try {
    lastForecast.value = await runAttendanceRiskForecast(parkCtx.activeParkId, {
      plannedDemand: Math.max(0, Math.round(Number(runPlanned.value) || 0)),
      knownRegisteredExpected: Math.max(0, Math.round(Number(runKnown.value) || 0)),
      weatherScore: clampScore0to100(runWeather.value),
      holidayScore: clampScore0to100(runHoliday.value),
      eventScore: clampScore0to100(runEvent.value),
      parkingPressureScore: clampScore0to100(runParking.value),
    })
    toast(t('trafficCorridorsPage.forecastSaved'), 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('trafficCorridorsPage.forecastFailed'), 'error')
  } finally {
    forecastRunning.value = false
  }
}

onMounted(async () => {
  if (!parkCtx.loaded) {
    await parkCtx.hydrate()
  }
})

watch(
  () => parkCtx.activeParkId,
  () => {
    void loadCorridors()
  },
  { immediate: true }
)

watch(showEditor, async (open) => {
  if (!open) return
  await nextTick()
  trafficMapRef.value?.invalidateSize()
  requestAnimationFrame(() => trafficMapRef.value?.invalidateSize())
})

watch([detailsOpen, detailsLoading, detailsPayload], async ([open, loading, payload]) => {
  if (!open || loading || !payload) return
  await nextTick()
  snapshotDetailsRouteMapRef.value?.invalidateSize()
  requestAnimationFrame(() => snapshotDetailsRouteMapRef.value?.invalidateSize())
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" data-testid="traffic-corridors-page">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('trafficCorridorsPage.title') }}</h1>
      <p class="mt-1 max-w-2xl text-sm text-slate-400">{{ t('trafficCorridorsPage.subtitle') }}</p>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <label class="block text-sm text-slate-300">
        {{ t('trafficCorridorsPage.park') }}
        <select
          v-model="selectedParkId"
          class="mt-1 block w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option disabled value="">{{ t('trafficCorridorsPage.selectPark') }}</option>
          <option v-for="p in parkCtx.parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
        :disabled="!parkCtx.activeParkId"
        @click="openCreate"
      >
        {{ t('trafficCorridorsPage.newCorridor') }}
      </button>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-40"
        :disabled="!parkCtx.activeParkId || loading"
        @click="loadCorridors"
      >
        {{ t('trafficCorridorsPage.reload') }}
      </button>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-semibold text-slate-200">{{ t('trafficCorridorsPage.forecastTitle') }}</h2>
      <p class="mt-1 text-xs text-slate-500">{{ t('trafficCorridorsPage.forecastHint') }}</p>
      <div class="mt-3 flex flex-wrap gap-3">
        <label class="text-xs text-slate-400">
          Planned demand
          <input v-model.number="runPlanned" type="number" min="0" class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Known / registered
          <input v-model.number="runKnown" type="number" min="0" class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Weather 0–100
          <input v-model="runWeather" type="number" class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Holiday 0–100
          <input v-model="runHoliday" type="number" class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Event 0–100
          <input v-model="runEvent" type="number" class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Parking 0–100
          <input v-model="runParking" type="number" class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white" />
        </label>
        <button
          type="button"
          class="self-end rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-40"
          :disabled="!parkCtx.activeParkId || forecastRunning"
          @click="submitRunForecast"
        >
          {{ forecastRunning ? t('trafficCorridorsPage.forecastRunning') : t('trafficCorridorsPage.runForecast') }}
        </button>
      </div>
      <div
        v-if="lastForecast"
        class="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
      >
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ t('trafficCorridorsPage.forecastResult') }}</p>
        <p class="mt-1 font-mono">
          {{ lastForecast.riskLevel || lastForecast.status }}
          · {{ Math.round(lastForecast.confidenceScore) }}% confidence
        </p>
      </div>
    </div>

    <p v-if="loadError" class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {{ loadError }}
    </p>
    <div v-if="loading" class="text-sm text-slate-400">{{ t('trafficCorridorsPage.loading') }}</div>
    <div v-else class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm" data-testid="traffic-corridors-table">
        <thead class="bg-slate-950/80 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Ampel</th>
            <th class="px-3 py-2 w-8" title="Route realism">⚠</th>
            <th class="px-3 py-2">Source</th>
            <th class="px-3 py-2">Direction</th>
            <th class="px-3 py-2">Route (km)</th>
            <th class="px-3 py-2">Baseline (min)</th>
            <th class="px-3 py-2">Current (min)</th>
            <th class="px-3 py-2">Delay</th>
            <th class="px-3 py-2">Congestion</th>
            <th class="px-3 py-2">Inbound pressure</th>
            <th class="px-3 py-2">Provider</th>
            <th class="px-3 py-2 normal-case">Letzter Stand</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800 text-slate-200">
          <tr v-for="c in corridors" :key="c.id">
            <td class="px-3 py-2 font-medium text-white">{{ c.name }}</td>
            <td class="px-3 py-2">
              <div
                class="flex items-center gap-2"
                :title="corridorAmpelTitleDe(rowTrafficAmpel(c), rowLastPoll(c))"
              >
                <span
                  class="inline-block h-3 w-3 shrink-0 rounded-full"
                  :class="corridorAmpelDotClass(rowTrafficAmpel(c))"
                  aria-hidden="true"
                />
                <span class="text-xs text-slate-400">{{ corridorAmpelLabelDe(rowTrafficAmpel(c)) }}</span>
              </div>
            </td>
            <td class="px-3 py-2 text-center text-amber-400" :title="c.latestSnapshotDetail?.providerErrorMessage || ''">
              <span v-if="c.latestSnapshotDetail?.routeLooksUnrealistic" aria-label="Route warning">⚠</span>
              <span v-else class="text-slate-600">—</span>
            </td>
            <td class="px-3 py-2 text-slate-400">
              {{ c.latestSnapshot?.source || '—' }}
            </td>
            <td class="px-3 py-2">{{ c.direction }}</td>
            <td class="px-3 py-2 font-mono">{{ routeKmFromRow(c) }}</td>
            <td class="px-3 py-2 font-mono">{{ Number(c.baselineTravelTimeMin).toFixed(1) }}</td>
            <td class="px-3 py-2 font-mono">
              {{ c.latestSnapshot ? Number(c.latestSnapshot.currentTravelTimeMin).toFixed(1) : '—' }}
            </td>
            <td class="px-3 py-2 font-mono">
              <span v-if="c.latestSnapshot && c.latestSnapshot.delayMin != null">
                {{ Number(c.latestSnapshot.delayMin).toFixed(1) }} min
                <span v-if="c.latestSnapshot.delayPercent != null" class="text-slate-500">
                  ({{ formatDelayPercentDisplay(c.latestSnapshot.delayPercent) }})
                </span>
              </span>
              <span v-else>—</span>
            </td>
            <td class="px-3 py-2 font-mono">
              {{ c.latestSnapshot && c.latestSnapshot.congestionScore != null ? Number(c.latestSnapshot.congestionScore).toFixed(1) : '—' }}
            </td>
            <td class="px-3 py-2 font-mono">
              {{
                c.latestSnapshot && c.latestSnapshot.inboundPressureScore != null
                  ? Number(c.latestSnapshot.inboundPressureScore).toFixed(1)
                  : '—'
              }}
            </td>
            <td class="px-3 py-2 text-xs text-slate-400">
              {{ c.latestSnapshotDetail?.providerStatus || '—' }}
            </td>
            <td class="px-3 py-2 text-xs leading-snug">
              <template v-if="c.latestSnapshot?.snapshotTs">
                <div class="text-slate-200">{{ formatDateTime(c.latestSnapshot.snapshotTs) }}</div>
                <div :class="rowSnapshotRelativeClass(c)">
                  {{ formatRelativeTime(c.latestSnapshot.snapshotTs) }}
                </div>
              </template>
              <span v-else class="text-slate-500">—</span>
            </td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <button type="button" class="text-sky-300 hover:text-sky-200" @click="openSnapshotDetails(c.id)">Details</button>
              <button type="button" class="ml-2 text-brand-300 hover:text-brand-200" @click="openEdit(c)">Edit</button>
              <button type="button" class="ml-2 text-slate-400 hover:text-white" @click="snapshotCorridor = c">Snapshot</button>
              <button type="button" class="ml-2 text-rose-300 hover:text-rose-200" @click="removeCorridor(c)">Delete</button>
            </td>
          </tr>
          <tr v-if="!corridors.length">
            <td colspan="14" class="px-3 py-6 text-center text-slate-500">{{ t('trafficCorridorsPage.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Editor modal -->
    <div
      v-if="showEditor"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 class="text-lg font-semibold text-white">{{ editing ? 'Edit corridor' : 'New corridor' }}</h3>
        <div class="mt-4 space-y-3 text-sm">
          <label class="block text-slate-300">
            Name *
            <input v-model="form.name" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <label class="block text-slate-300">
            Description
            <textarea v-model="form.description" rows="2" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-slate-300">
              Origin label
              <input v-model="form.originLabel" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
            <label class="text-slate-300">
              Destination label
              <input v-model="form.destinationLabel" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
          </div>
          <div>
            <p class="text-xs text-slate-500">
              Koordinaten (WGS84, optional): Pro Punkt immer <strong class="text-slate-400">Breite + Länge</strong> zusammen
              — oder Karte: zuerst „Origin“ klicken, dann „Destination“.
            </p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <label class="text-slate-300">
                Start — Breitengrad (lat)
                <input
                  v-model="form.originLat"
                  inputmode="decimal"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white"
                />
              </label>
              <label class="text-slate-300">
                Start — Längengrad (lng)
                <input
                  v-model="form.originLng"
                  inputmode="decimal"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white"
                />
              </label>
              <label class="text-slate-300">
                Ziel — Breitengrad (lat)
                <input
                  v-model="form.destinationLat"
                  inputmode="decimal"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white"
                />
              </label>
              <label class="text-slate-300">
                Ziel — Längengrad (lng)
                <input
                  v-model="form.destinationLng"
                  inputmode="decimal"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white"
                />
              </label>
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Map</div>
            <TrafficCorridorMapPicker
              ref="trafficMapRef"
              class="mt-2"
              :origin-lat="numFromForm(form.originLat)"
              :origin-lng="numFromForm(form.originLng)"
              :destination-lat="numFromForm(form.destinationLat)"
              :destination-lng="numFromForm(form.destinationLng)"
              :center-lat="parkCtx.activePark?.latitude ?? null"
              :center-lng="parkCtx.activePark?.longitude ?? null"
              @update:origin="onMapPickOrigin"
              @update:destination="onMapPickDestination"
            />
          </div>
          <label class="block text-slate-300">
            Direction
            <select v-model="form.direction" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white">
              <option value="inbound">inbound</option>
              <option value="outbound">outbound</option>
            </select>
          </label>
          <label class="block text-slate-300">
            Baseline travel (min) *
            <input v-model.number="form.baselineTravelTimeMin" type="number" min="0" step="0.1" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <label class="block text-slate-300">
            Weight
            <input v-model.number="form.weight" type="number" min="0" step="0.1" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <label class="flex items-center gap-2 text-slate-300">
            <input v-model="form.enabled" type="checkbox" class="rounded border-slate-600" />
            Enabled
          </label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded border border-slate-600 px-4 py-2 text-slate-200" @click="showEditor = false">{{ t('trafficCorridorsPage.cancel') }}</button>
          <button
            type="button"
            class="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-500 disabled:opacity-40"
            :disabled="!form.name.trim() || saving"
            @click="saveCorridor"
          >
            {{ saving ? t('trafficCorridorsPage.saving') : t('trafficCorridorsPage.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Snapshot modal -->
    <div
      v-if="snapshotCorridor"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 class="text-lg font-semibold text-white">Manual snapshot</h3>
        <p class="mt-1 text-xs text-slate-400">{{ snapshotCorridor.name }}</p>
        <label class="mt-4 block text-sm text-slate-300">
          Current travel time (min)
          <input v-model.number="snapshotTravel" type="number" min="0" step="0.1" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded border border-slate-600 px-4 py-2 text-slate-200" @click="snapshotCorridor = null">{{ t('trafficCorridorsPage.cancel') }}</button>
          <button
            type="button"
            class="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-500 disabled:opacity-40"
            :disabled="snapshotSaving"
            @click="submitSnapshot"
          >
            {{ snapshotSaving ? t('trafficCorridorsPage.snapshotSaving') : t('trafficCorridorsPage.save') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="detailsOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 class="text-lg font-semibold text-white">{{ t('trafficCorridorsPage.detailsTitle') }}</h3>
        <p class="mt-1 text-xs text-slate-500">{{ t('trafficCorridorsPage.detailsHint') }}</p>
        <p v-if="detailsLoading" class="mt-3 text-sm text-slate-400">Loading…</p>
        <p v-else-if="detailsError" class="mt-3 text-sm text-rose-300">{{ detailsError }}</p>
        <dl v-else-if="detailsPayload" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <dt class="text-slate-500">Route (km)</dt>
          <dd class="font-mono text-slate-100">
            {{
              detailsPayload.latestSnapshotDetail?.routeDistanceMeters != null
                ? (Number(detailsPayload.latestSnapshotDetail.routeDistanceMeters) / 1000).toFixed(2)
                : '—'
            }}
          </dd>
          <dt class="text-slate-500">Travel time (s)</dt>
          <dd class="font-mono text-slate-100">{{ detailsPayload.latestSnapshotDetail?.travelTimeSeconds ?? '—' }}</dd>
          <dt class="text-slate-500">Traffic delay (s)</dt>
          <dd class="font-mono text-slate-100">{{ detailsPayload.latestSnapshotDetail?.trafficDelaySeconds ?? '—' }}</dd>
          <dt class="text-slate-500">Delay %</dt>
          <dd class="font-mono text-slate-100">
            {{ formatDelayPercentDisplay(detailsPayload.latestSnapshotDetail?.delayPercent) }}
          </dd>
          <dt class="text-slate-500">Current / baseline (min)</dt>
          <dd class="font-mono text-slate-100">
            {{ detailsPayload.latestSnapshotDetail?.currentTravelTimeMinutes ?? '—' }} /
            {{ detailsPayload.latestSnapshotDetail?.baselineTravelTimeMinutes ?? '—' }}
          </dd>
          <dt class="text-slate-500">Provider status</dt>
          <dd class="font-mono text-slate-100">{{ detailsPayload.latestSnapshotDetail?.providerStatus ?? '—' }}</dd>
          <dt class="text-slate-500">Provider errors</dt>
          <dd class="text-slate-200">
            <span v-if="detailsPayload.latestSnapshotDetail?.providerErrorCode" class="font-mono text-amber-200">{{
              detailsPayload.latestSnapshotDetail.providerErrorCode
            }}</span>
            <span v-if="detailsPayload.latestSnapshotDetail?.providerErrorMessage" class="mt-1 block text-slate-400">{{
              detailsPayload.latestSnapshotDetail.providerErrorMessage
            }}</span>
            <span v-if="!detailsPayload.latestSnapshotDetail?.providerErrorCode" class="text-slate-500">—</span>
          </dd>
          <dt class="text-slate-500">Sampled at</dt>
          <dd class="font-mono text-slate-100">{{ detailsPayload.latestSnapshotDetail?.sampledAt ?? '—' }}</dd>
        </dl>
        <div v-if="detailsPayload && !detailsLoading && !detailsError" class="mt-4">
          <TrafficCorridorSnapshotRouteMap
            ref="snapshotDetailsRouteMapRef"
            :provider-raw-response="detailsPayload.providerRawResponse"
            :origin-lat="detailsPayload.corridor?.originLat ?? null"
            :origin-lng="detailsPayload.corridor?.originLng ?? null"
            :destination-lat="detailsPayload.corridor?.destinationLat ?? null"
            :destination-lng="detailsPayload.corridor?.destinationLng ?? null"
            :route-distance-meters="detailsPayload.latestSnapshotDetail?.routeDistanceMeters ?? null"
            :travel-time-seconds="detailsPayload.latestSnapshotDetail?.travelTimeSeconds ?? null"
            :traffic-delay-seconds="detailsPayload.latestSnapshotDetail?.trafficDelaySeconds ?? null"
          />
        </div>
        <details
          v-if="showSanitizedProviderRawJson && detailsPayload && !detailsLoading && !detailsError && detailsPayload.providerRawResponse"
          class="mt-4 rounded-lg border border-slate-800 bg-slate-950/40"
        >
          <summary class="cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Sanitized provider raw (debug)
          </summary>
          <pre
            class="max-h-52 overflow-auto border-t border-slate-800 p-3 text-[10px] leading-snug text-slate-300"
            data-testid="traffic-snapshot-sanitized-raw-json"
          >{{ JSON.stringify(detailsPayload.providerRawResponse, null, 2) }}</pre>
        </details>
        <div
          v-if="detailsPayload && !detailsLoading && !detailsError"
          class="mt-6 rounded-lg border border-slate-800 bg-slate-950/50"
          data-testid="traffic-snapshot-history"
        >
          <h4 class="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('trafficCorridorsPage.historyTitle') }}
          </h4>
          <p v-if="historyLoading" class="px-3 py-3 text-sm text-slate-400">{{ t('trafficCorridorsPage.historyLoading') }}</p>
          <p v-else-if="historyError" class="px-3 py-3 text-sm text-rose-300">{{ historyError }}</p>
          <p v-else-if="!historyRows.length" class="px-3 py-3 text-sm text-slate-500">{{ t('trafficCorridorsPage.historyEmpty') }}</p>
          <div v-else class="max-h-56 overflow-auto">
            <table class="min-w-full text-left text-xs">
              <thead class="sticky top-0 bg-slate-950 text-slate-500">
                <tr>
                  <th class="px-3 py-2 font-medium">{{ t('trafficCorridorsPage.historyColTime') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('trafficCorridorsPage.historyColSource') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('trafficCorridorsPage.historyColCurrent') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('trafficCorridorsPage.historyColDelay') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('trafficCorridorsPage.historyColCongestion') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800 text-slate-200">
                <tr v-for="row in historyRows" :key="row.id">
                  <td class="whitespace-nowrap px-3 py-1.5 font-mono">{{ formatDateTime(row.snapshotTs) }}</td>
                  <td class="px-3 py-1.5">{{ row.source || '—' }}</td>
                  <td class="px-3 py-1.5 font-mono">{{ Number(row.currentTravelTimeMin).toFixed(1) }}</td>
                  <td class="px-3 py-1.5 font-mono">
                    <span v-if="row.delayMin != null">{{ Number(row.delayMin).toFixed(1) }} min</span>
                    <span v-else>—</span>
                  </td>
                  <td class="px-3 py-1.5 font-mono">
                    {{ row.congestionScore != null ? Number(row.congestionScore).toFixed(1) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="mt-5 flex justify-end">
          <button type="button" class="rounded border border-slate-600 px-4 py-2 text-slate-200" @click="closeSnapshotDetails">
            {{ t('trafficCorridorsPage.close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
