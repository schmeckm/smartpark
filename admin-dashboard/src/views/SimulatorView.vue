<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
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
type OeeStartResult = Awaited<ReturnType<typeof startAttractionOeeSimulator>>
const MAX_OEE_ASSET_IDS = 32
const hasParkSelected = computed(() => Boolean(parkContext.activeParkId))
const selectedOeeRideCount = computed(() => getSelectedOeeAssetIds().length)
type OeeWizardStep = 'context' | 'rides' | 'run'
const oeeWizardStep = ref<OeeWizardStep>('context')
const rideFilterText = ref('')
const metricsFilterText = ref('')
const metricsStateFilter = ref<'ALL' | string>('ALL')
type MetricsSortKey = 'slug' | 'scenario' | 'state' | 'oee5m' | 'availability' | 'performance' | 'quality' | 'queue' | 'dispatches'
const metricsSortKey = ref<MetricsSortKey>('slug')
const metricsSortDir = ref<'asc' | 'desc'>('asc')
const showAdvancedScenarioSwitch = ref(false)

const filteredOeeCandidates = computed(() => {
  const q = rideFilterText.value.trim().toLowerCase()
  if (!q) return oeeCandidates.value
  return oeeCandidates.value.filter((c) => `${c.slug} ${c.name}`.toLowerCase().includes(q))
})

const filteredAndSortedAttractions = computed(() => {
  const base = [...(oeeStatus.value?.attractions || [])]
  const q = metricsFilterText.value.trim().toLowerCase()
  const filtered = base.filter((a) => {
    if (metricsStateFilter.value !== 'ALL' && a.state !== metricsStateFilter.value) return false
    if (!q) return true
    return `${a.slug} ${a.scenario} ${a.state} ${a.sparkplugEdgeNodeId || ''} ${a.zoneSlug || ''}`
      .toLowerCase()
      .includes(q)
  })
  const sign = metricsSortDir.value === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const n = (x: number | null | undefined) => (x == null ? Number.NEGATIVE_INFINITY : x)
    switch (metricsSortKey.value) {
      case 'oee5m':
        return (n(a.oee?.oee5m?.oee) - n(b.oee?.oee5m?.oee)) * sign
      case 'availability':
        return (n(a.oee?.oee5m?.availability) - n(b.oee?.oee5m?.availability)) * sign
      case 'performance':
        return (n(a.oee?.oee5m?.performance) - n(b.oee?.oee5m?.performance)) * sign
      case 'quality':
        return (n(a.oee?.oee5m?.quality) - n(b.oee?.oee5m?.quality)) * sign
      case 'queue':
        return (n(a.queue?.occupancy) - n(b.queue?.occupancy)) * sign
      case 'dispatches':
        return (n(a.metricsPreview?.dispatches) - n(b.metricsPreview?.dispatches)) * sign
      case 'scenario':
        return a.scenario.localeCompare(b.scenario) * sign
      case 'state':
        return a.state.localeCompare(b.state) * sign
      case 'slug':
      default:
        return a.slug.localeCompare(b.slug) * sign
    }
  })
  return filtered
})

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

watch(hasParkSelected, (ok) => {
  if (ok && oeeWizardStep.value === 'context') oeeWizardStep.value = 'rides'
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

async function onStart() {
  busy.value = true
  try {
    out.value = await startSimulator({ parkId: parkContext.activeParkId || null })
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
    out.value = await runScenario(name, { parkId: parkContext.activeParkId || null })
    push('Scenario executed', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Run failed', 'error')
  }
}

async function onOeeStart() {
  oeeBusy.value = true
  try {
    const ap = parkContext.activePark
    const pid = parkContext.activeParkId
    const selectedAssetIds = getSelectedOeeAssetIds()
    if (!selectedAssetIds.length) {
      push('Bitte mindestens eine Attraktion in Schritt 2 auswählen.', 'error')
      return
    }
    if (selectedAssetIds.length > MAX_OEE_ASSET_IDS) {
      push(`Maximal ${MAX_OEE_ASSET_IDS} Rides auswählbar (aktuell ${selectedAssetIds.length}).`, 'error')
      return
    }
    const scope = ap?.slug && pid ? { parkSlug: ap.slug, parkId: pid } : {}
    const payload = { ...scope, assetIds: selectedAssetIds }
    await startOeeSimulatorWithRestart(
      payload,
      `Attraction OEE simulator started (${selectedAssetIds.length} selected rides)`
    )
  } catch (e) {
    push(e instanceof Error ? e.message : 'OEE sim start failed', 'error')
  } finally {
    oeeBusy.value = false
  }
}

function getSelectedOeeAssetIds(): string[] {
  return Object.entries(oeeSelectedAssetIds.value)
    .filter(([, v]) => v)
    .map(([id]) => id)
}

function selectAllVisibleCandidates() {
  const next = { ...oeeSelectedAssetIds.value }
  let count = Object.values(next).filter(Boolean).length
  for (const c of filteredOeeCandidates.value) {
    if (next[c.assetId]) continue
    if (count >= MAX_OEE_ASSET_IDS) break
    next[c.assetId] = true
    count += 1
  }
  oeeSelectedAssetIds.value = next
  const pid = parkContext.activeParkId
  if (pid) persistMdAssetSelection(pid, next)
  if (count >= MAX_OEE_ASSET_IDS) {
    push(`Auswahl auf ${MAX_OEE_ASSET_IDS} Rides begrenzt.`, 'info')
  }
}

function clearAllVisibleCandidates() {
  const next = { ...oeeSelectedAssetIds.value }
  for (const c of filteredOeeCandidates.value) delete next[c.assetId]
  oeeSelectedAssetIds.value = next
  const pid = parkContext.activeParkId
  if (pid) persistMdAssetSelection(pid, next)
}

function toggleMetricsSort(key: MetricsSortKey) {
  if (metricsSortKey.value === key) {
    metricsSortDir.value = metricsSortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  metricsSortKey.value = key
  metricsSortDir.value = 'asc'
}

function throwIfOeeStartFailed(result: OeeStartResult) {
  if (result?.ok === false) {
    throw new Error(result.error || 'OEE simulator start failed')
  }
}

async function startOeeSimulatorWithRestart(payload: Record<string, unknown>, successMessage: string) {
  let result = await startAttractionOeeSimulator(payload)
  if (result?.alreadyRunning) {
    await stopAttractionOeeSimulator()
    result = await startAttractionOeeSimulator(payload)
    throwIfOeeStartFailed(result)
    out.value = result
    push(`${successMessage} (restarted with latest selection)`, 'success')
    await refreshOeeAndMqtt()
    return
  }
  throwIfOeeStartFailed(result)
  out.value = result
  push(successMessage, 'success')
  await refreshOeeAndMqtt()
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
      <h1 class="font-display text-xl font-semibold text-white">Event Simulator (Demo)</h1>
      <p class="text-sm text-slate-400">Szenario-Simulation für Crowd/Ride/Weather-Events.</p>
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

    <section class="space-y-4 border-t border-slate-800 pt-8">
      <h2 class="font-display text-lg font-semibold text-white">Attraction Simulator (OEE)</h2>
      <div class="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
        <p class="text-xs font-medium text-slate-300">Wizard</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button
            class="rounded border px-2 py-1.5 text-xs"
            :class="oeeWizardStep === 'context' ? 'border-brand-600 bg-brand-700/20 text-brand-100' : 'border-slate-700 text-slate-300'"
            @click="oeeWizardStep = 'context'"
          >
            1) Kontext
          </button>
          <span class="text-slate-600">→</span>
          <button
            class="rounded border px-2 py-1.5 text-xs"
            :class="oeeWizardStep === 'rides' ? 'border-brand-600 bg-brand-700/20 text-brand-100' : 'border-slate-700 text-slate-300'"
            :disabled="!hasParkSelected"
            @click="oeeWizardStep = 'rides'"
          >
            2) Rides
          </button>
          <span class="text-slate-600">→</span>
          <button
            class="rounded border px-2 py-1.5 text-xs"
            :class="oeeWizardStep === 'run' ? 'border-brand-600 bg-brand-700/20 text-brand-100' : 'border-slate-700 text-slate-300'"
            :disabled="!hasParkSelected"
            @click="oeeWizardStep = 'run'"
          >
            3) Start & Live
          </button>
        </div>
        <div class="mt-2 text-[11px] text-slate-500">
          <span v-if="oeeWizardStep === 'context'">Prüfe den aktiven Park-Kontext.</span>
          <span v-else-if="oeeWizardStep === 'rides'">Wähle die Rides für die OEE-Simulation.</span>
          <span v-else>Starte den Sim und prüfe die Live-Metriken.</span>
        </div>
      </div>
      <div class="grid gap-4 xl:grid-cols-1 xl:items-start">
        <div class="space-y-4">
          <div v-if="oeeWizardStep === 'context'" class="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p class="text-sm text-slate-300">Was kannst du hier machen?</p>
            <ol class="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-400">
              <li>Aktiven Park-Kontext prüfen.</li>
              <li>In Schritt 2 Attraktionen auswählen.</li>
              <li>In Schritt 3 OEE starten und Livewerte prüfen.</li>
            </ol>
            <div class="mt-3 rounded border border-slate-800/80 bg-slate-900/40 p-3 text-xs text-slate-400">
              <p>
                Prüfen in
                <RouterLink class="text-brand-400 hover:underline" to="/realtime/live">Live Signals</RouterLink>,
                <RouterLink class="text-brand-400 hover:underline" to="/realtime/live?mode=oee">OEE cockpit</RouterLink>,
                <RouterLink class="text-brand-400 hover:underline" to="/analytics/sqdc">SQDC Board</RouterLink>.
              </p>
              <p class="mt-1 text-[11px] text-slate-500">
                MQTT-Daten sind als <span class="font-mono">SIMULATED</span> markiert.
              </p>
            </div>
          </div>
          <div v-if="oeeWizardStep === 'context'" class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
            <span class="rounded border border-slate-700 px-2 py-1">OEE: {{ oeeStatus?.running ? 'on' : 'off' }}</span>
            <span v-if="mqttStatus" class="rounded border border-slate-700 px-2 py-1">
              MQTT: {{ mqttStatus.connected ? 'connected' : 'disconnected' }}
            </span>
            <span v-if="oeeStatus?.config?.parkId" class="rounded border border-amber-900/50 px-2 py-1 text-amber-200/90">
              parkId {{ oeeStatus.config.parkId }}
            </span>
            <span
              v-if="oeeStatus?.config?.groupId"
              class="font-mono text-slate-500"
              :title="
                (oeeStatus.config.edgeNodesInUse?.length ?? 0) > 1
                  ? `Edges: ${(oeeStatus.config.edgeNodesInUse || []).join(', ')}`
                  : ''
              "
            >
              {{ oeeStatus.config.groupId }} /
              {{
                oeeStatus.config.edgeNodesInUse?.length
                  ? oeeStatus.config.edgeNodesInUse.join(', ')
                  : oeeStatus.config.edgeNodeId || '—'
              }}
            </span>
          </div>
          <div v-if="oeeWizardStep === 'rides'" class="rounded-lg border border-slate-800 bg-slate-950/40 p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-medium text-slate-300">Park Attraktionen</span>
              <span v-if="oeeCandidatesBusy" class="text-xs text-slate-500">Loading…</span>
              <span
                v-else-if="selectedOeeRideCount"
                class="rounded border border-emerald-800/60 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200"
              >
                {{ selectedOeeRideCount }} ausgewählt
              </span>
            </div>
            <p class="text-xs text-slate-500">Attraktion auswählen.</p>
            <p v-if="!parkContext.activeParkId" class="text-xs text-amber-200/90">Kein aktiver Park-Kontext. Bitte Park im Header/Park Explorer setzen.</p>
            <p v-else-if="!oeeCandidatesBusy && !oeeCandidates.length" class="text-xs text-slate-500">No ride master rows for this park.</p>
            <div v-else class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <input
                  v-model="rideFilterText"
                  type="text"
                  placeholder="Ride filtern..."
                  class="min-w-[180px] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                />
                <button class="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800" @click="selectAllVisibleCandidates">
                  Alle sichtbaren wählen
                </button>
                <button class="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800" @click="clearAllVisibleCandidates">
                  Sichtbare abwählen
                </button>
              </div>
              <p class="text-[10px] text-slate-600">Selection is saved per park in this browser (localStorage).</p>
              <ul class="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-800 p-2 text-xs text-slate-300">
                <li v-for="c in filteredOeeCandidates" :key="c.assetId" class="flex items-center gap-2">
                  <input
                    :id="`oee-cand-${c.assetId}`"
                    :checked="Boolean(oeeSelectedAssetIds[c.assetId])"
                    type="checkbox"
                    class="rounded border-slate-600"
                    @change="toggleOeeMdAsset(c.assetId, ($event.target as HTMLInputElement).checked)"
                  />
                  <label :for="`oee-cand-${c.assetId}`" class="cursor-pointer font-mono text-slate-200">{{ c.slug }}</label>
                  <span class="truncate text-slate-500">{{ c.name }}</span>
                </li>
              </ul>
              <p v-if="!filteredOeeCandidates.length" class="text-[11px] text-slate-500">Keine Treffer für den aktuellen Filter.</p>
            </div>
          </div>
        </div>
        <div v-if="oeeWizardStep === 'run'" class="space-y-3">
          <div class="space-y-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
            <div class="flex flex-wrap gap-2">
              <button class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm" :disabled="oeeBusy || !parkContext.activeParkId" @click="onOeeStart">
                Schritt 3: Start OEE (ausgewählte Attraktionen)
              </button>
              <button class="rounded-lg bg-slate-700 px-3 py-1.5 text-sm" @click="onOeeStop">Stop OEE sim</button>
            </div>
            <button
              class="text-xs text-brand-300 hover:text-brand-200"
              @click="showAdvancedScenarioSwitch = !showAdvancedScenarioSwitch"
            >
              {{ showAdvancedScenarioSwitch ? 'Advanced ausblenden' : 'Advanced anzeigen (Szenario schnell wechseln)' }}
            </button>
            <div v-if="showAdvancedScenarioSwitch" class="space-y-2">
              <p class="text-xs text-slate-500">Szenario schnell wechseln</p>
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
            </div>
          </div>
          <p class="text-xs text-slate-500">Live attraction metrics (aktive Sim-Rides)</p>
          <div class="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/30 p-2">
            <input
              v-model="metricsFilterText"
              type="text"
              placeholder="Filter (Slug/Zone/Edge/State)"
              class="min-w-[220px] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
            <select v-model="metricsStateFilter" class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
              <option value="ALL">Alle States</option>
              <option value="OFF">OFF</option>
              <option value="STARTING">STARTING</option>
              <option value="READY">READY</option>
              <option value="LOADING">LOADING</option>
              <option value="DISPATCHED">DISPATCHED</option>
              <option value="RUNNING">RUNNING</option>
              <option value="UNLOADING">UNLOADING</option>
              <option value="STOPPED">STOPPED</option>
              <option value="FAULT">FAULT</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="WEATHER_HOLD">WEATHER_HOLD</option>
              <option value="NIGHT_SHUTDOWN">NIGHT_SHUTDOWN</option>
            </select>
            <span class="text-[11px] text-slate-500">Sortierung: {{ metricsSortKey }} ({{ metricsSortDir }})</span>
          </div>
          <div v-if="oeeStatus?.attractions?.length" class="max-h-[620px] overflow-auto rounded-lg border border-slate-800 bg-slate-950/20">
            <table class="w-full min-w-[640px] text-left text-[11px] text-slate-300">
              <thead class="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 text-slate-500 backdrop-blur">
                <tr>
                  <th class="px-3 py-1.5"><button class="hover:text-slate-200" @click="toggleMetricsSort('slug')">Attraction</button></th>
                  <th class="px-3 py-1.5 font-mono text-[10px]" title="Parkzone aus Stammdaten (park_assets → park_zones)">Zone MD</th>
                  <th class="px-3 py-1.5 font-mono text-[10px]" title="Sparkplug edge_node_id (Zone + sparkplug.edges)">MQTT edge</th>
                  <th class="px-3 py-1.5"><button class="hover:text-slate-200" @click="toggleMetricsSort('scenario')">Scenario</button></th>
                  <th class="px-3 py-1.5"><button class="hover:text-slate-200" @click="toggleMetricsSort('state')">State</button></th>
                  <th class="px-3 py-1.5">Störung</th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('oee5m')">OEE 5m</button></th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('availability')">A %</button></th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('performance')">P %</button></th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('quality')">Q %</button></th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('queue')">Queue</button></th>
                  <th class="px-3 py-1.5 text-right"><button class="hover:text-slate-200" @click="toggleMetricsSort('dispatches')">Dispatches</button></th>
                  <th class="px-3 py-1.5 text-right">Guests in/out</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="a in filteredAndSortedAttractions"
                  :key="a.slug"
                  class="border-b border-slate-800/80 align-top odd:bg-slate-900/10 hover:bg-slate-800/30"
                >
                  <td class="px-3 py-1.5 font-mono text-slate-200">
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
                  <td class="px-3 py-1.5 font-mono text-[10px] text-slate-400">{{ a.zoneSlug || '—' }}</td>
                  <td class="px-3 py-1.5 font-mono text-[10px] text-slate-400" :title="'Sparkplug topic segment 4'">
                    {{ a.sparkplugEdgeNodeId || '—' }}
                  </td>
                  <td class="px-3 py-1.5 font-mono text-[10px] text-slate-400">{{ a.scenario }}</td>
                  <td class="px-3 py-1.5">{{ a.state }}</td>
                  <td class="px-3 py-1.5">
                    <template v-if="a.metricsPreview?.disturbanceActive">
                      <span class="rounded bg-red-950/70 px-1.5 py-0.5 text-[10px] text-red-100" :title="a.metricsPreview?.downtimeReasonCode || ''">
                        {{ a.metricsPreview?.downtimeReasonCode || a.state }}
                        <template v-if="a.metricsPreview?.downtimeSec != null"> · {{ a.metricsPreview.downtimeSec }}s</template>
                      </span>
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ a.oee?.oee5m?.oee != null ? a.oee.oee5m.oee.toFixed(1) : '—' }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ a.oee?.oee5m?.availability != null ? a.oee.oee5m.availability.toFixed(1) : '—' }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ a.oee?.oee5m?.performance != null ? a.oee.oee5m.performance.toFixed(1) : '—' }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ a.oee?.oee5m?.quality != null ? a.oee.oee5m.quality.toFixed(1) : '—' }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">
                    <template v-if="a.queue">
                      {{ a.queue.occupancy }} / {{ a.queue.capacityLimit }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ a.metricsPreview?.dispatches ?? '—' }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">
                    {{ a.metricsPreview?.guestsIn ?? '—' }} / {{ a.metricsPreview?.guestsOut ?? '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="oeeStatus?.running" class="rounded-lg border border-slate-800 bg-slate-950/20 p-4 text-xs text-slate-500">
            Keine Zeilen für den aktuellen Filter.
          </div>
          <div v-else class="rounded-lg border border-slate-800 bg-slate-950/20 p-4 text-xs text-slate-500">
            No live attractions yet. Start the OEE sim to see metrics.
          </div>
        </div>
      </div>
    </section>

    <pre v-if="out" class="overflow-x-auto text-xs text-slate-300">{{ out }}</pre>
  </div>
</template>
