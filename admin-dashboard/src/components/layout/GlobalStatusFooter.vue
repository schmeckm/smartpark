<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { getApiHealthSummary, getIntegrationSettings, getUnsMqttLiveStatus } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const apiOrigin = import.meta.env.VITE_API_URL || undefined

const wsConnected = ref(false)
const mqttConnected = ref<boolean | null>(null)
const mqttParkKey = ref('')
const backendVersion = ref('—')
const statusSocket = shallowRef<Socket | null>(null)
let transportTimer: ReturnType<typeof setInterval> | null = null

const frontendVersion = computed(() => {
  const v = String(import.meta.env.VITE_REPO_VERSION || '').trim()
  if (v) return v
  const c = String(import.meta.env.VITE_GIT_COMMIT || '').trim()
  return c ? c.slice(0, 8) : 'dev'
})

function slugifyParkKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function refreshTransportStatus() {
  try {
    const health = await getApiHealthSummary()
    backendVersion.value = String(health.version || '—')
  } catch {
    backendVersion.value = '—'
  }

  try {
    const settings = await getIntegrationSettings()
    const key = typeof settings.unsParkKey === 'string' ? settings.unsParkKey.trim() : ''
    const p = (settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId
    const resolved = slugifyParkKey(key || p || 'europa_park')
    mqttParkKey.value = resolved
    const status = await getUnsMqttLiveStatus(resolved)
    mqttConnected.value = Boolean(status?.mqtt?.connected)
  } catch {
    mqttConnected.value = null
  }
}

function connectStatusSocket() {
  const token = auth.accessToken
  if (!token) {
    wsConnected.value = false
    statusSocket.value?.disconnect()
    statusSocket.value = null
    return
  }
  statusSocket.value?.disconnect()
  const s = apiOrigin
    ? io(apiOrigin, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
    : io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
  statusSocket.value = s
  s.on('connect', () => {
    wsConnected.value = true
  })
  s.on('disconnect', () => {
    wsConnected.value = false
  })
  s.on('connect_error', () => {
    wsConnected.value = false
  })
}

onMounted(() => {
  void refreshTransportStatus()
  connectStatusSocket()
  transportTimer = setInterval(() => {
    void refreshTransportStatus()
  }, 10000)
})

onUnmounted(() => {
  if (transportTimer) clearInterval(transportTimer)
  statusSocket.value?.disconnect()
  statusSocket.value = null
})

watch(
  () => auth.accessToken,
  () => {
    connectStatusSocket()
    void refreshTransportStatus()
  }
)
</script>

<template>
  <footer class="border-t border-slate-800 bg-slate-950/90 px-4 py-2 text-xs sm:px-6">
    <div class="flex flex-wrap items-center gap-3 text-slate-300">
      <span class="font-medium text-slate-400">Transport</span>
      <span
        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
        :class="wsConnected ? 'bg-emerald-900/50 text-emerald-200' : 'bg-rose-900/40 text-rose-200'"
      >
        <span class="h-2 w-2 rounded-full" :class="wsConnected ? 'bg-emerald-400' : 'bg-rose-400'" />
        WebSocket {{ wsConnected ? 'Connected' : 'Disconnected' }}
      </span>
      <span
        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
        :class="
          mqttConnected === null
            ? 'bg-slate-800 text-slate-300'
            : mqttConnected
              ? 'bg-emerald-900/50 text-emerald-200'
              : 'bg-rose-900/40 text-rose-200'
        "
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="mqttConnected === null ? 'bg-slate-500' : mqttConnected ? 'bg-emerald-400' : 'bg-rose-400'"
        />
        MQTT
        {{ mqttConnected === null ? 'Unknown' : mqttConnected ? 'Connected' : 'Disconnected' }}
      </span>
      <span class="text-slate-500">Park: <span class="font-mono">{{ mqttParkKey || '—' }}</span></span>
      <span class="text-slate-500">Frontend: <span class="font-mono">{{ frontendVersion }}</span></span>
      <span class="text-slate-500">Backend: <span class="font-mono">{{ backendVersion }}</span></span>
    </div>
  </footer>
</template>
