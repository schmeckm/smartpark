<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { io, type Socket } from 'socket.io-client'
import {
  getSqdcAssetBoardHierarchical,
  getSqdcBoard,
  getSqdcHistory,
  getSqdcParkBoardHierarchical,
  getUnsMqttLiveEvents,
  listMasterData,
  postSqdcMood,
  postSqdcSafetyEvent,
  postSqdcSnapshot,
  type MasterDataGridRow,
  type SqdcAssetBoardResponse,
  type SqdcBoardResponse,
  type SqdcHistoryResponse,
  type SqdcMood,
  type SqdcParkBoardResponse,
  type UnsMqttLiveEvent,
} from '@/api/client'
import SqdcHierarchicalBoardPreview from '@/components/SqdcHierarchicalBoardPreview.vue'
import { numMetric, slugifyUnsParkKey } from '@/composables/useOeeMqttCockpit'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const parkContext = useParkContextStore()
const auth = useAuthStore()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()

const apiOrigin = import.meta.env.VITE_API_URL || undefined

/** Local copy of UNS live buffer rows (HTTP seed + Socket.IO `uns:mqtt:live:events`). */
const mqttLiveBuffer = ref<UnsMqttLiveEvent[]>([])
let unsLiveSocket: Socket | null = null

const MOOD_CHOICES: [string, SqdcMood][] = [
  ['😀', 'great'],
  ['🙂', 'good'],
  ['😐', 'neutral'],
  ['😕', 'low'],
  ['😟', 'bad'],
]

const rides = ref<MasterDataGridRow[]>([])
/** Client-side filter for the attraction picker (many parks have >50 rides). */
const rideSearch = ref('')
const assetId = ref<string>('')
const businessDate = ref(todayIsoDate())
const historyDays = ref(14)

const board = ref<SqdcBoardResponse | null>(null)
const history = ref<SqdcHistoryResponse | null>(null)
/** Same park/date (and optional asset) from hierarchical SQDCP API — rings + gauge for classic page. */
const hierarchicalPreview = ref<SqdcParkBoardResponse | SqdcAssetBoardResponse | null>(null)
const loading = ref(false)

const safetyTitle = ref('')
const safetyKind = ref<'near_miss' | 'accident'>('near_miss')
const safetyDesc = ref('')

const snapOee = ref<string>('')
const snapGuests = ref<string>('')
const snapLead = ref('')
const snapNotes = ref('')

function todayIsoDate() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const selectedRide = computed(() => rides.value.find((r) => r.id === assetId.value) || null)

const filteredRides = computed(() => {
  const q = rideSearch.value.trim().toLowerCase()
  let list = rides.value
  if (q) {
    list = list.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.slug || '').toLowerCase().includes(q) ||
        String(r.id).toLowerCase().includes(q)
    )
  }
  if (assetId.value && !list.some((r) => r.id === assetId.value)) {
    const sel = rides.value.find((r) => r.id === assetId.value)
    if (sel) return [sel, ...list]
  }
  return list
})
/**
 * MQTT live rows use Sparkplug `groupId` (= park slug, e.g. europa_park), same as {@link useOeeMqttCockpit}.
 * The UNS API path param is passed through `slugifyName` server-side; using the park UUID would slugify to
 * a different string than the broker group and the buffer would look empty.
 */
const mqttLiveGroupId = computed(() =>
  slugifyUnsParkKey(parkContext.activePark?.slug || parkContext.activeParkId || '')
)

const liveOee = ref<number | null>(null)
const liveQueue = ref<number | null>(null)
const liveMqttLastAt = ref<string | null>(null)
const liveMqttStale = ref(false)

let mqttPollTimer: ReturnType<typeof setInterval> | null = null

function stopMqttPoll() {
  if (mqttPollTimer) {
    clearInterval(mqttPollTimer)
    mqttPollTimer = null
  }
}

function startMqttPoll() {
  stopMqttPoll()
  if (!parkContext.activeParkId || !assetId.value) return
  mqttPollTimer = setInterval(() => {
    void refreshLiveMqtt()
  }, 45_000)
}

function pushUnsLiveRows(rows: UnsMqttLiveEvent[]) {
  const want = mqttLiveGroupId.value
  if (!want) return
  const incoming = rows.filter((e) => String(e.groupId || '').toLowerCase() === want)
  if (!incoming.length) return
  mqttLiveBuffer.value = [...incoming, ...mqttLiveBuffer.value].slice(0, 2000)
  applyLiveFromBuffer()
}

function connectUnsLiveSocket() {
  const token = auth.accessToken
  if (!token) return
  unsLiveSocket?.disconnect()
  const s = apiOrigin
    ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
  unsLiveSocket = s
  s.on('uns:mqtt:live:events', (payload: unknown) => {
    const evs = (payload as { events?: UnsMqttLiveEvent[] })?.events
    if (Array.isArray(evs) && evs.length) pushUnsLiveRows(evs)
  })
}

function disconnectUnsLiveSocket() {
  unsLiveSocket?.disconnect()
  unsLiveSocket = null
}

/** Derive OEE / queue for the selected ride from `mqttLiveBuffer` (newest DDATA wins per metric). */
function applyLiveFromBuffer() {
  liveOee.value = null
  liveQueue.value = null
  liveMqttLastAt.value = null
  liveMqttStale.value = false
  const slug = selectedRide.value?.slug?.trim()
  const group = mqttLiveGroupId.value
  const aid = assetId.value.trim()
  if (!slug || !group) return

  const relevant = mqttLiveBuffer.value
    .filter((e) => {
      if (String(e.groupId || '').toLowerCase() !== group) return false
      if (String(e.messageType || '').toUpperCase() !== 'DDATA') return false
      const dev = String(e.deviceId || '')
      return dev === slug || dev.toLowerCase() === slug.toLowerCase() || dev === aid
    })
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))

  const byMetric = new Map<string, unknown>()
  let lastAt = ''
  for (const e of relevant) {
    if (e.metric) byMetric.set(String(e.metric), e.value)
    if (e.receivedAt && e.receivedAt > lastAt) lastAt = e.receivedAt
  }
  if (!lastAt) return
  liveMqttLastAt.value = lastAt
  const staleMs = Date.now() - Date.parse(lastAt)
  liveMqttStale.value = staleMs > 120_000
  liveOee.value = numMetric(Object.fromEntries(byMetric), 'oee_5m')
  liveQueue.value = numMetric(Object.fromEntries(byMetric), 'queue_occupancy')
}

async function loadRides() {
  const pid = parkContext.activeParkId
  if (!pid) {
    rides.value = []
    return
  }
  const pageSize = 200
  const acc: MasterDataGridRow[] = []
  try {
    setApiParkContextId(pid)
    for (let page = 0; page < 40; page += 1) {
      const res = await listMasterData('rides', { parkId: pid, page, pageSize })
      acc.push(...res.rows)
      if (res.rows.length < pageSize) break
      if (acc.length >= res.total) break
    }
    rides.value = acc.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
  } catch (e) {
    rides.value = []
    push(e instanceof Error ? e.message : 'Fahrten konnten nicht geladen werden', 'error')
  }
}

async function refreshLiveMqtt() {
  const slug = selectedRide.value?.slug?.trim()
  const group = mqttLiveGroupId.value
  if (!parkContext.activeParkId || !slug || !group) {
    mqttLiveBuffer.value = []
    applyLiveFromBuffer()
    return
  }
  try {
    const events = await getUnsMqttLiveEvents(group, { limit: 2000 })
    mqttLiveBuffer.value = [...events].slice(0, 2000)
    applyLiveFromBuffer()
  } catch {
    mqttLiveBuffer.value = []
    applyLiveFromBuffer()
  }
}

const liveMqttFootnote = computed(() => {
  if (!assetId.value) return ''
  if (liveOee.value == null && liveQueue.value == null && !liveMqttLastAt.value) {
    return 'Keine MQTT-DDATA für diese Attraktion im Live-Puffer (Gerät = Slug oder Asset-UUID, Gruppe = Sparkplug-Park-Slug wie im OEE-Cockpit). Snapshot oder Simulator-Pfad prüfen.'
  }
  if (liveMqttStale.value && liveMqttLastAt.value) {
    try {
      const t = formatDateTime(new Date(liveMqttLastAt.value))
      return `Letzte MQTT-Zeile: ${t} (>2 min — Werte können veraltet sein).`
    } catch {
      return 'Letzte MQTT-Zeile älter als 2 min.'
    }
  }
  if (liveMqttLastAt.value) {
    try {
      return `Letzte MQTT-Zeile: ${formatDateTime(new Date(liveMqttLastAt.value))} · Echtzeit: WebSocket (Socket.IO) + MQTT-Puffer · HTTP-Fallback ca. 45 s.`
    } catch {
      return 'MQTT live über WebSocket (Socket.IO) · HTTP-Fallback ca. 45 s.'
    }
  }
  return ''
})

async function loadBoard() {
  const pid = parkContext.activeParkId
  if (!pid) return
  loading.value = true
  try {
    setApiParkContextId(pid)
    board.value = await getSqdcBoard({
      businessDate: businessDate.value,
      assetId: assetId.value || null,
    })
    if (assetId.value) {
      history.value = await getSqdcHistory({ assetId: assetId.value, days: historyDays.value })
    } else {
      history.value = null
    }
    await refreshLiveMqtt()
    const snap = board.value?.delivery?.snapshot
    if (snap) {
      snapOee.value = snap.deliveryOee5m != null ? String(snap.deliveryOee5m) : ''
      snapGuests.value = snap.customerGuestCount != null ? String(snap.customerGuestCount) : ''
      snapLead.value = snap.leadTechnicianName || ''
      snapNotes.value = snap.notes || ''
    } else {
      snapOee.value = liveOee.value != null ? String(Math.round(liveOee.value * 1000) / 1000) : ''
      snapGuests.value = liveQueue.value != null ? String(liveQueue.value) : ''
      snapLead.value = board.value?.delivery?.leadTechnicianName || ''
      snapNotes.value = ''
    }

    hierarchicalPreview.value = null
    try {
      if (assetId.value) {
        hierarchicalPreview.value = await getSqdcAssetBoardHierarchical(pid, assetId.value, businessDate.value)
      } else {
        hierarchicalPreview.value = await getSqdcParkBoardHierarchical(pid, businessDate.value)
      }
    } catch {
      hierarchicalPreview.value = null
    }
  } catch (e) {
    push(e instanceof Error ? e.message : t('sqdc.classicBoardLoadError'), 'error')
    board.value = null
    hierarchicalPreview.value = null
  } finally {
    loading.value = false
  }
}

async function submitMood(m: SqdcMood) {
  const pid = parkContext.activeParkId
  if (!pid) {
    push('Bitte einen Park im Header wählen.', 'error')
    return
  }
  try {
    setApiParkContextId(pid)
    await postSqdcMood({
      businessDate: businessDate.value,
      mood: m,
      assetId: assetId.value || null,
    })
    push('Stimmung gespeichert', 'success')
    await loadBoard()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
  }
}

async function submitSafety() {
  if (!safetyTitle.value.trim()) {
    push('Titel eingeben', 'error')
    return
  }
  try {
    setApiParkContextId(parkContext.activeParkId)
    await postSqdcSafetyEvent({
      kind: safetyKind.value,
      title: safetyTitle.value.trim(),
      description: safetyDesc.value.trim() || null,
      assetId: assetId.value || null,
    })
    push('Sicherheits-Ereignis erfasst', 'success')
    safetyTitle.value = ''
    safetyDesc.value = ''
    await loadBoard()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
  }
}

async function saveSnapshot() {
  if (!assetId.value) {
    push('Bitte eine Attraktion wählen (Pflicht für Snapshot)', 'warning')
    return
  }
  try {
    setApiParkContextId(parkContext.activeParkId)
    const oee = snapOee.value.trim() === '' ? null : Number(snapOee.value)
    const guests = snapGuests.value.trim() === '' ? null : Number.parseInt(snapGuests.value, 10)
    await postSqdcSnapshot({
      assetId: assetId.value,
      businessDate: businessDate.value,
      deliveryOee5m: oee != null && Number.isFinite(oee) ? Math.min(1, Math.max(0, oee)) : null,
      customerGuestCount: guests != null && Number.isFinite(guests) ? guests : null,
      leadTechnicianName: snapLead.value.trim() || null,
      notes: snapNotes.value.trim() || null,
    })
    push('Tages-Snapshot gespeichert — Trend aktualisiert', 'success')
    await loadBoard()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Snapshot fehlgeschlagen', 'error')
  }
}

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return formatDateTime(new Date(iso))
  } catch {
    return iso
  }
}

const trendMaxOee = computed(() => {
  const s = history.value?.series || []
  let m = 0.01
  for (const row of s) {
    if (row.deliveryOee5m != null) m = Math.max(m, row.deliveryOee5m)
  }
  return m
})

onMounted(async () => {
  await loadRides()
  await loadBoard()
  connectUnsLiveSocket()
  if (parkContext.activeParkId && assetId.value) startMqttPoll()
})

watch(
  () => parkContext.activeParkId,
  async () => {
    mqttLiveBuffer.value = []
    applyLiveFromBuffer()
    assetId.value = ''
    rideSearch.value = ''
    await loadRides()
    await loadBoard()
  }
)

watch([businessDate, assetId, historyDays], async () => {
  await loadBoard()
})

watch([() => parkContext.activeParkId, assetId], () => {
  stopMqttPoll()
  if (parkContext.activeParkId && assetId.value) startMqttPoll()
  applyLiveFromBuffer()
})

watch(
  () => auth.accessToken,
  (t) => {
    if (t) connectUnsLiveSocket()
    else disconnectUnsLiveSocket()
  }
)

onBeforeUnmount(() => {
  disconnectUnsLiveSocket()
  stopMqttPoll()
})
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('sqdc.title') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          {{ t('sqdc.classicBoardSubtitle') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        <RouterLink
          v-if="parkContext.activeParkId"
          class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
          :to="`/sqdc/parks/${parkContext.activeParkId}`"
        >
          {{ t('sqdc.linkHierarchicalBoard') }}
        </RouterLink>
        <RouterLink class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800" to="/uns/oee-cockpit">
          ← OEE MQTT Cockpit
        </RouterLink>
      </div>
    </header>

    <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <label class="text-xs text-slate-500">
        Kalendertag (UTC)
        <input
          v-model="businessDate"
          type="date"
          class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label class="min-w-[10rem] flex-1 text-xs text-slate-500 sm:max-w-[14rem]">
        Fahrt suchen
        <input
          v-model="rideSearch"
          type="search"
          autocomplete="off"
          placeholder="Name, Slug…"
          class="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label class="min-w-[min(100%,18rem)] flex-[2] text-xs text-slate-500">
        <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span>Attraktion (Fahrgeschäft)</span>
          <span v-if="parkContext.activeParkId" class="font-normal text-slate-600"> {{ rides.length }} geladen </span>
        </span>
        <select
          v-model="assetId"
          class="mt-1 block w-full max-w-xl rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="">— Gesamter Park (kein Snapshot) —</option>
          <option v-for="r in filteredRides" :key="r.id" :value="r.id">{{ r.name }} ({{ r.slug || r.id.slice(0, 8) }})</option>
        </select>
        <span v-if="rideSearch.trim() && filteredRides.length === 0" class="mt-1 block text-[10px] text-amber-200/90">
          Keine Treffer — Filter lockern oder Liste lädt noch.
        </span>
      </label>
      <label v-if="assetId" class="text-xs text-slate-500">
        Trend (Tage)
        <select v-model.number="historyDays" class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white">
          <option :value="7">7</option>
          <option :value="14">14</option>
          <option :value="30">30</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="loading"
        @click="loadBoard"
      >
        Aktualisieren
      </button>
    </div>

    <p v-if="!parkContext.activeParkId" class="text-sm text-amber-200/90">Bitte einen Park im Header wählen.</p>

    <template v-else>
      <SqdcHierarchicalBoardPreview
        v-if="hierarchicalPreview"
        :mode="assetId ? 'asset' : 'park'"
        :board="hierarchicalPreview"
        :selected-date="businessDate"
      />

      <div v-if="board" class="grid gap-4 lg:grid-cols-4">
      <!-- Safety -->
      <section class="flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-emerald-300/90">S — Safety</h2>
        <p class="mt-1 text-[11px] text-slate-500">Stimmung heute · Beinahe-Unfall / Unfall · Lead Service Techniker (im Snapshot)</p>
        <div class="mt-4 space-y-2">
          <p class="text-xs text-slate-400">Wie fühlen Sie sich heute?</p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="[emo, mood] in MOOD_CHOICES"
              :key="mood"
              type="button"
              class="rounded border border-slate-600 px-2 py-1 text-lg hover:bg-slate-800"
              :title="mood"
              @click="submitMood(mood)"
            >
              {{ emo }}
            </button>
          </div>
          <p v-if="board.safety.moodSummary.total" class="text-xs text-slate-400">
            Ø-Score {{ board.safety.moodSummary.averageScore ?? '—' }} ({{ board.safety.moodSummary.total }} Rückmeldung(en))
          </p>
        </div>
        <div class="mt-4 max-h-40 overflow-y-auto border-t border-slate-800 pt-3 text-xs">
          <p class="font-medium text-slate-300">Sicherheits-Ereignisse</p>
          <ul class="mt-2 space-y-1 text-slate-400">
            <li v-for="ev in board.safety.events" :key="ev.id" class="border-b border-slate-800/80 pb-1">
              <span class="text-amber-200/90">{{ ev.kind }}</span> · {{ ev.title }}
              <span class="block text-[10px] text-slate-500">{{ fmt(ev.occurredAt) }}</span>
            </li>
            <li v-if="!board.safety.events.length" class="text-slate-600">Keine Einträge.</li>
          </ul>
        </div>
        <div class="mt-auto border-t border-slate-800 pt-3">
          <label class="text-[10px] text-slate-500">Neu</label>
          <select v-model="safetyKind" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
            <option value="near_miss">Beinahe-Unfall</option>
            <option value="accident">Unfall</option>
          </select>
          <input
            v-model="safetyTitle"
            type="text"
            placeholder="Kurztitel"
            class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
          />
          <textarea
            v-model="safetyDesc"
            rows="2"
            placeholder="Details (optional)"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
          />
          <button type="button" class="mt-2 w-full rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600" @click="submitSafety">
            Melden
          </button>
        </div>
        <p v-if="board.delivery.leadTechnicianName" class="mt-3 text-xs text-slate-400">
          Lead (Snapshot): <span class="font-medium text-slate-200">{{ board.delivery.leadTechnicianName }}</span>
        </p>
      </section>

      <!-- Quality -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-sky-300/90">Q — Quality</h2>
        <p class="mt-1 text-[11px] text-slate-500">Incidents mit Erstellungsdatum am gewählten Tag (park- oder asset-gefiltert).</p>
        <p class="mt-2 text-xs text-slate-500">{{ board.quality.incidentTotal }} Treffer</p>
        <ul class="mt-3 max-h-[28rem] space-y-2 overflow-y-auto text-xs">
          <li v-for="inc in board.quality.incidents" :key="inc.id" class="rounded border border-slate-800/80 bg-slate-900/30 p-2">
            <RouterLink :to="`/incidents/${inc.id}`" class="font-medium text-brand-400 hover:text-brand-300">{{ inc.title }}</RouterLink>
            <span class="ml-2 text-slate-500">{{ inc.severity }} / {{ inc.status }}</span>
            <p class="text-[10px] text-slate-500">{{ fmt(inc.createdAt) }}</p>
          </li>
          <li v-if="!board.quality.incidents.length" class="text-slate-600">Keine Incidents an diesem Tag.</li>
        </ul>
      </section>

      <!-- Delivery -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-violet-300/90">D — Delivery</h2>
        <p class="mt-1 text-[11px] text-slate-500">
          OEE 5m als KPI — Echtzeit: MQTT → Server-Puffer, Push per <strong class="font-medium text-slate-300">WebSocket (Socket.IO)</strong>
          ins Board; zusätzlich HTTP-Refresh. Snapshot weiterhin manuell persistierbar.
        </p>
        <dl class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">OEE 5m (live)</dt>
            <dd
              class="font-mono text-white"
              :class="liveMqttStale ? 'text-amber-200/95' : ''"
            >
              {{ liveOee != null ? liveOee.toFixed(3) : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">OEE 5m (Snapshot)</dt>
            <dd class="font-mono text-white">{{ board.delivery.oee5m != null ? Number(board.delivery.oee5m).toFixed(3) : '—' }}</dd>
          </div>
        </dl>
        <p v-if="liveMqttFootnote" class="mt-2 text-[10px] leading-snug text-slate-500">{{ liveMqttFootnote }}</p>
        <div v-if="assetId" class="mt-4 border-t border-slate-800 pt-3">
          <p class="text-xs font-medium text-slate-300">Snapshot speichern</p>
          <label class="mt-2 block text-[10px] text-slate-500">OEE 5m (0–1)</label>
          <input v-model="snapOee" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">Gäste / Queue (Anzahl)</label>
          <input v-model="snapGuests" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">Lead Service Techniker (Anzeige)</label>
          <input v-model="snapLead" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">Notizen</label>
          <textarea v-model="snapNotes" rows="2" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
          <button type="button" class="mt-2 w-full rounded-md bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-500" @click="saveSnapshot">
            Tageswerte persistieren
          </button>
        </div>
      </section>

      <!-- Customer -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-amber-300/90">C — Customer</h2>
        <p class="mt-1 text-[11px] text-slate-500">
          Personen / Auslastung — gleiche Echtzeit-Quelle: MQTT-DDATA <code class="text-slate-400">queue_occupancy</code> über WebSocket ins Board, sonst Snapshot.
        </p>
        <dl class="mt-6 space-y-3 text-sm">
          <div>
            <dt class="text-slate-500">Personen (live Queue)</dt>
            <dd class="font-mono text-2xl text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
              {{ liveQueue != null ? liveQueue : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">Snapshot (Gäste)</dt>
            <dd class="font-mono text-2xl text-slate-300">{{ board.customer.guestCount != null ? board.customer.guestCount : '—' }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <!-- Trend -->
    <section v-if="history?.series?.length" class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 class="text-sm font-semibold text-white">Trend (OEE 5m · {{ historyDays }} Tage)</h2>
      <p class="mt-1 text-xs text-slate-500">{{ selectedRide?.name }} — Balkenhöhe relativ zum Maximum in diesem Fenster.</p>
      <div class="mt-4 flex h-32 items-end gap-1 border-b border-slate-700 pb-1">
        <div
          v-for="row in history.series"
          :key="row.businessDate"
          class="flex min-w-[8px] flex-1 flex-col items-center justify-end gap-1"
          :title="`${row.businessDate}: OEE ${row.deliveryOee5m ?? '—'}`"
        >
          <div
            class="w-full max-w-[14px] rounded-t bg-violet-600/80"
            :style="{ height: row.deliveryOee5m != null ? `${(row.deliveryOee5m / trendMaxOee) * 100}%` : '2px' }"
          />
          <span class="hidden text-[8px] text-slate-600 sm:block">{{ row.businessDate.slice(5) }}</span>
        </div>
      </div>
      <p class="mt-2 text-[10px] text-slate-500">Stimmung Ø pro Tag als Zahl im Tooltip der API-Serie (vereinfachte Darstellung).</p>
    </section>
    </template>
  </div>
</template>
