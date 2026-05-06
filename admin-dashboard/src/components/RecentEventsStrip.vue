<script setup lang="ts">
import type { CrowdEvent } from '../types/api'

defineProps<{
  events: CrowdEvent[]
}>()
</script>

<template>
  <section
    v-if="events.length"
    class="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 shadow-panel"
  >
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live feed</span>
      <div class="flex min-w-0 flex-1 flex-wrap gap-2">
        <span
          v-for="e in events.slice(0, 8)"
          :key="e.id"
          class="inline-flex max-w-full items-center gap-2 truncate rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-xs text-slate-300"
        >
          <span class="font-semibold text-brand-300">{{ e.eventType.replace(/_/g, ' ') }}</span>
          <span class="text-slate-500">·</span>
          <span class="truncate">{{ e.zone?.name ?? e.zoneId?.slice(0, 8) }}</span>
          <span class="text-slate-500">·</span>
          <span class="tabular-nums text-slate-400">{{ e.crowdLevel }}</span>
        </span>
      </div>
    </div>
  </section>
</template>
