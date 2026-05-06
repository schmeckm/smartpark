import { onMounted, onUnmounted, ref, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

export function useWave2Socket() {
  const auth = useAuthStore()
  const { push } = useToast()
  const { formatTime } = useRegionalDateTime()
  const socket = ref<Socket | null>(null)
  const mqttStatus = ref<Record<string, unknown> | null>(null)
  const lastIngestion = ref<Record<string, unknown> | null>(null)
  const lastWeather = ref<Record<string, unknown> | null>(null)
  const timeline = ref<string[]>([])

  const apiOrigin = import.meta.env.VITE_API_URL || undefined

  function addLine(s: string) {
    const t = formatTime(new Date())
    timeline.value = [`[${t}] ${s}`, ...timeline.value].slice(0, 50)
  }

  function connect() {
    if (!auth.accessToken) {
      return
    }
    const t = auth.accessToken
    const s = apiOrigin
      ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token: t } })
      : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token: t } })
    socket.value = s
    s.on('mqtt:status', (p: unknown) => {
      mqttStatus.value = p as Record<string, unknown>
    })
    s.on('integration:ingested', (p: unknown) => {
      lastIngestion.value = p as Record<string, unknown>
      const o = p as { eventType?: string; status?: string; topic?: string }
      addLine(`Ingestion ${o.status || '—'} ${o.eventType || ''} ${o.topic || ''}`.trim())
    })
    s.on('weather:updated', (p: unknown) => {
      lastWeather.value = p as Record<string, unknown>
      addLine('Weather snapshot updated')
    })
    s.on('dataquality:new', (p: unknown) => {
      const o = (p as { issue?: { issueType?: string; message?: string } })?.issue
      push(`Data quality: ${o?.issueType || 'issue'} — ${o?.message || ''}`.trim(), 'info')
    })
    s.on('simulator:tick', (p: unknown) => {
      const o = p as { scenario?: string; ok?: boolean; error?: string }
      addLine(`Sim ${o.scenario || '—'} ${o.ok ? 'ok' : o.error || 'fail'}`)
    })
    s.on('simulator:oee:queue-alert', (p: unknown) => {
      const o = p as { message?: string; assetSlug?: string; queueOccupancy?: number; queueCapacityLimit?: number }
      let msg = o.message?.trim() || ''
      if (!msg) {
        msg = `Queue over capacity${o.assetSlug ? `: ${o.assetSlug}` : ''}`
        if (o.queueOccupancy != null && o.queueCapacityLimit != null) {
          msg += ` (${o.queueOccupancy} > ${o.queueCapacityLimit})`
        }
      }
      push(msg, 'warning')
    })
  }

  watch(
    () => auth.accessToken,
    (t) => {
      if (t && !socket.value?.connected) {
        connect()
      }
    }
  )

  onMounted(() => {
    if (auth.accessToken) connect()
  })

  onUnmounted(() => {
    socket.value?.disconnect()
    socket.value = null
  })

  return { mqttStatus, lastIngestion, lastWeather, timeline, addLine, socket }
}
