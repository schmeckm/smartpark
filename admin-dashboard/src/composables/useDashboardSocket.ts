import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type { CanonicalInboundMessage, CrowdEvent, Recommendation, Ride, Staff, Zone } from '@/types/api'
import { getOperationsFactsRides, getRecommendations, getRides, getStaff, getZones } from '@/api/client'
import { getApiParkContextId, setApiParkContextId } from '@/utils/apiParkContext'
import { resolveApiOrigin } from '@/utils/apiOrigin'
import { mergeRidesWithOperationsFacts } from '@/utils/operationsFactsDashboardRides'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'

type ZoneSocketPayload = Zone & { deleted?: boolean }

function mergeZone(list: Zone[], incoming: ZoneSocketPayload): Zone[] {
  if (incoming.deleted) {
    return list.filter((z) => z.id !== incoming.id)
  }
  const idx = list.findIndex((z) => z.id === incoming.id)
  const next = [...list]
  if (idx >= 0) next[idx] = { ...next[idx], ...incoming }
  else next.push(incoming)
  return next.sort((a, b) => a.name.localeCompare(b.name))
}

export type CanonicalMessageAppliedPayload = {
  message?: CanonicalInboundMessage | Record<string, unknown>
  applied?: boolean
}

export type UseDashboardSocketOptions = {
  onCanonicalMessageApplied?: (payload: CanonicalMessageAppliedPayload) => void
}

export function useDashboardSocket(options?: UseDashboardSocketOptions) {
  const auth = useAuthStore()
  const parkCtx = useParkContextStore()
  const { push: toast } = useToast()
  const zones = ref<Zone[]>([])
  const rides = ref<Ride[]>([])
  const staff = ref<Staff[]>([])
  const recommendations = ref<Recommendation[]>([])
  const recentEvents = ref<CrowdEvent[]>([])

  const connected = ref(false)
  const connectionLabel = ref('Connecting…')
  const loadError = ref<string | null>(null)
  const socket = shallowRef<Socket | null>(null)

  const apiOrigin = resolveApiOrigin()

  async function loadRidesWithOperationsFactsPreferred(): Promise<Ride[]> {
    const legacy = await getRides()
    const fromHeader = getApiParkContextId()?.trim()
    const fromStore = parkCtx.activeParkId?.trim()
    const parkId = fromHeader || fromStore
    if (!parkId) return legacy
    /** `MainLayout` sets this in `hydrate()`, but dashboard may load before that completes. */
    if (!fromHeader && fromStore) setApiParkContextId(fromStore)
    try {
      const facts = await getOperationsFactsRides({ parkId })
      return mergeRidesWithOperationsFacts(legacy, facts)
    } catch {
      return legacy
    }
  }

  async function bootstrap() {
    loadError.value = null
    try {
      const [z, r, s, rec] = await Promise.all([
        getZones(),
        loadRidesWithOperationsFactsPreferred(),
        getStaff(),
        getRecommendations(),
      ])
      zones.value = z
      rides.value = r
      staff.value = s
      recommendations.value = rec
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load data'
    }
  }

  async function refreshRidesAndStaff() {
    try {
      const [r, s] = await Promise.all([loadRidesWithOperationsFactsPreferred(), getStaff()])
      rides.value = r
      staff.value = s
    } catch {
      /* ignore refresh errors */
    }
  }

  function connectSocket() {
    const token = auth.accessToken
    if (!token) {
      connectionLabel.value = 'No token'
      return
    }
    socket.value?.removeAllListeners()
    socket.value?.disconnect()
    const s = apiOrigin
      ? io(apiOrigin, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          auth: { token, parkId: parkCtx.activeParkId ?? undefined },
        })
      : io({
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          auth: { token, parkId: parkCtx.activeParkId ?? undefined },
        })

    socket.value = s

    function subscribePark() {
      const parkId = parkCtx.activeParkId?.trim()
      if (parkId && s.connected) s.emit('park:subscribe', { parkId })
    }

    s.on('connect', () => {
      connected.value = true
      connectionLabel.value = 'Live'
      subscribePark()
    })

    s.on('disconnect', () => {
      connected.value = false
      connectionLabel.value = 'Disconnected'
    })

    s.on('connect_error', () => {
      connected.value = false
      connectionLabel.value = 'Offline'
    })

    s.on('zones:updated', (payload: { zone: ZoneSocketPayload }) => {
      const z = payload.zone
      if (z?.deleted) {
        zones.value = zones.value.filter((x) => x.id !== z.id)
        void refreshRidesAndStaff()
        return
      }
      if (z?.id) {
        zones.value = mergeZone(zones.value, z)
        void refreshRidesAndStaff()
      }
    })

    s.on('events:created', (payload: { event: CrowdEvent }) => {
      if (payload?.event) {
        recentEvents.value = [payload.event, ...recentEvents.value].slice(0, 40)
      }
    })

    s.on('recommendations:created', (payload: { recommendation: Recommendation }) => {
      if (payload?.recommendation) {
        recommendations.value = [payload.recommendation, ...recommendations.value]
      }
    })

    s.on('recommendations:updated', (payload: { recommendation: Recommendation }) => {
      const rec = payload?.recommendation
      if (!rec?.id) return
      const i = recommendations.value.findIndex((x) => x.id === rec.id)
      if (i >= 0) {
        const copy = [...recommendations.value]
        copy[i] = { ...copy[i], ...rec }
        recommendations.value = copy
      }
    })

    s.on('canonical:message:applied', (payload: CanonicalMessageAppliedPayload) => {
      options?.onCanonicalMessageApplied?.(payload)
    })

    s.on('ai:recommendation-scored', (payload: { recommendation?: Recommendation; score?: Recommendation['score'] }) => {
      toast('AI scoring updated for recommendation', 'info')
      const rec = payload?.recommendation
      const sc = payload?.score
      if (rec?.id) {
        const i = recommendations.value.findIndex((x) => x.id === rec.id)
        if (i >= 0) {
          const copy = [...recommendations.value]
          copy[i] = { ...copy[i], ...rec, score: sc ?? copy[i].score }
          recommendations.value = copy
        } else {
          void getRecommendations().then((list) => {
            recommendations.value = list
          })
        }
      } else {
        void getRecommendations().then((list) => {
          recommendations.value = list
        })
      }
    })
  }

  onMounted(() => {
    void bootstrap().then(() => connectSocket())
  })

  /** T.4: `X-Park-Id` is set in `parkContext.hydrate()` (async); reload rides when park context arrives or changes. */
  watch(
    () => parkCtx.activeParkId,
    (pid, prev) => {
      if (pid === prev) return
      const s = socket.value
      if (pid?.trim() && s?.connected) s.emit('park:subscribe', { parkId: pid.trim() })
      void refreshRidesAndStaff()
    }
  )

  onUnmounted(() => {
    socket.value?.disconnect()
    socket.value = null
  })

  const openRecommendations = computed(() =>
    recommendations.value.filter((r) => r.status === 'OPEN')
  )

  const sortedRecommendations = computed(() => {
    const rank = (s: string) => (s === 'OPEN' ? 0 : s === 'ACCEPTED' ? 1 : 2)
    return [...recommendations.value].sort((a, b) => {
      const rs = rank(a.status) - rank(b.status)
      if (rs !== 0) return rs
      const pr: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
      return (pr[a.priority] ?? 9) - (pr[b.priority] ?? 9)
    })
  })

  function patchRecommendation(rec: Recommendation) {
    const i = recommendations.value.findIndex((x) => x.id === rec.id)
    if (i < 0) return
    const next = [...recommendations.value]
    next[i] = { ...next[i], ...rec }
    recommendations.value = next
  }

  return {
    zones,
    rides,
    staff,
    recommendations,
    recentEvents,
    connected,
    connectionLabel,
    loadError,
    openRecommendations,
    sortedRecommendations,
    patchRecommendation,
    bootstrap,
    refreshRidesAndStaff,
  }
}
