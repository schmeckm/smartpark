<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { io, type Socket } from 'socket.io-client'
import {
  getOperationsFactsRide,
  getSqdcAssetBoardHierarchical,
  getSqdcBoard,
  getSqdcHistory,
  getSqdcParkBoardHierarchical,
  getUnsMqttLiveEvents,
  getUnsMqttLiveStatus,
  listMasterData,
  postSqdcMood,
  postSqdcSafetyEvent,
  postSqdcSnapshot,
  type MasterDataGridRow,
  type OperationFactRide,
  type SqdcAssetBoardResponse,
  type SqdcBoardResponse,
  type SqdcHistoryResponse,
  type SqdcMood,
  type SqdcParkBoardResponse,
  type UnsMqttLiveEvent,
} from '@/api/client'
import SqdcHierarchicalBoardPreview from '@/components/SqdcHierarchicalBoardPreview.vue'
import { numMetric, resolveRawMqttSparkplugGroupKey, slugifyUnsParkKey } from '@/composables/useOeeMqttCockpit'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { resolveApiOrigin } from '@/utils/apiOrigin'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const parkContext = useParkContextStore()
const auth = useAuthStore()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()

const apiOrigin = resolveApiOrigin()

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

/**
 * Sparkplug `deviceId` entspricht dem Ride-Slug (Simulator/Edge). In den Asset-Daten kann `slug` fehlen — dann wie UNS slugify aus dem Namen.
 */
function effectiveRideDeviceId(r: MasterDataGridRow | null): string {
  if (!r) return ''
  const raw = r.slug?.trim()
  if (raw) return raw
  return slugifyUnsParkKey(r.name || '')
}

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
 * Sparkplug `groupId` (e.g. europa_park). Same resolution as OEE MQTT Cockpit — do not use park UUID as group key.
 */
const mqttLiveGroupId = computed(() => {
  const raw = resolveRawMqttSparkplugGroupKey(parkContext.activePark?.slug, parkContext.activeParkId)
  const g = slugifyUnsParkKey(raw)
  return g || slugifyUnsParkKey('europa_park')
})

/**
 * Lowercase Sparkplug group from {@link getUnsMqttLiveStatus} (aligns with `SPARKPLUG_GROUP_ID` + simulator).
 * Socket pushes must filter on this, not only on park slug.
 */
const effectiveSparkplugGroupLower = ref<string | null>(null)

const mqttLiveGroupResolved = computed(() => {
  const g = effectiveSparkplugGroupLower.value || mqttLiveGroupId.value || ''
  return g ? g.toLowerCase() : ''
})

/** Device id aliases for Sparkplug DDATA (slug, raw asset UUID, slugified UUID — matches server-side Operations Facts fallbacks). */
function sparkplugDeviceMatchSet(): Set<string> {
  const s = new Set<string>()
  const slug = effectiveRideDeviceId(selectedRide.value)
  const aid = assetId.value.trim()
  const add = (v: string) => {
    const t = v.trim()
    if (!t) return
    s.add(t)
    s.add(t.toLowerCase())
  }
  if (slug) add(slug)
  if (aid) {
    add(aid)
    const seg = slugifyUnsParkKey(aid)
    if (seg) add(seg)
  }
  return s
}

const opsFactsRide = ref<OperationFactRide | null>(null)

function coerceFactNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const liveOee = ref<number | null>(null)
const liveQueue = ref<number | null>(null)
/** Sparkplug DDATA: simulator publishes `energy_kw`; edges may send kWh/day or €/day for cost pillar C. */
const liveEnergyKw = ref<number | null>(null)
const liveElectricityKwhDay = ref<number | null>(null)
const liveElectricityCostEurDay = ref<number | null>(null)
const liveMaintenanceCostEurDay = ref<number | null>(null)
const liveMqttLastAt = ref<string | null>(null)
const liveMqttStale = ref(false)

function numMetricFirst(m: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = numMetric(m, k)
    if (v != null) return v
  }
  return null
}

/** Sparkplug/Simulator often uses 0–100 for OEE; SQDC throughput + labels expect 0–1. */
function normalizeSparkplugOeeTo01(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v > 1.0001) return Math.min(1, Math.max(0, v / 100))
  return Math.min(1, Math.max(0, v))
}

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
  const want = mqttLiveGroupResolved.value
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

/** Derive OEE / queue / energy for the selected ride from `mqttLiveBuffer` (newest DDATA wins per metric). */
function applyLiveFromBuffer() {
  liveOee.value = null
  liveQueue.value = null
  liveEnergyKw.value = null
  liveElectricityKwhDay.value = null
  liveElectricityCostEurDay.value = null
  liveMaintenanceCostEurDay.value = null
  liveMqttLastAt.value = null
  liveMqttStale.value = false
  const group = mqttLiveGroupResolved.value
  const aliases = sparkplugDeviceMatchSet()
  if (!group || !aliases.size) return

  const relevant = mqttLiveBuffer.value
    .filter((e) => {
      if (String(e.groupId || '').toLowerCase() !== group) return false
      if (String(e.messageType || '').toUpperCase() !== 'DDATA') return false
      const dev = String(e.deviceId || '')
      const devLo = dev.toLowerCase()
      for (const a of aliases) {
        if (a === dev || a.toLowerCase() === devLo) return true
      }
      return false
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
  const m = Object.fromEntries(byMetric)
  liveOee.value = normalizeSparkplugOeeTo01(
    numMetricFirst(m, ['oee_current', 'current_oee', 'oee', 'oee_5m'])
  )
  liveQueue.value = numMetricFirst(m, ['queue_occupancy', 'queue_time'])
  liveEnergyKw.value = numMetric(m, 'energy_kw')
  liveElectricityKwhDay.value = numMetricFirst(m, [
    'electricity_kwh_day',
    'electricityKwhPerDay',
    'energy_kwh_day',
    'kwh_per_day',
  ])
  liveElectricityCostEurDay.value = numMetricFirst(m, [
    'electricity_cost_eur_day',
    'electricityCostEurPerDay',
    'energy_cost_eur_day',
    'stromkosten_eur_tag',
  ])
  liveMaintenanceCostEurDay.value = numMetricFirst(m, [
    'maintenance_cost_eur_day',
    'maintenanceCostEurPerDay',
    'wartung_kosten_eur_tag',
  ])
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

async function refreshEffectiveSparkplugGroup() {
  const base = mqttLiveGroupId.value
  if (!parkContext.activeParkId || !base) {
    effectiveSparkplugGroupLower.value = null
    return
  }
  try {
    setApiParkContextId(parkContext.activeParkId)
    const st = await getUnsMqttLiveStatus(base)
    const g =
      st.mqttGroupId != null && String(st.mqttGroupId).trim() !== ''
        ? String(st.mqttGroupId).toLowerCase()
        : null
    effectiveSparkplugGroupLower.value = g || base.toLowerCase()
  } catch {
    effectiveSparkplugGroupLower.value = base.toLowerCase()
  }
}

async function refreshLiveMqtt() {
  const deviceId = effectiveRideDeviceId(selectedRide.value)
  const group = mqttLiveGroupId.value
  if (!parkContext.activeParkId || !deviceId || !group) {
    mqttLiveBuffer.value = []
    applyLiveFromBuffer()
    return
  }
  await refreshEffectiveSparkplugGroup()
  try {
    const events = await getUnsMqttLiveEvents(group, { limit: 2000 })
    mqttLiveBuffer.value = [...events].slice(0, 2000)
    applyLiveFromBuffer()
  } catch {
    // Do not wipe the buffer: Socket.IO may have filled it while HTTP poll failed (e.g. permissions/network).
    applyLiveFromBuffer()
  }
}

const liveMqttFootnote = computed(() => {
  if (!assetId.value) return t('sqdc.classicDeliveryMqttNeedsAsset')
  if (
    liveOee.value == null &&
    liveQueue.value == null &&
    liveEnergyKw.value == null &&
    liveElectricityKwhDay.value == null &&
    liveElectricityCostEurDay.value == null &&
    liveMaintenanceCostEurDay.value == null &&
    !liveMqttLastAt.value
  ) {
    const g = mqttLiveGroupId.value || '—'
    const d = effectiveRideDeviceId(selectedRide.value) || '—'
    return t('sqdc.classicDeliveryMqttBufferEmpty', { groupId: g, deviceId: d })
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
  opsFactsRide.value = null
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

    if (assetId.value) {
      try {
        opsFactsRide.value = await getOperationsFactsRide(assetId.value)
      } catch {
        opsFactsRide.value = null
      }
    }
  } catch (e) {
    push(e instanceof Error ? e.message : t('sqdc.classicBoardLoadError'), 'error')
    board.value = null
    hierarchicalPreview.value = null
    opsFactsRide.value = null
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

/** S/Q/D scores from hierarchical board — same source as month rings above (0–100). */
const ringPillarScores = computed(() => {
  const s = hierarchicalPreview.value?.scores
  if (!s) return { safety: null as number | null, quality: null as number | null, delivery: null as number | null }
  return {
    safety: s.safety != null && Number.isFinite(Number(s.safety)) ? Number(s.safety) : null,
    quality: s.quality != null && Number.isFinite(Number(s.quality)) ? Number(s.quality) : null,
    delivery: s.delivery != null && Number.isFinite(Number(s.delivery)) ? Number(s.delivery) : null,
  }
})

const hierarchicalElectricityEur = computed(() => {
  const h = hierarchicalPreview.value
  if (!h) return null
  if (h.level === 'PARK') {
    const e = h.electricityCostEurPerDay
    return e != null && Number.isFinite(Number(e)) ? Number(e) : null
  }
  const e = h.delivery?.electricityCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

const hierarchicalMaintenanceEur = computed(() => {
  const h = hierarchicalPreview.value
  if (!h) return null
  if (h.level === 'PARK') {
    const e = h.maintenanceCostEurPerDay
    return e != null && Number.isFinite(Number(e)) ? Number(e) : null
  }
  const e = h.delivery?.maintenanceCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

const hierarchicalCostEurForRing = computed(() => {
  const h = hierarchicalPreview.value
  if (!h) return null
  if (h.level === 'PARK') {
    const t = h.totalCostEurPerDay
    if (t != null && Number.isFinite(Number(t))) return Number(t)
  } else {
    const t = h.delivery?.totalCostEurPerDay
    if (t != null && Number.isFinite(Number(t))) return Number(t)
  }
  const elec = hierarchicalElectricityEur.value
  const maint = hierarchicalMaintenanceEur.value
  let sum = 0
  let any = false
  if (elec != null && elec > 0) {
    sum += elec
    any = true
  }
  if (maint != null && maint > 0) {
    sum += maint
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
})

const hierarchicalElectricityKwh = computed(() => {
  const h = hierarchicalPreview.value
  if (!h || h.level !== 'ASSET') return null
  const k = h.delivery?.electricityKwhPerDay
  return k != null && Number.isFinite(Number(k)) ? Number(k) : null
})

/** Ø mood 1–5 for selected UTC day — matches P-ring input (hierarchical rows first, else classic summary). */
const previewMoodAvgForDay = computed(() => {
  const d = businessDate.value
  const h = hierarchicalPreview.value
  if (h?.moodFeedback?.length) {
    const scores = h.moodFeedback
      .map((m) => m as { feedbackDate?: string; moodScore?: number })
      .filter((m) => String(m.feedbackDate ?? '') === d && m.moodScore != null)
      .map((m) => Number(m.moodScore))
      .filter((n) => Number.isFinite(n))
    if (scores.length) return scores.reduce((a, b) => a + b, 0) / scores.length
  }
  const avg = board.value?.safety.moodSummary.averageScore
  return avg != null && Number.isFinite(Number(avg)) ? Number(avg) : null
})

const peopleRingPct = computed(() => {
  const a = previewMoodAvgForDay.value
  if (a == null) return null
  return Math.round((a / 5) * 100)
})

/** Hierarchical asset board guest count (roll-up / daily JSON), when available. */
const hierarchicalGuestCount = computed(() => {
  const h = hierarchicalPreview.value
  if (!h || h.level !== 'ASSET') return null
  const g = h.customer?.guestCount
  return g != null && Number.isFinite(Number(g)) ? Number(g) : null
})

/** Park Ø OEE or asset merged OEE (0–1) from hierarchical API — fills D-details when MQTT/snapshot are empty. */
const hierarchicalRollupOee01 = computed(() => {
  const h = hierarchicalPreview.value
  if (!h) return null
  if (h.level === 'PARK') {
    const o = h.rollup?.averageOee
    return o != null && Number.isFinite(Number(o)) ? Number(o) : null
  }
  const o = h.delivery?.oee01
  return o != null && Number.isFinite(Number(o)) ? Number(o) : null
})

/** Ride master: theoretical capacity (Pers./h), from hierarchical ASSET board. */
const deliveryMdTheoreticalPph = computed(() => {
  const h = hierarchicalPreview.value
  if (!h || h.level !== 'ASSET') return null
  const v = Number(h.delivery?.theoreticalCapacityPph)
  return Number.isFinite(v) && v > 0 ? v : null
})

/** Ride master: planned / target capacity (Pers./h), when stored separately from theoretical. */
const deliveryMdPlannedPph = computed(() => {
  const h = hierarchicalPreview.value
  if (!h || h.level !== 'ASSET') return null
  const v = Number(h.delivery?.plannedCapacityPph)
  return Number.isFinite(v) && v > 0 ? v : null
})

const opsFactsQueueMinutes = computed(() => coerceFactNumber(opsFactsRide.value?.queueTime))

const opsFactsThroughputActual = computed(() => coerceFactNumber(opsFactsRide.value?.throughputActual))

/** Queue wait (minutes): hierarchical snapshot → MD grid → Operations Facts (same Sparkplug resolution as API). */
const deliveryWaitMinutesBoard = computed(() => {
  const h = hierarchicalPreview.value
  if (h && h.level === 'ASSET') {
    const q = h.customer?.queueMinutes
    if (q != null && Number.isFinite(Number(q))) return Number(q)
  }
  const w = selectedRide.value?.waitTimeMin
  if (w != null && Number.isFinite(Number(w))) return Number(w)
  return opsFactsQueueMinutes.value
})

/** OEE 0–1 for throughput estimate: live MQTT → classic snapshot → hierarchical roll-up. */
const deliveryOeeForThroughput = computed(() => {
  if (liveOee.value != null && Number.isFinite(liveOee.value)) {
    return Math.min(1, Math.max(0, liveOee.value))
  }
  const snap = board.value?.delivery?.oee5m
  if (snap != null && Number.isFinite(Number(snap))) {
    return Math.min(1, Math.max(0, Number(snap)))
  }
  const r = hierarchicalRollupOee01.value
  if (r != null && Number.isFinite(r)) return Math.min(1, Math.max(0, r))
  return null
})

/** Capacity base for throughput: theoretical Soll, else planned (MD). */
const deliveryThroughputSollPph = computed(() => {
  return deliveryMdTheoreticalPph.value ?? deliveryMdPlannedPph.value ?? null
})

/** Estimated actual throughput (Pers./h) ≈ Soll × OEE. */
const deliveryThroughputEstPph = computed(() => {
  const cap = deliveryThroughputSollPph.value
  const oee = deliveryOeeForThroughput.value
  if (cap == null || oee == null) return null
  return Math.round(cap * oee)
})

const displayGuestCount = computed(() => {
  const c = board.value?.customer?.guestCount
  if (c != null && Number.isFinite(Number(c))) return Number(c)
  return hierarchicalGuestCount.value
})

function isEuropaParkDemoContext(): boolean {
  const p = parkContext.activePark
  if (!p) return false
  const s = slugifyUnsParkKey(p.slug || '')
  if (s === 'europa_park' || s === 'europapark') return true
  const slugLo = (p.slug || '').toLowerCase()
  const nameLo = (p.name || '').toLowerCase()
  return slugLo.includes('europa') || nameLo.includes('europa park')
}

/** Europa-Park demo ride: Arthur (`deviceId` / Slug `arthur`), same as OEE MQTT Cockpit docs. */
const europaArthurExampleRide = computed(() => {
  if (!isEuropaParkDemoContext()) return null
  for (const r of rides.value) {
    const slug = (r.slug || '').trim().toLowerCase()
    if (slug === 'arthur') return r
    const n = (r.name || '').trim().toLowerCase()
    if (n === 'arthur' || n.startsWith('arthur ')) return r
  }
  return null
})

function selectEuropaArthurExample() {
  const r = europaArthurExampleRide.value
  if (!r) return
  rideSearch.value = ''
  assetId.value = r.id
}

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
    effectiveSparkplugGroupLower.value = null
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
        <RouterLink class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800" to="/realtime/live?mode=oee">
          ← OEE MQTT Cockpit
        </RouterLink>
      </div>
    </header>

    <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <label class="text-xs text-slate-500">
        {{ t('sqdc.dateUtc') }}
        <input
          v-model="businessDate"
          type="date"
          class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label class="min-w-[10rem] flex-1 text-xs text-slate-500 sm:max-w-[14rem]">
        {{ t('sqdc.searchRides') }}
        <input
          v-model="rideSearch"
          type="search"
          autocomplete="off"
          :placeholder="t('sqdc.searchRides')"
          class="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label class="min-w-[min(100%,18rem)] flex-[2] text-xs text-slate-500">
        <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span>{{ t('sqdc.classicBoardAttractionFilterLabel') }}</span>
          <span v-if="parkContext.activeParkId" class="font-normal text-slate-600">
            {{ t('sqdc.classicBoardRidesLoaded', { n: rides.length }) }}
          </span>
        </span>
        <select
          v-model="assetId"
          class="mt-1 block w-full max-w-xl rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="">— {{ t('sqdc.classicBoardParkWideOption') }} —</option>
          <option v-for="r in filteredRides" :key="r.id" :value="r.id">{{ r.name }} ({{ r.slug || r.id.slice(0, 8) }})</option>
        </select>
        <span v-if="rideSearch.trim() && filteredRides.length === 0" class="mt-1 block text-[10px] text-amber-200/90">
          {{ t('sqdc.classicBoardRideSearchNoHits') }}
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
        v-if="europaArthurExampleRide"
        type="button"
        class="rounded-md border border-violet-500/35 bg-violet-950/35 px-3 py-2 text-sm font-medium text-violet-100 hover:bg-violet-900/45"
        :title="t('sqdc.exampleArthurRideTitle')"
        @click="selectEuropaArthurExample"
      >
        {{ t('sqdc.exampleArthurRide') }}
      </button>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="loading"
        @click="loadBoard"
      >
        {{ t('sqdc.refresh') }}
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

      <div v-if="board" class="grid gap-4 xl:grid-cols-5">
      <!-- Safety -->
      <section class="flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-emerald-300/90">
          S — {{ t('sqdc.monthRingSafety') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.classicSafetyIntro') }}</p>
        <dl v-if="ringPillarScores.safety != null" class="mt-3 rounded border border-emerald-500/15 bg-emerald-950/20 px-2 py-2 text-xs">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicRingKpiLabel') }}</dt>
            <dd class="font-mono font-medium text-emerald-200/95">{{ Math.round(ringPillarScores.safety) }}%</dd>
          </div>
        </dl>
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
        <h2 class="text-sm font-semibold uppercase tracking-wide text-sky-300/90">
          Q — {{ t('sqdc.monthRingQuality') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.classicQualityIntro') }}</p>
        <dl v-if="ringPillarScores.quality != null" class="mt-3 rounded border border-sky-500/15 bg-sky-950/20 px-2 py-2 text-xs">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicRingKpiLabel') }}</dt>
            <dd class="font-mono font-medium text-sky-200/95">{{ Math.round(ringPillarScores.quality) }}%</dd>
          </div>
        </dl>
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
        <h2 class="text-sm font-semibold uppercase tracking-wide text-violet-300/90">
          D — {{ t('sqdc.monthRingDelivery') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.classicDeliveryIntro') }}</p>
        <p
          v-if="assetId && selectedRide"
          class="mt-1 text-[10px] leading-snug text-slate-500"
        >
          {{
            t('sqdc.classicDeliveryFilterActive', {
              name: selectedRide.name || selectedRide.slug || assetId,
              deviceId: effectiveRideDeviceId(selectedRide),
            })
          }}
        </p>
        <dl v-if="ringPillarScores.delivery != null" class="mt-3 rounded border border-violet-500/15 bg-violet-950/20 px-2 py-2 text-xs">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicRingKpiLabel') }}</dt>
            <dd class="font-mono font-medium text-violet-200/95">{{ Math.round(ringPillarScores.delivery) }}%</dd>
          </div>
        </dl>
        <p class="mt-2 text-[11px] text-slate-500">{{ t('sqdc.classicDeliveryOeeCaption') }}</p>
        <dl class="mt-3 space-y-2 text-sm">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryOeeLive') }}</dt>
            <dd
              class="font-mono text-white"
              :class="liveMqttStale ? 'text-amber-200/95' : ''"
            >
              {{ liveOee != null ? liveOee.toFixed(3) : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryOeeSnapshot') }}</dt>
            <dd class="font-mono text-white">{{ board.delivery.oee5m != null ? Number(board.delivery.oee5m).toFixed(3) : '—' }}</dd>
          </div>
          <div v-if="hierarchicalRollupOee01 != null" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.avgOeeMerged') }}</dt>
            <dd class="font-mono text-violet-200/90">{{ hierarchicalRollupOee01.toFixed(3) }}</dd>
          </div>
          <div
            v-if="deliveryMdTheoreticalPph != null || deliveryMdPlannedPph != null"
            class="flex justify-between gap-2 border-t border-slate-800/80 pt-2"
          >
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryMdCapacitySection') }}</dt>
            <dd class="text-right font-mono text-slate-200">
              <span v-if="deliveryMdTheoreticalPph != null" class="block text-white">
                {{ t('sqdc.classicDeliveryMdTheoreticalPph', { pph: deliveryMdTheoreticalPph }) }}
              </span>
              <span
                v-if="deliveryMdPlannedPph != null && deliveryMdPlannedPph !== deliveryMdTheoreticalPph"
                class="mt-0.5 block text-slate-300"
              >
                {{ t('sqdc.classicDeliveryMdPlannedPph', { pph: deliveryMdPlannedPph }) }}
              </span>
            </dd>
          </div>
          <div v-if="deliveryThroughputEstPph != null" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryThroughputEst') }}</dt>
            <dd class="text-right">
              <span class="font-mono text-violet-200/95">{{ deliveryThroughputEstPph }}</span>
              <span class="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500">
                {{ t('sqdc.classicDeliveryThroughputHint') }}
              </span>
            </dd>
          </div>
          <div v-else-if="opsFactsThroughputActual != null" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryThroughputOpsFacts') }}</dt>
            <dd class="text-right">
              <span class="font-mono text-slate-200">{{ Math.round(opsFactsThroughputActual) }}</span>
              <span class="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500">
                {{ t('sqdc.classicDeliveryThroughputOpsFactsHint') }}
              </span>
            </dd>
          </div>
          <div v-if="deliveryWaitMinutesBoard != null" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicDeliveryWaitMinutes') }}</dt>
            <dd class="text-right">
              <span class="font-mono text-white">{{ deliveryWaitMinutesBoard }}</span>
              <span class="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500">
                {{ t('sqdc.classicDeliveryWaitMinutesHint') }}
              </span>
            </dd>
          </div>
          <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
            <dt class="text-slate-500">{{ t('sqdc.liveQueueOccupancy') }}</dt>
            <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
              {{ liveQueue != null ? liveQueue : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.snapshotGuestCount') }}</dt>
            <dd class="font-mono text-white">{{ displayGuestCount != null ? displayGuestCount : '—' }}</dd>
          </div>
        </dl>
        <p v-if="liveMqttFootnote" class="mt-2 text-[10px] leading-snug text-slate-500">{{ liveMqttFootnote }}</p>
        <div v-if="assetId" class="mt-4 border-t border-slate-800 pt-3">
          <p class="text-xs font-medium text-slate-300">Snapshot speichern</p>
          <label class="mt-2 block text-[10px] text-slate-500">{{ t('sqdc.classicSnapshotOeeField') }}</label>
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

      <!-- Cost (C-Ring = electricity / delivery_json + MQTT DDATA) -->
      <section class="rounded-xl border border-amber-500/25 bg-slate-950/40 p-4 shadow-[inset_0_1px_0_0_rgba(251,191,36,0.06)]">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-amber-200/95">
          C — {{ t('sqdc.monthRingCost') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.classicCostIntro') }}</p>
        <p class="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('sqdc.classicCostSnapshotBlock') }}</p>
        <dl class="mt-2 space-y-3 text-sm">
          <div v-if="hierarchicalElectricityKwh != null" class="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
            <dt class="text-slate-500">{{ t('sqdc.electricityKwhDay') }}</dt>
            <dd class="font-mono text-white">{{ hierarchicalElectricityKwh }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.electricityCostEurDay') }}</dt>
            <dd class="font-mono text-white">{{ hierarchicalElectricityEur != null ? `${hierarchicalElectricityEur} €` : '—' }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }}</dt>
            <dd class="font-mono text-white">{{ hierarchicalMaintenanceEur != null ? `${hierarchicalMaintenanceEur} €` : '—' }}</dd>
          </div>
          <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
            <dt class="text-slate-500">{{ t('sqdc.operatingCostTotalCringEurDay') }}</dt>
            <dd class="font-mono text-white">{{ hierarchicalCostEurForRing != null ? `${hierarchicalCostEurForRing} €` : '—' }}</dd>
          </div>
        </dl>
        <template v-if="assetId">
          <p class="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('sqdc.classicCostMqttBlock') }}</p>
          <dl class="mt-2 space-y-2 text-sm">
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.liveMqttEnergyKw') }}</dt>
              <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
                {{ liveEnergyKw != null ? liveEnergyKw.toFixed(1) : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.liveMqttElectricityKwhDay') }}</dt>
              <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
                {{ liveElectricityKwhDay != null ? liveElectricityKwhDay.toFixed(2) : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.liveMqttElectricityCostEurDay') }}</dt>
              <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
                {{ liveElectricityCostEurDay != null ? `${liveElectricityCostEurDay.toFixed(2)} €` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.liveMqttMaintenanceCostEurDay') }}</dt>
              <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
                {{ liveMaintenanceCostEurDay != null ? `${liveMaintenanceCostEurDay.toFixed(2)} €` : '—' }}
              </dd>
            </div>
          </dl>
        </template>
        <p v-if="!assetId" class="mt-3 text-[10px] leading-snug text-slate-500">{{ t('sqdc.classicCostMqttNeedsAsset') }}</p>
        <p
          v-else-if="
            liveEnergyKw == null &&
            liveElectricityKwhDay == null &&
            liveElectricityCostEurDay == null &&
            liveMaintenanceCostEurDay == null &&
            !liveMqttLastAt
          "
          class="mt-3 text-[10px] leading-snug text-slate-500"
        >
          {{ t('sqdc.classicCostMqttNoData') }}
        </p>
        <p
          v-else-if="
            liveEnergyKw == null &&
            liveElectricityKwhDay == null &&
            liveElectricityCostEurDay == null &&
            liveMaintenanceCostEurDay == null &&
            liveMqttLastAt
          "
          class="mt-3 text-[10px] leading-snug text-slate-500"
        >
          {{ t('sqdc.classicCostMqttNoEnergyMetrics') }}
        </p>
        <p v-else-if="liveMqttStale && liveMqttLastAt" class="mt-2 text-[10px] leading-snug text-amber-200/85">
          {{ t('sqdc.classicCostMqttStale') }}
        </p>
      </section>

      <!-- People: Gäste am Fahrgeschäft + Wohlfühlen (Stimmung) — P-Ring folgt primär der Stimmung -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-teal-300/90">
          P — {{ t('sqdc.monthRingPeople') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.classicPeopleIntro') }}</p>

        <p class="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('sqdc.peopleHeadcountSection') }}</p>
        <p class="mt-1 text-[10px] text-slate-600">{{ t('sqdc.peopleHeadcountHint') }}</p>
        <dl class="mt-2 space-y-2 text-sm">
          <div v-if="assetId" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.peopleHeadcountLive') }}</dt>
            <dd class="font-mono text-white" :class="liveMqttStale ? 'text-amber-200/95' : ''">
              {{ liveQueue != null ? liveQueue : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.peopleHeadcountSnapshot') }}</dt>
            <dd class="font-mono text-white">{{ board.customer.guestCount != null ? board.customer.guestCount : '—' }}</dd>
          </div>
          <div v-if="hierarchicalGuestCount != null" class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.peopleHeadcountHierarchical') }}</dt>
            <dd class="font-mono text-slate-300">{{ hierarchicalGuestCount }}</dd>
          </div>
        </dl>
        <p v-if="!assetId" class="mt-2 text-[10px] leading-snug text-slate-600">{{ t('sqdc.peopleHeadcountNeedsAsset') }}</p>

        <p class="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('sqdc.peopleWellbeingSection') }}</p>
        <dl v-if="peopleRingPct != null" class="mt-2 rounded border border-teal-500/15 bg-teal-950/20 px-2 py-2 text-xs">
          <div class="flex justify-between gap-2">
            <dt class="text-slate-500">{{ t('sqdc.classicPeopleRingLabel') }}</dt>
            <dd class="font-mono font-medium text-teal-200/95">
              {{ peopleRingPct }}% · Ø {{ previewMoodAvgForDay?.toFixed(1) }}/5
            </dd>
          </div>
        </dl>
        <div class="mt-3 space-y-2">
          <p class="text-xs text-slate-400">{{ t('sqdc.classicMoodPrompt') }}</p>
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
            Ø {{ board.safety.moodSummary.averageScore ?? '—' }} ({{ board.safety.moodSummary.total }} {{ t('sqdc.classicMoodResponses') }})
          </p>
        </div>
      </section>
    </div>

    <!-- Trend -->
    <section v-if="history?.series?.length" class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 class="text-sm font-semibold text-white">{{ t('sqdc.classicDeliveryOeeTrendTitle', { days: historyDays }) }}</h2>
      <p class="mt-1 text-xs text-slate-500">{{ selectedRide?.name }} — {{ t('sqdc.classicDeliveryOeeTrendSubtitle') }}</p>
      <div class="mt-4 flex h-32 items-end gap-1 border-b border-slate-700 pb-1">
        <div
          v-for="row in history.series"
          :key="row.businessDate"
          class="flex min-w-[8px] flex-1 flex-col items-center justify-end gap-1"
          :title="
            t('sqdc.classicDeliveryOeeTrendBarTitle', {
              date: row.businessDate,
              value:
                row.deliveryOee5m != null && Number.isFinite(Number(row.deliveryOee5m))
                  ? Number(row.deliveryOee5m).toFixed(3)
                  : '—',
            })
          "
        >
          <div
            class="w-full max-w-[14px] rounded-t bg-violet-600/80"
            :style="{ height: row.deliveryOee5m != null ? `${(row.deliveryOee5m / trendMaxOee) * 100}%` : '2px' }"
          />
          <span class="hidden text-[8px] text-slate-600 sm:block">{{ row.businessDate.slice(5) }}</span>
        </div>
      </div>
      <p class="mt-2 text-[10px] text-slate-500">{{ t('sqdc.classicDeliveryOeeTrendFootnote') }}</p>
    </section>
    </template>
  </div>
</template>
