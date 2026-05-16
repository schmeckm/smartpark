<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ApiRequestError,
  createIntegrationFlow,
  createIntegrationFlowFromTemplate,
  deleteIntegrationFlow,
  getIntegrationFlow,
  getIntegrationFlowRun,
  listIntegrationFlowNodes,
  listIntegrationFlowRuns,
  listIntegrationFlows,
  INTEGRATION_FLOW_RETRY_DELAY_SECONDS,
  INTEGRATION_FLOW_SCHEDULE_INTERVAL_SECONDS,
  getIntegrationFeatureFlags,
  listIntegrationFlowTemplates,
  patchIntegrationFlow,
  postIntegrationFlowRunRetry,
  recalculateIntegrationFlowSchedule,
  runIntegrationFlow,
  validateIntegrationFlow,
  type IntegrationFlowDefinitionDto,
  type IntegrationFlowJson,
  type IntegrationFlowRunDto,
  type IntegrationFlowRunStepDto,
  type IntegrationFlowRunSummaryDto,
  type IntegrationFlowTemplateDto,
  type IntegrationFlowTimelineEntryDto,
  type IntegrationFlowValidationResult,
  type IntegrationNodeRegistryEntryDto,
} from '@/api/client'
import { askConfirm } from '@/composables/useConfirmDialog'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useIntegrationFlowNodeConfigForm } from '@/composables/useIntegrationFlowNodeConfigForm'
import IntegrationFlowFailuresPanel from '@/components/operations/IntegrationFlowFailuresPanel.vue'
import IntegrationFlowDesignerWorkbench from '@/components/integration-flow/IntegrationFlowDesignerWorkbench.vue'
import IntegrationFlowVisualBuilder from '@/components/integration-flow/IntegrationFlowVisualBuilder.vue'
import { useIntegrationFlowPinnedPayload } from '@/composables/useIntegrationFlowPinnedPayload'

const { t } = useI18n()
const auth = useAuthStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const canRead = computed(() => auth.hasPermission('integrations', 'read'))
const canManage = computed(() => auth.hasPermission('integrations', 'manage'))

const engineAvailable = ref(true)
const initialLoadDone = ref(false)

const flows = ref<IntegrationFlowDefinitionDto[]>([])
const flowsLoading = ref(false)

const nodes = ref<IntegrationNodeRegistryEntryDto[]>([])
const nodesLoading = ref(false)

const selectedFlowId = ref<string | null>(null)
const detailLoading = ref(false)

const editorName = ref('')
const editorDescription = ref('')
const editorEnabled = ref(false)
const editorTriggerType = ref('MANUAL')
const editorFlowJsonText = ref('')
const flowJsonError = ref<string | null>(null)
const flowJsonEditorTab = ref<'json' | 'visual'>('json')
const visualBuilderRef = ref<InstanceType<typeof IntegrationFlowVisualBuilder> | null>(null)
const focusVisualNodeId = ref<string | null>(null)

const editorScheduleEnabled = ref(false)
const editorScheduleIntervalSeconds = ref<number>(300)
const displayLastScheduledRunAt = ref<string | null>(null)
const displayNextScheduledRunAt = ref<string | null>(null)
const displayScheduleLockUntil = ref<string | null>(null)
const scheduleRecalculateLoading = ref(false)

const editorRetryEnabled = ref(false)
const editorMaxRetryAttempts = ref(0)
const editorRetryDelaySeconds = ref<number>(300)
const editorRetryNodeTypes = ref<string[]>([])
const runRetryNowLoading = ref(false)

const validationResult = ref<IntegrationFlowValidationResult | null>(null)
const validationLoading = ref(false)

const runInputText = ref('{}')
const runSummary = ref<IntegrationFlowRunSummaryDto | null>(null)
const runLoading = ref(false)

const runs = ref<IntegrationFlowRunDto[]>([])
const runsLoading = ref(false)

const selectedRunId = ref<string | null>(null)
const runDetail = ref<IntegrationFlowRunDto | null>(null)
const runDetailLoading = ref(false)

const selectedStep = ref<IntegrationFlowRunStepDto | null>(null)
const debugPanelOpen = ref(false)
const scriptNodeEnabled = ref(false)
const samplePayloadText = ref('{}')
const designerWorkbenchRef = ref<InstanceType<typeof IntegrationFlowDesignerWorkbench> | null>(null)

const templates = ref<IntegrationFlowTemplateDto[]>([])
const templatesLoading = ref(false)
const selectedTemplateKey = ref('')
const templateFlowName = ref('')
const fromTemplateLoading = ref(false)

/** Default “blank” flow: same shape as `manual_canonical_test_flow` (editable). */
const DEFAULT_FLOW_JSON: IntegrationFlowJson = {
  nodes: [
    { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
    {
      id: 'map_1',
      type: 'CANONICAL_MAPPING',
      config: {
        eventType: 'QUEUE_TIME_OBSERVED',
        provider: 'integration_flow_test',
        externalParkId: 'test-park',
        mappings: {
          externalEntityId: '$.id',
          name: '$.name',
          value: '$.value',
          status: '$.status',
          sampledAt: '$.sampledAt',
          entityType: 'ATTRACTION',
        },
      },
    },
    { id: 'apply_1', type: 'CANONICAL_APPLY', config: { autoApply: true } },
  ],
  edges: [
    { source: 'trigger_1', target: 'map_1' },
    { source: 'map_1', target: 'apply_1' },
  ],
}

const selectedTemplateMeta = computed(() =>
  templates.value.find((x) => x.templateKey === selectedTemplateKey.value) ?? null
)

const {
  selectedNodeIdForConfig,
  flowNodesFromJson,
  selectedNodeInFlow,
  schemaFields,
  unknownNodeTypeWarning,
  missingConfigSchemaWarning,
  noConfigurableFieldsHint,
  hasUnsupportedSchemaFields,
  jsonDrafts,
  nodeConfigPanelErrors,
  panelVisible: nodeConfigPanelVisible,
  draftKey,
  setStringField,
  setNumberField,
  setBooleanField,
  commitJsonField,
  validatePanel,
  getConfigValue,
  nodeConfigStringValue,
  nodeConfigNumberDisplay,
} = useIntegrationFlowNodeConfigForm({
  editorFlowJsonText,
  nodes,
  selectedFlowId,
  flowJsonError,
  detailLoading,
  canRead,
  t,
})

const flowIdForPin = computed(() => selectedFlowId.value)
const { getPinned, setPinned, clearPinned, revision: pinnedRevision } =
  useIntegrationFlowPinnedPayload(flowIdForPin)

const pinnedPayloadForSelectedNode = computed(() => {
  void pinnedRevision.value
  const nodeId = selectedNodeIdForConfig.value?.trim()
  if (!nodeId) return null
  return getPinned(nodeId)
})

const scheduleIntervalOptions = computed(() =>
  INTEGRATION_FLOW_SCHEDULE_INTERVAL_SECONDS.map((sec) => ({
    sec,
    labelKey: `integrationFlowStudio.scheduleSec_${sec}` as const,
  }))
)

const retryDelayOptions = computed(() =>
  INTEGRATION_FLOW_RETRY_DELAY_SECONDS.map((sec) => ({
    sec,
    labelKey: `integrationFlowStudio.retrySec_${sec}` as const,
  }))
)

const retryMaxAttemptChoices = [0, 1, 2, 3]

const catalogNodeTypes = computed(() => {
  const s = new Set<string>()
  for (const n of nodes.value) {
    if (n.nodeType) s.add(n.nodeType)
  }
  return [...s].sort()
})

const canRetrySelectedRunNow = computed(() => {
  const d = runDetail.value
  if (!d || d.status !== 'failed' || !canManage.value) return false
  if (!editorEnabled.value || !editorRetryEnabled.value) return false
  const max = Number(editorMaxRetryAttempts.value || 0)
  if (max <= 0) return false
  const attempt = Number(d.retryAttempt ?? 0)
  return attempt < max
})

const selectedRegistryEntry = computed(() => {
  const n = selectedNodeInFlow.value
  if (!n?.type) return null
  return nodes.value.find((r) => r.nodeKey === n.type) ?? null
})

const stepForSelectedNode = computed((): IntegrationFlowRunStepDto | null => {
  const id = selectedNodeIdForConfig.value?.trim()
  if (!id || !runDetail.value?.steps) return null
  return runDetail.value.steps.find((s) => s.nodeId === id) ?? null
})

const runTimeline = computed((): IntegrationFlowTimelineEntryDto[] => {
  const d = runDetail.value
  if (!d) return []
  if (Array.isArray(d.timeline) && d.timeline.length) return d.timeline
  const steps = d.steps || []
  return steps.map((s) => ({
    nodeId: s.nodeId,
    nodeType: s.nodeType,
    status: s.status,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    durationMs: s.durationMs ?? null,
    errorMessage: s.errorMessage ?? null,
  }))
})

const parsedFlowJsonForVisual = computed((): IntegrationFlowJson | null => {
  try {
    const parsed = JSON.parse(editorFlowJsonText.value) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as IntegrationFlowJson
    if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null
    return p
  } catch {
    return null
  }
})

const isDesignerTab = computed(() => flowJsonEditorTab.value === 'visual')

const runVisualFlowJson = computed((): IntegrationFlowJson | null => {
  const d = runDetail.value
  if (!d?.flowId || !selectedFlowId.value || d.flowId !== selectedFlowId.value) return null
  return parsedFlowJsonForVisual.value
})

function timelineDotClass(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'success') return 'bg-emerald-500'
  if (s === 'failed') return 'bg-red-500'
  if (s === 'running') return 'bg-amber-400 animate-pulse'
  if (s === 'skipped') return 'bg-slate-500'
  return 'bg-slate-400'
}

function onTimelineSelect(index: number) {
  const steps = runDetail.value?.steps
  if (steps && steps[index]) {
    selectedStep.value = steps[index]!
    selectedNodeIdForConfig.value = steps[index]!.nodeId
    if (selectedRunId.value) debugPanelOpen.value = true
  }
}

function timelineRowSelected(index: number) {
  const steps = runDetail.value?.steps
  return Boolean(selectedStep.value && steps?.[index]?.id === selectedStep.value.id)
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

function parseFlowJson(): IntegrationFlowJson | null {
  flowJsonError.value = null
  try {
    const parsed = JSON.parse(editorFlowJsonText.value) as IntegrationFlowJson
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      flowJsonError.value = t('integrationFlowStudio.flowJsonInvalidShape')
      return null
    }
    return parsed
  } catch (e) {
    flowJsonError.value = e instanceof Error ? e.message : t('integrationFlowStudio.flowJsonParseError')
    return null
  }
}

function onVisualFlowJsonUpdate(fj: IntegrationFlowJson) {
  editorFlowJsonText.value = formatJson(fj)
  flowJsonError.value = null
}

function onVisualSelectNode(nodeId: string) {
  selectedNodeIdForConfig.value = nodeId
  selectRunStepByNodeId(nodeId)
  if (selectedRunId.value) debugPanelOpen.value = true
}

function selectRunStepByNodeId(nodeId: string) {
  const steps = runDetail.value?.steps
  if (!steps?.length) return
  const step = steps.find((s) => s.nodeId === nodeId)
  if (step) selectedStep.value = step
}

async function showNodeInVisualGraph(nodeId: string) {
  if (!parsedFlowJsonForVisual.value) return
  flowJsonEditorTab.value = 'visual'
  selectedNodeIdForConfig.value = nodeId
  focusVisualNodeId.value = nodeId
  selectRunStepByNodeId(nodeId)
  await nextTick()
  await visualBuilderRef.value?.focusNode(nodeId)
}

function onVisualOpenRunStep(nodeId: string) {
  selectRunStepByNodeId(nodeId)
  debugPanelOpen.value = true
  if (flowJsonEditorTab.value !== 'visual') {
    void showNodeInVisualGraph(nodeId)
  } else {
    focusVisualNodeId.value = nodeId
    selectedNodeIdForConfig.value = nodeId
    void visualBuilderRef.value?.focusNode(nodeId)
  }
}

function onPinDebugPayload(payload: unknown) {
  const nodeId = selectedNodeIdForConfig.value?.trim()
  if (!nodeId) return
  setPinned(nodeId, payload)
  try {
    samplePayloadText.value = JSON.stringify(payload, null, 2)
  } catch {
    samplePayloadText.value = '{}'
  }
}

function onPatchConfigKey(key: string, value: unknown) {
  const fj = parseFlowJson()
  const nodeId = selectedNodeIdForConfig.value?.trim()
  if (!fj || !nodeId) return
  const nodesList = fj.nodes.map((n) =>
    n.id === nodeId ? { ...n, config: { ...(n.config || {}), [key]: value } } : n
  )
  editorFlowJsonText.value = formatJson({ ...fj, nodes: nodesList })
  flowJsonError.value = null
}

function syncSampleFromStepOrPin() {
  const step = stepForSelectedNode.value
  const pinned = pinnedPayloadForSelectedNode.value
  const src = step?.previewInputJson ?? step?.inputJson ?? pinned
  if (src == null) {
    samplePayloadText.value = '{}'
    return
  }
  try {
    samplePayloadText.value = JSON.stringify(src, null, 2)
  } catch {
    samplePayloadText.value = '{}'
  }
}

function onClearPinnedPayload() {
  const nodeId = selectedNodeIdForConfig.value?.trim()
  if (!nodeId) return
  clearPinned(nodeId)
}

function onDebugKeydown(ev: KeyboardEvent) {
  if (ev.key !== 'd' && ev.key !== 'D') return
  const target = ev.target as HTMLElement | null
  if (!target) return
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
  ev.preventDefault()
  debugPanelOpen.value = !debugPanelOpen.value
}

watch(flowJsonEditorTab, async (tab) => {
  if (tab === 'visual') {
    await nextTick()
    await designerWorkbenchRef.value?.builderRef?.fitViewAll?.()
  }
  if (tab !== 'visual' || !focusVisualNodeId.value) return
  await nextTick()
  await visualBuilderRef.value?.focusNode(focusVisualNodeId.value)
  await designerWorkbenchRef.value?.builderRef?.focusNode(focusVisualNodeId.value)
})

watch([selectedNodeIdForConfig, stepForSelectedNode, pinnedPayloadForSelectedNode], () => {
  syncSampleFromStepOrPin()
})

function resetRunPanels() {
  validationResult.value = null
  runSummary.value = null
  selectedRunId.value = null
  runDetail.value = null
  selectedStep.value = null
  runs.value = []
}

function clearSelection() {
  selectedFlowId.value = null
  editorName.value = ''
  editorDescription.value = ''
  editorEnabled.value = false
  editorTriggerType.value = 'MANUAL'
  editorFlowJsonText.value = formatJson(DEFAULT_FLOW_JSON)
  flowJsonError.value = null
  editorScheduleEnabled.value = false
  editorScheduleIntervalSeconds.value = INTEGRATION_FLOW_SCHEDULE_INTERVAL_SECONDS[1] ?? 300
  displayLastScheduledRunAt.value = null
  displayNextScheduledRunAt.value = null
  displayScheduleLockUntil.value = null
  editorRetryEnabled.value = false
  editorMaxRetryAttempts.value = 0
  editorRetryDelaySeconds.value = 300
  editorRetryNodeTypes.value = []
  resetRunPanels()
}

async function applyFlowToEditor(flow: IntegrationFlowDefinitionDto) {
  editorName.value = flow.name
  editorDescription.value = flow.description ?? ''
  editorEnabled.value = flow.enabled
  editorTriggerType.value = flow.triggerType || 'MANUAL'
  editorFlowJsonText.value = formatJson(flow.flowJson)
  flowJsonError.value = null
  editorScheduleEnabled.value = flow.scheduleEnabled === true
  editorScheduleIntervalSeconds.value =
    flow.scheduleIntervalSeconds != null
      ? Number(flow.scheduleIntervalSeconds)
      : INTEGRATION_FLOW_SCHEDULE_INTERVAL_SECONDS[1] ?? 300
  displayLastScheduledRunAt.value = flow.lastScheduledRunAt ?? null
  displayNextScheduledRunAt.value = flow.nextScheduledRunAt ?? null
  displayScheduleLockUntil.value = flow.scheduleLockUntil ?? null
  editorRetryEnabled.value = flow.retryEnabled === true
  if (flow.maxRetryAttempts != null) {
    editorMaxRetryAttempts.value = Number(flow.maxRetryAttempts)
  } else {
    editorMaxRetryAttempts.value = flow.retryEnabled === true ? 1 : 0
  }
  editorRetryDelaySeconds.value =
    flow.retryDelaySeconds != null ? Number(flow.retryDelaySeconds) : INTEGRATION_FLOW_RETRY_DELAY_SECONDS[1] ?? 300
  editorRetryNodeTypes.value = Array.isArray(flow.retryOnNodeTypes) ? [...flow.retryOnNodeTypes] : []
}

async function loadRuns(flowId: string) {
  runsLoading.value = true
  try {
    runs.value = await listIntegrationFlowRuns(flowId, { limit: 50 })
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowStudio.loadRunsError'), 'error')
    }
    runs.value = []
  } finally {
    runsLoading.value = false
  }
}

async function probeAndLoad() {
  if (!canRead.value) return

  flowsLoading.value = true
  engineAvailable.value = true
  try {
    flows.value = await listIntegrationFlows()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
      flows.value = []
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowStudio.loadFlowsError'), 'error')
      flows.value = []
    }
  } finally {
    flowsLoading.value = false
    initialLoadDone.value = true
  }

  if (!engineAvailable.value) {
    nodes.value = []
    return
  }

  try {
    const flags = await getIntegrationFeatureFlags()
    scriptNodeEnabled.value = Boolean(flags.integrationFlowScriptNodeEnabled)
  } catch {
    scriptNodeEnabled.value = false
  }

  nodesLoading.value = true
  try {
    nodes.value = await listIntegrationFlowNodes()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowStudio.loadNodesError'), 'error')
    }
    nodes.value = []
  } finally {
    nodesLoading.value = false
  }

  await loadTemplates()
}

async function loadTemplates() {
  if (!canRead.value || !engineAvailable.value) {
    templates.value = []
    return
  }
  templatesLoading.value = true
  try {
    templates.value = await listIntegrationFlowTemplates()
    if (templates.value.length && !selectedTemplateKey.value) {
      selectedTemplateKey.value = templates.value[0]!.templateKey
    }
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowStudio.loadTemplatesError'), 'error')
    }
    templates.value = []
  } finally {
    templatesLoading.value = false
  }
}

async function selectFlow(id: string) {
  selectedFlowId.value = id
  resetRunPanels()
  detailLoading.value = true
  try {
    const flow = await getIntegrationFlow(id)
    await applyFlowToEditor(flow)
    await loadRuns(id)
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowStudio.loadFlowError'), 'error')
      clearSelection()
    }
  } finally {
    detailLoading.value = false
  }
}

async function refreshAll() {
  const keepId = selectedFlowId.value
  await probeAndLoad()
  if (keepId && flows.value.some((f) => f.id === keepId)) {
    await selectFlow(keepId)
  } else if (keepId) {
    clearSelection()
  }
}

async function saveFlow() {
  if (!selectedFlowId.value || !canManage.value) return
  if (!editorName.value.trim()) {
    push(t('integrationFlowStudio.nameRequired'), 'error')
    return
  }
  const fj = parseFlowJson()
  if (!fj) return
  try {
    await patchIntegrationFlow(selectedFlowId.value, {
      name: editorName.value.trim(),
      description: editorDescription.value.trim() || null,
      enabled: editorEnabled.value,
      triggerType: editorTriggerType.value.trim(),
      flowJson: fj,
      scheduleEnabled: editorScheduleEnabled.value,
      scheduleIntervalSeconds: editorScheduleEnabled.value ? editorScheduleIntervalSeconds.value : null,
      retryEnabled: editorRetryEnabled.value,
      maxRetryAttempts: editorRetryEnabled.value ? editorMaxRetryAttempts.value : 0,
      retryDelaySeconds: editorRetryEnabled.value ? editorRetryDelaySeconds.value : null,
      retryOnNodeTypes:
        editorRetryEnabled.value && editorRetryNodeTypes.value.length ? [...editorRetryNodeTypes.value] : null,
    })
    push(t('integrationFlowStudio.saved'), 'success')
    await refreshAll()
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.saveError'), 'error')
  }
}

async function onRecalculateSchedule() {
  if (!selectedFlowId.value || !canManage.value || !engineAvailable.value) return
  scheduleRecalculateLoading.value = true
  try {
    const data = await recalculateIntegrationFlowSchedule(selectedFlowId.value)
    await applyFlowToEditor(data)
    push(t('integrationFlowStudio.scheduleRecalculated'), 'success')
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      engineAvailable.value = false
    }
    push(e instanceof Error ? e.message : t('integrationFlowStudio.scheduleRecalculateError'), 'error')
  } finally {
    scheduleRecalculateLoading.value = false
  }
}

async function onCreateFlow() {
  if (!canManage.value || !engineAvailable.value) return
  try {
    const created = await createIntegrationFlow({
      name: t('integrationFlowStudio.newFlowName'),
      description: '',
      enabled: false,
      triggerType: 'MANUAL',
      flowJson: DEFAULT_FLOW_JSON,
    })
    push(t('integrationFlowStudio.created'), 'success')
    await probeAndLoad()
    await selectFlow(created.id)
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.createError'), 'error')
  }
}

async function onCreateFromTemplate() {
  if (!canManage.value || !engineAvailable.value) return
  if (!selectedTemplateKey.value) {
    push(t('integrationFlowStudio.templatePickRequired'), 'error')
    return
  }
  if (!templateFlowName.value.trim()) {
    push(t('integrationFlowStudio.nameRequired'), 'error')
    return
  }
  fromTemplateLoading.value = true
  try {
    const created = await createIntegrationFlowFromTemplate({
      templateKey: selectedTemplateKey.value,
      name: templateFlowName.value.trim(),
      configOverrides: {},
    })
    push(t('integrationFlowStudio.fromTemplateCreated'), 'success')
    templateFlowName.value = ''
    await probeAndLoad()
    await selectFlow(created.id)
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.fromTemplateError'), 'error')
  } finally {
    fromTemplateLoading.value = false
  }
}

async function onDeleteFlow() {
  if (!selectedFlowId.value || !canManage.value) return
  const ok = await askConfirm({
    title: t('integrationFlowStudio.deleteTitle'),
    message: t('integrationFlowStudio.deleteMessage', { name: editorName.value }),
    confirmLabel: t('integrationFlowStudio.deleteConfirm'),
    variant: 'danger',
  })
  if (!ok) return
  try {
    await deleteIntegrationFlow(selectedFlowId.value)
    push(t('integrationFlowStudio.deleted'), 'success')
    clearSelection()
    await probeAndLoad()
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.deleteError'), 'error')
  }
}

async function onValidate() {
  if (!selectedFlowId.value || !canRead.value || !engineAvailable.value) return
  validationLoading.value = true
  validationResult.value = null
  try {
    validationResult.value = await validateIntegrationFlow(selectedFlowId.value)
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.validateError'), 'error')
  } finally {
    validationLoading.value = false
  }
}

async function onRun() {
  if (!selectedFlowId.value || !canManage.value || !engineAvailable.value) return
  let input: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(runInputText.value || '{}') as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      push(t('integrationFlowStudio.runInputInvalid'), 'error')
      return
    }
    input = parsed as Record<string, unknown>
  } catch {
    push(t('integrationFlowStudio.runInputInvalid'), 'error')
    return
  }

  runLoading.value = true
  runSummary.value = null
  try {
    runSummary.value = await runIntegrationFlow(selectedFlowId.value, input)
    push(t('integrationFlowStudio.runStarted'), 'success')
    if (selectedFlowId.value) await loadRuns(selectedFlowId.value)
    if (runSummary.value?.runId) await selectRun(runSummary.value.runId)
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.runError'), 'error')
  } finally {
    runLoading.value = false
  }
}

async function onRetryNow() {
  if (!selectedRunId.value || !runDetail.value || !canManage.value || !engineAvailable.value) return
  runRetryNowLoading.value = true
  try {
    const summary = await postIntegrationFlowRunRetry(selectedRunId.value)
    push(t('integrationFlowStudio.retryNowStarted'), 'success')
    if (selectedFlowId.value) await loadRuns(selectedFlowId.value)
    if (summary?.runId) await selectRun(summary.runId)
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.retryNowError'), 'error')
  } finally {
    runRetryNowLoading.value = false
  }
}

async function selectRun(runId: string) {
  selectedRunId.value = runId
  runDetailLoading.value = true
  selectedStep.value = null
  runDetail.value = null
  try {
    runDetail.value = await getIntegrationFlowRun(runId)
    const steps = runDetail.value.steps
    const failedStep = steps?.find((s) => String(s.status || '').toLowerCase() === 'failed')
    if (failedStep) {
      selectedStep.value = failedStep
      selectedNodeIdForConfig.value = failedStep.nodeId
      debugPanelOpen.value = true
      focusVisualNodeId.value = failedStep.nodeId
    } else {
      selectedStep.value = steps?.length ? steps[0]! : null
      if (selectedStep.value) selectedNodeIdForConfig.value = selectedStep.value.nodeId
    }
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowStudio.loadRunDetailError'), 'error')
  } finally {
    runDetailLoading.value = false
  }
}

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = Date.parse(iso)
  return Number.isNaN(d) ? iso : new Date(d).toLocaleString()
}

async function onInboxOpenRun(payload: { flowId: string | null; runId: string }) {
  if (!payload.flowId) {
    push(t('integrationFlowFailures.missingFlowForRun'), 'error')
    return
  }
  await selectFlow(payload.flowId)
  await selectRun(payload.runId)
}

async function onInboxRunsChanged() {
  if (selectedFlowId.value) await loadRuns(selectedFlowId.value)
}

watch(selectedFlowId, (id) => {
  if (!id) resetRunPanels()
})

watch(editorEnabled, (on) => {
  if (!on) {
    editorScheduleEnabled.value = false
    editorRetryEnabled.value = false
  }
})

watch(editorRetryEnabled, (on) => {
  if (on) {
    if (editorMaxRetryAttempts.value < 1) editorMaxRetryAttempts.value = 1
  } else {
    editorMaxRetryAttempts.value = 0
    editorRetryNodeTypes.value = []
  }
})

onMounted(() => {
  void probeAndLoad()
  window.addEventListener('keydown', onDebugKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDebugKeydown)
})
</script>

<template>
  <div
    class="mx-auto space-y-6 py-4 sm:py-6"
    :class="isDesignerTab ? 'max-w-none w-full px-2 sm:px-4' : 'max-w-7xl px-4'"
    data-testid="integration-flow-studio-root"
  >
    <header>
      <h1 :class="ui.title">{{ t('integrationFlowStudio.title') }}</h1>
      <p :class="ui.subtitle">{{ t('integrationFlowStudio.subtitle') }}</p>
      <p v-if="!canRead" :class="ui.muted">{{ t('integrationFlowStudio.permissionHint') }}</p>
    </header>

    <div
      v-if="initialLoadDone && !engineAvailable"
      class="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
      data-testid="integration-flow-studio-disabled"
    >
      <div class="font-semibold">{{ t('integrationFlowStudio.disabledTitle') }}</div>
      <p class="mt-1 text-amber-100/90">{{ t('integrationFlowStudio.disabledHint') }}</p>
    </div>

    <IntegrationFlowFailuresPanel
      v-if="initialLoadDone && engineAvailable && !isDesignerTab"
      :engine-available="engineAvailable"
      :can-read="canRead"
      :can-manage="canManage"
      :nodes="nodes"
      @open-run="onInboxOpenRun"
      @runs-changed="onInboxRunsChanged"
    />

    <div class="flex items-start gap-0">
      <div class="min-w-0 flex-1 space-y-6">

    <section
      v-if="canManage && !isDesignerTab"
      :class="ui.card"
      data-testid="integration-flow-studio-templates"
    >
      <h2 :class="ui.h2">{{ t('integrationFlowStudio.templatesTitle') }}</h2>
      <p :class="ui.muted">{{ t('integrationFlowStudio.templatesHint') }}</p>
      <div class="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <label :class="ui.label" for="ifs-tpl-pick">{{ t('integrationFlowStudio.templatePick') }}</label>
          <select
            id="ifs-tpl-pick"
            v-model="selectedTemplateKey"
            :class="ui.control"
            :disabled="!engineAvailable || templatesLoading"
          >
            <option value="">{{ t('integrationFlowStudio.templatePlaceholder') }}</option>
            <option v-for="tp in templates" :key="tp.templateKey" :value="tp.templateKey">
              {{ tp.displayName }}
            </option>
          </select>
        </div>
        <div>
          <label :class="ui.label" for="ifs-tpl-name">{{ t('integrationFlowStudio.templateFlowName') }}</label>
          <input
            id="ifs-tpl-name"
            v-model="templateFlowName"
            type="text"
            :class="ui.control"
            :disabled="!engineAvailable || templatesLoading"
          />
        </div>
        <div class="flex items-end">
          <button
            type="button"
            class="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            :disabled="!engineAvailable || templatesLoading || fromTemplateLoading || !selectedTemplateKey"
            @click="onCreateFromTemplate"
          >
            {{ fromTemplateLoading ? t('integrationFlowStudio.creating') : t('integrationFlowStudio.createFromTemplate') }}
          </button>
        </div>
      </div>
      <details v-if="selectedTemplateMeta" class="mt-3">
        <summary class="cursor-pointer text-sm text-slate-400">{{ t('integrationFlowStudio.templateNotes') }}</summary>
        <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{{ selectedTemplateMeta.defaultConfigNotes }}</pre>
      </details>
      <p v-if="templatesLoading" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
    </section>

    <div class="grid gap-6 lg:grid-cols-12">
      <!-- Flow list -->
      <section
        v-show="!isDesignerTab"
        :class="[ui.card, 'lg:col-span-4']"
        data-testid="integration-flow-studio-flow-list"
      >
        <div class="flex items-start justify-between gap-3">
          <h2 :class="ui.h2">{{ t('integrationFlowStudio.flowsTitle') }}</h2>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            :disabled="!canRead || flowsLoading"
            @click="refreshAll"
          >
            {{ t('integrationFlowStudio.refresh') }}
          </button>
        </div>
        <button
          v-if="canManage"
          type="button"
          class="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          :disabled="!engineAvailable || flowsLoading"
          @click="onCreateFlow"
        >
          {{ t('integrationFlowStudio.newFlow') }}
        </button>
        <p v-if="flowsLoading" :class="['mt-4', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
        <ul v-else class="mt-4 max-h-72 space-y-1 overflow-auto pr-1">
          <li v-if="!flows.length" :class="ui.muted">{{ t('integrationFlowStudio.noFlows') }}</li>
          <li v-for="f in flows" :key="f.id">
            <button
              type="button"
              class="flex w-full flex-col rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              :class="
                selectedFlowId === f.id
                  ? 'border-brand-500 bg-brand-500/10 text-white'
                  : 'border-slate-700 text-slate-200 hover:border-slate-500'
              "
              @click="selectFlow(f.id)"
            >
              <span class="font-medium">{{ f.name }}</span>
              <span class="text-xs text-slate-400">
                {{ f.triggerType }} · {{ f.enabled ? t('integrationFlowStudio.stateOn') : t('integrationFlowStudio.stateOff') }}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Flow editor -->
      <section
        :class="[ui.card, isDesignerTab ? 'lg:col-span-12 !p-2 sm:!p-3' : 'lg:col-span-8']"
        data-testid="integration-flow-studio-flow-editor"
      >
        <h2 v-if="!isDesignerTab" :class="ui.h2">{{ t('integrationFlowStudio.editorTitle') }}</h2>
        <div v-if="isDesignerTab && flows.length" class="mb-2 max-w-md">
          <label :class="ui.label" for="ifs-flow-picker">{{ t('integrationFlowDesigner.flowPickerLabel') }}</label>
          <select
            id="ifs-flow-picker"
            :class="ui.control"
            :value="selectedFlowId ?? ''"
            data-testid="integration-flow-designer-flow-picker"
            @change="selectFlow(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="f in flows" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </div>
        <p v-if="!selectedFlowId" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.selectFlow') }}</p>
        <div v-else-if="detailLoading" :class="['mt-4', ui.muted]">{{ t('integrationFlowStudio.loading') }}</div>
        <div v-else :class="['mt-4', isDesignerTab ? 'space-y-2' : 'space-y-3']">
          <details v-if="isDesignerTab" class="rounded-lg border border-slate-700/60 bg-slate-950/30">
            <summary class="cursor-pointer px-3 py-2 text-sm text-slate-400">
              {{ t('integrationFlowDesigner.flowSettingsSummary') }}
            </summary>
            <div class="space-y-3 border-t border-slate-700/60 p-3">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label :class="ui.label" for="ifs-name-compact">{{ t('integrationFlowStudio.name') }}</label>
                  <input
                    id="ifs-name-compact"
                    v-model="editorName"
                    type="text"
                    :class="ui.control"
                    :disabled="!canManage"
                  />
                </div>
                <div>
                  <label :class="ui.label" for="ifs-trigger-compact">{{ t('integrationFlowStudio.triggerType') }}</label>
                  <input
                    id="ifs-trigger-compact"
                    v-model="editorTriggerType"
                    type="text"
                    :class="ui.control"
                    :disabled="!canManage"
                  />
                </div>
              </div>
              <label :class="ui.checkboxRow">
                <input v-model="editorEnabled" type="checkbox" class="rounded border-slate-600" :disabled="!canManage" />
                {{ t('integrationFlowStudio.enabled') }}
              </label>
            </div>
          </details>
          <div v-if="!isDesignerTab" class="grid gap-4 sm:grid-cols-2">
            <div>
              <label :class="ui.label" for="ifs-name">{{ t('integrationFlowStudio.name') }}</label>
              <input
                id="ifs-name"
                v-model="editorName"
                type="text"
                :class="ui.control"
                :disabled="!canManage"
              />
            </div>
            <div>
              <label :class="ui.label" for="ifs-trigger">{{ t('integrationFlowStudio.triggerType') }}</label>
              <input
                id="ifs-trigger"
                v-model="editorTriggerType"
                type="text"
                :class="ui.control"
                :disabled="!canManage"
              />
            </div>
          </div>
          <template v-if="!isDesignerTab">
            <div>
              <label :class="ui.label" for="ifs-desc">{{ t('integrationFlowStudio.description') }}</label>
              <textarea
                id="ifs-desc"
                v-model="editorDescription"
                rows="2"
                :class="ui.control"
                :disabled="!canManage"
              />
            </div>
            <label :class="ui.checkboxRow">
              <input v-model="editorEnabled" type="checkbox" class="rounded border-slate-600" :disabled="!canManage" />
              {{ t('integrationFlowStudio.enabled') }}
            </label>
          </template>
          <template v-if="engineAvailable && !isDesignerTab">
            <div class="rounded-lg border border-slate-700/80 p-4" data-testid="integration-flow-studio-scheduling">
              <h3 class="text-sm font-semibold text-slate-200">{{ t('integrationFlowStudio.schedulingTitle') }}</h3>
              <p :class="['mt-1 text-xs', ui.muted]">{{ t('integrationFlowStudio.schedulingHint') }}</p>
              <label :class="[ui.checkboxRow, 'mt-3']">
                <input
                  v-model="editorScheduleEnabled"
                  type="checkbox"
                  class="rounded border-slate-600"
                  :disabled="!canManage || !editorEnabled"
                />
                {{ t('integrationFlowStudio.scheduleEnabled') }}
              </label>
              <p v-if="!editorEnabled" :class="['mt-2 text-xs', ui.muted]">
                {{ t('integrationFlowStudio.scheduleRequiresEnabled') }}
              </p>
              <div class="mt-3">
                <label :class="ui.label" for="ifs-sched-interval">{{ t('integrationFlowStudio.scheduleInterval') }}</label>
                <select
                  id="ifs-sched-interval"
                  v-model.number="editorScheduleIntervalSeconds"
                  :class="ui.control"
                  :disabled="!canManage || !editorEnabled || !editorScheduleEnabled"
                  data-testid="integration-flow-schedule-interval"
                >
                  <option v-for="o in scheduleIntervalOptions" :key="o.sec" :value="o.sec">
                    {{ t(o.labelKey) }}
                  </option>
                </select>
              </div>
              <dl class="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                <div>
                  <dt class="text-slate-500">{{ t('integrationFlowStudio.scheduleLastRun') }}</dt>
                  <dd class="text-slate-200">{{ formatTime(displayLastScheduledRunAt ?? undefined) }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">{{ t('integrationFlowStudio.scheduleNextRun') }}</dt>
                  <dd class="text-slate-200">{{ formatTime(displayNextScheduledRunAt ?? undefined) }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">{{ t('integrationFlowStudio.scheduleLockUntil') }}</dt>
                  <dd class="text-slate-200">{{ formatTime(displayScheduleLockUntil ?? undefined) }}</dd>
                </div>
              </dl>
              <button
                v-if="canManage"
                type="button"
                class="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                :disabled="!engineAvailable || !editorEnabled || !editorScheduleEnabled || scheduleRecalculateLoading"
                data-testid="integration-flow-schedule-recalculate"
                @click="onRecalculateSchedule"
              >
                {{
                  scheduleRecalculateLoading
                    ? t('integrationFlowStudio.scheduleRecalculating')
                    : t('integrationFlowStudio.scheduleRecalculate')
                }}
              </button>
            </div>
            <div
              class="mt-3 rounded-lg border border-slate-700/80 p-4"
              data-testid="integration-flow-studio-retry"
            >
              <h3 class="text-sm font-semibold text-slate-200">{{ t('integrationFlowStudio.retryTitle') }}</h3>
              <p :class="['mt-1 text-xs', ui.muted]">{{ t('integrationFlowStudio.retryHint') }}</p>
              <label :class="[ui.checkboxRow, 'mt-3']">
                <input
                  v-model="editorRetryEnabled"
                  type="checkbox"
                  class="rounded border-slate-600"
                  data-testid="integration-flow-retry-enabled"
                  :disabled="!canManage || !editorEnabled"
                />
                {{ t('integrationFlowStudio.retryEnabled') }}
              </label>
              <p v-if="!editorEnabled" :class="['mt-2 text-xs', ui.muted]">
                {{ t('integrationFlowStudio.retryRequiresEnabled') }}
              </p>
              <div class="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label :class="ui.label" for="ifs-retry-max">{{ t('integrationFlowStudio.retryMaxAttempts') }}</label>
                  <select
                    id="ifs-retry-max"
                    v-model.number="editorMaxRetryAttempts"
                    :class="ui.control"
                    data-testid="integration-flow-retry-max-attempts"
                    :disabled="!canManage || !editorEnabled || !editorRetryEnabled"
                  >
                    <option v-for="n in retryMaxAttemptChoices" :key="n" :value="n">{{ n }}</option>
                  </select>
                </div>
                <div>
                  <label :class="ui.label" for="ifs-retry-delay">{{ t('integrationFlowStudio.retryDelay') }}</label>
                  <select
                    id="ifs-retry-delay"
                    v-model.number="editorRetryDelaySeconds"
                    :class="ui.control"
                    data-testid="integration-flow-retry-delay"
                    :disabled="!canManage || !editorEnabled || !editorRetryEnabled"
                  >
                    <option v-for="o in retryDelayOptions" :key="o.sec" :value="o.sec">
                      {{ t(o.labelKey) }}
                    </option>
                  </select>
                </div>
              </div>
              <div class="mt-3">
                <label :class="ui.label" for="ifs-retry-node-types">{{ t('integrationFlowStudio.retryNodeTypes') }}</label>
                <select
                  id="ifs-retry-node-types"
                  v-model="editorRetryNodeTypes"
                  multiple
                  size="6"
                  :class="ui.control"
                  data-testid="integration-flow-retry-node-types"
                  :disabled="!canManage || !editorEnabled || !editorRetryEnabled"
                >
                  <option v-for="nt in catalogNodeTypes" :key="nt" :value="nt">{{ nt }}</option>
                </select>
                <p :class="['mt-1 text-xs', ui.muted]">{{ t('integrationFlowStudio.retryNodeTypesHint') }}</p>
              </div>
            </div>
          </template>
          <p
            v-else-if="!engineAvailable && !isDesignerTab"
            class="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-500"
            data-testid="integration-flow-studio-scheduling-unavailable"
          >
            {{ t('integrationFlowStudio.schedulingEngineOff') }}
          </p>
          <div>
            <template v-if="!isDesignerTab">
              <label :class="ui.label">{{ t('integrationFlowStudio.flowJson') }}</label>
              <p :class="ui.muted">{{ t('integrationFlowStudio.flowJsonHint') }}</p>
            </template>
            <div
              class="flex flex-wrap gap-2 border-b border-slate-700/80 pb-2"
              :class="isDesignerTab ? '' : 'mt-2'"
            >
              <button
                type="button"
                class="rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="
                  flowJsonEditorTab === 'json'
                    ? 'border-b-2 border-brand-500 text-brand-300'
                    : 'text-slate-400 hover:text-slate-200'
                "
                data-testid="integration-flow-tab-json"
                @click="flowJsonEditorTab = 'json'"
              >
                {{ t('integrationFlowStudio.tabJson') }}
              </button>
              <button
                type="button"
                class="rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="
                  flowJsonEditorTab === 'visual'
                    ? 'border-b-2 border-brand-500 text-brand-300'
                    : 'text-slate-400 hover:text-slate-200'
                "
                data-testid="integration-flow-tab-visual"
                @click="flowJsonEditorTab = 'visual'"
              >
                {{ t('integrationFlowStudio.tabVisual') }}
              </button>
            </div>
            <div v-show="flowJsonEditorTab === 'json'" class="mt-3">
              <textarea
                id="ifs-flow-json"
                v-model="editorFlowJsonText"
                rows="14"
                :class="ui.control"
                :disabled="!canManage"
                spellcheck="false"
              />
              <p v-if="flowJsonError" class="mt-2 text-sm text-red-400">{{ flowJsonError }}</p>
            </div>
            <div v-show="flowJsonEditorTab === 'visual'" :class="isDesignerTab ? 'mt-1' : 'mt-3'">
              <IntegrationFlowDesignerWorkbench
                v-if="parsedFlowJsonForVisual"
                ref="designerWorkbenchRef"
                :flow-json="parsedFlowJsonForVisual"
                :node-registry="nodes"
                :can-manage="canManage"
                :selected-node-id="selectedNodeIdForConfig"
                :selected-node-type="selectedNodeInFlow?.type ?? ''"
                :registry-entry="selectedRegistryEntry"
                :schema-fields="schemaFields"
                :node-config-panel-errors="nodeConfigPanelErrors"
                :unknown-node-type-warning="unknownNodeTypeWarning"
                :missing-config-schema-warning="missingConfigSchemaWarning"
                :no-configurable-fields-hint="noConfigurableFieldsHint"
                :has-unsupported-schema-fields="hasUnsupportedSchemaFields"
                :get-config-value="getConfigValue"
                :node-config-string-value="nodeConfigStringValue"
                :node-config-number-display="nodeConfigNumberDisplay"
                :json-draft-value="(key) => jsonDrafts[draftKey(selectedNodeIdForConfig, key)] ?? ''"
                :run-detail="runDetail"
                :run-timeline="selectedRunId ? runTimeline : []"
                :validation-result="validationResult"
                :script-node-enabled="scriptNodeEnabled"
                :pinned-payload="pinnedPayloadForSelectedNode"
                :sample-payload-text="samplePayloadText"
                :step-for-node="stepForSelectedNode"
                :focus-node-id="focusVisualNodeId"
                @update:flow-json="onVisualFlowJsonUpdate"
                @select-node="onVisualSelectNode"
                @open-run-step="onVisualOpenRunStep"
                @update:sample-payload-text="samplePayloadText = $event"
                @pin-sample="onPinDebugPayload(stepForSelectedNode?.previewInputJson ?? stepForSelectedNode?.inputJson ?? {})"
                @clear-pin="onClearPinnedPayload()"
                @set-string="(k, v, n) => setStringField(k, v, n ?? false)"
                @set-number="(k, v, min, max) => setNumberField(k, v, min, max)"
                @set-boolean="(k, v) => setBooleanField(k, v)"
                @commit-json="(f) => { commitJsonField(f); validatePanel() }"
                @patch-config-key="onPatchConfigKey"
                @validate="validatePanel"
              >
                <template #timeline>
                  <ul
                    v-if="runTimeline.length"
                    class="space-y-2 text-xs"
                    data-testid="integration-flow-designer-timeline"
                  >
                    <li
                      v-for="(ev, idx) in runTimeline"
                      :key="`${ev.nodeId}-${idx}`"
                      class="cursor-pointer rounded border border-slate-700/60 px-2 py-1 hover:bg-slate-800/60"
                      @click="onTimelineSelect(idx)"
                    >
                      <span class="font-mono text-slate-200">{{ ev.nodeId }}</span>
                      <span class="ml-2 text-slate-500">{{ ev.status }}</span>
                    </li>
                  </ul>
                  <p v-else class="text-slate-500">{{ t('integrationFlowStudio.noTimeline') }}</p>
                </template>
                <template #validation>
                  <div v-if="validationResult">
                    <p :class="validationResult.valid ? 'text-emerald-300' : 'text-red-300'">
                      {{ validationResult.valid ? t('integrationFlowStudio.validationOk') : t('integrationFlowStudio.validationFailed') }}
                    </p>
                    <ul v-if="validationResult.errors?.length" class="mt-2 list-inside list-disc text-red-200">
                      <li v-for="(err, i) in validationResult.errors" :key="`de-${i}`">{{ err }}</li>
                    </ul>
                  </div>
                  <p v-else class="text-slate-500">{{ t('integrationFlowDesigner.runValidateHint') }}</p>
                </template>
              </IntegrationFlowDesignerWorkbench>
              <p v-else class="text-sm text-amber-200/90">{{ t('integrationFlowStudio.visualInvalidJson') }}</p>
            </div>
          </div>
          <div :class="ui.footerRule">
            <button
              v-if="canManage"
              type="button"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              :disabled="!engineAvailable"
              data-testid="integration-flow-studio-save"
              @click="saveFlow"
            >
              {{ t('integrationFlowStudio.save') }}
            </button>
            <button
              v-if="canManage"
              type="button"
              class="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              :disabled="!engineAvailable"
              @click="onDeleteFlow"
            >
              {{ t('integrationFlowStudio.delete') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <section
      v-if="nodeConfigPanelVisible && flowJsonEditorTab !== 'visual'"
      :class="ui.card"
      data-testid="integration-flow-studio-node-config"
    >
      <h2 :class="ui.h2">{{ t('integrationFlowStudio.nodeConfigTitle') }}</h2>
      <p :class="ui.muted">{{ t('integrationFlowStudio.nodeConfigHint') }}</p>

      <div class="mt-4">
        <label :class="ui.label" for="ifs-node-pick">{{ t('integrationFlowStudio.nodeConfigSelect') }}</label>
        <select
          id="ifs-node-pick"
          v-model="selectedNodeIdForConfig"
          :class="ui.control"
          :disabled="!canManage"
          data-testid="integration-flow-node-config-select"
        >
          <option v-for="n in flowNodesFromJson" :key="n.id" :value="n.id">
            {{ n.id }} — {{ n.type }}
          </option>
        </select>
      </div>

      <div
        v-if="unknownNodeTypeWarning"
        class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        data-testid="integration-flow-node-config-unknown-type-warning"
      >
        {{ unknownNodeTypeWarning }}
      </div>
      <div
        v-if="missingConfigSchemaWarning"
        class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        data-testid="integration-flow-node-config-missing-schema-warning"
      >
        {{ missingConfigSchemaWarning }}
      </div>
      <p v-if="hasUnsupportedSchemaFields" class="mt-3 text-xs text-slate-400">
        {{ t('integrationFlowStudio.nodeConfigUnsupportedHint') }}
      </p>
      <p v-if="noConfigurableFieldsHint" :class="['mt-3', ui.muted]">{{ noConfigurableFieldsHint }}</p>

      <ul v-if="nodeConfigPanelErrors.length" class="mt-3 list-inside list-disc text-sm text-red-300">
        <li v-for="(err, i) in nodeConfigPanelErrors" :key="`ncerr-${i}`">{{ err }}</li>
      </ul>

      <div v-if="selectedNodeInFlow" class="mt-4 space-y-4">
        <div v-for="f in schemaFields" :key="f.key" class="space-y-1">
          <label :class="ui.label" :for="`ifs-nc-${f.key}`">
            {{ f.key }}<span v-if="f.required" class="text-red-400">*</span>
          </label>
          <p v-if="f.description" class="text-xs text-slate-500">{{ f.description }}</p>

          <input
            v-if="f.kind === 'string'"
            :id="`ifs-nc-${f.key}`"
            type="text"
            :value="nodeConfigStringValue(f.key)"
            :disabled="!canManage"
            :class="ui.control"
            :data-testid="`integration-flow-node-config-field-${f.key}`"
            @input="setStringField(f.key, ($event.target as HTMLInputElement).value, f.nullable)"
            @blur="validatePanel"
          />

          <input
            v-else-if="f.kind === 'number'"
            :id="`ifs-nc-${f.key}`"
            type="number"
            :value="nodeConfigNumberDisplay(f.key)"
            :disabled="!canManage"
            :class="ui.control"
            :min="f.minimum"
            :max="f.maximum"
            :data-testid="`integration-flow-node-config-field-${f.key}`"
            @change="setNumberField(f.key, ($event.target as HTMLInputElement).value, f.minimum, f.maximum)"
            @blur="validatePanel"
          />

          <label
            v-else-if="f.kind === 'boolean'"
            :class="ui.checkboxRow"
          >
            <input
              :id="`ifs-nc-${f.key}`"
              type="checkbox"
              class="rounded border-slate-600"
              :checked="Boolean(getConfigValue(f.key))"
              :disabled="!canManage"
              :data-testid="`integration-flow-node-config-field-${f.key}`"
              @change="setBooleanField(f.key, ($event.target as HTMLInputElement).checked)"
            />
            {{ f.key }}
          </label>

          <textarea
            v-else-if="f.kind === 'json-object' || f.kind === 'json-array'"
            :id="`ifs-nc-${f.key}`"
            :value="jsonDrafts[draftKey(selectedNodeInFlow.id, f.key)] ?? ''"
            rows="6"
            :disabled="!canManage"
            spellcheck="false"
            :class="ui.control"
            :data-testid="`integration-flow-node-config-field-${f.key}`"
            @input="jsonDrafts[draftKey(selectedNodeInFlow.id, f.key)] = ($event.target as HTMLTextAreaElement).value"
            @blur="
              commitJsonField(f);
              validatePanel()
            "
          />

          <pre
            v-else
            :id="`ifs-nc-${f.key}`"
            class="max-h-48 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300"
          >{{ prettyJson(getConfigValue(f.key)) }}</pre>
        </div>
      </div>
    </section>

    <div class="grid gap-6 lg:grid-cols-12">
      <!-- Node catalog -->
      <section
        :class="[ui.card, 'lg:col-span-4']"
        data-testid="integration-flow-studio-node-catalog"
      >
        <h2 :class="ui.h2">{{ t('integrationFlowStudio.nodesTitle') }}</h2>
        <p v-if="nodesLoading" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
        <ul v-else class="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
          <li v-if="!nodes.length" :class="ui.muted">{{ t('integrationFlowStudio.noNodes') }}</li>
          <li
            v-for="n in nodes"
            :key="n.id"
            :class="[ui.infoBox, '!p-3']"
          >
            <div class="font-medium text-slate-200">{{ n.displayName }}</div>
            <div class="mt-1 text-xs text-slate-400">
              {{ n.nodeKey }} · {{ t('integrationFlowStudio.nodeCategory') }}: {{ n.category || n.nodeType }}
            </div>
            <p v-if="n.description" class="mt-2 text-xs">{{ n.description }}</p>
          </li>
        </ul>
      </section>

      <!-- Validation + run result -->
      <div class="space-y-6 lg:col-span-4">
        <section :class="ui.card" data-testid="integration-flow-studio-validation">
          <h2 :class="ui.h2">{{ t('integrationFlowStudio.validationTitle') }}</h2>
          <button
            type="button"
            class="mt-3 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            :disabled="!selectedFlowId || !canRead || validationLoading || !engineAvailable"
            @click="onValidate"
          >
            {{ validationLoading ? t('integrationFlowStudio.validating') : t('integrationFlowStudio.validate') }}
          </button>
          <div v-if="validationResult" class="mt-4 space-y-3 text-sm">
            <div
              class="rounded-lg px-3 py-2 font-medium"
              :class="validationResult.valid ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200'"
            >
              {{ validationResult.valid ? t('integrationFlowStudio.validationOk') : t('integrationFlowStudio.validationFailed') }}
            </div>
            <div v-if="validationResult.errors?.length">
              <div class="text-xs uppercase text-slate-500">{{ t('integrationFlowStudio.errors') }}</div>
              <ul class="mt-1 list-inside list-disc text-red-200">
                <li v-for="(err, i) in validationResult.errors" :key="`e-${i}`">{{ err }}</li>
              </ul>
            </div>
            <div v-if="validationResult.warnings?.length">
              <div class="text-xs uppercase text-slate-500">{{ t('integrationFlowStudio.warnings') }}</div>
              <ul class="mt-1 list-inside list-disc text-amber-200">
                <li v-for="(w, i) in validationResult.warnings" :key="`w-${i}`">{{ w }}</li>
              </ul>
            </div>
          </div>
        </section>

        <section :class="ui.card" data-testid="integration-flow-studio-run-result">
          <h2 :class="ui.h2">{{ t('integrationFlowStudio.runResultTitle') }}</h2>
          <div class="mt-3">
            <label :class="ui.label" for="ifs-run-input">{{ t('integrationFlowStudio.runInput') }}</label>
            <p :class="ui.muted">{{ t('integrationFlowStudio.runInputHint') }}</p>
            <textarea
              id="ifs-run-input"
              v-model="runInputText"
              rows="4"
              :class="ui.control"
              :disabled="!canManage || !selectedFlowId"
              spellcheck="false"
            />
          </div>
          <button
            type="button"
            class="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            :disabled="!selectedFlowId || !canManage || runLoading || !engineAvailable"
            @click="onRun"
          >
            {{ runLoading ? t('integrationFlowStudio.running') : t('integrationFlowStudio.run') }}
          </button>
          <pre
            v-if="runSummary"
            class="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"
          >{{ prettyJson(runSummary) }}</pre>
        </section>
      </div>

      <!-- Run history -->
      <section
        :class="[ui.card, 'lg:col-span-4']"
        data-testid="integration-flow-studio-run-history"
      >
        <h2 :class="ui.h2">{{ t('integrationFlowStudio.runHistoryTitle') }}</h2>
        <p v-if="!selectedFlowId" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.selectFlow') }}</p>
        <p v-else-if="runsLoading" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
        <div v-else :class="['mt-3', ui.tableShell]">
          <table class="min-w-full text-left text-sm">
            <thead>
              <tr :class="ui.tableHead">
                <th class="px-3 py-2">{{ t('integrationFlowStudio.colStatus') }}</th>
                <th class="px-3 py-2">{{ t('integrationFlowStudio.colStarted') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!runs.length">
                <td colspan="2" :class="['px-3 py-4', ui.tableCellMuted]">{{ t('integrationFlowStudio.noRuns') }}</td>
              </tr>
              <tr
                v-for="r in runs"
                :key="r.id"
                :class="[ui.tableRow, 'cursor-pointer hover:bg-slate-800/60']"
                @click="selectRun(r.id)"
              >
                <td :class="['px-3', ui.tableCell, selectedRunId === r.id ? 'text-brand-400' : '']">
                  {{ r.status }}
                </td>
                <td :class="['px-3', ui.tableCell]">{{ formatTime(r.startedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!--Step detail -->
    <section :class="ui.card" data-testid="integration-flow-studio-step-detail">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 :class="ui.h2">{{ t('integrationFlowStudio.runDetailTitle') }}</h2>
        <button
          v-if="selectedRunId"
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          data-testid="integration-flow-studio-debug-toggle"
          @click="debugPanelOpen = !debugPanelOpen"
        >
          {{ debugPanelOpen ? t('integrationFlowStudio.debugHide') : t('integrationFlowStudio.debugShow') }}
        </button>
      </div>
      <p v-if="!selectedRunId" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.noRunSelected') }}</p>
      <p v-else-if="runDetailLoading" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
      <div v-else-if="runDetail" class="mt-4 grid gap-6 lg:grid-cols-2">
        <div data-testid="integration-flow-studio-execution-timeline-panel">
          <div :class="ui.calloutSm">
            <div><span class="text-slate-500">ID</span> {{ runDetail.id }}</div>
            <div><span class="text-slate-500">{{ t('integrationFlowStudio.colStatus') }}</span> {{ runDetail.status }}</div>
            <div><span class="text-slate-500">{{ t('integrationFlowStudio.colDuration') }}</span> {{ runDetail.durationMs ?? '—' }}</div>
            <div
              v-if="
                runDetail.parentRunId ||
                runDetail.retryOfRunId ||
                runDetail.retryAttempt != null ||
                runDetail.retryStatus ||
                runDetail.nextRetryAt
              "
              class="mt-3 space-y-1 border-t border-slate-700/80 pt-3"
              data-testid="integration-flow-run-retry-meta"
            >
              <div v-if="runDetail.parentRunId" class="text-xs">
                <span class="text-slate-500">parentRunId</span> {{ runDetail.parentRunId }}
              </div>
              <div v-if="runDetail.retryOfRunId" class="text-xs">
                <span class="text-slate-500">retryOfRunId</span> {{ runDetail.retryOfRunId }}
              </div>
              <div v-if="runDetail.retryAttempt != null" class="text-xs">
                <span class="text-slate-500">retryAttempt</span> {{ runDetail.retryAttempt }}
              </div>
              <div v-if="runDetail.retryStatus" class="text-xs">
                <span class="text-slate-500">retryStatus</span> {{ runDetail.retryStatus }}
              </div>
              <div v-if="runDetail.nextRetryAt" class="text-xs">
                <span class="text-slate-500">nextRetryAt</span> {{ formatTime(runDetail.nextRetryAt) }}
              </div>
            </div>
            <div
              v-if="runDetail.retryStatus === 'pending_retry'"
              class="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
              data-testid="integration-flow-run-pending-retry"
            >
              {{ t('integrationFlowStudio.pendingRetryBanner') }}
              <span v-if="runDetail.nextRetryAt" class="font-medium">{{ formatTime(runDetail.nextRetryAt) }}</span>
            </div>
            <button
              v-if="canRetrySelectedRunNow"
              type="button"
              class="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              :disabled="runRetryNowLoading"
              data-testid="integration-flow-run-retry-now"
              @click="onRetryNow"
            >
              {{ runRetryNowLoading ? t('integrationFlowStudio.retryNowLoading') : t('integrationFlowStudio.retryNow') }}
            </button>
          </div>
          <h3 :class="[ui.h2, 'mt-6']">{{ t('integrationFlowStudio.executionTimeline') }}</h3>
          <p v-if="!runTimeline.length" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.noTimeline') }}</p>
          <ul
            v-else
            class="relative mt-4 space-y-0 border-l border-slate-600/80 pl-5"
            data-testid="integration-flow-studio-execution-timeline"
          >
            <li
              v-for="(ev, idx) in runTimeline"
              :key="`${ev.nodeId}-${idx}`"
              class="relative cursor-pointer pb-6 pl-1 last:pb-1"
              :class="timelineRowSelected(idx) ? 'rounded-r-md bg-brand-500/10 pr-2' : ''"
              @click="onTimelineSelect(idx)"
            >
              <span
                class="absolute -left-[15px] top-1.5 block h-3 w-3 shrink-0 rounded-full ring-4 ring-slate-900/90"
                :class="timelineDotClass(ev.status)"
              />
              <div class="text-sm font-medium text-slate-100">{{ ev.nodeId }}</div>
              <div class="text-xs text-slate-500">{{ ev.nodeType }}</div>
              <div class="mt-1 text-xs">
                <span :class="ev.status === 'failed' ? 'font-medium text-red-300' : 'text-slate-300'">{{ ev.status }}</span>
                <span v-if="ev.durationMs != null" class="text-slate-500"> · {{ ev.durationMs }} ms</span>
              </div>
              <div v-if="ev.startedAt" class="mt-0.5 text-[11px] text-slate-500">
                {{ formatTime(typeof ev.startedAt === 'string' ? ev.startedAt : String(ev.startedAt)) }}
              </div>
              <p v-if="ev.errorMessage" class="mt-1 text-xs text-red-400">{{ ev.errorMessage }}</p>
              <button
                v-if="parsedFlowJsonForVisual"
                type="button"
                class="mt-2 text-xs font-medium text-brand-400 hover:text-brand-300"
                data-testid="integration-flow-show-in-graph"
                @click.stop="showNodeInVisualGraph(ev.nodeId)"
              >
                {{ t('integrationFlowStudio.showInGraph') }}
              </button>
            </li>
          </ul>
          <div
            v-if="runVisualFlowJson && runTimeline.length"
            class="mt-8"
            data-testid="integration-flow-run-visual"
          >
            <h3 :class="[ui.h2]">{{ t('integrationFlowStudio.runVisualTitle') }}</h3>
            <IntegrationFlowVisualBuilder
              vue-flow-id="integration-flow-run-visual"
              :flow-json="runVisualFlowJson"
              :node-registry="nodes"
              readonly
              :timeline="runTimeline"
              :selected-node-id="selectedNodeIdForConfig"
              :focus-node-id="focusVisualNodeId"
              @select-node="onVisualSelectNode"
              @open-run-step="onVisualOpenRunStep"
            />
          </div>
        </div>
        <div>
          <h3 :class="ui.h2">{{ t('integrationFlowStudio.stepIoTitle') }}</h3>
          <p v-if="!selectedStep" :class="['mt-2', ui.muted]">{{ t('integrationFlowStudio.noStepSelected') }}</p>
          <template v-else>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <p v-if="selectedStep.errorMessage" class="text-sm text-red-300">{{ selectedStep.errorMessage }}</p>
              <button
                v-if="parsedFlowJsonForVisual"
                type="button"
                class="text-sm font-medium text-brand-400 hover:text-brand-300"
                data-testid="integration-flow-show-in-graph-step"
                @click="showNodeInVisualGraph(selectedStep.nodeId)"
              >
                {{ t('integrationFlowStudio.showInGraph') }}
              </button>
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-1">
              <div>
                <div class="text-xs uppercase text-slate-500">{{ t('integrationFlowStudio.stepInput') }}</div>
                <pre class="mt-1 max-h-56 overflow-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-300">{{ prettyJson(selectedStep.inputJson) }}</pre>
              </div>
              <div>
                <div class="text-xs uppercase text-slate-500">{{ t('integrationFlowStudio.stepOutput') }}</div>
                <pre class="mt-1 max-h-56 overflow-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-300">{{ prettyJson(selectedStep.outputJson) }}</pre>
              </div>
            </div>
          </template>
        </div>
      </div>
    </section>

      </div>

    </div>
  </div>
</template>
