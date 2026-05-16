<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  mae: number | null | undefined
  rmse: number | null | undefined
  r2: number | null | undefined
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let inst: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function buildOption(): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: ['MAE', 'RMSE', 'R²'] },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#334155' } } },
    series: [
      {
        type: 'bar',
        data: [props.mae ?? 0, props.rmse ?? 0, props.r2 ?? 0],
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#6366f1' },
            { offset: 1, color: '#4f46e5' },
          ]),
        },
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
  () => [props.mae, props.rmse, props.r2],
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
