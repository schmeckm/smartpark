<script setup lang="ts">
import { computed } from 'vue'
import type { SqdcRingTone } from '@/api/client'

const props = defineProps<{
  letter: string
  label: string
  /** 0–100 arc fill; `null` shows an empty track (no numeric hero). */
  percent: number | null
  /** Arc color family (same semantics as SQDC rings). */
  tone: SqdcRingTone | 'neutral'
  centerValue?: string | null
  centerUnit?: string | null
  statusLabel?: string | null
  statusTone?: SqdcRingTone | 'neutral'
  trendText?: string | null
  subLabel?: string | null
  size?: 'default' | 'hero'
}>()

const colorMap: Record<SqdcRingTone | 'neutral', string> = {
  green: 'rgb(22 163 74)',
  amber: 'rgb(217 119 6)',
  red: 'rgb(220 38 38)',
  empty: 'rgb(51 65 85)',
  neutral: 'rgb(71 85 105)',
}

const ringBackground = computed(() => {
  const track = 'rgb(30 41 59)'
  if (props.percent == null || !Number.isFinite(Number(props.percent))) {
    return `conic-gradient(from -90deg, ${colorMap.empty} 0deg 360deg)`
  }
  const p = Math.min(100, Math.max(0, Number(props.percent)))
  const fill = colorMap[props.tone === 'neutral' ? 'neutral' : props.tone]
  const a = (p / 100) * 360
  return `conic-gradient(from -90deg, ${fill} 0deg ${a}deg, ${track} ${a}deg 360deg)`
})

const ringSizeClass = computed(() =>
  props.size === 'hero' ? 'h-[8.25rem] w-[8.25rem] sm:h-36 sm:w-36' : 'h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32'
)

const innerInsetClass = computed(() => (props.size === 'hero' ? 'inset-[20%]' : 'inset-[22%]'))

const statusTextClass = computed(() => {
  const st = props.statusTone ?? 'neutral'
  if (st === 'green') return 'text-emerald-400/95'
  if (st === 'amber') return 'text-amber-300/95'
  if (st === 'red') return 'text-rose-400/95'
  return 'text-slate-500'
})

const pillarLabelClass = computed(() =>
  props.size === 'hero'
    ? 'text-xl font-semibold leading-tight tracking-wide sm:text-2xl'
    : 'text-sm font-semibold leading-tight tracking-wide sm:text-base'
)

const pillarLabelMinHClass = computed(() =>
  props.size === 'hero' ? 'min-h-[2.75rem] sm:min-h-[3.25rem]' : 'min-h-[2.25rem] sm:min-h-[2.5rem]'
)

const centerLetterClass = computed(() =>
  props.size === 'hero'
    ? 'text-sm font-bold uppercase tracking-wide text-slate-500 sm:text-base'
    : 'text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm'
)

const soloLetterClass = computed(() =>
  props.size === 'hero'
    ? 'text-3xl font-bold leading-none tracking-tight sm:text-4xl'
    : 'text-2xl font-bold leading-none tracking-tight sm:text-3xl'
)

const ringTrendTextClass = computed(() =>
  props.size === 'hero' ? 'text-sm font-medium leading-snug sm:text-base' : 'text-xs font-medium leading-snug sm:text-sm'
)

const ringSubLabelClass = computed(() =>
  props.size === 'hero'
    ? 'text-sm font-semibold tabular-nums leading-snug sm:text-base'
    : 'text-xs font-semibold tabular-nums leading-snug sm:text-sm'
)

const ringSubLabelMinHClass = computed(() =>
  props.size === 'hero' ? 'min-h-[1.5rem] sm:min-h-[1.75rem]' : 'min-h-[1.35rem] sm:min-h-[1.5rem]'
)
</script>

<template>
  <section class="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950/60 p-3">
    <p class="line-clamp-2 text-center uppercase text-slate-400" :class="[pillarLabelClass, pillarLabelMinHClass]">
      {{ label }}
    </p>
    <div class="relative mt-2 shrink-0" :class="ringSizeClass">
      <div
        class="absolute inset-0 rounded-full shadow-[inset_0_0_14px_rgba(0,0,0,0.4)] ring-1 ring-slate-800/80"
        :style="{ background: ringBackground }"
      />
      <div
        class="absolute flex flex-col items-center justify-center gap-0.5 rounded-full bg-slate-950 text-white shadow-inner ring-1 ring-slate-800/90"
        :class="innerInsetClass"
      >
        <template v-if="centerValue">
          <span :class="centerLetterClass">{{ letter }}</span>
          <span class="text-center text-lg font-bold tabular-nums leading-none sm:text-xl">
            {{ centerValue }}<span v-if="centerUnit" class="text-[11px] font-semibold text-slate-400">{{ centerUnit }}</span>
          </span>
          <span v-if="statusLabel" class="text-[9px] font-semibold leading-none" :class="statusTextClass">{{ statusLabel }}</span>
        </template>
        <span v-else :class="soloLetterClass">{{ letter }}</span>
      </div>
    </div>
    <p v-if="trendText" class="mt-1 line-clamp-2 text-center text-slate-400" :class="ringTrendTextClass">{{ trendText }}</p>
    <p v-if="subLabel" class="mt-1 line-clamp-2 text-center text-slate-500" :class="[ringSubLabelClass, ringSubLabelMinHClass]">
      {{ subLabel }}
    </p>
  </section>
</template>
