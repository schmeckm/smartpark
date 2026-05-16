import { markRaw, type Component } from 'vue'
import FlowHealthCardWidget from '@/components/widget-runtime/widgets/FlowHealthCardWidget.vue'
import FailedRunsCardWidget from '@/components/widget-runtime/widgets/FailedRunsCardWidget.vue'
import FlowRunTimelineWidget from '@/components/widget-runtime/widgets/FlowRunTimelineWidget.vue'
import FlowStatusSummaryWidget from '@/components/widget-runtime/widgets/FlowStatusSummaryWidget.vue'

/** Approved widget components only — never resolve arbitrary names from API JSON. */
export const WIDGET_COMPONENT_REGISTRY: Record<string, Component> = {
  FlowHealthCardWidget: markRaw(FlowHealthCardWidget),
  FailedRunsCardWidget: markRaw(FailedRunsCardWidget),
  FlowRunTimelineWidget: markRaw(FlowRunTimelineWidget),
  FlowStatusSummaryWidget: markRaw(FlowStatusSummaryWidget),
}

export function resolveApprovedWidgetComponent(componentName: string): Component | null {
  const key = String(componentName || '').trim()
  if (!key || !Object.prototype.hasOwnProperty.call(WIDGET_COMPONENT_REGISTRY, key)) {
    return null
  }
  return WIDGET_COMPONENT_REGISTRY[key] ?? null
}
