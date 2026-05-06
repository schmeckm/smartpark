<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()

function classes(level: string) {
  if (level === 'success') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
  if (level === 'error') return 'border-red-500/40 bg-red-500/15 text-red-100'
  if (level === 'warning') return 'border-amber-500/50 bg-amber-500/15 text-amber-50'
  return 'border-slate-600 bg-slate-800/90 text-slate-100'
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg shadow-black/40 backdrop-blur"
      :class="classes(t.level)"
    >
      {{ t.message }}
    </div>
  </div>
</template>
