<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  points: Array<{ i: number; actual: number; predicted: number }>
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let inst: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function buildOption(): EChartsOption {
  const pts = props.points
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    legend: { textStyle: { color: '#94a3b8' }, data: ['Actual', 'Predicted'] },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: pts.map((p) => String(p.i)),
      name: 'Holdout row',
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#334155' } } },
    series: [
      { name: 'Actual', type: 'line', smooth: true, data: pts.map((p) => p.actual) },
      { name: 'Predicted', type: 'line', smooth: true, data: pts.map((p) => p.predicted) },
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
  () => props.points,
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
  <div ref="hostRef" class="h-56 w-full min-w-0" />
</template>
