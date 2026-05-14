<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import {
  createManualTrafficSnapshot,
  createTrafficCorridor,
  deleteTrafficCorridor,
  listTrafficCorridors,
  runAttendanceRiskForecast,
  updateTrafficCorridor,
} from '@/api/client'
import type { TrafficCorridorRow } from '@/types/api'

const parkCtx = useParkContextStore()
const { push: toast } = useToast()

const corridors = ref<TrafficCorridorRow[]>([])
const loading = ref(false)

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

async function loadCorridors() {
  if (!parkCtx.activeParkId) {
    corridors.value = []
    return
  }
  loading.value = true
  try {
    corridors.value = await listTrafficCorridors(parkCtx.activeParkId)
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load corridors', 'error')
    corridors.value = []
  } finally {
    loading.value = false
  }
}

async function saveCorridor() {
  if (!parkCtx.activeParkId) return
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
      toast('Corridor updated', 'success')
    } else {
      await createTrafficCorridor(parkCtx.activeParkId, body)
      toast('Corridor created', 'success')
    }
    showEditor.value = false
    await loadCorridors()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Save failed', 'error')
  }
}

async function removeCorridor(row: TrafficCorridorRow) {
  if (!globalThis.confirm(`Delete corridor "${row.name}"?`)) return
  try {
    await deleteTrafficCorridor(row.id)
    toast('Corridor deleted', 'success')
    await loadCorridors()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

async function submitSnapshot() {
  if (!snapshotCorridor.value) return
  try {
    await createManualTrafficSnapshot(snapshotCorridor.value.id, {
      currentTravelTimeMin: Number(snapshotTravel.value),
    })
    toast('Snapshot saved', 'success')
    snapshotCorridor.value = null
    await loadCorridors()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Snapshot failed', 'error')
  }
}

async function submitRunForecast() {
  if (!parkCtx.activeParkId) return
  try {
    await runAttendanceRiskForecast(parkCtx.activeParkId, {
      plannedDemand: Math.max(0, Math.round(Number(runPlanned.value) || 0)),
      knownRegisteredExpected: Math.max(0, Math.round(Number(runKnown.value) || 0)),
      weatherScore: numOrUndef(runWeather.value),
      holidayScore: numOrUndef(runHoliday.value),
      eventScore: numOrUndef(runEvent.value),
      parkingPressureScore: numOrUndef(runParking.value),
    })
    toast('Forecast run saved', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Forecast run failed', 'error')
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
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" data-testid="traffic-corridors-page">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Traffic corridors</h1>
      <p class="mt-1 max-w-2xl text-sm text-slate-400">
        Configure inbound/outbound corridors and enter manual travel times. Traffic feeds attendance risk as a leading
        indicator only (not visitor count).
      </p>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <label class="block text-sm text-slate-300">
        Park
        <select
          v-model="selectedParkId"
          class="mt-1 block w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option disabled value="">Select park…</option>
          <option v-for="p in parkCtx.parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
        :disabled="!parkCtx.activeParkId"
        @click="openCreate"
      >
        New corridor
      </button>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-40"
        :disabled="!parkCtx.activeParkId"
        @click="loadCorridors"
      >
        Reload
      </button>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-semibold text-slate-200">Run attendance risk forecast</h2>
      <p class="mt-1 text-xs text-slate-500">Uses latest corridor snapshots + optional context scores.</p>
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
          :disabled="!parkCtx.activeParkId"
          @click="submitRunForecast"
        >
          Run forecast
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-slate-400">Loading corridors…</div>
    <div v-else class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm" data-testid="traffic-corridors-table">
        <thead class="bg-slate-950/80 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Direction</th>
            <th class="px-3 py-2">Baseline (min)</th>
            <th class="px-3 py-2">Current (min)</th>
            <th class="px-3 py-2">Delay</th>
            <th class="px-3 py-2">Congestion</th>
            <th class="px-3 py-2">Inbound pressure</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800 text-slate-200">
          <tr v-for="c in corridors" :key="c.id">
            <td class="px-3 py-2 font-medium text-white">{{ c.name }}</td>
            <td class="px-3 py-2">{{ c.direction }}</td>
            <td class="px-3 py-2 font-mono">{{ Number(c.baselineTravelTimeMin).toFixed(1) }}</td>
            <td class="px-3 py-2 font-mono">
              {{ c.latestSnapshot ? Number(c.latestSnapshot.currentTravelTimeMin).toFixed(1) : '—' }}
            </td>
            <td class="px-3 py-2 font-mono">
              <span v-if="c.latestSnapshot && c.latestSnapshot.delayMin != null">
                {{ Number(c.latestSnapshot.delayMin).toFixed(1) }} min
                <span v-if="c.latestSnapshot.delayPercent != null" class="text-slate-500">
                  ({{ (Number(c.latestSnapshot.delayPercent) * 100).toFixed(0) }}%)
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
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <button type="button" class="text-brand-300 hover:text-brand-200" @click="openEdit(c)">Edit</button>
              <button type="button" class="ml-2 text-slate-400 hover:text-white" @click="snapshotCorridor = c">Snapshot</button>
              <button type="button" class="ml-2 text-rose-300 hover:text-rose-200" @click="removeCorridor(c)">Delete</button>
            </td>
          </tr>
          <tr v-if="!corridors.length">
            <td colspan="8" class="px-3 py-6 text-center text-slate-500">No corridors yet.</td>
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
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
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
          <div class="grid grid-cols-2 gap-2">
            <label class="text-slate-300">
              Origin lat
              <input v-model="form.originLat" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
            <label class="text-slate-300">
              Origin lng
              <input v-model="form.originLng" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
            <label class="text-slate-300">
              Dest lat
              <input v-model="form.destinationLat" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
            <label class="text-slate-300">
              Dest lng
              <input v-model="form.destinationLng" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white" />
            </label>
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
          <button type="button" class="rounded border border-slate-600 px-4 py-2 text-slate-200" @click="showEditor = false">Cancel</button>
          <button
            type="button"
            class="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-500 disabled:opacity-40"
            :disabled="!form.name.trim()"
            @click="saveCorridor"
          >
            Save
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
          <button type="button" class="rounded border border-slate-600 px-4 py-2 text-slate-200" @click="snapshotCorridor = null">Cancel</button>
          <button type="button" class="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-500" @click="submitSnapshot">Save snapshot</button>
        </div>
      </div>
    </div>
  </div>
</template>
