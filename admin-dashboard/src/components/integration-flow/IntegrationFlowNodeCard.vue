<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { IntegrationFlowNodePresentation } from '@/types/integrationFlowVueFlow'
import { resolvePaletteCategory } from '@/utils/integrationFlowPaletteCategories'

const { t } = useI18n()

defineEmits<{
  'open-run-step': [nodeId: string]
}>()

const { node } = useNode()

const data = computed(
  () =>
    ({
      nodeType: '',
      nodeId: '',
      displayName: '',
      category: '',
      status: '',
      errorMessage: '',
      validationHighlight: false,
      durationMs: null,
      hasPreview: false,
      ...(node.data || {}),
    }) as IntegrationFlowNodePresentation
)

const nodeType = computed(() => data.value.nodeType || '')
const nodeId = computed(() => data.value.nodeId || node.id)
const displayName = computed(() => data.value.displayName || nodeType.value)
const category = computed(() => data.value.category || '')
const status = computed(() => (data.value.status || '').toLowerCase())
const errorMessage = computed(() => {
  const m = data.value.errorMessage
  return m.trim() ? m.trim() : ''
})
const selected = computed(() => Boolean(node.selected))

const categoryClass = computed(() => {
  const cat = resolvePaletteCategory(category.value, nodeType.value)
  const m: Record<string, string> = {
    Trigger: 'iff-node-card__cat--trigger',
    Adapter: 'iff-node-card__cat--adapter',
    Transform: 'iff-node-card__cat--transform',
    Canonical: 'iff-node-card__cat--canonical',
    Output: 'iff-node-card__cat--output',
    AI: 'iff-node-card__cat--ai',
    Utility: 'iff-node-card__cat--utility',
  }
  return m[cat] || 'iff-node-card__cat--default'
})

function statusBadgeClass(): string {
  const s = status.value
  if (s === 'success') return 'iff-node-badge iff-node-badge--success'
  if (s === 'failed') return 'iff-node-badge iff-node-badge--failed'
  if (s === 'running') return 'iff-node-badge iff-node-badge--running'
  if (s === 'skipped') return 'iff-node-badge iff-node-badge--skipped'
  return 'iff-node-badge iff-node-badge--default'
}
</script>

<template>
  <div
    class="iff-node-card"
    :class="[
      status ? `iff-node-card--${status}` : '',
      selected ? 'iff-node-card--selected' : '',
      data.validationHighlight ? 'iff-node-card--validation' : '',
    ]"
    data-testid="integration-flow-visual-node"
  >
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
    <div class="iff-node-card__head">
      <span class="iff-node-card__cat" :class="categoryClass">{{ category || nodeType }}</span>
      <button
        v-if="status"
        type="button"
        class="iff-node-card__badge-btn"
        :class="statusBadgeClass()"
        data-testid="integration-flow-visual-node-status-badge"
        @click.stop="$emit('open-run-step', nodeId)"
      >
        {{ status }}
      </button>
    </div>
    <div class="iff-node-card__title">{{ displayName }}</div>
    <div class="iff-node-card__id">{{ nodeId }}</div>
    <div v-if="data.durationMs != null || data.hasPreview" class="iff-node-card__meta">
      <span v-if="data.durationMs != null" class="iff-node-card__duration">{{ data.durationMs }} ms</span>
      <span
        v-if="data.hasPreview"
        class="iff-node-card__preview-dot"
        data-testid="integration-flow-visual-node-preview-badge"
        :title="t('integrationFlowDesigner.previewBadge')"
      />
    </div>
    <p
      v-if="status === 'failed' && errorMessage"
      class="iff-node-card__error"
      data-testid="integration-flow-visual-node-error"
    >
      {{ errorMessage }}
    </p>
    <button
      v-if="status === 'failed'"
      type="button"
      class="iff-node-card__debug-btn"
      data-testid="integration-flow-visual-node-open-debug"
      @click.stop="$emit('open-run-step', nodeId)"
    >
      {{ t('integrationFlowStudio.debugOpen') }}
    </button>
  </div>
</template>

<style scoped>
.iff-node-card {
  min-width: 176px;
  max-width: 260px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgb(71 85 105 / 0.9);
  background: rgb(15 23 42 / 0.98);
  font-size: 11px;
  line-height: 1.3;
  color: rgb(226 232 240);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
}
.iff-node-card--selected {
  border-color: rgb(99 102 241 / 0.95);
  box-shadow: 0 0 0 2px rgb(99 102 241 / 0.35);
}
.iff-node-card--validation {
  border-color: rgb(248 113 113 / 0.85);
  box-shadow: 0 0 0 2px rgb(248 113 113 / 0.35);
}
.iff-node-card--success {
  border-color: rgb(16 185 129 / 0.55);
}
.iff-node-card--failed {
  border-color: rgb(248 113 113 / 0.65);
}
.iff-node-card--running {
  border-color: rgb(251 191 36 / 0.65);
}
.iff-node-card--skipped {
  border-color: rgb(100 116 139 / 0.65);
}
.iff-node-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}
.iff-node-card__cat {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 3px;
  padding: 1px 5px;
}
.iff-node-card__cat--trigger {
  background: rgb(16 185 129 / 0.2);
  color: rgb(167 243 208);
}
.iff-node-card__cat--adapter {
  background: rgb(14 165 233 / 0.2);
  color: rgb(186 230 253);
}
.iff-node-card__cat--transform {
  background: rgb(139 92 246 / 0.2);
  color: rgb(221 214 254);
}
.iff-node-card__cat--canonical {
  background: rgb(99 102 241 / 0.2);
  color: rgb(199 210 254);
}
.iff-node-card__cat--output {
  background: rgb(245 158 11 / 0.2);
  color: rgb(253 230 138);
}
.iff-node-card__cat--default {
  background: rgb(51 65 85 / 0.5);
  color: rgb(203 213 225);
}
.iff-node-card__title {
  margin-top: 4px;
  font-weight: 600;
  font-size: 11px;
  color: rgb(241 245 249);
  word-break: break-word;
}
.iff-node-card__id {
  margin-top: 2px;
  font-family: ui-monospace, monospace;
  font-size: 9px;
  color: rgb(148 163 184);
  word-break: break-all;
}
.iff-node-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.iff-node-card__duration {
  font-size: 9px;
  color: rgb(148 163 184);
}
.iff-node-card__preview-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(129 140 248);
  box-shadow: 0 0 4px rgb(129 140 248 / 0.8);
}
.iff-node-card__badge-btn {
  flex-shrink: 0;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  border: none;
}
.iff-node-badge--success {
  background: rgb(16 185 129 / 0.25);
  color: rgb(167 243 208);
}
.iff-node-badge--failed {
  background: rgb(248 113 113 / 0.25);
  color: rgb(254 202 202);
}
.iff-node-badge--running {
  background: rgb(251 191 36 / 0.25);
  color: rgb(253 230 138);
}
.iff-node-badge--skipped {
  background: rgb(100 116 139 / 0.35);
  color: rgb(203 213 225);
}
.iff-node-badge--default {
  background: rgb(51 65 85 / 0.6);
  color: rgb(203 213 225);
}
.iff-node-card__error {
  margin: 6px 0 0;
  font-size: 10px;
  color: rgb(252 165 165);
  word-break: break-word;
}
.iff-node-card__debug-btn {
  margin-top: 6px;
  width: 100%;
  border-radius: 4px;
  border: 1px solid rgb(248 113 113 / 0.45);
  background: rgb(127 29 29 / 0.35);
  padding: 3px 6px;
  font-size: 9px;
  font-weight: 600;
  color: rgb(254 202 202);
  cursor: pointer;
}
.iff-node-card__debug-btn:hover {
  background: rgb(127 29 29 / 0.55);
}
</style>
