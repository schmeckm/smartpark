<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  points: Array<{ t: string; v: number }>
  /** Short label for Y axis (e.g. metric name). */
  valueLabel?: string
  /** 'live' | 'simulated' — adjusts subtitle styling only. */
  seriesSource?: 'live' | 'simulated' | 'none'
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let inst: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function formatTick(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

function buildOption(): EChartsOption {
  const pts = props.points
  const src = props.seriesSource
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    grid: { left: 52, right: 12, top: src && src !== 'none' ? 28 : 12, bottom: 28 },
    xAxis: {
      type: 'category',
      data: pts.map((p) => formatTick(p.t)),
      axisLabel: { fontSize: 10, rotate: pts.length > 24 ? 32 : 0 },
    },
    yAxis: {
      type: 'value',
      name: props.valueLabel || '',
      nameTextStyle: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: '#334155' } },
    },
    series: [
      {
        name: 'value',
        type: 'line',
        smooth: true,
        showSymbol: pts.length <= 36,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.08 },
        data: pts.map((p) => p.v),
      },
    ],
  }
}

function applyOption() {
  if (!inst) return
  inst.setOption(buildOption(), { notMerge: true })
}

function paint() {
  const el = hostRef.value
  if (!el) return
  if (!ro) {
    ro = new ResizeObserver(() => {
      const node = hostRef.value
      const laidOut = !!node && node.clientWidth > 0 && node.clientHeight > 0
      if (!laidOut) return
      if (inst) inst.resize()
      else inst = echarts.init(node, undefined, { renderer: 'canvas' })
      applyOption()
    })
    ro.observe(el)
  }
  const laidOut = el.clientWidth > 0 && el.clientHeight > 0
  if (!laidOut) return
  if (inst) inst.resize()
  else inst = echarts.init(el, undefined, { renderer: 'canvas' })
  applyOption()
}

onMounted(() => paint())
watch(
  () => [props.points, props.valueLabel, props.seriesSource] as const,
  () => paint(),
  { deep: true }
)
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  inst?.dispose()
  inst = null
})
</script>

<template>
  <div class="space-y-1">
    <p v-if="seriesSource === 'simulated'" class="text-[11px] leading-snug text-sky-400/90">
      {{ $t('pdmPage.seriesSimulatedNote') }}
    </p>
    <p v-else-if="seriesSource === 'live'" class="text-[11px] leading-snug text-emerald-400/85">
      {{ $t('pdmPage.seriesLiveNote') }}
    </p>
    <div ref="hostRef" class="h-52 w-full min-w-0" data-testid="pdm-metric-series-chart" />
  </div>
</template>
