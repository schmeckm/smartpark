<script setup lang="ts">
import { computed } from 'vue'
import { RIDES_ADAPTER_ZONE_ID, type Ride, type Zone } from '../types/api'

const props = defineProps<{
  rides: Ride[]
  zones: Zone[]
  /** True when rows come from external adapter / canonical wait-time feed (not legacy `/rides`). */
  adapterLive?: boolean
}>()

const zoneName = computed(() => {
  const map = new Map(props.zones.map((z) => [z.id, z.name]))
  return (zoneId: string) => {
    if (zoneId === RIDES_ADAPTER_ZONE_ID) return 'External park'
    return map.get(zoneId) ?? zoneId.slice(0, 8) + '…'
  }
})

function statusClass(status: string) {
  if (status === 'OPEN') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
  if (status === 'MAINTENANCE') return 'bg-amber-500/15 text-amber-200 ring-amber-500/30'
  return 'bg-slate-600/40 text-slate-300 ring-slate-500/30'
}

const sorted = computed(() =>
  [...props.rides].sort((a, b) => (b.waitTime ?? 0) - (a.waitTime ?? 0))
)
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-panel">
    <div class="mb-4">
      <h2 class="font-display text-lg font-semibold text-white">Rides</h2>
      <p class="mt-1 text-sm text-slate-400">
        Throughput, wait times, and status by attraction
        <span v-if="adapterLive" class="ml-2 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
          Live · adapter
        </span>
      </p>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80">
          <tr>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Ride</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Zone</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Status</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400">Wait</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400">Cap/hr</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400">Criticality</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr
            v-for="r in sorted"
            :key="r.id"
            class="bg-slate-900/30 transition hover:bg-slate-800/40"
          >
            <td class="px-4 py-3 font-medium text-white">{{ r.name }}</td>
            <td class="px-4 py-3 text-slate-300">{{ zoneName(r.zoneId) }}</td>
            <td class="px-4 py-3">
              <span
                class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset"
                :class="statusClass(r.status)"
              >
                {{ r.status }}
              </span>
            </td>
            <td class="px-4 py-3 text-right tabular-nums">
              <span :class="r.waitTime > 45 ? 'font-semibold text-amber-300' : 'text-slate-200'">
                {{ r.status === 'OPEN' ? `${r.waitTime} min` : '—' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right tabular-nums text-slate-300">
              <template v-if="adapterLive && !(r.capacityPerHour > 0)">—</template>
              <template v-else>{{ r.capacityPerHour?.toLocaleString?.() ?? r.capacityPerHour }}</template>
            </td>
            <td class="px-4 py-3 text-right">
              <span
                class="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md bg-slate-800 px-2 text-xs font-semibold text-slate-200"
              >
                {{ adapterLive && r.criticality === 0 ? '—' : r.criticality }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
