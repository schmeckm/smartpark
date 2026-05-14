import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { getAiInsightsSummary, postAiForecastsRefresh, type AiInsightsSummary } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const apiOrigin = import.meta.env.VITE_API_URL || undefined

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
  const summary = ref<AiInsightsSummary | null>(null)
  const loading = ref(true)
  const busy = ref(false)
  const lastSocketAt = ref<string | null>(null)
  const socket = shallowRef<Socket | null>(null)

  async function load() {
    if (!auth.hasPermission('ai', 'read')) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      summary.value = await getAiInsightsSummary()
    } catch (e) {
      onError?.(e)
    } finally {
      loading.value = false
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

  function connect() {
    if (!connectSocket || !auth.hasPermission('ai', 'read')) return
    const token = auth.accessToken
    if (!token) return
    const s = apiOrigin
      ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
      : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    socket.value = s
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

  return { summary, loading, busy, lastSocketAt, load, refresh }
}
