<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SqdcRingTone } from '@/api/client'

const { t } = useI18n()

const props = defineProps<{
  letter: string
  label: string
  /** One segment per calendar day in the month (28–31 entries). */
  segments: SqdcRingTone[]
  /** e.g. today's numeric score */
  subLabel?: string
  /** Large center value (e.g. score % or EUR amount) — mockup-style SQDCP hero. */
  centerValue?: string | null
  /** Suffix after centerValue (e.g. " €"). */
  centerUnit?: string | null
  /** Short status under value (e.g. Good / Watch). */
  statusLabel?: string | null
  statusTone?: SqdcRingTone | 'neutral'
  /** Line under the ring (e.g. trend vs prior day). */
  trendText?: string | null
  /** Larger ring for top “command center” row. */
  size?: 'default' | 'hero'
}>()

const colorMap: Record<SqdcRingTone, string> = {
  green: 'rgb(22 163 74)',
  amber: 'rgb(217 119 6)',
  red: 'rgb(220 38 38)',
  empty: 'rgb(51 65 85)',
}

/** Dark groove between day segments so 28–31 divisions stay visible even when adjacent days share the same tone. */
const SEGMENT_DELIM = 'rgb(15 23 42)'

const ringBackground = computed(() => {
  const n = Math.max(1, props.segments.length)
  const step = 360 / n
  const g = Math.min(1.05, Math.max(0.28, step * 0.085))
  const parts: string[] = []
  for (let i = 0; i < n; i += 1) {
    const tone = props.segments[i] ?? 'empty'
    const a0 = i * step - 90
    const a1 = (i + 1) * step - 90
    const half = Math.min(g, (a1 - a0) / 2 - 0.04)
    if (half <= 0) {
      parts.push(`${colorMap[tone]} ${a0}deg ${a1}deg`)
      continue
    }
    parts.push(
      `${SEGMENT_DELIM} ${a0}deg ${a0 + half}deg`,
      `${colorMap[tone]} ${a0 + half}deg ${a1 - half}deg`,
      `${SEGMENT_DELIM} ${a1 - half}deg ${a1}deg`,
    )
  }
  return `conic-gradient(from -90deg, ${parts.join(', ')})`
})

const segmentDayCount = computed(() => Math.max(0, props.segments.length))

const ringDayDividerHint = computed(() =>
  segmentDayCount.value > 1 ? t('sqdc.monthRingDayDividerHint', { n: segmentDayCount.value }) : undefined
)

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

/** Title above the ring — readable, smaller than the 4xl/5xl experiment. */
const pillarLabelClass = computed(() =>
  props.size === 'hero'
    ? 'text-xl font-semibold leading-tight tracking-wide sm:text-2xl'
    : 'text-sm font-semibold leading-tight tracking-wide sm:text-base'
)

const pillarLabelMinHClass = computed(() =>
  props.size === 'hero'
    ? 'min-h-[2.75rem] sm:min-h-[3.25rem]'
    : 'min-h-[2.25rem] sm:min-h-[2.5rem]'
)

/** S / Q / … above the center value — was 9px. */
const centerLetterClass = computed(() =>
  props.size === 'hero'
    ? 'text-sm font-bold uppercase tracking-wide text-slate-500 sm:text-base'
    : 'text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm'
)

/** Letter-only center (no numeric hero value). */
const soloLetterClass = computed(() =>
  props.size === 'hero'
    ? 'text-3xl font-bold leading-none tracking-tight sm:text-4xl'
    : 'text-2xl font-bold leading-none tracking-tight sm:text-3xl'
)

/** Under ring: “Ring vs. Vortag: …” — was 9px. */
const ringTrendTextClass = computed(() =>
  props.size === 'hero'
    ? 'text-sm font-medium leading-snug sm:text-base'
    : 'text-xs font-medium leading-snug sm:text-sm'
)

/** Under ring: “Heute: 88.0” — was 9px. */
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
    <p
      class="line-clamp-2 text-center uppercase text-slate-400"
      :class="[pillarLabelClass, pillarLabelMinHClass]"
    >
      {{ label }}
    </p>
    <div class="relative mt-2 shrink-0" :class="ringSizeClass">
      <div
        class="absolute inset-0 rounded-full shadow-[inset_0_0_14px_rgba(0,0,0,0.4)] ring-1 ring-slate-800/80"
        :style="{ background: ringBackground }"
        :title="ringDayDividerHint"
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
    <p
      v-if="subLabel"
      class="mt-1 line-clamp-2 text-center text-slate-500"
      :class="[ringSubLabelClass, ringSubLabelMinHClass]"
    >
      {{ subLabel }}
    </p>
  </section>
</template>
