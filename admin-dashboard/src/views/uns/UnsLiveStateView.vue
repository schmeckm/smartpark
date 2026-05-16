<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  getIntegrationSettings,
  getUnsMqttLiveEvents,
  getUnsMqttLiveStatus,
  postUnsMqttLiveTestEvent,
  type UnsMqttLiveEvent,
  type UnsMqttLiveStatus,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useI18n } from 'vue-i18n'
import { resolveApiOrigin } from '@/utils/apiOrigin'

const { t } = useI18n()
const auth = useAuthStore()
const { push: pushToast } = useToast()
const { formatTime, formatDateTime } = useRegionalDateTime()
const apiOrigin = resolveApiOrigin()

const parkId = ref('')
const integrationExternalParkId = ref('')
const events = ref<UnsMqttLiveEvent[]>([])
const liveStatus = ref<UnsMqttLiveStatus | null>(null)
const mqttSocketPayload = ref<Record<string, unknown> | null>(null)
const integrationSettings = ref<Record<string, unknown> | null>(null)
const socket = ref<Socket | null>(null)
const publishPending = ref(false)
/** Bumps every second so ThemeParks freshness & KPIs stay reactive without new events. */
const clock = ref(0)
let statusTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const filterSource = ref('')
const filterMessageType = ref('')
const filterDeviceId = ref('')
const filterMetric = ref('')
const search = ref('')
const viewMode = ref<'raw' | 'device' | 'metric'>('raw')

const sourceOptions = computed(() => {
  const seen = new Set<string>()
  for (const e of parkEvents.value) {
    const src = String(e.source || '').trim()
    if (src) seen.add(src)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
})

function slugifyParkKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function groupIdForUi(): string {
  return slugifyParkKey(parkId.value || '')
}

async function resolveParkId() {
  const settings = await getIntegrationSettings()
  integrationSettings.value = settings
  const key = typeof settings.unsParkKey === 'string' ? settings.unsParkKey.trim() : ''
  parkId.value =
    key ||
    ((settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId as string) ||
    'europa_park'
  integrationExternalParkId.value =
    ((settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId as string) || ''
}

function matchesPark(e: UnsMqttLiveEvent): boolean {
  const gid = groupIdForUi()
  if (!gid) return false
  return String(e.groupId || '').toLowerCase() === gid.toLowerCase()
}

async function loadSnapshot() {
  if (!parkId.value) await resolveParkId()
  const gid = groupIdForUi()
  if (!gid) return
  const list = await getUnsMqttLiveEvents(gid, { limit: 1000 })
  events.value = list
}

async function loadStatus() {
  if (!parkId.value) await resolveParkId()
  const gid = groupIdForUi()
  if (!gid) return
  liveStatus.value = await getUnsMqttLiveStatus(gid)
}

function pushIncoming(rows: UnsMqttLiveEvent[]) {
  const incoming = rows.filter(matchesPark)
  if (!incoming.length) return
  events.value = [...incoming, ...events.value].slice(0, 1000)
}

function connectSocket() {
  const token = auth.accessToken
  if (!token) return
  socket.value?.disconnect()
  const s = apiOrigin
    ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
  socket.value = s
  s.on('mqtt:status', (p: unknown) => {
    mqttSocketPayload.value = p as Record<string, unknown>
  })
  s.on('uns:mqtt:live:events', (payload: unknown) => {
    const evs = (payload as { events?: UnsMqttLiveEvent[] })?.events
    if (Array.isArray(evs) && evs.length) pushIncoming(evs)
  })
}

async function publishTest() {
  if (!parkId.value) await resolveParkId()
  publishPending.value = true
  try {
    await postUnsMqttLiveTestEvent(groupIdForUi())
    pushToast('Event published successfully.', 'success')
    await loadStatus()
  } catch (e) {
    pushToast(e instanceof Error ? e.message : 'Publish failed', 'error')
  } finally {
    publishPending.value = false
  }
}

const filteredEvents = computed(() => {
  let list = events.value
  const fs = filterSource.value.trim().toLowerCase()
  const fmt = filterMessageType.value.trim().toUpperCase()
  const fd = filterDeviceId.value.trim().toLowerCase()
  const fm = filterMetric.value.trim().toLowerCase()
  const q = search.value.trim().toLowerCase()
  if (fs) list = list.filter((e) => String(e.source || '').toLowerCase() === fs)
  if (fmt) list = list.filter((e) => (e.messageType || '').toUpperCase().includes(fmt))
  if (fd) list = list.filter((e) => String(e.deviceId || '').toLowerCase().includes(fd))
  if (fm) list = list.filter((e) => String(e.metric || '').toLowerCase().includes(fm))
  if (q) {
    list = list.filter((e) => {
      const hay = [
        e.source,
        e.messageType,
        e.sparkplugTopic,
        e.groupId,
        e.edgeNodeId,
        e.deviceId,
        e.unsDomain,
        e.metric,
        e.canonicalUnsTopic,
        e.payloadPreview,
        formatValue(e.value),
        e.valueDisplay,
      ]
        .join('\n')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  return list
})

const parkEvents = computed(() => events.value.filter(matchesPark))

/** Last DDATA receivedAt (ms) per device — heartbeat for stale detection. */
const deviceLastDdataMs = computed(() => {
  const m = new Map<string, number>()
  for (const e of parkEvents.value) {
    if (String(e.messageType || '').toUpperCase() !== 'DDATA' || !e.deviceId) continue
    const t = Date.parse(e.receivedAt)
    if (Number.isNaN(t)) continue
    const prev = m.get(e.deviceId)
    if (prev == null || t > prev) m.set(e.deviceId, t)
  }
  return m
})

function deviceHeartbeatStale(deviceId: string | null | undefined): boolean {
  const tick = clock.value
  if (!deviceId) return true
  const last = deviceLastDdataMs.value.get(deviceId)
  if (last == null) return true
  return Date.now() - last + tick * 0 > 60_000
}

const tableRows = computed(() => {
  const list = filteredEvents.value
  if (viewMode.value === 'raw') return list

  const seen = new Set<string>()
  const out: UnsMqttLiveEvent[] = []
  for (const e of list) {
    if (viewMode.value === 'device') {
      const d = e.deviceId || ''
      if (!d || seen.has(d)) continue
      seen.add(d)
      out.push(e)
    } else {
      const d = e.deviceId || ''
      const m = e.metric ?? ''
      const k = `${d}|${m || '__payload__'}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
    }
  }
  return out
})

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function formatCellValue(r: UnsMqttLiveEvent): string {
  if (r.valueDisplay) return r.valueDisplay
  return formatValue(r.value)
}

type LiveSortCol =
  | 'receivedAt'
  | 'heartbeat'
  | 'source'
  | 'messageType'
  | 'sparkplugTopic'
  | 'groupId'
  | 'edgeNodeId'
  | 'deviceId'
  | 'unsDomain'
  | 'metric'
  | 'value'
  | 'quality'
  | 'canonicalUnsTopic'
  | 'payloadPreview'

const sortColumn = ref<LiveSortCol | null>(null)
const sortDir = ref<'asc' | 'desc'>('desc')

function sortHint(col: LiveSortCol): string {
  if (sortColumn.value !== col) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function onSortHeader(col: LiveSortCol) {
  if (sortColumn.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = col
    sortDir.value = col === 'receivedAt' ? 'desc' : 'asc'
  }
}

function clearSort() {
  sortColumn.value = null
  sortDir.value = 'desc'
}

function cmpSortPrimitives(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function sortPrimitiveForRow(r: UnsMqttLiveEvent, col: LiveSortCol): string | number {
  switch (col) {
    case 'receivedAt': {
      const t = Date.parse(r.receivedAt)
      return Number.isNaN(t) ? 0 : t
    }
    case 'heartbeat':
      return deviceHeartbeatStale(r.deviceId) ? 1 : 0
    case 'source':
      return (r.source || '').toLowerCase()
    case 'messageType':
      return (r.messageType || '').toUpperCase()
    case 'sparkplugTopic':
      return (r.sparkplugTopic || '').toLowerCase()
    case 'groupId':
      return (r.groupId || '').toLowerCase()
    case 'edgeNodeId':
      return (r.edgeNodeId || '').toLowerCase()
    case 'deviceId':
      return (r.deviceId || '').toLowerCase()
    case 'unsDomain':
      return (r.unsDomain || '').toLowerCase()
    case 'metric':
      return (r.metric || '').toLowerCase()
    case 'value': {
      const v = r.value
      if (typeof v === 'number' && Number.isFinite(v)) return v
      return formatCellValue(r).toLowerCase()
    }
    case 'quality':
      return (r.quality || '').toLowerCase()
    case 'canonicalUnsTopic':
      return (r.canonicalUnsTopic || '').toLowerCase()
    case 'payloadPreview':
      return (r.payloadPreview || '').toLowerCase()
    default:
      return ''
  }
}

const sortedTableRows = computed(() => {
  const rows = tableRows.value
  const col = sortColumn.value
  if (!col) return rows
  const mul = sortDir.value === 'asc' ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    const va = sortPrimitiveForRow(a, col)
    const vb = sortPrimitiveForRow(b, col)
    let c = cmpSortPrimitives(va, vb)
    if (c === 0) c = a.id.localeCompare(b.id)
    return c * mul
  })
  return copy
})

/** ThemeParks live sync → canonical ingest → Sparkplug MQTT publish cadence (API settings). */
const integrationPollingSummary = computed(() => {
  const s = integrationSettings.value
  if (!s) return null
  const pe = s.pollingEnabled as { enabled?: boolean } | undefined
  const iv = s.pollingIntervalSeconds as { seconds?: number } | undefined
  const secRaw = iv?.seconds
  const sec =
    typeof secRaw === 'number' && Number.isFinite(secRaw) ? Math.max(30, Math.min(86400, Math.round(secRaw))) : 300
  return {
    enabled: pe?.enabled === true,
    seconds: sec,
  }
})

/** Local wall time HH:mm:ss.SSS */
function formatClockMs(iso: string): string {
  return formatTime(iso)
}

function computeLiveKpis(list: UnsMqttLiveEvent[], now: number, eventsPerSec: number) {
  const windowMs = 60_000
  const devicesRecent = new Set<string>()
  for (const e of list) {
    if (!e.deviceId) continue
    const t = Date.parse(e.receivedAt)
    if (!Number.isNaN(t) && now - t <= windowMs) devicesRecent.add(e.deviceId)
  }
  const statusByDev = new Map<string, string>()
  const queueByDev = new Map<string, number>()
  for (const e of list) {
    if (!e.deviceId) continue
    if (e.metric === 'status' && !statusByDev.has(e.deviceId)) {
      statusByDev.set(e.deviceId, String(e.value ?? ''))
    }
    if (e.metric === 'queue_time' && typeof e.value === 'number' && !queueByDev.has(e.deviceId)) {
      queueByDev.set(e.deviceId, e.value)
    }
  }
  const openAttractions = [...statusByDev.values()].filter((v) => v === 'OPERATING').length
  const queues = [...queueByDev.values()]
  const avgQueue = queues.length ? Math.round(queues.reduce((a, b) => a + b, 0) / queues.length) : null
  const maxQueue = queues.length ? Math.max(...queues) : null
  return {
    onlineDevices: devicesRecent.size,
    avgQueue,
    maxQueue,
    openAttractions,
    eventsPerSec,
  }
}

const themeparksAdapterLive = computed(() => {
  const tick = clock.value
  const maxAgeMs = 60_000
  let newest = 0
  for (const e of parkEvents.value) {
    if (String(e.source || '').toLowerCase() !== 'themeparks_wiki') continue
    const t = Date.parse(e.receivedAt)
    if (!Number.isNaN(t) && t > newest) newest = t
  }
  if (!newest) return { active: false as const, lastReceivedAt: null as string | null }
  const ageMs = Date.now() - newest + tick * 0
  return {
    active: ageMs < maxAgeMs,
    lastReceivedAt: new Date(newest).toISOString(),
  }
})

const liveKpis = computed(() => {
  const tick = clock.value
  const list = parkEvents.value
  const now = Date.now() + tick * 0
  return computeLiveKpis(list, now, liveStatus.value?.buffer?.eventsPerSec ?? 0)
})

const mqttConnected = computed(() => {
  const fromSocket = mqttSocketPayload.value?.connected
  if (typeof fromSocket === 'boolean') return fromSocket
  const fromStatus = liveStatus.value?.mqtt?.connected
  return Boolean(fromStatus)
})

const subscribedTopics = computed(() => {
  const sp = (mqttSocketPayload.value?.sparkplugSubscribePatterns ||
    liveStatus.value?.mqtt?.sparkplugSubscribePatterns) as string[] | undefined
  return Array.isArray(sp) ? sp : []
})

const lastEventTime = computed(() => {
  const buf = liveStatus.value?.buffer?.lastEventTime
  if (buf) return buf
  const first = events.value[0]
  return first?.receivedAt || null
})

onMounted(async () => {
  await resolveParkId()
  await loadSnapshot()
  await loadStatus()
  connectSocket()
  statusTimer = setInterval(() => {
    void loadStatus()
  }, 2500)
  clockTimer = setInterval(() => {
    clock.value += 1
  }, 1000)
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  if (clockTimer) clearInterval(clockTimer)
  socket.value?.disconnect()
})

watch(
  () => auth.accessToken,
  (t) => {
    if (t) connectSocket()
  }
)

watch(parkId, async () => {
  await loadSnapshot()
  await loadStatus()
})
</script>

<template>
  <div class="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('realtime.liveSignals.unsStreamTitle') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          Zeigt ausschließlich eingehende Sparkplug-MQTT-Nachrichten vom Broker (kein Adapter- oder DB-Spiegel). Pro
          Metrik eine Zeile. Park-Key entspricht der Sparkplug-Gruppe (<span class="font-mono text-slate-300">groupId</span>).
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-amber-600/60 bg-amber-900/30 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
          :disabled="publishPending"
          @click="publishTest"
        >
          Publish Test Event
        </button>
        <button
          type="button"
          class="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          @click="loadSnapshot"
        >
          Refresh snapshot
        </button>
      </div>
    </div>

    <section
      class="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300"
    >
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
        :class="mqttConnected ? 'bg-emerald-900/50 text-emerald-200' : 'bg-red-900/40 text-red-200'"
      >
        MQTT {{ mqttConnected ? 'Connected' : 'Disconnected' }}
      </span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
        :class="themeparksAdapterLive.active ? 'bg-sky-900/50 text-sky-200' : 'bg-slate-800 text-slate-400'"
        :title="
          themeparksAdapterLive.lastReceivedAt
            ? `Letztes source=themeparks_wiki: ${formatDateTime(themeparksAdapterLive.lastReceivedAt)}`
            : 'Noch kein Event mit source=themeparks_wiki im Puffer'
        "
      >
        Adapter simulation {{ themeparksAdapterLive.active ? 'Active' : 'Inactive' }}
      </span>
      <span class="rounded-full bg-slate-800 px-2.5 py-1 text-slate-400">
        Buffer: <span class="font-mono text-slate-200">{{ liveStatus?.buffer?.bufferSize ?? '—' }}</span>
      </span>
      <span class="rounded-full bg-slate-800 px-2.5 py-1 text-slate-400">
        Last event:
        <span class="font-mono text-slate-200">{{ lastEventTime ? formatClockMs(lastEventTime) : '—' }}</span>
      </span>
      <span class="w-full text-[11px] text-slate-500">
        UNS park / groupId: <span class="font-mono text-slate-300">{{ groupIdForUi() || '—' }}</span>
        <span v-if="integrationExternalParkId" class="ml-2">
          · Integration park id:
          <span class="font-mono text-slate-400">{{ integrationExternalParkId }}</span>
        </span>
      </span>
      <div v-if="subscribedTopics.length" class="w-full border-t border-slate-800 pt-2">
        <p class="mb-1 text-slate-500">Subscribed Sparkplug patterns</p>
        <ul class="flex flex-wrap gap-1 font-mono text-[11px] text-amber-200/80">
          <li v-for="t in subscribedTopics" :key="t" class="rounded bg-slate-950/80 px-1.5 py-0.5">{{ t }}</li>
        </ul>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Online devices</p>
        <p class="mt-1 font-display text-2xl font-semibold text-white">{{ liveKpis.onlineDevices }}</p>
        <p class="mt-0.5 text-[10px] text-slate-500">DDATA/DBIRTH &lt; 60s</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Avg queue</p>
        <p class="mt-1 font-display text-2xl font-semibold text-white">
          {{ liveKpis.avgQueue != null ? liveKpis.avgQueue : '—' }}
        </p>
        <p class="mt-0.5 text-[10px] text-slate-500">Letzte queue_time / Gerät</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Max queue</p>
        <p class="mt-1 font-display text-2xl font-semibold text-amber-200/90">
          {{ liveKpis.maxQueue != null ? liveKpis.maxQueue : '—' }}
        </p>
        <p class="mt-0.5 text-[10px] text-slate-500">Höchster aktueller Wert</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Open attractions</p>
        <p class="mt-1 font-display text-2xl font-semibold text-emerald-200/90">{{ liveKpis.openAttractions }}</p>
        <p class="mt-0.5 text-[10px] text-slate-500">status = OPERATING</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Events/sec</p>
        <p class="mt-1 font-display text-2xl font-semibold text-slate-100">{{ liveKpis.eventsPerSec }}</p>
        <p class="mt-0.5 text-[10px] text-slate-500">Broker (global)</p>
      </div>
    </section>

    <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-xs text-slate-500">View</span>
        <div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition"
            :class="viewMode === 'raw' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="viewMode = 'raw'"
          >
            Raw events
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition"
            :class="viewMode === 'device' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="viewMode = 'device'"
          >
            Latest per device
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition"
            :class="viewMode === 'metric' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="viewMode = 'metric'"
          >
            Latest per metric
          </button>
        </div>
      </div>
      <div class="mb-3 flex flex-wrap gap-3">
        <select
          v-model="filterSource"
          class="min-w-[8rem] flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 sm:max-w-[11rem]"
        >
          <option value="">All sources</option>
          <option v-for="src in sourceOptions" :key="src" :value="src">{{ src }}</option>
        </select>
        <input
          v-model="filterMessageType"
          type="search"
          placeholder="Message type (e.g. DDATA)"
          class="min-w-[8rem] flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 sm:max-w-[12rem]"
        />
        <input
          v-model="filterDeviceId"
          type="search"
          placeholder="Device ID"
          class="min-w-[8rem] flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 sm:max-w-[11rem]"
        />
        <input
          v-model="filterMetric"
          type="search"
          placeholder="Metric"
          class="min-w-[8rem] flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 sm:max-w-[11rem]"
        />
        <input
          v-model="search"
          type="search"
          placeholder="Search (contains)"
          class="min-w-[10rem] flex-[2] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600"
        />
      </div>
      <p class="mb-2 text-xs text-slate-500">
        Showing {{ sortedTableRows.length }} row(s) · view: {{ viewMode }} · {{ filteredEvents.length }} after filters ·
        {{ events.length }} in buffer (park)
        <span v-if="sortColumn" class="ml-1 text-slate-400">
          · sort: {{ sortColumn }} {{ sortDir }}
          <button type="button" class="ml-1 text-amber-300/90 underline hover:text-amber-200" @click="clearSort">
            reset
          </button>
        </span>
      </p>
      <p v-if="integrationPollingSummary" class="mb-2 text-[11px] text-slate-500">
        ThemeParks Live-Sync (API → Canonical → MQTT):
        <span class="font-mono text-slate-300">~{{ integrationPollingSummary.seconds }}s</span>
        Intervall (Einstellung
        <span class="font-mono text-slate-400">pollingIntervalSeconds</span>, min. 30s), nur wenn Polling
        <span class="font-mono text-slate-400">enabled</span>
        und Server
        <span class="font-mono text-slate-400">EXTERNAL_PARK_DATA_ENABLED</span>
        — aktuell Polling:
        <span :class="integrationPollingSummary.enabled ? 'text-emerald-400/90' : 'text-slate-500'">{{
          integrationPollingSummary.enabled ? 'an' : 'aus'
        }}</span>
      </p>
      <div class="overflow-auto">
        <table class="min-w-full text-left text-[11px]">
          <thead class="sticky top-0 z-10 bg-slate-900 text-slate-500">
            <tr>
              <th class="whitespace-nowrap px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  title="Sort by receive time"
                  @click="onSortHeader('receivedAt')"
                >
                  Timestamp <span class="font-mono text-[10px] text-slate-600">{{ sortHint('receivedAt') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  title="Stale before Live (asc = Live first)"
                  @click="onSortHeader('heartbeat')"
                >
                  Heartbeat <span class="font-mono text-[10px] text-slate-600">{{ sortHint('heartbeat') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('source')"
                >
                  Source <span class="font-mono text-[10px] text-slate-600">{{ sortHint('source') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('messageType')"
                >
                  Message type <span class="font-mono text-[10px] text-slate-600">{{ sortHint('messageType') }}</span>
                </button>
              </th>
              <th class="min-w-[12rem] px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('sparkplugTopic')"
                >
                  Sparkplug topic <span class="font-mono text-[10px] text-slate-600">{{ sortHint('sparkplugTopic') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('groupId')"
                >
                  Park / group ID <span class="font-mono text-[10px] text-slate-600">{{ sortHint('groupId') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('edgeNodeId')"
                >
                  Edge node ID <span class="font-mono text-[10px] text-slate-600">{{ sortHint('edgeNodeId') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('deviceId')"
                >
                  Device ID <span class="font-mono text-[10px] text-slate-600">{{ sortHint('deviceId') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  title="UNS domain from entity registry (not from DDATA guess)"
                  @click="onSortHeader('unsDomain')"
                >
                  Domain <span class="font-mono text-[10px] text-slate-600">{{ sortHint('unsDomain') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('metric')"
                >
                  Metric <span class="font-mono text-[10px] text-slate-600">{{ sortHint('metric') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('value')"
                >
                  Value <span class="font-mono text-[10px] text-slate-600">{{ sortHint('value') }}</span>
                </button>
              </th>
              <th class="px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('quality')"
                >
                  Quality <span class="font-mono text-[10px] text-slate-600">{{ sortHint('quality') }}</span>
                </button>
              </th>
              <th class="min-w-[10rem] px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('canonicalUnsTopic')"
                >
                  Canonical UNS topic
                  <span class="font-mono text-[10px] text-slate-600">{{ sortHint('canonicalUnsTopic') }}</span>
                </button>
              </th>
              <th class="min-w-[8rem] px-2 py-2">
                <button
                  type="button"
                  class="inline-flex w-full items-center gap-0.5 text-left font-medium text-slate-400 hover:text-slate-200"
                  @click="onSortHeader('payloadPreview')"
                >
                  Payload preview
                  <span class="font-mono text-[10px] text-slate-600">{{ sortHint('payloadPreview') }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedTableRows" :key="r.id" class="border-t border-slate-800 align-top">
              <td class="whitespace-nowrap px-2 py-1.5 font-mono text-slate-300" :title="`Payload: ${r.timestamp} · Empfang: ${r.receivedAt}`">
                {{ formatClockMs(r.receivedAt) }}
              </td>
              <td
                class="whitespace-nowrap px-2 py-1.5"
                :title="deviceHeartbeatStale(r.deviceId) ? 'Kein DDATA seit über 60s' : 'DDATA innerhalb der letzten 60s'"
              >
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                  :class="
                    deviceHeartbeatStale(r.deviceId) ? 'bg-amber-950/80 text-amber-300' : 'bg-emerald-950/60 text-emerald-300'
                  "
                >
                  {{ deviceHeartbeatStale(r.deviceId) ? 'Stale' : 'Live' }}
                </span>
              </td>
              <td class="px-2 py-1.5 text-slate-300">{{ r.source || '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-amber-200/90">{{ r.messageType }}</td>
              <td class="max-w-[20rem] break-all px-2 py-1.5 font-mono text-amber-200/70">{{ r.sparkplugTopic }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-400">{{ r.groupId || '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-400">{{ r.edgeNodeId || '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ r.deviceId || '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-sky-200/90">{{ r.unsDomain || '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ r.metric || '—' }}</td>
              <td class="max-w-[14rem] break-words px-2 py-1.5 text-slate-200">{{ formatCellValue(r) }}</td>
              <td class="px-2 py-1.5 text-slate-400">{{ r.quality || '—' }}</td>
              <td class="max-w-[18rem] break-all px-2 py-1.5 font-mono text-emerald-200/80">
                {{ r.canonicalUnsTopic || '—' }}
              </td>
              <td class="max-w-[14rem] px-2 py-1.5 text-slate-500">{{ r.payloadPreview }}</td>
            </tr>
            <tr v-if="!sortedTableRows.length">
              <td colspan="14" class="px-2 py-6 text-center text-slate-500">
                Keine MQTT-Events für diesen Park / Filter. Prüfe MQTT, Subscriptions und ob der Broker Traffic
                liefert.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
