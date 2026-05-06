<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: number | null
  /** hue 0-360 for conic accent */
  hue?: number
}>()

const pct = computed(() => {
  if (props.value == null || !Number.isFinite(props.value)) return 0
  return Math.max(0, Math.min(100, props.value))
})

const display = computed(() => (props.value != null && Number.isFinite(props.value) ? props.value.toFixed(1) : '—'))

const hue = computed(() => (props.hue != null && Number.isFinite(props.hue) ? props.hue : 160))

const cone = computed(() => {
  const p = pct.value
  const h = hue.value
  const track = 'rgb(30 41 59)'
  const fill = `hsl(${h} 70% 45%)`
  return {
    background: `conic-gradient(from 0.25turn, ${track} 0deg ${(1 - p / 100) * 360}deg, ${fill} ${(1 - p / 100) * 360}deg 360deg)`,
  }
})
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <p class="text-[10px] font-medium uppercase tracking-wide text-slate-500">{{ label }}</p>
    <div class="relative h-20 w-20 rounded-full p-1.5" :style="cone">
      <div
        class="flex h-full w-full flex-col items-center justify-center rounded-full bg-slate-950 text-center shadow-inner"
      >
        <span class="text-lg font-semibold tabular-nums text-white">{{ display }}</span>
        <span class="text-[9px] text-slate-500">%</span>
      </div>
    </div>
  </div>
</template>
