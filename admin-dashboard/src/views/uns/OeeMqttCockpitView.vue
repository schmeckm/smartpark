<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import StandardPercentGaugeMini from '@/components/StandardPercentGaugeMini.vue'
import { getAttractionOeeSimulatorCandidates, type AttractionOeeSimCandidate } from '@/api/client'
import { useParkContextStore } from '@/stores/parkContext'
import {
  numMetric,
  resolveRawMqttSparkplugGroupKey,
  slugifyUnsParkKey,
  useOeeMqttCockpit,
  type OeeDeviceSnapshot,
} from '@/composables/useOeeMqttCockpit'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { loadPersistedMdAssetIds } from '@/utils/oeeMdSimSelection'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const parkContext = useParkContextStore()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()

/** Sparkplug group id (often same as park slug, e.g. europa_park; can differ if SPARKPLUG_GROUP_ID is set on API). */
const sparkplugGroupInput = ref('')

watch(
  () => parkContext.activePark?.slug,
  (slug) => {
    if (slug && !sparkplugGroupInput.value) sparkplugGroupInput.value = slug
  },
  { immediate: true }
)

const groupKey = () =>
  sparkplugGroupInput.value.trim() ||
  resolveRawMqttSparkplugGroupKey(parkContext.activePark?.slug, parkContext.activeParkId)

const { devices, liveStatus, loadError } = useOeeMqttCockpit(groupKey)

const STALE_THRESHOLD_MS = 60_000

function strMetric(m: Record<string, unknown>, key: string): string {
  const v = m[key]
  if (v == null) return '—'
  return String(v)
}

function staleMs(lastIso: string): number {
  const t = Date.parse(lastIso)
  if (Number.isNaN(t)) return 999999
  return Date.now() - t
}

function isLiveDevice(d: OeeDeviceSnapshot): boolean {
  return staleMs(d.lastReceivedAt) <= STALE_THRESHOLD_MS
}

const mdCandidates = ref<AttractionOeeSimCandidate[]>([])

async function loadMdCandidates() {
  const pid = parkContext.activeParkId
  if (!pid) {
    mdCandidates.value = []
    return
  }
  try {
    mdCandidates.value = await getAttractionOeeSimulatorCandidates(pid)
  } catch {
    mdCandidates.value = []
  }
}

/** Only rides that already have DDATA in the buffer (no placeholders). */
const mqttDevicesSorted = computed((): OeeDeviceSnapshot[] =>
  [...devices.value]
    .filter((d) => Boolean(d.lastReceivedAt))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
)

/** Draft inputs (MD-style: apply on button). */
const draftSearch = ref('')
const draftFreshness = ref<'any' | 'live' | 'stale'>('any')
const draftScenario = ref('')

const appliedSearch = ref('')
const appliedFreshness = ref<'any' | 'live' | 'stale'>('any')
const appliedScenario = ref('')

function applyGridFilters() {
  appliedSearch.value = draftSearch.value.trim()
  appliedFreshness.value = draftFreshness.value
  appliedScenario.value = draftScenario.value.trim()
}

function resetGridFilters() {
  draftSearch.value = ''
  draftFreshness.value = 'any'
  draftScenario.value = ''
  appliedSearch.value = ''
  appliedFreshness.value = 'any'
  appliedScenario.value = ''
  sortBy.value = 'deviceId'
  sortDir.value = 'asc'
  const next: Record<string, boolean> = {}
  for (const d of mqttDevicesSorted.value) next[d.deviceId] = true
  multiVisible.value = next
}

const devicesAfterApplied = computed((): OeeDeviceSnapshot[] => {
  let list = mqttDevicesSorted.value
  const q = appliedSearch.value.trim().toLowerCase()
  if (q) {
    list = list.filter((d) => {
      if (d.deviceId.toLowerCase().includes(q)) return true
      if (strMetric(d.metrics, 'scenario').toLowerCase().includes(q)) return true
      return strMetric(d.metrics, 'asset_state').toLowerCase().includes(q)
    })
  }
  if (appliedFreshness.value === 'live') list = list.filter((d) => isLiveDevice(d))
  else if (appliedFreshness.value === 'stale') list = list.filter((d) => !isLiveDevice(d))
  const sc = appliedScenario.value.toLowerCase()
  if (sc) list = list.filter((d) => strMetric(d.metrics, 'scenario').toLowerCase().includes(sc))
  return list
})

type MqttSortCol = 'deviceId' | 'lastReceivedAt' | 'oee5m' | 'freshness'
const sortBy = ref<MqttSortCol>('deviceId')
const sortDir = ref<'asc' | 'desc'>('asc')

function setSort(col: MqttSortCol) {
  if (sortBy.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = col
    sortDir.value = 'asc'
  }
}

function sortHint(col: MqttSortCol): string {
  if (sortBy.value !== col) return ''
  return sortDir.value === 'asc' ? ' ↑' : ' ↓'
}

const sortedTableDevices = computed((): OeeDeviceSnapshot[] => {
  const list = [...devicesAfterApplied.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    if (sortBy.value === 'deviceId') return a.deviceId.localeCompare(b.deviceId) * dir
    if (sortBy.value === 'lastReceivedAt') return (Date.parse(a.lastReceivedAt) - Date.parse(b.lastReceivedAt)) * dir
    if (sortBy.value === 'oee5m') {
      const na = numMetric(a.metrics, 'oee_5m')
      const nb = numMetric(b.metrics, 'oee_5m')
      const va = na ?? -1
      const vb = nb ?? -1
      return (va - vb) * dir
    }
    return (staleMs(a.lastReceivedAt) - staleMs(b.lastReceivedAt)) * dir
  })
  return list
})

const cardFilterMode = ref<'all' | 'single' | 'multi'>('all')
const singleDeviceSlug = ref('')
const multiVisible = ref<Record<string, boolean>>({})

watch(
  () => mqttDevicesSorted.value.map((d) => d.deviceId).join('|'),
  () => {
    const cur = { ...multiVisible.value }
    for (const d of mqttDevicesSorted.value) {
      if (cur[d.deviceId] === undefined) cur[d.deviceId] = true
    }
    for (const k of Object.keys(cur)) {
      if (!mqttDevicesSorted.value.some((d) => d.deviceId === k)) delete cur[k]
    }
    multiVisible.value = cur
  },
  { immediate: true }
)

watch(
  () => [devicesAfterApplied.value.map((d) => d.deviceId).join('|'), cardFilterMode.value] as const,
  () => {
    if (cardFilterMode.value !== 'single') return
    const slugs = devicesAfterApplied.value.map((d) => d.deviceId)
    if (!slugs.length) singleDeviceSlug.value = ''
    else if (!singleDeviceSlug.value || !slugs.includes(singleDeviceSlug.value)) {
      singleDeviceSlug.value = slugs[0]
    }
  },
  { immediate: true }
)

watch(cardFilterMode, (m) => {
  if (m === 'single' && devicesAfterApplied.value.length) {
    if (!singleDeviceSlug.value || !devicesAfterApplied.value.some((d) => d.deviceId === singleDeviceSlug.value)) {
      singleDeviceSlug.value = devicesAfterApplied.value[0].deviceId
    }
  }
})

function setMultiVisible(slug: string, visible: boolean) {
  multiVisible.value = { ...multiVisible.value, [slug]: visible }
}

const displayDevices = computed((): OeeDeviceSnapshot[] => {
  const base = sortedTableDevices.value
  if (!base.length) return []
  if (cardFilterMode.value === 'all') return base
  if (cardFilterMode.value === 'single') {
    const s = singleDeviceSlug.value
    if (!s) return []
    return base.filter((d) => d.deviceId === s)
  }
  return base.filter((d) => multiVisible.value[d.deviceId] !== false)
})

async function applySimulatorSelectionToMulti() {
  await loadMdCandidates()
  const pid = parkContext.activeParkId
  if (!pid) {
    push('No active park in header', 'error')
    return
  }
  const ids = loadPersistedMdAssetIds(pid)
  if (!ids.length) {
    push('No Simulator MD selection saved for this park', 'info')
    return
  }
  const byAsset = new Map(mdCandidates.value.map((c) => [c.assetId, c.slug]))
  const wanted = new Set(ids.map((id) => byAsset.get(id)).filter((s): s is string => Boolean(s && String(s).trim())))
  if (!wanted.size) {
    push('Could not map selection to ride slugs (load candidates failed?)', 'error')
    return
  }
  const next: Record<string, boolean> = {}
  for (const d of mqttDevicesSorted.value) {
    next[d.deviceId] = wanted.has(d.deviceId)
  }
  multiVisible.value = next
  cardFilterMode.value = 'multi'
  const on = Object.values(next).filter(Boolean).length
  push(
    on ? `Multi-Filter: ${on} Fahrt(en) mit MQTT passen zur Simulator-Auswahl` : 'Keine MQTT-Fahrten passen zur Simulator-Auswahl',
    on ? 'success' : 'warning'
  )
}

onMounted(() => {
  void loadMdCandidates()
})

watch(
  () => parkContext.activeParkId,
  () => {
    void loadMdCandidates()
  }
)

const resolvedGroup = computed(() => slugifyUnsParkKey(groupKey()))

function fmtTs(iso: string) {
  try {
    return formatDateTime(new Date(iso))
  } catch {
    return iso
  }
}

function mqttConnectedFlag(): boolean {
  const m = liveStatus.value?.mqtt as Record<string, unknown> | undefined
  return Boolean(m?.connected)
}
</script>

<template>
  <div class="space-y-6 px-4 py-6 sm:px-6">
    <header class="space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h1 class="font-display text-xl font-semibold text-white">Realtime OEE cockpit (MQTT)</h1>
        <RouterLink
          class="shrink-0 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          to="/analytics/sqdc"
        >
          {{ t('menu.sqdcBoard') }} →
        </RouterLink>
      </div>
      <p class="max-w-3xl text-sm text-slate-400">
        Nur Fahrgeschäfte mit <strong class="font-medium text-slate-300">mindestens einem DDATA</strong> im UNS-Live-Buffer erscheinen als Karte (keine blinden Platzhalter). Aktualisierung per WebSocket und 5&nbsp;s-Poll.
      </p>
    </header>

    <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
      <label class="min-w-[200px] flex-1 text-xs text-slate-500">
        Sparkplug group id
        <input
          v-model="sparkplugGroupInput"
          type="text"
          class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-sm text-white"
          placeholder="europa_park"
        />
        <span class="mt-1 block text-[10px] text-slate-600">Normalized filter: {{ resolvedGroup || '—' }}</span>
      </label>
      <p v-if="parkContext.activePark" class="text-xs text-slate-500">
        Active park (header): <span class="font-mono text-slate-400">{{ parkContext.activePark.slug }}</span>
      </p>
    </div>

    <div class="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-3">
        <span class="text-xs font-medium text-slate-400">Karten</span>
        <div class="flex flex-wrap gap-1 rounded border border-slate-700 p-0.5">
          <button
            type="button"
            class="rounded px-2 py-1 text-xs"
            :class="cardFilterMode === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'"
            @click="cardFilterMode = 'all'"
          >
            Alle (mit MQTT)
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs"
            :class="cardFilterMode === 'single' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'"
            @click="cardFilterMode = 'single'"
          >
            Einzel
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs"
            :class="cardFilterMode === 'multi' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'"
            @click="cardFilterMode = 'multi'"
          >
            Mehrfach
          </button>
        </div>
        <button
          type="button"
          class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          @click="applySimulatorSelectionToMulti"
        >
          Auswahl aus Simulator (nur mit MQTT)
        </button>
        <p class="text-[10px] text-slate-500">
          Auswahl und Sortierung wie in den Asset-Daten: Filter unten anwenden; Tabelle sortieren; Zeilen-Checkboxen/Radio steuern die Karten.
        </p>
      </div>

      <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <label class="text-xs text-slate-500">
          Search
          <input
            v-model="draftSearch"
            type="search"
            class="mt-1 block w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            placeholder="Slug, scenario, state…"
            @keydown.enter="applyGridFilters"
          />
        </label>
        <label class="text-xs text-slate-500">
          Freshness
          <select
            v-model="draftFreshness"
            class="mt-1 block w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          >
            <option value="any">Any</option>
            <option value="live">LIVE only</option>
            <option value="stale">STALE only</option>
          </select>
        </label>
        <label class="text-xs text-slate-500">
          Scenario contains
          <input
            v-model="draftScenario"
            type="text"
            class="mt-1 block w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
            placeholder="Substring"
            @keydown.enter="applyGridFilters"
          />
        </label>
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
          @click="applyGridFilters"
        >
          Apply filters
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          @click="resetGridFilters"
        >
          Reset filters
        </button>
      </div>

      <div class="overflow-x-auto rounded-lg border border-slate-800">
        <div class="max-h-[min(28rem,55vh)] overflow-y-auto">
          <table class="min-w-full text-left text-sm text-slate-200">
            <thead class="sticky top-0 z-[1] border-b border-slate-800 bg-slate-900/95 text-xs uppercase text-slate-500">
              <tr>
                <th v-if="cardFilterMode === 'multi'" class="whitespace-nowrap px-3 py-2">Show</th>
                <th v-else-if="cardFilterMode === 'single'" class="whitespace-nowrap px-3 py-2">Pick</th>
                <th
                  class="cursor-pointer whitespace-nowrap px-3 py-2 hover:text-slate-300"
                  title="Sort by device id"
                  @click="setSort('deviceId')"
                >
                  Device{{ sortHint('deviceId') }}
                </th>
                <th
                  class="cursor-pointer whitespace-nowrap px-3 py-2 hover:text-slate-300"
                  title="Sort by last DDATA time"
                  @click="setSort('lastReceivedAt')"
                >
                  Last DDATA{{ sortHint('lastReceivedAt') }}
                </th>
                <th
                  class="cursor-pointer whitespace-nowrap px-3 py-2 hover:text-slate-300"
                  title="Sort by freshness (age of last message)"
                  @click="setSort('freshness')"
                >
                  Freshness{{ sortHint('freshness') }}
                </th>
                <th
                  class="cursor-pointer whitespace-nowrap px-3 py-2 hover:text-slate-300"
                  title="Sort by OEE 5m"
                  @click="setSort('oee5m')"
                >
                  OEE 5m{{ sortHint('oee5m') }}
                </th>
                <th class="whitespace-nowrap px-3 py-2">State</th>
                <th class="min-w-[8rem] px-3 py-2">Scenario</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!sortedTableDevices.length">
                <td
                  :colspan="cardFilterMode === 'all' ? 6 : 7"
                  class="px-3 py-6 text-center text-sm text-slate-500"
                >
                  <template v-if="!mqttDevicesSorted.length">Keine DDATA-Zeilen für diese Gruppe.</template>
                  <template v-else>Keine Zeilen passen zu den angewendeten Filtern — Filter anpassen oder zurücksetzen.</template>
                </td>
              </tr>
              <tr
                v-for="d in sortedTableDevices"
                :key="d.deviceId"
                class="border-b border-slate-800/80 hover:bg-slate-900/50"
              >
                <td v-if="cardFilterMode === 'multi'" class="px-3 py-2">
                  <input
                    type="checkbox"
                    class="rounded border-slate-600"
                    :checked="multiVisible[d.deviceId] !== false"
                    @change="setMultiVisible(d.deviceId, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td v-else-if="cardFilterMode === 'single'" class="px-3 py-2">
                  <input
                    type="radio"
                    name="oee-mqtt-single-device"
                    class="border-slate-600 text-brand-500"
                    :checked="singleDeviceSlug === d.deviceId"
                    @change="singleDeviceSlug = d.deviceId"
                  />
                </td>
                <td class="px-3 py-2 font-mono text-xs text-white">{{ d.deviceId }}</td>
                <td class="px-3 py-2 text-xs text-slate-400">{{ fmtTs(d.lastReceivedAt) }}</td>
                <td class="px-3 py-2">
                  <span
                    class="rounded px-2 py-0.5 text-[10px] font-medium uppercase"
                    :class="
                      isLiveDevice(d) ? 'bg-emerald-950/60 text-emerald-200' : 'bg-amber-950/80 text-amber-200'
                    "
                  >
                    {{ isLiveDevice(d) ? 'live' : 'stale' }}
                  </span>
                </td>
                <td class="px-3 py-2 font-mono text-xs tabular-nums text-slate-300">
                  {{ numMetric(d.metrics, 'oee_5m') ?? '—' }}
                </td>
                <td class="px-3 py-2 font-mono text-xs text-slate-300">{{ strMetric(d.metrics, 'asset_state') }}</td>
                <td class="max-w-[14rem] truncate px-3 py-2 font-mono text-xs text-slate-400" :title="strMetric(d.metrics, 'scenario')">
                  {{ strMetric(d.metrics, 'scenario') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
          <span>{{ sortedTableDevices.length }} row(s) · {{ mqttDevicesSorted.length }} mit DDATA gesamt</span>
          <span v-if="draftSearch.trim() !== appliedSearch || draftFreshness !== appliedFreshness || draftScenario.trim() !== appliedScenario" class="text-amber-200/90">
            Entwurf geändert — „Apply filters“ klicken
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadError" class="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
      {{ loadError }}
    </div>

    <div v-if="liveStatus" class="flex flex-wrap gap-2 text-xs text-slate-400">
      <span class="rounded border border-slate-700 px-2 py-1">Buffer: {{ liveStatus.buffer?.bufferSize ?? '—' }} events</span>
      <span class="rounded border border-slate-700 px-2 py-1">~{{ liveStatus.buffer?.eventsPerSec ?? '—' }} msg/s</span>
      <span v-if="liveStatus.buffer?.lastEventTime" class="rounded border border-slate-700 px-2 py-1">
        Last: {{ fmtTs(liveStatus.buffer.lastEventTime) }}
      </span>
      <span class="rounded border border-slate-700 px-2 py-1">
        MQTT: {{ mqttConnectedFlag() ? 'connected' : 'disconnected' }}
      </span>
      <span class="rounded border border-slate-700 px-2 py-1">Mit DDATA: {{ mqttDevicesSorted.length }}</span>
    </div>

    <p v-if="!mqttDevicesSorted.length" class="text-sm text-slate-500">
      Noch keine DDATA für diese Gruppe im Buffer. OEE-Simulator starten (gleiche Sparkplug-Group) oder Gateway abwarten.
    </p>
    <p v-else-if="mqttDevicesSorted.length && !devicesAfterApplied.length" class="text-sm text-amber-200/90">
      Keine Zeilen nach den angewendeten Filtern — „Reset filters“ oder Kriterien lockern.
    </p>
    <p v-else-if="devicesAfterApplied.length && !displayDevices.length" class="text-sm text-amber-200/90">
      <template v-if="cardFilterMode === 'multi'">
        Modus „Mehrfach“: mindestens eine Zeile mit Show aktivieren, oder auf „Alle“ / „Einzel“ wechseln.
      </template>
      <template v-else-if="cardFilterMode === 'single'">
        Modus „Einzel“: keine Zeile wählbar — Filter prüfen oder auf „Alle“ wechseln.
      </template>
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="d in displayDevices"
        :key="d.deviceId"
        class="rounded-xl border border-slate-800 bg-slate-900/40 p-4 shadow-lg shadow-black/20"
      >
        <div class="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 class="font-mono text-base font-semibold text-white">{{ d.deviceId }}</h2>
            <p class="text-[10px] text-slate-500">Last DDATA: {{ fmtTs(d.lastReceivedAt) }}</p>
          </div>
          <span
            class="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase"
            :class="isLiveDevice(d) ? 'bg-emerald-950/60 text-emerald-200' : 'bg-amber-950/80 text-amber-200'"
          >
            {{ isLiveDevice(d) ? 'live' : 'stale' }}
          </span>
        </div>

        <div class="mb-4 grid grid-cols-4 gap-2">
          <StandardPercentGaugeMini label="OEE 5m" :value="numMetric(d.metrics, 'oee_5m')" />
          <StandardPercentGaugeMini label="A 5m" :value="numMetric(d.metrics, 'oee_availability_5m')" />
          <StandardPercentGaugeMini label="P 5m" :value="numMetric(d.metrics, 'oee_performance_5m')" />
          <StandardPercentGaugeMini label="Q 5m" :value="numMetric(d.metrics, 'oee_quality_5m')" />
        </div>

        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400">
          <dt class="text-slate-500">State</dt>
          <dd class="font-mono text-slate-200">{{ strMetric(d.metrics, 'asset_state') }}</dd>
          <dt class="text-slate-500">Scenario</dt>
          <dd class="font-mono text-slate-200">{{ strMetric(d.metrics, 'scenario') }}</dd>
          <dt class="text-slate-500">Störung</dt>
          <dd class="font-mono text-slate-200">
            <span
              v-if="d.metrics.downtime_active === true || numMetric(d.metrics, 'downtime_active') === 1"
              class="text-red-200"
            >
              {{ strMetric(d.metrics, 'downtime_reason_code') || '—' }}
              <span v-if="numMetric(d.metrics, 'downtime_duration_sec') != null" class="text-slate-400">
                · {{ numMetric(d.metrics, 'downtime_duration_sec') }}s
              </span>
            </span>
            <span v-else class="text-slate-500">—</span>
          </dd>
          <dt class="text-slate-500">Queue</dt>
          <dd class="font-mono text-slate-200">
            {{ numMetric(d.metrics, 'queue_occupancy') ?? '—' }} / {{ numMetric(d.metrics, 'queue_capacity_limit') ?? '—' }}
          </dd>
          <dt class="text-slate-500">Queue est. (min)</dt>
          <dd class="font-mono text-slate-200">{{ numMetric(d.metrics, 'queue_time') ?? '—' }}</dd>
          <dt class="text-slate-500">pph act / plan</dt>
          <dd class="font-mono text-slate-200">
            {{ numMetric(d.metrics, 'actual_capacity_pph') ?? '—' }} / {{ numMetric(d.metrics, 'planned_capacity_pph') ?? '—' }}
          </dd>
          <dt class="text-slate-500">Virtual line</dt>
          <dd class="font-mono text-slate-200">
            {{
              d.metrics.virtual_line_enabled == null
                ? '—'
                : numMetric(d.metrics, 'virtual_line_enabled') === 1
                  ? 'yes'
                  : 'no'
            }}
          </dd>
          <dt class="text-slate-500">Downtime</dt>
          <dd class="font-mono text-slate-200">
            {{ strMetric(d.metrics, 'downtime_reason_code') }} · {{ numMetric(d.metrics, 'downtime_duration_sec') ?? 0 }}s
          </dd>
          <dt class="text-slate-500">Quality tag</dt>
          <dd class="font-mono text-slate-200">{{ strMetric(d.metrics, 'quality') }}</dd>
        </dl>
      </article>
    </div>
  </div>
</template>
