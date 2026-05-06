<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  getMqttStatus,
  getCurrentWeather,
  getIntegrationLogs,
  type MqttStatus,
  type IntegrationLog,
} from '@/api/client'
import { useWave2Socket } from '@/composables/useWave2Socket'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { mqttStatus: liveMqtt, lastIngestion, lastWeather, timeline } = useWave2Socket()
const { formatDateTime } = useRegionalDateTime()
const httpMqtt = ref<MqttStatus | null>(null)
const weather = ref<unknown>(null)
const feed = ref<IntegrationLog[]>([])

onMounted(async () => {
  try {
    const [m, w, logs] = await Promise.all([getMqttStatus(), getCurrentWeather(), getIntegrationLogs({ limit: 30 })])
    httpMqtt.value = m
    weather.value = w
    feed.value = logs.data
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div class="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Live connectivity (Wave 2)</h1>
      <p class="mt-1 text-sm text-slate-400">MQTT state, last weather, integration feed, and real-time event stream.</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 class="text-sm font-semibold text-white">MQTT (HTTP)</h2>
        <pre class="mt-2 overflow-x-auto text-xs text-slate-300">{{ httpMqtt }}</pre>
        <h3 class="mt-4 text-xs font-medium text-slate-500">Socket live</h3>
        <pre class="mt-1 overflow-x-auto text-xs text-brand-200/90">{{ liveMqtt }}</pre>
      </section>
      <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 class="text-sm font-semibold text-white">Current weather</h2>
        <pre class="mt-2 overflow-x-auto text-xs text-slate-300">{{ weather || lastWeather }}</pre>
      </section>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 class="text-sm font-semibold text-white">Ingestion log (last)</h2>
        <pre class="mt-2 max-h-48 overflow-auto text-xs text-slate-300">{{ lastIngestion }}</pre>
        <h3 class="mt-3 text-xs font-medium text-slate-500">Recent rows (HTTP)</h3>
        <ul class="mt-1 max-h-40 overflow-auto text-xs text-slate-400">
          <li v-for="e in feed" :key="e.id" class="border-b border-slate-800/60 py-1">
            {{ e.status }} · {{ e.eventType }} · {{ e.topic }} · {{ formatDateTime(e.createdAt) }}
          </li>
        </ul>
      </section>
      <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 class="text-sm font-semibold text-white">Live event timeline</h2>
        <ul class="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-slate-300">
          <li v-for="(l, i) in timeline" :key="i" class="font-mono">
            {{ l }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
