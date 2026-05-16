<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  data: Record<string, number>
  /** When true, bar values are shown as 0–100 (% of total relative importance). */
  displayAsPercent?: boolean
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let inst: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function buildOption(): EChartsOption {
  const entries = Object.entries(props.data).sort((a, b) => b[1] - a[1])
  const mult = props.displayAsPercent ? 100 : 1
  const values = entries.map(([, v]) => Number((v * mult).toFixed(mult === 100 ? 2 : 6)))
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    xAxis: {
      type: 'value',
      max: props.displayAsPercent ? 100 : undefined,
      splitLine: { lineStyle: { color: '#334155' } },
      axisLabel: props.displayAsPercent ? { formatter: '{value}%' } : undefined,
    },
    yAxis: { type: 'category', data: entries.map(([k]) => k) },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: { color: '#22d3ee' },
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
  () => [props.data, props.displayAsPercent] as const,
  () => paint(),
  { deep: true },
)
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  inst?.dispose()
  inst = null
})
</script>

<template>
  <div ref="hostRef" class="h-80 w-full min-w-0" />
</template>
