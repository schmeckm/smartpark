<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { buildStandardPercentGaugeSeries } from '@/utils/echartsStandardGauge'

export type SqdcScoreHistoryPoint = { snapshotDate: string; overallScore: number | null }

/** Matches `sqdc-board.service.js` overall history window: `addCalendarDaysIso(date, -29) … date`. */
const SCORE_HISTORY_LOOKBACK_DAYS = 29

function addUtcCalendarDays(iso: string, deltaDays: number): string {
  const parts = iso.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function enumerateUtcDaysInclusive(fromIso: string, toIso: string): string[] {
  if (fromIso > toIso) return []
  const out: string[] = []
  let cur = fromIso
  while (cur <= toIso) {
    out.push(cur)
    cur = addUtcCalendarDays(cur, 1)
  }
  return out
}

const props = defineProps<{
  overallScore: number | null | undefined
  selectedDate: string
  history: SqdcScoreHistoryPoint[]
}>()

const { t } = useI18n()

const gaugeEl = ref<HTMLElement | null>(null)
const trendEl = ref<HTMLElement | null>(null)
let gaugeChart: echarts.ECharts | null = null
let trendChart: echarts.ECharts | null = null

function trendMeta() {
  const sel = props.selectedDate
  const past = props.history
    .filter(
      (h) =>
        h.snapshotDate < sel && h.overallScore != null && Number.isFinite(Number(h.overallScore))
    )
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .slice(-7)
  if (!past.length) return { kind: 'flat' as const, avg: null as number | null }
  const avg = past.reduce((s, h) => s + Number(h.overallScore), 0) / past.length
  let cur: number | null =
    props.overallScore != null && Number.isFinite(Number(props.overallScore))
      ? Number(props.overallScore)
      : null
  if (cur == null) {
    const row = props.history.find((h) => h.snapshotDate === sel)
    if (row?.overallScore != null && Number.isFinite(Number(row.overallScore))) cur = Number(row.overallScore)
  }
  if (cur == null) return { kind: 'flat' as const, avg }
  if (cur > avg + 2) return { kind: 'up' as const, avg }
  if (cur < avg - 2) return { kind: 'down' as const, avg }
  return { kind: 'flat' as const, avg }
}

const trend = computed(() => trendMeta())

const trendHint = computed(() => {
  const { kind, avg } = trend.value
  if (avg == null) return t('sqdc.gaugeTrendNoHistory')
  const avgStr = avg.toFixed(1)
  if (kind === 'up') return t('sqdc.gaugeTrendUp', { avg: avgStr })
  if (kind === 'down') return t('sqdc.gaugeTrendDown', { avg: avgStr })
  return t('sqdc.gaugeTrendFlat', { avg: avgStr })
})

const gaugeNumeric = computed(() => {
  const v = props.overallScore
  if (v != null && Number.isFinite(Number(v))) return Math.max(0, Math.min(100, Number(v)))
  const row = props.history.find((h) => h.snapshotDate === props.selectedDate)
  if (row?.overallScore != null && Number.isFinite(Number(row.overallScore))) {
    return Math.max(0, Math.min(100, Number(row.overallScore)))
  }
  return null
})

const detailText = computed(() => {
  const n = gaugeNumeric.value
  if (n == null) return '—'
  return n.toFixed(1)
})

function gaugePointerColor(kind: 'up' | 'down' | 'flat'): string {
  if (kind === 'up') return '#4ade80'
  if (kind === 'down') return '#f87171'
  return '#94a3b8'
}

function gaugeOption(): EChartsOption {
  const val = gaugeNumeric.value ?? 0
  const tk = trend.value.kind
  const pointerColor = gaugePointerColor(tk)
  return {
    backgroundColor: 'transparent',
    animationDuration: 420,
    series: [
      buildStandardPercentGaugeSeries({
        value: val,
        pointerColor,
        detail: {
          formatter: () => detailText.value,
        },
      }),
    ],
  }
}

function trendOption(): EChartsOption {
  const winStart = addUtcCalendarDays(props.selectedDate, -SCORE_HISTORY_LOOKBACK_DAYS)
  const xs = enumerateUtcDaysInclusive(winStart, props.selectedDate)
  const byDate = new Map<string, number | null>()
  for (const h of props.history) {
    byDate.set(h.snapshotDate, h.overallScore)
  }
  const ys = xs.map((d) => {
    const v = byDate.get(d)
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null
  })
  const markDay = xs.includes(props.selectedDate) ? props.selectedDate : null
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 10, bottom: xs.length > 16 ? 32 : 24 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisValue?: string; value?: number | null }>
        const p = arr[0]
        if (!p) return ''
        const v = p.value
        return `${p.axisValue ?? ''}<br/>${v != null && Number.isFinite(v) ? Number(v).toFixed(1) : '—'}`
      },
    },
    xAxis: {
      type: 'category',
      data: xs,
      axisLabel: {
        color: '#64748b',
        fontSize: 9,
        rotate: xs.length > 14 ? 40 : 0,
        formatter: (v: string) => (v.length >= 10 ? `${v.slice(5, 7)}-${v.slice(8, 10)}` : v),
      },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { alignWithLabel: true },
      splitLine: { show: true, lineStyle: { color: '#1e293b', type: 'solid', width: 1 } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      splitNumber: 4,
      axisLabel: { color: '#64748b', fontSize: 9 },
      splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: '#38bdf8' },
        itemStyle: { color: '#38bdf8' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(56,189,248,0.35)' },
            { offset: 1, color: 'rgba(15,23,42,0.02)' },
          ]),
        },
        data: ys,
        markLine: markDay
          ? {
              symbol: 'none',
              lineStyle: { color: '#fbbf24', type: 'dashed', width: 1 },
              label: { show: false },
              data: [{ xAxis: markDay }],
            }
          : undefined,
      },
    ],
  }
}

function renderCharts() {
  const g = gaugeEl.value
  const tr = trendEl.value
  if (g) {
    if (!gaugeChart) gaugeChart = echarts.init(g, undefined, { renderer: 'canvas' })
    gaugeChart.setOption(gaugeOption(), true)
  }
  if (tr) {
    if (!trendChart) trendChart = echarts.init(tr, undefined, { renderer: 'canvas' })
    trendChart.setOption(trendOption(), true)
  }
}

function onResize() {
  gaugeChart?.resize()
  trendChart?.resize()
}

watch(
  () => [props.overallScore, props.selectedDate, props.history],
  () => {
    void nextTick(() => renderCharts())
  },
  { deep: true }
)

onMounted(() => {
  void nextTick(() => renderCharts())
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  gaugeChart?.dispose()
  trendChart?.dispose()
  gaugeChart = null
  trendChart = null
})
</script>

<template>
  <div class="rounded-xl border border-slate-700/80 bg-slate-950/50 p-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-slate-100">{{ t('sqdc.overallGaugeTitle') }}</h3>
        <p class="mt-0.5 text-[10px] text-slate-500">{{ t('sqdc.overallGaugeHistoryHint') }}</p>
      </div>
      <p
        class="max-w-[14rem] text-right text-[10px] leading-snug"
        :class="
          trend.kind === 'up'
            ? 'text-emerald-400/95'
            : trend.kind === 'down'
              ? 'text-rose-400/95'
              : 'text-slate-400'
        "
      >
        {{ trendHint }}
      </p>
    </div>
    <div ref="gaugeEl" class="mt-1 h-[220px] w-full" />
    <p class="mt-1 text-center text-[10px] uppercase tracking-wide text-slate-500">{{ t('sqdc.overallGaugeSparkline') }}</p>
    <div ref="trendEl" class="h-[120px] w-full" />
  </div>
</template>
