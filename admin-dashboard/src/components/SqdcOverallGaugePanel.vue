<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

export type SqdcScoreHistoryPoint = { snapshotDate: string; overallScore: number | null }

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
  return n != null ? n.toFixed(1) : '—'
})

function gaugeOption(): EChartsOption {
  const val = gaugeNumeric.value ?? 0
  const tk = trend.value.kind
  const pointerColor = tk === 'up' ? '#4ade80' : tk === 'down' ? '#f87171' : '#94a3b8'
  return {
    backgroundColor: 'transparent',
    animationDuration: 420,
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 100,
        radius: '92%',
        center: ['50%', '54%'],
        startAngle: 200,
        endAngle: -20,
        splitNumber: 5,
        pointer: {
          length: '58%',
          width: 5,
          itemStyle: { color: pointerColor, shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.35)' },
        },
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.55, '#9f1239'],
              [0.8, '#b45309'],
              [1, '#166534'],
            ],
          },
        },
        axisTick: { distance: -10, length: 6, lineStyle: { color: '#475569' } },
        splitLine: { distance: -12, length: 12, lineStyle: { color: '#475569' } },
        axisLabel: { color: '#64748b', distance: 16, fontSize: 9 },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '74%'],
          fontSize: 24,
          fontWeight: 700,
          color: '#f8fafc',
          formatter: () => detailText.value,
        },
        data: [{ value: val }],
      },
    ],
  }
}

function trendOption(): EChartsOption {
  const xs = props.history.map((h) => h.snapshotDate)
  const ys = props.history.map((h) =>
    h.overallScore != null && Number.isFinite(h.overallScore) ? h.overallScore : null
  )
  const markDay = xs.includes(props.selectedDate) ? props.selectedDate : null
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 10, bottom: 22 },
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
      axisLabel: { color: '#64748b', fontSize: 9, rotate: xs.length > 14 ? 40 : 0 },
      axisLine: { lineStyle: { color: '#334155' } },
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
    <div ref="gaugeEl" class="mt-1 h-[200px] w-full" />
    <p class="mt-1 text-center text-[10px] uppercase tracking-wide text-slate-500">{{ t('sqdc.overallGaugeSparkline') }}</p>
    <div ref="trendEl" class="h-[120px] w-full" />
  </div>
</template>
