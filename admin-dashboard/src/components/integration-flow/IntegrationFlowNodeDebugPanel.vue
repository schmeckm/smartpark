<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  IntegrationFlowRunDto,
  IntegrationFlowRunStepDto,
  IntegrationFlowTimelineEntryDto,
} from '@/api/client'
import IntegrationFlowPayloadTree from '@/components/integration-flow/IntegrationFlowPayloadTree.vue'
import {
  copyTextToClipboard,
  estimatePayloadBytes,
  extractPreviewMeta,
  formatPreviewJson,
  isPreviewTruncated,
} from '@/utils/integrationFlowPreviewDisplay'

const props = defineProps<{
  selectedNodeId: string | null
  selectedRun: IntegrationFlowRunDto | null
  timeline: IntegrationFlowTimelineEntryDto[]
  flowId: string | null
  pinnedPayload: unknown | null
}>()

const emit = defineEmits<{
  close: []
  'pin-payload': [payload: unknown]
  'clear-pinned': []
}>()

const { t } = useI18n()

const activeTab = ref<'input' | 'output' | 'metadata'>('input')
const copyOk = ref(false)
const viewMode = ref<'tree' | 'json'>('tree')

const step = computed((): IntegrationFlowRunStepDto | null => {
  const id = props.selectedNodeId?.trim()
  if (!id || !props.selectedRun?.steps?.length) return null
  return props.selectedRun.steps.find((s) => s.nodeId === id) ?? null
})

const timelineEntry = computed((): IntegrationFlowTimelineEntryDto | null => {
  const id = props.selectedNodeId?.trim()
  if (!id) return null
  return props.timeline.find((e) => e.nodeId === id) ?? null
})

const nodeType = computed(() => step.value?.nodeType ?? timelineEntry.value?.nodeType ?? '')
const status = computed(() => step.value?.status ?? timelineEntry.value?.status ?? '')
const isMappingNode = computed(() => nodeType.value === 'CANONICAL_MAPPING')

const inputPreview = computed(() => step.value?.previewInputJson ?? null)
const outputPreview = computed(() => step.value?.previewOutputJson ?? null)

const inputMeta = computed(() => extractPreviewMeta(inputPreview.value))
const outputMeta = computed(() => extractPreviewMeta(outputPreview.value))

const activePayload = computed(() => {
  if (activeTab.value === 'output') return outputPreview.value
  if (activeTab.value === 'input') return inputPreview.value
  return null
})

const activeMeta = computed(() => {
  if (activeTab.value === 'output') return outputMeta.value
  if (activeTab.value === 'input') return inputMeta.value
  return extractPreviewMeta(null)
})

const hasPreviewData = computed(
  () => inputPreview.value != null || outputPreview.value != null || props.pinnedPayload != null
)

const tableRows = computed((): Record<string, unknown>[] | null => {
  const payload = activeTab.value === 'input' ? inputPreview.value : outputPreview.value
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const obj = payload as Record<string, unknown>
  for (const key of ['items', 'rows', 'data', 'results', 'liveData', 'canonicalMessages']) {
    const arr = obj[key]
    if (!Array.isArray(arr) || !arr.length) continue
    if (!arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) continue
    return arr.slice(0, 12) as Record<string, unknown>[]
  }
  return null
})

const tableColumns = computed((): string[] => {
  const rows = tableRows.value
  if (!rows?.length) return []
  const keys = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!k.startsWith('_')) keys.add(k)
    }
  }
  return [...keys].slice(0, 8)
})

watch(
  () => props.selectedNodeId,
  () => {
    activeTab.value = 'input'
    copyOk.value = false
  }
)

watch(
  () => [props.selectedRun?.id, props.selectedNodeId] as const,
  () => {
    copyOk.value = false
  }
)

function statusClass(s: string): string {
  const v = s.toLowerCase()
  if (v === 'success') return 'text-emerald-300'
  if (v === 'failed') return 'text-red-300'
  if (v === 'running') return 'text-amber-300'
  if (v === 'skipped') return 'text-slate-400'
  return 'text-slate-300'
}

async function onCopy() {
  const text =
    activeTab.value === 'metadata'
      ? formatPreviewJson({
          nodeId: props.selectedNodeId,
          nodeType: nodeType.value,
          status: status.value,
          step: step.value,
          timeline: timelineEntry.value,
          run: props.selectedRun
            ? {
                id: props.selectedRun.id,
                retryAttempt: props.selectedRun.retryAttempt,
                retryStatus: props.selectedRun.retryStatus,
              }
            : null,
        })
      : formatPreviewJson(activePayload.value ?? props.pinnedPayload)
  copyOk.value = await copyTextToClipboard(text)
}

function onPinFromInput() {
  if (inputPreview.value != null) emit('pin-payload', inputPreview.value)
  else if (step.value?.inputJson != null) emit('pin-payload', step.value.inputJson)
}

function formatCell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object') return '{…}'
  const s = String(v)
  return s.length > 48 ? `${s.slice(0, 48)}…` : s
}

function formatBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}
</script>

<template>
  <aside
    class="iff-debug-panel flex h-full flex-col border-l border-slate-700/80 bg-slate-900/95"
    data-testid="integration-flow-node-debug-panel"
  >
    <header class="flex shrink-0 items-start justify-between gap-2 border-b border-slate-700/80 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold text-slate-100">{{ t('integrationFlowStudio.debugTitle') }}</h2>
        <p v-if="selectedNodeId" class="mt-0.5 font-mono text-xs text-slate-400">{{ selectedNodeId }}</p>
        <p v-else class="mt-1 text-xs text-slate-500">{{ t('integrationFlowStudio.debugNoNode') }}</p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        :aria-label="t('integrationFlowStudio.debugClose')"
        data-testid="integration-flow-debug-close"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <div v-if="!selectedNodeId" class="flex-1 p-4 text-sm text-slate-500">
      {{ t('integrationFlowStudio.debugSelectNode') }}
    </div>
    <div v-else-if="!selectedRun" class="flex-1 p-4 text-sm text-slate-500">
      {{ t('integrationFlowStudio.debugSelectRun') }}
    </div>
    <template v-else>
      <div class="shrink-0 space-y-2 border-b border-slate-700/60 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{{ nodeType || '—' }}</span>
          <span v-if="status" :class="['font-medium uppercase', statusClass(status)]">{{ status }}</span>
          <span v-if="step?.durationMs != null" class="text-slate-500">{{ step.durationMs }} ms</span>
        </div>
        <p
          v-if="step?.errorMessage || timelineEntry?.errorMessage"
          class="text-xs text-red-300"
          data-testid="integration-flow-debug-error"
        >
          {{ step?.errorMessage || timelineEntry?.errorMessage }}
        </p>
        <div
          v-if="pinnedPayload != null"
          class="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-xs text-indigo-200"
          data-testid="integration-flow-debug-pinned"
        >
          {{ t('integrationFlowStudio.debugPinnedActive') }}
          <button
            type="button"
            class="ml-2 font-medium text-indigo-300 hover:text-indigo-100"
            data-testid="integration-flow-debug-clear-pin"
            @click="emit('clear-pinned')"
          >
            {{ t('integrationFlowStudio.debugClearPin') }}
          </button>
        </div>
      </div>

      <div class="flex shrink-0 gap-1 border-b border-slate-700/60 px-2 pt-2">
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="activeTab === 'input' ? 'bg-slate-800 text-brand-300' : 'text-slate-400 hover:text-slate-200'"
          data-testid="integration-flow-debug-tab-input"
          @click="activeTab = 'input'"
        >
          {{ t('integrationFlowStudio.debugTabInput') }}
        </button>
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="activeTab === 'output' ? 'bg-slate-800 text-brand-300' : 'text-slate-400 hover:text-slate-200'"
          data-testid="integration-flow-debug-tab-output"
          @click="activeTab = 'output'"
        >
          {{ t('integrationFlowStudio.debugTabOutput') }}
        </button>
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="activeTab === 'metadata' ? 'bg-slate-800 text-brand-300' : 'text-slate-400 hover:text-slate-200'"
          data-testid="integration-flow-debug-tab-metadata"
          @click="activeTab = 'metadata'"
        >
          {{ t('integrationFlowStudio.debugTabMetadata') }}
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <template v-if="isMappingNode && activeTab !== 'metadata' && inputPreview != null && outputPreview != null">
          <div
            class="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden bg-slate-700/50"
            data-testid="integration-flow-debug-mapping-compare"
          >
            <div class="flex min-h-0 flex-col overflow-hidden bg-slate-950/80 p-2">
              <div class="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                {{ t('integrationFlowStudio.debugBefore') }}
              </div>
              <pre class="min-h-0 flex-1 overflow-auto text-[10px] text-slate-300">{{ formatPreviewJson(inputPreview) }}</pre>
            </div>
            <div class="flex min-h-0 flex-col overflow-hidden bg-slate-950/80 p-2">
              <div class="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                {{ t('integrationFlowStudio.debugAfter') }}
              </div>
              <pre class="min-h-0 flex-1 overflow-auto text-[10px] text-slate-300">{{ formatPreviewJson(outputPreview) }}</pre>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            v-if="activeTab !== 'metadata'"
            class="flex shrink-0 flex-wrap gap-2 px-3 py-2"
            data-testid="integration-flow-debug-preview-stats"
          >
            <span
              v-if="activeMeta.truncated || isPreviewTruncated(activePayload)"
              class="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200"
              data-testid="integration-flow-debug-truncation-badge"
            >
              {{ t('integrationFlowStudio.debugTruncated') }}
            </span>
            <span v-if="activeMeta.fieldCount != null" class="text-[10px] text-slate-500">
              {{ t('integrationFlowStudio.debugFieldCount', { n: activeMeta.fieldCount }) }}
            </span>
            <span v-if="activeMeta.rowCount != null" class="text-[10px] text-slate-500">
              {{ t('integrationFlowStudio.debugRowEstimate', { n: activeMeta.rowCount }) }}
            </span>
            <span class="text-[10px] text-slate-500">
              {{ t('integrationFlowStudio.debugSizeEstimate', { size: formatBytes(activeMeta.originalBytes ?? estimatePayloadBytes(activePayload)) }) }}
            </span>
          </div>

          <div v-if="activeTab === 'metadata'" class="flex-1 overflow-auto p-3 text-xs text-slate-300">
            <dl class="space-y-2">
              <div>
                <dt class="text-slate-500">{{ t('integrationFlowStudio.stepNode') }}</dt>
                <dd class="font-mono">{{ selectedNodeId }}</dd>
              </div>
              <div>
                <dt class="text-slate-500">{{ t('integrationFlowStudio.stepType') }}</dt>
                <dd>{{ nodeType }}</dd>
              </div>
              <div v-if="step">
                <div>
                  <dt class="text-slate-500">{{ t('integrationFlowStudio.stepStatus') }}</dt>
                  <dd>{{ step.status }}</dd>
                </div>
                <div v-if="step.startedAt">
                  <dt class="text-slate-500">startedAt</dt>
                  <dd>{{ step.startedAt }}</dd>
                </div>
                <div v-if="step.finishedAt">
                  <dt class="text-slate-500">finishedAt</dt>
                  <dd>{{ step.finishedAt }}</dd>
                </div>
              </div>
              <template v-if="selectedRun">
                <div v-if="selectedRun.retryAttempt != null">
                  <dt class="text-slate-500">retryAttempt</dt>
                  <dd>{{ selectedRun.retryAttempt }}</dd>
                </div>
                <div v-if="selectedRun.retryStatus">
                  <dt class="text-slate-500">retryStatus</dt>
                  <dd>{{ selectedRun.retryStatus }}</dd>
                </div>
                <div v-if="selectedRun.nextRetryAt">
                  <dt class="text-slate-500">nextRetryAt</dt>
                  <dd>{{ selectedRun.nextRetryAt }}</dd>
                </div>
              </template>
              <div v-if="inputMeta.truncated || outputMeta.truncated">
                <dt class="text-slate-500">{{ t('integrationFlowStudio.debugPreviewMeta') }}</dt>
                <dd class="text-amber-200/90">{{ t('integrationFlowStudio.debugTruncatedHint') }}</dd>
              </div>
            </dl>
          </div>

          <div v-else-if="pinnedPayload != null && activePayload == null" class="flex-1 overflow-auto p-3">
            <p class="mb-2 text-xs text-indigo-200">{{ t('integrationFlowStudio.debugShowingPinned') }}</p>
            <IntegrationFlowPayloadTree :value="pinnedPayload" />
          </div>

          <div v-else-if="!hasPreviewData && !step" class="flex-1 p-4 text-sm text-slate-500">
            {{ t('integrationFlowStudio.debugNoStepData') }}
          </div>

          <div v-else-if="activePayload == null" class="flex-1 p-4 text-sm text-slate-500">
            {{ t('integrationFlowStudio.debugNoPreview') }}
          </div>

          <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div class="flex shrink-0 items-center gap-2 px-3 pb-1">
              <button
                type="button"
                class="text-[10px] text-slate-500 hover:text-slate-300"
                :class="viewMode === 'tree' ? 'text-brand-300' : ''"
                @click="viewMode = 'tree'"
              >
                {{ t('integrationFlowStudio.debugViewTree') }}
              </button>
              <button
                type="button"
                class="text-[10px] text-slate-500 hover:text-slate-300"
                :class="viewMode === 'json' ? 'text-brand-300' : ''"
                @click="viewMode = 'json'"
              >
                {{ t('integrationFlowStudio.debugViewJson') }}
              </button>
            </div>
            <div
              v-if="tableRows && viewMode === 'tree'"
              class="mx-3 mb-2 max-h-40 overflow-auto rounded border border-slate-700/80"
              data-testid="integration-flow-debug-table-preview"
            >
              <table class="min-w-full text-left text-[10px]">
                <thead class="bg-slate-800/80 text-slate-400">
                  <tr>
                    <th v-for="col in tableColumns" :key="col" class="px-2 py-1 font-medium">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in tableRows" :key="ri" class="border-t border-slate-800">
                    <td v-for="col in tableColumns" :key="col" class="px-2 py-1 text-slate-200">
                      {{ formatCell(row[col]) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="min-h-0 flex-1 overflow-auto px-3 pb-3" data-testid="integration-flow-debug-payload-body">
              <IntegrationFlowPayloadTree v-if="viewMode === 'tree'" :value="activePayload" />
              <pre v-else class="text-[10px] text-slate-300">{{ formatPreviewJson(activePayload) }}</pre>
            </div>
          </div>
        </template>
      </div>

      <footer class="flex shrink-0 flex-wrap gap-2 border-t border-slate-700/80 px-3 py-2">
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          data-testid="integration-flow-debug-copy"
          @click="onCopy"
        >
          {{ copyOk ? t('integrationFlowStudio.debugCopied') : t('integrationFlowStudio.debugCopy') }}
        </button>
        <button
          v-if="activeTab === 'input' && (inputPreview != null || step?.inputJson != null)"
          type="button"
          class="rounded-md border border-indigo-500/50 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-500/10"
          data-testid="integration-flow-debug-pin"
          @click="onPinFromInput"
        >
          {{ t('integrationFlowStudio.debugPinPayload') }}
        </button>
        <span class="ml-auto text-[10px] text-slate-600">{{ t('integrationFlowStudio.debugShortcut') }}</span>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.iff-debug-panel {
  width: min(420px, 100vw);
}
</style>
