import type { SeriesOption } from 'echarts'

/** Ampelfarben auf der Skala 0–1 (arm / warn / gut) — einheitlich für OEE, SQDC, MQTT-Cockpit. */
export const STANDARD_PERCENT_GAUGE_AXIS_COLORS: Array<[number, string]> = [
  [0.6, '#ef4444'],
  [0.85, '#fbbf24'],
  [1, '#22c55e'],
]

export type StandardPercentGaugeOptions = {
  value: number
  /** Kompakte Variante: keine Teilstriche/Beschriftung, dünnere Arc — z. B. MQTT-Karten. */
  compact?: boolean
  pointerColor?: string
  animationDuration?: number
  /** Überschreibt / ergänzt die Standard-`detail`-Konfiguration (z. B. eigener formatter). */
  detail?: Record<string, unknown>
}

/**
 * Einheitliches 0–100-%-Gauge (Halbbogen): gleiche Geometrie und Farben wie auf SQDC-Boards und OEE-Platform.
 */
export function buildStandardPercentGaugeSeries(opt: StandardPercentGaugeOptions): SeriesOption {
  const compact = opt.compact ?? false
  const pointerColor = opt.pointerColor ?? '#f1f5f9'

  const detailDefaults: Record<string, unknown> = {
    valueAnimation: true,
    offsetCenter: [0, compact ? '68%' : '72%'],
    fontSize: compact ? 11 : 26,
    fontWeight: 700,
    color: '#f8fafc',
    formatter: '{value}%',
    ...opt.detail,
  }

  return {
    type: 'gauge',
    min: 0,
    max: 100,
    splitNumber: 5,
    radius: compact ? '88%' : '92%',
    center: (compact ? ['50%', '62%'] : ['50%', '56%']) as [string, string],
    startAngle: 210,
    endAngle: -30,
    animationDuration: opt.animationDuration ?? 420,
    axisLine: {
      roundCap: true,
      lineStyle: {
        width: compact ? 8 : 12,
        color: STANDARD_PERCENT_GAUGE_AXIS_COLORS,
      },
    },
    pointer: {
      length: compact ? '62%' : '72%',
      width: compact ? 4 : 5,
      itemStyle: {
        color: pointerColor,
        ...(compact ? {} : { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.25)' }),
      },
    },
    axisTick: compact
      ? { show: false }
      : { distance: -12, length: 6, lineStyle: { color: '#64748b', width: 1 } },
    splitLine: compact
      ? { show: false }
      : { distance: -12, length: 14, lineStyle: { color: '#64748b', width: 1 } },
    axisLabel: compact
      ? { show: false }
      : { color: '#94a3b8', distance: 14, fontSize: 10 },
    title: { show: false },
    detail: detailDefaults,
    data: [{ value: opt.value }],
  } as SeriesOption
}
