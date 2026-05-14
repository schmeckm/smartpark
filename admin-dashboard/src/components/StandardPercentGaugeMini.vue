<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { buildStandardPercentGaugeSeries } from '@/utils/echartsStandardGauge'

const props = defineProps<{
  label: string
  value: number | null
}>()

const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const numeric = computed(() => {
  if (props.value == null || !Number.isFinite(Number(props.value))) return null
  return Math.max(0, Math.min(100, Number(props.value)))
})

function renderGauge() {
  const dom = chartEl.value
  if (!dom) return
  if (!chart) chart = echarts.init(dom, undefined, { renderer: 'canvas' })

  if (numeric.value == null) {
    chart.clear()
    chart.setOption(
      {
        backgroundColor: 'transparent',
        graphic: [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: { text: '—', fill: '#64748b', fontSize: 11 },
          },
        ],
        series: [],
      } as EChartsOption,
      true
    )
    chart.resize()
    return
  }

  const v = numeric.value
  chart.clear()
  chart.setOption(
    {
      backgroundColor: 'transparent',
      series: [
        buildStandardPercentGaugeSeries({
          value: v,
          compact: true,
          detail: {
            formatter: () => `${v.toFixed(1)}%`,
          },
        }),
      ],
    } as EChartsOption,
    true
  )
  chart.resize()
}

function onResize() {
  chart?.resize()
}

watch(
  () => [props.value],
  () => {
    void nextTick(() => renderGauge())
  }
)

onMounted(() => {
  void nextTick(() => renderGauge())
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="flex min-w-0 flex-col items-center gap-1">
    <p class="text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">{{ label }}</p>
    <div ref="chartEl" class="h-20 w-full min-w-[4.5rem]" />
  </div>
</template>
