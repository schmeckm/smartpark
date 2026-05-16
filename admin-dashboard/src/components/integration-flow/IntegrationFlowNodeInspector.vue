<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  IntegrationFlowRunDto,
  IntegrationFlowRunStepDto,
  IntegrationNodeRegistryEntryDto,
} from '@/api/client'
import IntegrationFlowPayloadTree from '@/components/integration-flow/IntegrationFlowPayloadTree.vue'
import { applyPayloadTransformMappings } from '@/utils/jsonPath'
import { formatPreviewJson, isPreviewTruncated } from '@/utils/integrationFlowPreviewDisplay'
import { resolvePaletteCategory } from '@/utils/integrationFlowPaletteCategories'
import type { NodeConfigFormField } from '@/composables/useIntegrationFlowNodeConfigForm'

const props = defineProps<{
  selectedNodeId: string
  selectedNodeType: string
  registryEntry: IntegrationNodeRegistryEntryDto | null
  schemaFields: NodeConfigFormField[]
  canManage: boolean
  nodeConfigPanelErrors: string[]
  unknownNodeTypeWarning: string | null
  missingConfigSchemaWarning: string | null
  noConfigurableFieldsHint: string | null
  hasUnsupportedSchemaFields: boolean
  runDetail: IntegrationFlowRunDto | null
  step: IntegrationFlowRunStepDto | null
  validationErrorsForNode: string[]
  scriptNodeEnabled: boolean
  pinnedPayload: unknown | null
  samplePayloadText: string
  getConfigValue: (key: string) => unknown
  nodeConfigStringValue: (key: string) => string
  nodeConfigNumberDisplay: (key: string) => string
  jsonDraftValue: (key: string) => string
}>()

const emit = defineEmits<{
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
const previewTab = ref<'input' | 'output' | 'sample'>('input')

const isPayloadTransform = computed(() => props.selectedNodeType === 'PAYLOAD_TRANSFORM')
const transformMode = computed(() => String(props.getConfigValue('mode') || 'mapping'))

const mappingRows = computed(() => {
  const m = props.getConfigValue('mappings')
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [] as { key: string; path: string }[]
  return Object.entries(m as Record<string, string>).map(([key, path]) => ({
    key,
    path: String(path ?? ''),
  }))
})

const sampleRoot = computed(() => {
  try {
    return JSON.parse(props.samplePayloadText || '{}') as unknown
  } catch {
    return null
  }
})

const localOutputPreview = computed(() => {
  if (!isPayloadTransform.value || transformMode.value !== 'mapping' || !sampleRoot.value) return null
  const m = props.getConfigValue('mappings')
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  return applyPayloadTransformMappings(m as Record<string, string>, sampleRoot.value)
})

const inputPreview = computed(() => props.step?.previewInputJson ?? null)
const outputPreview = computed(() => props.step?.previewOutputJson ?? null)

const activePreview = computed(() => {
  if (previewTab.value === 'output') return outputPreview.value
  if (previewTab.value === 'sample') return sampleRoot.value
  return inputPreview.value ?? props.pinnedPayload
})

watch(
  () => props.selectedNodeId,
  () => {
    previewTab.value = 'input'
  }
)

function patchMappings(m: Record<string, string>) {
  emit('patch-config-key', 'mappings', m)
}

function addMappingRow() {
  const m = { ...((props.getConfigValue('mappings') as Record<string, string>) || {}) }
  let i = 1
  while (m[`field_${i}`] != null) i += 1
  m[`field_${i}`] = '$.'
  patchMappings(m)
}

function updateMappingRow(key: string, path: string) {
  const m = { ...((props.getConfigValue('mappings') as Record<string, string>) || {}) }
  m[key] = path
  patchMappings(m)
}

function removeMappingRow(key: string) {
  const m = { ...((props.getConfigValue('mappings') as Record<string, string>) || {}) }
  delete m[key]
  patchMappings(m)
}
</script>

<template>
  <aside
    class="iff-inspector flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/80"
    data-testid="integration-flow-node-inspector"
  >
    <header class="shrink-0 border-b border-slate-700/80 px-3 py-3">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {{ t('integrationFlowDesigner.inspectorTitle') }}
      </h2>
      <p v-if="!selectedNodeId" class="mt-1 text-sm text-slate-500">{{ t('integrationFlowDesigner.inspectorEmpty') }}</p>
      <template v-else>
        <p class="mt-1 font-mono text-sm text-slate-100">{{ selectedNodeId }}</p>
        <p class="text-xs text-slate-400">
          {{ registryEntry?.displayName || selectedNodeType }}
          <span v-if="registryEntry" class="text-slate-600">
            · {{ resolvePaletteCategory(registryEntry.category, registryEntry.nodeType) }}
          </span>
        </p>
      </template>
    </header>

    <div v-if="selectedNodeId" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div v-if="validationErrorsForNode.length" class="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2">
        <ul class="list-inside list-disc text-xs text-red-200">
          <li v-for="(err, i) in validationErrorsForNode" :key="`ve-${i}`">{{ err }}</li>
        </ul>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <section v-if="isPayloadTransform" data-testid="integration-flow-transform-inspector">
          <h3 class="text-xs font-semibold text-slate-300">{{ t('integrationFlowDesigner.transformTitle') }}</h3>
          <label class="mt-2 block text-xs text-slate-500">{{ t('integrationFlowDesigner.transformMode') }}</label>
          <select
            class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
            :value="transformMode"
            :disabled="!canManage"
            data-testid="integration-flow-transform-mode"
            @change="emit('set-string', 'mode', ($event.target as HTMLSelectElement).value)"
          >
            <option value="mapping">{{ t('integrationFlowDesigner.transformModeMapping') }}</option>
            <option value="script">{{ t('integrationFlowDesigner.transformModeScript') }}</option>
          </select>

          <template v-if="transformMode === 'mapping'">
            <div class="mt-3 space-y-2" data-testid="integration-flow-transform-mappings">
              <div
                v-for="row in mappingRows"
                :key="row.key"
                class="grid grid-cols-[1fr_1.2fr_auto] gap-1"
              >
                <input
                  :value="row.key"
                  class="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs"
                  :disabled="!canManage"
                  @change="updateMappingRow(($event.target as HTMLInputElement).value, row.path); removeMappingRow(row.key)"
                />
                <input
                  :value="row.path"
                  class="rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs"
                  :disabled="!canManage"
                  placeholder="$.field"
                  @change="updateMappingRow(row.key, ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="text-xs text-red-400"
                  :disabled="!canManage"
                  @click="removeMappingRow(row.key)"
                >
                  ×
                </button>
              </div>
              <button
                type="button"
                class="text-xs text-brand-400"
                :disabled="!canManage"
                @click="addMappingRow"
              >
                {{ t('integrationFlowDesigner.addMappingField') }}
              </button>
            </div>
          </template>

          <template v-else>
            <p
              v-if="!scriptNodeEnabled"
              class="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-100"
              data-testid="integration-flow-script-governance-warning"
            >
              {{ t('integrationFlowDesigner.scriptDisabledWarning') }}
            </p>
            <textarea
              v-else
              :value="String(getConfigValue('script') ?? '')"
              rows="5"
              class="mt-3 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs"
              :disabled="!canManage"
              data-testid="integration-flow-transform-script"
              @input="emit('set-string', 'script', ($event.target as HTMLTextAreaElement).value)"
            />
          </template>
        </section>

        <section>
          <h3 class="text-xs font-semibold text-slate-300">{{ t('integrationFlowStudio.nodeConfigTitle') }}</h3>
          <div v-if="unknownNodeTypeWarning" class="mt-2 text-xs text-amber-200">{{ unknownNodeTypeWarning }}</div>
          <div v-if="missingConfigSchemaWarning" class="mt-2 text-xs text-amber-200">{{ missingConfigSchemaWarning }}</div>
          <p v-if="noConfigurableFieldsHint" class="mt-2 text-xs text-slate-500">{{ noConfigurableFieldsHint }}</p>
          <ul v-if="nodeConfigPanelErrors.length" class="mt-2 list-inside list-disc text-xs text-red-300">
            <li v-for="(err, i) in nodeConfigPanelErrors" :key="`nc-${i}`">{{ err }}</li>
          </ul>
          <div class="mt-3 space-y-3">
            <div v-for="f in schemaFields" :key="f.key" class="space-y-1">
              <label class="text-xs text-slate-400">{{ f.key }}</label>
              <input
                v-if="f.kind === 'string' && f.key !== 'mappings' && f.key !== 'script' && f.key !== 'mode'"
                type="text"
                :value="nodeConfigStringValue(f.key)"
                :disabled="!canManage"
                class="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                :data-testid="`integration-flow-inspector-field-${f.key}`"
                @input="emit('set-string', f.key, ($event.target as HTMLInputElement).value, f.nullable)"
                @blur="emit('validate')"
              />
              <input
                v-else-if="f.kind === 'number'"
                type="number"
                :value="nodeConfigNumberDisplay(f.key)"
                :disabled="!canManage"
                class="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                @change="emit('set-number', f.key, ($event.target as HTMLInputElement).value, f.minimum, f.maximum)"
              />
              <label v-else-if="f.kind === 'boolean'" class="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  :checked="Boolean(getConfigValue(f.key))"
                  :disabled="!canManage"
                  @change="emit('set-boolean', f.key, ($event.target as HTMLInputElement).checked)"
                />
                {{ f.key }}
              </label>
              <textarea
                v-else-if="(f.kind === 'json-object' || f.kind === 'json-array') && !(isPayloadTransform && f.key === 'mappings')"
                :value="jsonDraftValue(f.key)"
                rows="4"
                spellcheck="false"
                :disabled="!canManage"
                class="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs"
                @input="emit('set-string', f.key, ($event.target as HTMLTextAreaElement).value)"
                @blur="emit('commit-json', f); emit('validate')"
              />
            </div>
          </div>
        </section>

        <section data-testid="integration-flow-inspector-preview">
          <h3 class="text-xs font-semibold text-slate-300">{{ t('integrationFlowDesigner.previewTitle') }}</h3>
          <div class="mt-2 flex gap-1">
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[10px]"
              :class="previewTab === 'input' ? 'bg-slate-700 text-brand-300' : 'text-slate-500'"
              @click="previewTab = 'input'"
            >
              {{ t('integrationFlowStudio.debugTabInput') }}
            </button>
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[10px]"
              :class="previewTab === 'output' ? 'bg-slate-700 text-brand-300' : 'text-slate-500'"
              @click="previewTab = 'output'"
            >
              {{ t('integrationFlowStudio.debugTabOutput') }}
            </button>
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[10px]"
              :class="previewTab === 'sample' ? 'bg-slate-700 text-brand-300' : 'text-slate-500'"
              @click="previewTab = 'sample'"
            >
              {{ t('integrationFlowDesigner.sampleTab') }}
            </button>
          </div>
          <span
            v-if="activePreview && isPreviewTruncated(activePreview)"
            class="mt-2 inline-block rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200"
            data-testid="integration-flow-inspector-truncation-badge"
          >
            {{ t('integrationFlowStudio.debugTruncated') }}
          </span>
          <div v-if="previewTab === 'sample'" class="mt-2 space-y-2">
            <textarea
              :value="samplePayloadText"
              rows="6"
              spellcheck="false"
              class="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-[10px]"
              data-testid="integration-flow-sample-payload-editor"
              @input="emit('update:samplePayloadText', ($event.target as HTMLTextAreaElement).value)"
            />
            <div class="flex gap-2">
              <button type="button" class="text-xs text-indigo-300" data-testid="integration-flow-pin-sample" @click="emit('pin-sample')">
                {{ t('integrationFlowStudio.debugPinPayload') }}
              </button>
              <button v-if="pinnedPayload != null" type="button" class="text-xs text-slate-400" @click="emit('clear-pin')">
                {{ t('integrationFlowStudio.debugClearPin') }}
              </button>
            </div>
            <div v-if="localOutputPreview" class="rounded border border-slate-700/80 bg-slate-950/80 p-2">
              <div class="text-[10px] uppercase text-slate-500">{{ t('integrationFlowDesigner.localOutputPreview') }}</div>
              <pre class="mt-1 max-h-32 overflow-auto text-[10px] text-slate-300">{{ formatPreviewJson(localOutputPreview) }}</pre>
            </div>
          </div>
          <div v-else-if="activePreview" class="mt-2 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-950/80 p-2">
            <IntegrationFlowPayloadTree :value="activePreview" :max-depth="4" />
          </div>
          <p v-else class="mt-2 text-xs text-slate-500">{{ t('integrationFlowDesigner.noPreview') }}</p>
        </section>
      </div>
    </div>
  </aside>
</template>
