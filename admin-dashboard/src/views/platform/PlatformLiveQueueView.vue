<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getPlatformLiveObservations, getPlatformParks } from '@/api/client'
import type { PlatformObservation, PlatformPark } from '@/types/api'
import { useToast } from '@/composables/useToast'

const { push } = useToast()
const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const rows = ref<PlatformObservation[]>([])
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  try {
    rows.value = await getPlatformLiveObservations({ parkId: parkId.value || undefined, limit: 150 })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

onMounted(async () => {
  try {
    parks.value = await getPlatformParks()
    if (parks.value.length) parkId.value = parks.value[0].id
    await load()
    timer = setInterval(() => void load(), 15000)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function obsMetricCode(r: PlatformObservation): string {
  return String(r.metricCode || '')
}
function obsMetricValue(r: PlatformObservation): string {
  return String(r.metricValue || '')
}
function obsAssetName(r: PlatformObservation): string {
  const a = r.asset as { name?: string } | undefined
  return String(a?.name || '')
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <h1 class="font-display text-xl font-semibold text-white">Live queue dashboard</h1>
    <p class="text-xs text-slate-500">Reads asset_observations only (queue times never stored in master tables).</p>
    <div class="flex gap-2">
      <select v-model="parkId" class="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" @change="load">
        <option value="">All parks</option>
        <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button type="button" class="rounded border border-slate-600 px-3 py-1 text-xs" @click="load">Refresh</button>
    </div>
    <ul class="space-y-1 text-sm">
      <li
        v-for="r in rows"
        :key="String(r.id)"
        class="flex justify-between rounded border border-slate-800 bg-slate-900/30 px-2 py-1 font-mono text-xs text-slate-300"
      >
        <span>{{ obsMetricCode(r) }}={{ obsMetricValue(r) }}</span>
        <span class="text-slate-500">{{ obsAssetName(r) }} · {{ r.timestamp }}</span>
      </li>
    </ul>
  </div>
</template>
