<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getSimulatorStatus,
  startSimulator,
  stopSimulator,
  runScenario,
  getAttractionOeeSimulatorStatus,
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
  setAttractionOeeSimulatorScenario,
  getMqttStatus,
  getAttractionOeeSimulatorCandidates,
  type AttractionOeeSimStatus,
  type AttractionOeeSimCandidate,
  type MqttStatus,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useParkContextStore } from '@/stores/parkContext'
import { useWave2Socket } from '@/composables/useWave2Socket'
import { loadPersistedMdAssetIdMap, persistMdAssetSelection } from '@/utils/oeeMdSimSelection'

useWave2Socket()

const status = ref<{ running: boolean; scenarios: string[] } | null>(null)
const out = ref<unknown>(null)
const busy = ref(false)
const { push } = useToast()

const scenarios = [
  'CROWD_SPIKE_ALPINE',
  'RIDE_CLOSURE_HIGH_IMPACT',
  'RAIN_SHIFT_TO_INDOOR',
  'FOOD_RUSH_LUNCH',
  'PARADE_END_CROWD_SHIFT',
  'SILVER_COMET_LINE',
] as const

const oeeScenarios = [
  'NORMAL_OPERATION',
  'HIGH_DEMAND',
  'LOW_STAFF',
  'TRAIN_REMOVED',
  'TECHNICAL_STOP',
  'WEATHER_DELAY',
  'SLOW_LOADING',
  'FAST_DISPATCH',
  'PARK_OPENING',
  'PARK_CLOSING',
  'NIGHT_MODE',
] as const

const oeeStatus = ref<AttractionOeeSimStatus | null>(null)
const mqttStatus = ref<MqttStatus | null>(null)
const oeeBusy = ref(false)
const parkContext = useParkContextStore()
const oeeCandidates = ref<AttractionOeeSimCandidate[]>([])
const oeeCandidatesBusy = ref(false)
const oeeSelectedAssetIds = ref<Record<string, boolean>>({})

function applyPersistedSelectionToCandidates() {
  const pid = parkContext.activeParkId
  if (!pid || !oeeCandidates.value.length) return
  const persisted = loadPersistedMdAssetIdMap(pid)
  const next: Record<string, boolean> = {}
  for (const c of oeeCandidates.value) {
    if (persisted[c.assetId]) next[c.assetId] = true
  }
  oeeSelectedAssetIds.value = next
}

function toggleOeeMdAsset(assetId: string, checked: boolean) {
  oeeSelectedAssetIds.value = { ...oeeSelectedAssetIds.value, [assetId]: checked }
  const pid = parkContext.activeParkId
  if (pid) persistMdAssetSelection(pid, oeeSelectedAssetIds.value)
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  status.value = await getSimulatorStatus()
}

async function refreshOeeAndMqtt() {
  try {
    oeeStatus.value = await getAttractionOeeSimulatorStatus()
  } catch {
    oeeStatus.value = null
  }
  try {
    mqttStatus.value = await getMqttStatus()
  } catch {
    mqttStatus.value = null
  }
}

async function loadOeeCandidates() {
  const pid = parkContext.activeParkId
  if (!pid) {
    oeeCandidates.value = []
    return
  }
  oeeCandidatesBusy.value = true
  try {
    oeeCandidates.value = await getAttractionOeeSimulatorCandidates(pid)
  } catch {
    oeeCandidates.value = []
  } finally {
    oeeCandidatesBusy.value = false
    applyPersistedSelectionToCandidates()
  }
}

onMounted(() => {
  void refresh()
  void refreshOeeAndMqtt()
  void loadOeeCandidates()
  pollTimer = setInterval(() => {
    void refreshOeeAndMqtt()
  }, 5000)
})

watch(
  () => parkContext.activeParkId,
  () => {
    void loadOeeCandidates()
  }
)

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

async function onStart() {
  busy.value = true
  try {
    out.value = await startSimulator()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Start failed', 'error')
  } finally {
    busy.value = false
  }
}
async function onStop() {
  out.value = await stopSimulator()
  await refresh()
}
async function onRun(name: string) {
  try {
    out.value = await runScenario(name)
    push('Scenario executed', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Run failed', 'error')
  }
}

async function onOeeStart() {
  oeeBusy.value = true
  try {
    out.value = await startAttractionOeeSimulator({})
    push('Attraction OEE simulator started', 'success')
    await refreshOeeAndMqtt()
  } catch (e) {
    push(e instanceof Error ? e.message : 'OEE sim start failed', 'error')
  } finally {
    oeeBusy.value = false
  }
}

async function onOeeStartFromMasterData() {
  const pid = parkContext.activeParkId
  if (!pid) {
    push('Select an active park in the header', 'error')
    return
  }
  const assetIds = Object.entries(oeeSelectedAssetIds.value)
    .filter(([, v]) => v)
    .map(([id]) => id)
  if (!assetIds.length) {
    push('Select at least one ride from master data', 'error')
    return
  }
  oeeBusy.value = true
  try {
    out.value = await startAttractionOeeSimulator({ parkId: pid, assetIds })
    push('OEE simulator started (MD rides)', 'success')
    await refreshOeeAndMqtt()
  } catch (e) {
    push(e instanceof Error ? e.message : 'OEE sim start failed', 'error')
  } finally {
    oeeBusy.value = false
  }
}

async function onOeeStop() {
  out.value = await stopAttractionOeeSimulator()
  await refreshOeeAndMqtt()
}

async function onOeeScenario(name: string) {
  try {
    out.value = await setAttractionOeeSimulatorScenario(name)
    push('OEE scenario updated', 'success')
    await refreshOeeAndMqtt()
  } catch (e) {
    push(e instanceof Error ? e.message : 'OEE scenario failed', 'error')
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-10 px-4 py-6 sm:px-6">
    <section class="space-y-4">
      <h1 class="font-display text-xl font-semibold text-white">Live simulator (demo)</h1>
      <p class="text-sm text-slate-400">Uses seeded zone/ride ids. Safe for demonstrations.</p>
      <div class="flex flex-wrap gap-2">
        <span class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">Running: {{ status?.running }}</span>
        <button class="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm" :disabled="busy" @click="onStart">Start (12s loop)</button>
        <button class="rounded-lg bg-slate-700 px-3 py-1.5 text-sm" @click="onStop">Stop</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in scenarios"
          :key="s"
          class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          @click="onRun(s)"
        >
          {{ s }}
        </button>
      </div>
    </section>

    <section class="space-y-3 border-t border-slate-800 pt-8">
      <h2 class="font-display text-lg font-semibold text-white">Attraction OEE (Sparkplug B)</h2>
      <p class="text-sm text-slate-400">
        Simulates <strong class="font-medium text-slate-300">ride / plant operation only</strong> (cycles, capacity, queue, downtime-style states).
        It does <strong class="font-medium text-slate-300">not</strong> ingest or publish park weather — use the demo block above for weather crowd demos.
        Ride master can flag <span class="font-mono text-slate-500">virtualLineEnabled</span> (app time-slot / Virtual Line); the sim still models one aggregate queue but publishes the flag in DDATA and status.
        Publishes <span class="font-mono text-slate-500">NBIRTH / DBIRTH / DDATA</span> on the shared API MQTT client
        (<span class="font-mono">MQTT_ENABLED=true</span>). UNS Live shows rows as <span class="font-mono">SIMULATED</span> quality.
      </p>
      <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span class="rounded border border-slate-700 px-2 py-1">OEE sim: {{ oeeStatus?.running ? 'on' : 'off' }}</span>
        <span v-if="mqttStatus" class="rounded border border-slate-700 px-2 py-1">
          MQTT: {{ mqttStatus.connected ? 'connected' : 'disconnected' }}
        </span>
        <span v-if="oeeStatus?.config?.parkId" class="rounded border border-amber-900/50 px-2 py-1 text-amber-200/90">
          parkId {{ oeeStatus.config.parkId }}
        </span>
        <span v-if="oeeStatus?.config?.groupId" class="font-mono text-slate-500">{{ oeeStatus.config.groupId }} / {{ oeeStatus.config.edgeNodeId }}</span>
      </div>
      <p class="text-xs text-slate-500">
        <strong class="font-medium text-slate-400">Master data:</strong> planned cycle time, OPC reference cycle time, and max queue guests are read from ride master data for the selected park rides. Start below binds the simulator to those assets; over-capacity queue warnings are pushed in real time via WebSocket.
      </p>
      <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-medium text-slate-300">Rides from master data (active park)</span>
          <span v-if="oeeCandidatesBusy" class="text-xs text-slate-500">Loading…</span>
        </div>
        <p v-if="!parkContext.activeParkId" class="text-xs text-amber-200/90">Choose a park in the header to list rides.</p>
        <p v-else-if="!oeeCandidatesBusy && !oeeCandidates.length" class="text-xs text-slate-500">No ride master rows for this park.</p>
        <div v-else class="space-y-1">
        <p class="text-[10px] text-slate-600">Selection is saved per park in this browser (localStorage).</p>
        <ul class="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-300">
          <li v-for="c in oeeCandidates" :key="c.assetId" class="flex items-center gap-2">
            <input
              :id="`oee-cand-${c.assetId}`"
              :checked="Boolean(oeeSelectedAssetIds[c.assetId])"
              type="checkbox"
              class="rounded border-slate-600"
              @change="toggleOeeMdAsset(c.assetId, ($event.target as HTMLInputElement).checked)"
            />
            <label :for="`oee-cand-${c.assetId}`" class="cursor-pointer font-mono text-slate-200">{{ c.slug }}</label>
            <span class="text-slate-500">{{ c.name }}</span>
          </li>
        </ul>
        </div>
        <button
          class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm disabled:opacity-40"
          :disabled="oeeBusy || !parkContext.activeParkId"
          @click="onOeeStartFromMasterData"
        >
          Start OEE sim (selected MD rides)
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm" :disabled="oeeBusy" @click="onOeeStart">Start OEE sim</button>
        <button class="rounded-lg bg-slate-700 px-3 py-1.5 text-sm" @click="onOeeStop">Stop OEE sim</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in oeeScenarios"
          :key="s"
          class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          @click="onOeeScenario(s)"
        >
          {{ s }}
        </button>
      </div>
      <div v-if="oeeStatus?.attractions?.length" class="overflow-x-auto rounded-lg border border-slate-800">
        <table class="w-full min-w-[640px] text-left text-xs text-slate-300">
          <thead class="border-b border-slate-800 bg-slate-900/60 text-slate-500">
            <tr>
              <th class="px-3 py-2">Attraction</th>
              <th class="px-3 py-2">Scenario</th>
              <th class="px-3 py-2">State</th>
              <th class="px-3 py-2">Störung</th>
              <th class="px-3 py-2">OEE 5m</th>
              <th class="px-3 py-2">A %</th>
              <th class="px-3 py-2">P %</th>
              <th class="px-3 py-2">Q %</th>
              <th class="px-3 py-2">Queue</th>
              <th class="px-3 py-2">Dispatches</th>
              <th class="px-3 py-2">Guests in/out</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in oeeStatus.attractions" :key="a.slug" class="border-b border-slate-800/80">
              <td class="px-3 py-2 font-mono text-slate-200">
                {{ a.slug }}
                <span
                  v-if="a.metricsPreview?.virtualLineEnabled"
                  class="ml-1 rounded border border-sky-700/60 bg-sky-950/50 px-1 py-0.5 text-[10px] text-sky-200"
                  title="Virtual Line / app time-slot (MD)"
                >
                  VL
                </span>
                <span v-if="a.queue?.overcapacity" class="ml-1 rounded bg-amber-900/60 px-1 py-0.5 text-[10px] text-amber-100">over cap</span>
              </td>
              <td class="px-3 py-2 font-mono text-[11px] text-slate-400">{{ a.scenario }}</td>
              <td class="px-3 py-2">{{ a.state }}</td>
              <td class="px-3 py-2">
                <template v-if="a.metricsPreview?.disturbanceActive">
                  <span class="rounded bg-red-950/70 px-1.5 py-0.5 text-[10px] text-red-100" :title="a.metricsPreview?.downtimeReasonCode || ''">
                    {{ a.metricsPreview?.downtimeReasonCode || a.state }}
                    <template v-if="a.metricsPreview?.downtimeSec != null"> · {{ a.metricsPreview.downtimeSec }}s</template>
                  </span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">{{ a.oee?.oee5m?.oee != null ? a.oee.oee5m.oee.toFixed(1) : '—' }}</td>
              <td class="px-3 py-2">{{ a.oee?.oee5m?.availability != null ? a.oee.oee5m.availability.toFixed(1) : '—' }}</td>
              <td class="px-3 py-2">{{ a.oee?.oee5m?.performance != null ? a.oee.oee5m.performance.toFixed(1) : '—' }}</td>
              <td class="px-3 py-2">{{ a.oee?.oee5m?.quality != null ? a.oee.oee5m.quality.toFixed(1) : '—' }}</td>
              <td class="px-3 py-2">
                <template v-if="a.queue">
                  {{ a.queue.occupancy }} / {{ a.queue.capacityLimit }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">{{ a.metricsPreview?.dispatches ?? '—' }}</td>
              <td class="px-3 py-2">
                {{ a.metricsPreview?.guestsIn ?? '—' }} / {{ a.metricsPreview?.guestsOut ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <pre v-if="out" class="overflow-x-auto text-xs text-slate-300">{{ out }}</pre>
  </div>
</template>
