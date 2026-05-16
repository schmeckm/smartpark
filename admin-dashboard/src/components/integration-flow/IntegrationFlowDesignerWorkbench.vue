<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  IntegrationFlowJson,
  IntegrationFlowRunDto,
  IntegrationFlowRunStepDto,
  IntegrationFlowTimelineEntryDto,
  IntegrationFlowValidationResult,
  IntegrationNodeRegistryEntryDto,
} from '@/api/client'
import type { NodeConfigFormField } from '@/composables/useIntegrationFlowNodeConfigForm'
import IntegrationFlowNodeDebugPanel from '@/components/integration-flow/IntegrationFlowNodeDebugPanel.vue'
import IntegrationFlowNodeInspector from '@/components/integration-flow/IntegrationFlowNodeInspector.vue'
import IntegrationFlowNodePalette from '@/components/integration-flow/IntegrationFlowNodePalette.vue'
import IntegrationFlowVisualBuilder from '@/components/integration-flow/IntegrationFlowVisualBuilder.vue'
import { parseValidationNodeIds } from '@/utils/integrationFlowValidationNodeIds'

const props = defineProps<{
  flowJson: IntegrationFlowJson
  nodeRegistry: IntegrationNodeRegistryEntryDto[]
  canManage: boolean
  selectedNodeId: string
  selectedNodeType: string
  registryEntry: IntegrationNodeRegistryEntryDto | null
  schemaFields: NodeConfigFormField[]
  nodeConfigPanelErrors: string[]
  unknownNodeTypeWarning: string | null
  missingConfigSchemaWarning: string | null
  noConfigurableFieldsHint: string | null
  hasUnsupportedSchemaFields: boolean
  getConfigValue: (key: string) => unknown
  nodeConfigStringValue: (key: string) => string
  nodeConfigNumberDisplay: (key: string) => string
  jsonDraftValue: (key: string) => string
  runDetail: IntegrationFlowRunDto | null
  runTimeline: IntegrationFlowTimelineEntryDto[]
  validationResult: IntegrationFlowValidationResult | null
  scriptNodeEnabled: boolean
  pinnedPayload: unknown | null
  samplePayloadText: string
  stepForNode: IntegrationFlowRunStepDto | null
  focusNodeId: string | null
}>()

const emit = defineEmits<{
  'update:flowJson': [value: IntegrationFlowJson]
  'select-node': [nodeId: string]
  'open-run-step': [nodeId: string]
  'update:samplePayloadText': [value: string]
  'pin-sample': []
  'clear-pin': []
  'set-string': [key: string, value: string, nullable?: boolean]
  'set-number': [key: string, value: string, min?: number, max?: number]
  'set-boolean': [key: string, value: boolean]
  'commit-json': [field: NodeConfigFormField]
  'patch-config-key': [key: string, value: unknown]
  validate: []
}>()

const { t } = useI18n()
const builderRef = ref<InstanceType<typeof IntegrationFlowVisualBuilder> | null>(null)
const drawerTab = ref<'timeline' | 'debug' | 'validation'>('timeline')
const drawerCollapsed = ref(true)

const visualValidationNodeIds = computed((): string[] => {
  if (!props.validationResult?.errors?.length) return []
  return [...parseValidationNodeIds(props.validationResult.errors)]
})

const validationErrorsForNode = computed(() => {
  const id = props.selectedNodeId
  if (!id || !props.validationResult?.errors?.length) return []
  return props.validationResult.errors.filter((e) => e.includes(id) || e.includes(`node ${id}`))
})

const previewNodeIds = computed(() => {
  const ids: string[] = []
  for (const s of props.runDetail?.steps ?? []) {
    if (s.previewInputJson != null || s.previewOutputJson != null) ids.push(s.nodeId)
  }
  return ids
})

function onPaletteAdd(entry: IntegrationNodeRegistryEntryDto) {
  builderRef.value?.addRegistryNode(entry)
}

defineExpose({ builderRef })
</script>

<template>
  <div
    class="iff-designer flex min-h-0 flex-col gap-2"
    :class="{ 'iff-designer--drawer-collapsed': drawerCollapsed }"
    data-testid="integration-flow-designer-workbench"
  >
    <div class="iff-designer__main grid min-h-0 flex-1 gap-2">
      <IntegrationFlowNodePalette
        :node-registry="nodeRegistry"
        :readonly="!canManage"
        @add-node="onPaletteAdd"
      />
      <IntegrationFlowVisualBuilder
        ref="builderRef"
        vue-flow-id="integration-flow-designer-canvas"
        canvas-height="100%"
        :flow-json="flowJson"
        :node-registry="nodeRegistry"
        :readonly="!canManage"
        :timeline="runTimeline"
        :validation-node-ids="visualValidationNodeIds"
        :selected-node-id="selectedNodeId"
        :preview-node-ids="previewNodeIds"
        :focus-node-id="focusNodeId"
        @update:flow-json="emit('update:flowJson', $event)"
        @select-node="emit('select-node', $event)"
        @open-run-step="emit('open-run-step', $event)"
      />
      <IntegrationFlowNodeInspector
        :selected-node-id="selectedNodeId"
        :selected-node-type="selectedNodeType"
        :registry-entry="registryEntry"
        :schema-fields="schemaFields"
        :can-manage="canManage"
        :node-config-panel-errors="nodeConfigPanelErrors"
        :unknown-node-type-warning="unknownNodeTypeWarning"
        :missing-config-schema-warning="missingConfigSchemaWarning"
        :no-configurable-fields-hint="noConfigurableFieldsHint"
        :has-unsupported-schema-fields="hasUnsupportedSchemaFields"
        :run-detail="runDetail"
        :step="stepForNode"
        :validation-errors-for-node="validationErrorsForNode"
        :script-node-enabled="scriptNodeEnabled"
        :pinned-payload="pinnedPayload"
        :sample-payload-text="samplePayloadText"
        :get-config-value="getConfigValue"
        :node-config-string-value="nodeConfigStringValue"
        :node-config-number-display="nodeConfigNumberDisplay"
        :json-draft-value="jsonDraftValue"
        @update:sample-payload-text="emit('update:samplePayloadText', $event)"
        @pin-sample="emit('pin-sample')"
        @clear-pin="emit('clear-pin')"
        @set-string="(k, v, n) => emit('set-string', k, v, n)"
        @set-number="(k, v, min, max) => emit('set-number', k, v, min, max)"
        @set-boolean="(k, v) => emit('set-boolean', k, v)"
        @commit-json="(f) => emit('commit-json', f)"
        @patch-config-key="(k, v) => emit('patch-config-key', k, v)"
        @validate="emit('validate')"
      />
    </div>

    <div
      class="iff-designer__drawer shrink-0 rounded-lg border border-slate-700/80 bg-slate-900/60"
      data-testid="integration-flow-designer-drawer"
    >
      <div class="flex items-center gap-1 border-b border-slate-700/80 px-2 pt-2">
        <button
          type="button"
          class="mr-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800"
          :aria-expanded="!drawerCollapsed"
          data-testid="integration-flow-designer-drawer-toggle"
          @click="drawerCollapsed = !drawerCollapsed"
        >
          {{ drawerCollapsed ? '▲' : '▼' }}
        </button>
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="drawerTab === 'timeline' ? 'bg-slate-800 text-brand-300' : 'text-slate-400'"
          data-testid="integration-flow-drawer-tab-timeline"
          @click="drawerTab = 'timeline'"
        >
          {{ t('integrationFlowStudio.executionTimeline') }}
        </button>
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="drawerTab === 'debug' ? 'bg-slate-800 text-brand-300' : 'text-slate-400'"
          data-testid="integration-flow-drawer-tab-debug"
          @click="drawerTab = 'debug'"
        >
          {{ t('integrationFlowStudio.debugTitle') }}
        </button>
        <button
          type="button"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="drawerTab === 'validation' ? 'bg-slate-800 text-brand-300' : 'text-slate-400'"
          data-testid="integration-flow-drawer-tab-validation"
          @click="drawerTab = 'validation'"
        >
          {{ t('integrationFlowStudio.validationTitle') }}
        </button>
      </div>
      <div v-show="!drawerCollapsed" class="iff-designer__drawer-body overflow-auto p-3">
        <slot v-if="drawerTab === 'timeline'" name="timeline" />
        <IntegrationFlowNodeDebugPanel
          v-else-if="drawerTab === 'debug'"
          class="!w-full !max-w-none !border-0 !shadow-none"
          :selected-node-id="selectedNodeId || null"
          :selected-run="runDetail"
          :timeline="runTimeline"
          :flow-id="runDetail?.flowId ?? null"
          :pinned-payload="pinnedPayload"
          @pin-payload="emit('pin-sample')"
          @clear-pinned="emit('clear-pin')"
          @close="drawerTab = 'timeline'"
        />
        <slot v-else name="validation" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.iff-designer {
  --iff-designer-canvas-h: max(36rem, calc(100vh - 13rem));
  min-height: var(--iff-designer-canvas-h);
}
.iff-designer__main {
  grid-template-columns: minmax(11rem, 13.5rem) minmax(0, 1fr) minmax(16rem, 20rem);
  height: var(--iff-designer-canvas-h);
  min-height: 36rem;
}
.iff-designer__drawer-body {
  max-height: min(14rem, 28vh);
}
.iff-designer--drawer-collapsed {
  --iff-designer-canvas-h: max(40rem, calc(100vh - 11rem));
}
.iff-designer--drawer-collapsed .iff-designer__main {
  min-height: 40rem;
}
@media (min-width: 1280px) {
  .iff-designer {
    --iff-designer-canvas-h: max(42rem, calc(100vh - 11.5rem));
  }
}
</style>
