import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { getUnsMqttLiveEvents, getUnsMqttLiveStatus, type UnsMqttLiveEvent, type UnsMqttLiveStatus } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { resolveApiOrigin } from '@/utils/apiOrigin'

export function slugifyUnsParkKey(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLikelyUuid(s: string | null | undefined): boolean {
  return UUID_RE.test(String(s || '').trim())
}

/**
 * Raw Sparkplug group key before `slugifyUnsParkKey` (e.g. europa_park).
 * Must match OEE MQTT Cockpit: never treat a park UUID as the group id — it slugifies to a different string than the broker group.
 */
export function resolveRawMqttSparkplugGroupKey(
  parkSlug: string | null | undefined,
  parkId: string | null | undefined
): string {
  const slug = parkSlug?.trim()
  if (slug) return slug
  const pid = parkId?.trim()
  if (pid && !isLikelyUuid(pid)) return pid
  return 'europa_park'
}

export type OeeDeviceSnapshot = {
  deviceId: string
  lastReceivedAt: string
  metrics: Record<string, unknown>
}

function normGroupId(g: string | null | undefined): string {
  return String(g || '')
    .trim()
    .toLowerCase()
}

/**
 * Latest metric value per device from DDATA rows (chronological overwrite).
 * @param resolvedGroupLower - optional lowercase Sparkplug group from {@link getUnsMqttLiveStatus} (SPARKPLUG_GROUP_ID)
 */
export function aggregateDdataByDevice(
  events: UnsMqttLiveEvent[],
  groupKey: string,
  resolvedGroupLower?: string | null
): OeeDeviceSnapshot[] {
  const want =
    resolvedGroupLower != null && String(resolvedGroupLower).trim() !== ''
      ? normGroupId(resolvedGroupLower)
      : normGroupId(slugifyUnsParkKey(groupKey))
  const filtered = events.filter((e) => {
    if (normGroupId(e.groupId) !== want) return false
    if (String(e.messageType || '').toUpperCase() !== 'DDATA') return false
    if (!e.deviceId) return false
    return true
  })
  filtered.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
  const byDevice = new Map<string, { metrics: Record<string, unknown>; lastAt: string }>()
  for (const e of filtered) {
    const d = String(e.deviceId)
    const row = byDevice.get(d) || { metrics: {}, lastAt: e.receivedAt }
    if (e.metric) row.metrics[e.metric] = e.value
    row.lastAt = e.receivedAt
    byDevice.set(d, row)
  }
  return [...byDevice.entries()]
    .map(([deviceId, { metrics, lastAt }]) => ({ deviceId, metrics, lastReceivedAt: lastAt }))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
}

export function numMetric(m: Record<string, unknown>, key: string): number | null {
  const v = m[key]
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function useOeeMqttCockpit(groupKey: () => string) {
  const auth = useAuthStore()
  const apiOrigin = resolveApiOrigin()
  const events = ref<UnsMqttLiveEvent[]>([])
  const liveStatus = ref<UnsMqttLiveStatus | null>(null)
  /** Lowercase Sparkplug group segment; set from mqtt-live status (aligns with API SPARKPLUG_GROUP_ID). */
  const mqttGroupForFilter = ref<string | null>(null)
  const loadError = ref<string | null>(null)
  const socket = ref<Socket | null>(null)

  const devices = computed(() => aggregateDdataByDevice(events.value, groupKey(), mqttGroupForFilter.value))

  function syncMqttGroupFromStatus(st: UnsMqttLiveStatus | null) {
    const mg = st?.mqttGroupId
    mqttGroupForFilter.value =
      mg != null && String(mg).trim() !== '' ? String(mg).toLowerCase().trim() : null
  }

  async function loadEvents() {
    const key = groupKey().trim()
    if (!key) {
      events.value = []
      return
    }
    loadError.value = null
    try {
      await loadStatus()
      const list = await getUnsMqttLiveEvents(slugifyUnsParkKey(key), { limit: 2000 })
      events.value = list
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load MQTT live events'
      events.value = []
    }
  }

  async function loadStatus() {
    try {
      liveStatus.value = await getUnsMqttLiveStatus(slugifyUnsParkKey(groupKey() || 'europa_park'))
      syncMqttGroupFromStatus(liveStatus.value)
    } catch {
      liveStatus.value = null
      mqttGroupForFilter.value = null
    }
  }

  function pushIncoming(rows: UnsMqttLiveEvent[]) {
    const g = mqttGroupForFilter.value?.trim()
    const want = g ? normGroupId(g) : normGroupId(slugifyUnsParkKey(groupKey()))
    const incoming = rows.filter((e) => normGroupId(e.groupId) === want)
    if (!incoming.length) return
    events.value = [...incoming, ...events.value].slice(0, 2000)
  }

  function connectSocket() {
    const token = auth.accessToken
    if (!token) return
    socket.value?.disconnect()
    const s = apiOrigin
      ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
      : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    socket.value = s
    s.on('uns:mqtt:live:events', (payload: unknown) => {
      const evs = (payload as { events?: UnsMqttLiveEvent[] })?.events
      if (Array.isArray(evs) && evs.length) pushIncoming(evs)
    })
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    void loadEvents()
    connectSocket()
    pollTimer = setInterval(() => {
      void loadEvents()
    }, 5000)
  })

  watch(
    () => groupKey(),
    () => {
      mqttGroupForFilter.value = null
      void loadEvents()
    }
  )

  watch(
    () => auth.accessToken,
    (t) => {
      if (t) connectSocket()
    }
  )

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer)
    socket.value?.disconnect()
    socket.value = null
  })

  return { events, liveStatus, loadError, devices, reload: loadEvents }
}
