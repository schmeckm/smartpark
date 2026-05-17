import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { getAiInsightsSummary, postAiForecastsRefresh, type AiInsightsSummary } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { resolveApiOrigin } from '@/utils/apiOrigin'
import { createRequestGeneration } from '@/utils/requestGeneration'

const apiOrigin = resolveApiOrigin()

type Opts = {
  connectSocket?: boolean
  onError?: (e: unknown) => void
}

/**
 * Zone hotspot summary for Operations dashboard tiles.
 *
 * Calls `GET /api/v1/ai/insights/summary` — **persisted zone crowd forecasts** (60m horizon, baseline model),
 * not the on-read ADR ride/park wait forecast used on the AI Insights page.
 *
 * @see docs/architecture/ai-insights-studio-forecast-consistency-assessment.md
 */
export function useAiInsights(opts: Opts = {}) {
  const { connectSocket = true, onError } = opts
  const auth = useAuthStore()
  const parkCtx = useParkContextStore()
  const summary = ref<AiInsightsSummary | null>(null)
  const loading = ref(true)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const lastSocketAt = ref<string | null>(null)
  const socket = shallowRef<Socket | null>(null)
  const loadGen = createRequestGeneration()

  async function load() {
    if (!auth.hasPermission('ai', 'read')) {
      loading.value = false
      return
    }
    const gen = loadGen.next()
    loading.value = true
    error.value = null
    try {
      const data = await getAiInsightsSummary()
      if (loadGen.isStale(gen)) return
      summary.value = data
    } catch (e) {
      if (loadGen.isStale(gen)) return
      const msg = e instanceof Error ? e.message : 'Failed to load AI forecast summary'
      error.value = msg
      onError?.(e)
    } finally {
      if (!loadGen.isStale(gen)) loading.value = false
    }
  }

  async function refresh() {
    if (!auth.hasPermission('ai', 'refresh')) return false
    busy.value = true
    try {
      await postAiForecastsRefresh()
      await load()
      return true
    } catch (e) {
      onError?.(e)
      return false
    } finally {
      busy.value = false
    }
  }

  function subscribePark(s: Socket) {
    const parkId = parkCtx.activeParkId?.trim()
    if (parkId) s.emit('park:subscribe', { parkId })
  }

  function connect() {
    if (!connectSocket || !auth.hasPermission('ai', 'read')) return
    const token = auth.accessToken
    if (!token) return
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
    s.on('connect', () => subscribePark(s))
    s.on('ai:forecast:updated', () => {
      lastSocketAt.value = new Date().toISOString()
      void load()
    })
  }

  onMounted(() => {
    void load().then(() => connect())
  })

  onUnmounted(() => {
    socket.value?.disconnect()
    socket.value = null
  })

  return { summary, loading, busy, error, lastSocketAt, load, refresh }
}
