<script setup lang="ts">
defineProps<{
  connected: boolean
  connectionLabel: string
  loadError: string | null
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md"
  >
    <div class="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <div class="flex items-center gap-4">
        <div
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 shadow-lg shadow-brand-900/40"
        >
          <span class="font-display text-lg font-bold tracking-tight text-white">SP</span>
        </div>
        <div>
          <h1 class="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Smart Park OS
          </h1>
          <p class="text-sm text-slate-400">Operations control · real-time venue intelligence</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div
          v-if="loadError"
          class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          <span class="max-w-[280px] truncate" :title="loadError">{{ loadError }}</span>
          <button
            type="button"
            class="rounded-md bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/30"
            @click="emit('retry')"
          >
            Retry
          </button>
        </div>

        <div
          class="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm shadow-panel"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-slate-500'"
          />
          <span class="font-medium text-slate-200">{{ connectionLabel }}</span>
          <span class="text-slate-500">·</span>
          <span class="text-slate-400">WebSocket</span>
        </div>
      </div>
    </div>
  </header>
</template>
