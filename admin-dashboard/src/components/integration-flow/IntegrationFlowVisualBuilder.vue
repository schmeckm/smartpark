<script setup lang="ts">
/**
 * Visual editor for integration flow_json.
 * - Persists: nodes (id, type, config), edges, and nodes[].position when dragged/placed.
 * - Read-only overlay: timeline/status/validation on node.data — never emitted to flow_json.
 */
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, Panel, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import type {
  IntegrationFlowJson,
  IntegrationFlowJsonNode,
  IntegrationFlowTimelineEntryDto,
  IntegrationNodeRegistryEntryDto,
} from '@/api/client'
import IntegrationFlowNodeCard from '@/components/integration-flow/IntegrationFlowNodeCard.vue'
import type {
  IntegrationFlowNodePresentation,
  IntegrationFlowVfEdge,
  IntegrationFlowVfNode,
} from '@/types/integrationFlowVueFlow'
import {
  buildIntegrationFlowEmitPayload,
  flowJsonHasNoPresentationKeys,
} from '@/utils/integrationFlowVisualEmit'

type FlowNodeJson = IntegrationFlowJsonNode

const FLOW_NODE_TYPE = 'integrationFlow'
const DEFAULT_VUE_FLOW_ID = 'integration-flow-visual-vue-flow'
const SNAP_GRID: [number, number] = [16, 16]

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    flowJson: IntegrationFlowJson
    nodeRegistry: IntegrationNodeRegistryEntryDto[]
    readonly?: boolean
    /** @deprecated prefer timeline */
    statusByNodeId?: Record<string, string> | null
    timeline?: IntegrationFlowTimelineEntryDto[] | null
    validationNodeIds?: string[] | null
    focusNodeId?: string | null
    selectedNodeId?: string | null
    /** Node ids with preview payloads on the selected run (presentation overlay). */
    previewNodeIds?: string[] | null
    /** Distinct id when multiple builders mount (editor vs run detail). */
    vueFlowId?: string
    /** Canvas height CSS value (default 480px). */
    canvasHeight?: string
  }>(),
  {
    readonly: false,
    statusByNodeId: null,
    timeline: null,
    validationNodeIds: null,
    focusNodeId: null,
    selectedNodeId: null,
    previewNodeIds: null,
    vueFlowId: DEFAULT_VUE_FLOW_ID,
    canvasHeight: '480px',
  }
)

const instanceFlowId = props.vueFlowId ?? DEFAULT_VUE_FLOW_ID

const emit = defineEmits<{
  'update:flowJson': [value: IntegrationFlowJson]
  'select-node': [nodeId: string]
  'open-run-step': [nodeId: string]
}>()

// Custom node card; cast avoids vue-tsc deep NodeComponent variance.
const nodeTypes = markRaw({ [FLOW_NODE_TYPE]: IntegrationFlowNodeCard }) as any

const vfNodes = ref<IntegrationFlowVfNode[]>([])
const vfEdges = ref<IntegrationFlowVfEdge[]>([])
const canonicalNodes = ref<FlowNodeJson[]>([])
const canonicalEdges = ref<IntegrationFlowJson['edges']>([])
const positionPersistIds = ref<Set<string>>(new Set())

let lastEmittedSig = ''

/** @deprecated legacy embedded palette (hidden; use IntegrationFlowNodePalette). */
const paletteSearch = ref('')
const paletteNodeKey = ref('')
const paletteDragKey = ref<string | null>(null)
const paletteGroups = computed(() => [] as { category: string; entries: IntegrationNodeRegistryEntryDto[] }[])
function onAddFromPalette() {
  /* palette externalized */
}
function onPaletteDragStart(_entry: IntegrationNodeRegistryEntryDto, _ev: DragEvent) {
  /* palette externalized */
}
function onPaletteDragEnd() {
  paletteDragKey.value = null
}

const previewIdSet = computed(() => new Set(props.previewNodeIds ?? []))

const { fitView, setCenter, findNode } = useVueFlow({ id: instanceFlowId })

const timelineByNodeId = computed(() => {
  const m = new Map<string, IntegrationFlowTimelineEntryDto>()
  for (const e of props.timeline ?? []) {
    if (e?.nodeId) m.set(e.nodeId, e)
  }
  return m
})

const validationIdSet = computed(() => new Set(props.validationNodeIds ?? []))

const hasCanvasNodes = computed(() => canonicalNodes.value.length > 0)

function registryEntryForType(type: string): IntegrationNodeRegistryEntryDto | undefined {
  return props.nodeRegistry.find((r) => r.nodeKey === type)
}

function flowSignature(f: IntegrationFlowJson): string {
  try {
    return JSON.stringify({
      nodes: f.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: n.config,
        position: n.position ?? null,
      })),
      edges: f.edges.map((e) => ({ source: e.source, target: e.target })),
    })
  } catch {
    return ''
  }
}

function hasValidPosition(n: FlowNodeJson): boolean {
  const p = n.position
  return (
    p != null &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    typeof (p as { x?: unknown }).x === 'number' &&
    typeof (p as { y?: unknown }).y === 'number' &&
    Number.isFinite((p as { x: number }).x) &&
    Number.isFinite((p as { y: number }).y)
  )
}

function computeLayers(flow: IntegrationFlowJson): Map<string, number> {
  const idSet = new Set(flow.nodes.map((n) => n.id))
  const incoming = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of flow.nodes) {
    incoming.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of flow.edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    incoming.set(e.target, incoming.get(e.target)! + 1)
  }
  const starts = [...idSet].filter((id) => incoming.get(id) === 0)
  const layer = new Map<string, number>()
  const q = starts.map((id) => ({ id, L: 0 }))
  while (q.length) {
    const { id, L } = q.shift()!
    if (layer.has(id)) continue
    layer.set(id, L)
    for (const t of adj.get(id) || []) q.push({ id: t, L: L + 1 })
  }
  let maxL = 0
  for (const v of layer.values()) maxL = Math.max(maxL, v)
  for (const id of idSet) {
    if (!layer.has(id)) layer.set(id, maxL + 1)
  }
  return layer
}

function autoLayoutPositions(flow: IntegrationFlowJson): Map<string, { x: number; y: number }> {
  const layers = computeLayers(flow)
  const byLayer = new Map<number, string[]>()
  for (const [id, L] of layers) {
    if (!byLayer.has(L)) byLayer.set(L, [])
    byLayer.get(L)!.push(id)
  }
  for (const arr of byLayer.values()) arr.sort()
  const pos = new Map<string, { x: number; y: number }>()
  for (const [L, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, i) => pos.set(id, { x: L * 280, y: i * 110 }))
  }
  return pos
}

function overlayForNode(nodeId: string): {
  status: string
  errorMessage: string
  validationHighlight: boolean
  durationMs: number | null
  hasPreview: boolean
} {
  const tl = timelineByNodeId.value.get(nodeId)
  const status = tl?.status ?? props.statusByNodeId?.[nodeId] ?? ''
  const errorMessage =
    tl?.status?.toLowerCase() === 'failed' && tl.errorMessage ? String(tl.errorMessage) : ''
  return {
    status: String(status || ''),
    errorMessage,
    validationHighlight: validationIdSet.value.has(nodeId),
    durationMs: tl?.durationMs != null ? Number(tl.durationMs) : null,
    hasPreview: previewIdSet.value.has(nodeId),
  }
}

function buildVfNodeData(n: FlowNodeJson): IntegrationFlowNodePresentation {
  const o = overlayForNode(n.id)
  const reg = registryEntryForType(n.type)
  return {
    nodeType: n.type,
    nodeId: n.id,
    displayName: reg?.displayName || n.type,
    category: reg?.category || reg?.nodeType || '',
    status: o.status,
    errorMessage: o.errorMessage,
    validationHighlight: o.validationHighlight,
    durationMs: o.durationMs,
    hasPreview: o.hasPreview,
  }
}

function rebuildFromProps(f: IntegrationFlowJson) {
  canonicalNodes.value = f.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    config: { ...(n.config || {}) },
    ...(hasValidPosition(n as FlowNodeJson) ? { position: { ...(n as FlowNodeJson).position! } } : {}),
  }))
  canonicalEdges.value = f.edges.map((e) => ({ source: e.source, target: e.target }))
  const layout = autoLayoutPositions(f)
  const persist = new Set<string>()
  for (const n of canonicalNodes.value) {
    if (hasValidPosition(n)) persist.add(n.id)
  }
  positionPersistIds.value = persist

  const nextVfNodes: IntegrationFlowVfNode[] = []
  for (const n of canonicalNodes.value) {
    const p = hasValidPosition(n) ? n.position! : layout.get(n.id) || { x: 0, y: 0 }
    nextVfNodes.push({
      id: n.id,
      type: FLOW_NODE_TYPE,
      position: { x: p.x, y: p.y },
      data: buildVfNodeData(n),
      connectable: !props.readonly,
      draggable: !props.readonly,
      deletable: !props.readonly,
      selected: props.selectedNodeId === n.id,
    })
  }
  vfNodes.value = nextVfNodes
  vfEdges.value = canonicalEdges.value.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    deletable: !props.readonly,
  }))
}

function refreshNodePresentation() {
  vfNodes.value = vfNodes.value.map((vn) => {
    const canon = canonicalNodes.value.find((n) => n.id === vn.id)
    if (!canon) return vn
    return {
      ...vn,
      data: buildVfNodeData(canon),
      selected: props.selectedNodeId === vn.id,
    }
  })
}

function buildEmitPayload(): IntegrationFlowJson {
  const posById = new Map<string, { x: number; y: number }>()
  for (const n of vfNodes.value) {
    posById.set(n.id, { x: n.position.x, y: n.position.y })
  }
  return buildIntegrationFlowEmitPayload(
    canonicalNodes.value,
    canonicalEdges.value,
    posById,
    positionPersistIds.value
  )
}

function commit() {
  if (props.readonly) return
  const out = buildEmitPayload()
  if (import.meta.env.DEV && !flowJsonHasNoPresentationKeys(out)) {
    console.warn('[IntegrationFlowVisualBuilder] emit contained presentation-only keys')
  }
  lastEmittedSig = flowSignature(out)
  emit('update:flowJson', out)
}

async function fitViewAll() {
  await nextTick()
  try {
    await fitView({ padding: 0.2, duration: 200 })
  } catch {
    /* empty graph */
  }
}

async function focusNode(nodeId: string) {
  await nextTick()
  const n = findNode(nodeId)
  if (n) {
    try {
      await fitView({ nodes: [nodeId], padding: 0.5, duration: 250, maxZoom: 1.2 })
    } catch {
      await setCenter(n.position.x + 80, n.position.y + 40, { zoom: 1, duration: 250 })
    }
    return
  }
  const canon = canonicalNodes.value.find((x) => x.id === nodeId)
  if (canon?.position) {
    await setCenter(canon.position.x + 80, canon.position.y + 40, { zoom: 1, duration: 250 })
  }
}

defineExpose({ fitViewAll, focusNode, addRegistryNode })

watch(
  () => props.flowJson,
  (f) => {
    const sig = flowSignature(f)
    if (sig === lastEmittedSig) return
    rebuildFromProps(f)
    lastEmittedSig = sig
  },
  { deep: true, immediate: true }
)

watch(
  () => [
    props.timeline,
    props.statusByNodeId,
    props.validationNodeIds,
    props.selectedNodeId,
    props.previewNodeIds,
    props.nodeRegistry,
  ],
  () => refreshNodePresentation(),
  { deep: true }
)

watch(
  () => props.focusNodeId,
  (id) => {
    if (id) void focusNode(id)
  }
)

function defaultConfigFromSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || (schema as { type?: string }).type !== 'object') return {}
  const propsObj = (schema as { properties?: Record<string, unknown> }).properties
  const required = Array.isArray((schema as { required?: string[] }).required)
    ? (schema as { required: string[] }).required.map(String)
    : []
  const out: Record<string, unknown> = {}
  if (!propsObj) return out
  for (const key of required) {
    const sub = propsObj[key]
    if (!sub || typeof sub !== 'object') continue
    const so = sub as Record<string, unknown>
    if (so.default !== undefined) out[key] = so.default
    else if (so.type === 'object' && so.properties) out[key] = defaultConfigFromSchema(sub)
    else if (so.type === 'array') out[key] = []
    else if (so.type === 'string') out[key] = ''
    else if (so.type === 'number' || so.type === 'integer') out[key] = 0
    else if (so.type === 'boolean') out[key] = false
  }
  return out
}

function nextNodeId(nodeTypeKey: string, existingIds: Set<string>): string {
  const base = nodeTypeKey.toLowerCase()
  if (!existingIds.has(base)) return base
  let max = 1
  const prefix = `${base}_`
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10)
      if (!Number.isNaN(n)) max = Math.max(max, n)
    }
  }
  return `${base}_${max + 1}`
}

function canvasCenter(): { x: number; y: number } {
  const xs = vfNodes.value.map((n) => n.position.x)
  const ys = vfNodes.value.map((n) => n.position.y)
  if (!xs.length) return { x: 120, y: 120 }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return { x: cx + 40, y: cy + 40 }
}

function addRegistryNode(entry: IntegrationNodeRegistryEntryDto, position?: { x: number; y: number }) {
  if (props.readonly || entry.enabled === false) return
  const existing = new Set(canonicalNodes.value.map((n) => n.id))
  const id = nextNodeId(entry.nodeKey, existing)
  const cfg = defaultConfigFromSchema(entry.configSchema)
  const pos = position ?? canvasCenter()
  const newNode: FlowNodeJson = {
    id,
    type: entry.nodeKey,
    config: cfg,
    position: { x: pos.x, y: pos.y },
  }
  canonicalNodes.value = [...canonicalNodes.value, newNode]
  positionPersistIds.value = new Set([...positionPersistIds.value, id])
  vfNodes.value = [
    ...vfNodes.value,
    {
      id,
      type: FLOW_NODE_TYPE,
      position: pos,
      data: buildVfNodeData(newNode),
      connectable: true,
      draggable: true,
      deletable: true,
    },
  ]
  commit()
  emit('select-node', id)
}

function onCanvasDragOver(ev: DragEvent) {
  if (props.readonly) return
  if (ev.dataTransfer?.types.includes('application/x-integration-flow-node-key')) {
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  }
}

function onCanvasDrop(ev: DragEvent) {
  if (props.readonly) return
  const key = ev.dataTransfer?.getData('application/x-integration-flow-node-key')
  if (!key) return
  ev.preventDefault()
  const entry = props.nodeRegistry.find((r) => r.nodeKey === key)
  if (!entry) return
  const el = ev.currentTarget as HTMLElement | null
  const bounds = el?.getBoundingClientRect()
  const x = bounds ? ev.clientX - bounds.left : 120
  const y = bounds ? ev.clientY - bounds.top : 120
  addRegistryNode(entry, { x, y })
}

function onNodeDragStop(ev: { node: { id: string } }) {
  if (props.readonly) return
  const id = ev.node.id
  positionPersistIds.value = new Set([...positionPersistIds.value, id])
  commit()
}

function onConnect(c: { source?: string | null; target?: string | null }) {
  if (props.readonly) return
  if (!c.source || !c.target) return
  if (c.source === c.target) return
  if (canonicalEdges.value.some((e) => e.source === c.source && e.target === c.target)) return
  const next = {
    id: `${c.source}->${c.target}`,
    source: c.source,
    target: c.target,
    deletable: !props.readonly,
  }
  vfEdges.value = addEdge(next as any, vfEdges.value as any) as IntegrationFlowVfEdge[]
  canonicalEdges.value = [...canonicalEdges.value, { source: c.source, target: c.target }]
  commit()
}

function onEdgesChange(changes: any[]) {
  if (props.readonly) return
  let removed = false
  for (const ch of changes) {
    if (ch.type === 'remove') {
      if (ch.source != null && ch.target != null) {
        canonicalEdges.value = canonicalEdges.value.filter(
          (x) => !(x.source === ch.source && x.target === ch.target)
        )
      } else if (ch.id) {
        const edge = vfEdges.value.find((x) => x.id === ch.id)
        if (edge) {
          canonicalEdges.value = canonicalEdges.value.filter(
            (x) => !(x.source === edge.source && x.target === edge.target)
          )
        }
      }
      removed = true
    }
  }
  if (removed) commit()
}

function onNodesChange(changes: any[]) {
  if (props.readonly) return
  const removedIds: string[] = []
  for (const ch of changes) {
    if (ch?.type === 'remove' && typeof ch.id === 'string') removedIds.push(ch.id)
  }
  if (!removedIds.length) return
  const rm = new Set(removedIds)
  canonicalNodes.value = canonicalNodes.value.filter((n) => !rm.has(n.id))
  canonicalEdges.value = canonicalEdges.value.filter((e) => !rm.has(e.source) && !rm.has(e.target))
  positionPersistIds.value = new Set([...positionPersistIds.value].filter((id) => !rm.has(id)))
  vfEdges.value = vfEdges.value.filter((e) => !rm.has(e.source) && !rm.has(e.target))
  commit()
}

function onNodeClick(ev: { node: { id: string } }) {
  emit('select-node', ev.node.id)
}

function onOpenRunStepFromNode(nodeId: string) {
  emit('open-run-step', nodeId)
}

function isValidConnection(
  connection: { source?: string | null; target?: string | null },
  ctx: { edges: { source: string; target: string }[] }
): boolean {
  const { source, target } = connection
  if (!source || !target || source === target) return false
  if (canonicalEdges.value.some((e) => e.source === source && e.target === target)) return false
  if (ctx.edges.some((e) => e.source === source && e.target === target)) return false
  return true
}

function onNodesInitialized() {
  void fitViewAll()
  if (props.focusNodeId) void focusNode(props.focusNodeId)
}
</script>

<template>
  <div class="iff-visual-root h-full min-h-0" data-testid="integration-flow-visual-builder">
    <div class="iff-layout h-full min-h-0">
      <aside
        v-if="false"
        class="iff-palette w-full shrink-0 rounded-lg border border-slate-700/80 bg-slate-900/60 lg:w-72"
        data-testid="integration-flow-visual-palette"
      >
        <div class="border-b border-slate-700/80 p-3">
          <label class="mb-1 block text-xs font-medium text-slate-400" for="iff-palette-search">
            {{ t('integrationFlowVisual.paletteSearch') }}
          </label>
          <input
            id="iff-palette-search"
            v-model="paletteSearch"
            type="search"
            class="w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            data-testid="integration-flow-visual-palette-search"
            :placeholder="t('integrationFlowVisual.paletteSearchPlaceholder')"
          />
        </div>
        <div
          class="max-h-52 overflow-y-auto p-2 lg:max-h-[420px]"
          data-testid="integration-flow-visual-palette-list"
        >
          <p v-if="!paletteGroups.length" class="px-2 py-3 text-xs text-slate-500">
            {{ t('integrationFlowVisual.paletteEmpty') }}
          </p>
          <div v-for="group in paletteGroups" :key="group.category" class="mb-3" data-testid="integration-flow-visual-palette-group">
            <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {{ group.category }}
            </div>
            <ul class="space-y-1">
              <li
                v-for="entry in group.entries"
                :key="entry.id"
                class="rounded-md border border-transparent px-2 py-1.5 transition-colors"
                :class="[
                  entry.enabled === false ? 'opacity-50' : 'hover:border-slate-600 hover:bg-slate-800/80',
                  paletteNodeKey === entry.nodeKey ? 'border-indigo-500/50 bg-indigo-500/10' : '',
                  paletteDragKey === entry.nodeKey ? 'border-indigo-400/60' : '',
                ]"
                :draggable="entry.enabled !== false"
                data-testid="integration-flow-visual-palette-item"
                @click="paletteNodeKey = entry.nodeKey"
                @dragstart="onPaletteDragStart(entry, $event)"
                @dragend="onPaletteDragEnd"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-sm font-medium text-slate-100">{{ entry.displayName }}</span>
                  <span
                    v-if="entry.enabled === false"
                    class="shrink-0 rounded px-1 text-[9px] uppercase text-slate-400 ring-1 ring-slate-600"
                  >
                    {{ t('integrationFlowVisual.registryDisabled') }}
                  </span>
                </div>
                <div class="mt-0.5 font-mono text-[10px] text-slate-500">{{ entry.nodeKey }}</div>
                <div v-if="entry.nodeType" class="text-[10px] text-slate-600">{{ entry.nodeType }}</div>
                <p v-if="entry.description" class="mt-1 line-clamp-2 text-[10px] text-slate-400">
                  {{ entry.description }}
                </p>
              </li>
            </ul>
          </div>
        </div>
        <div class="flex flex-wrap items-end gap-2 border-t border-slate-700/80 p-3">
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            :disabled="!paletteNodeKey"
            data-testid="integration-flow-visual-palette-add"
            @click="onAddFromPalette"
          >
            {{ t('integrationFlowVisual.addNode') }}
          </button>
        </div>
      </aside>

      <div class="iff-canvas-wrap h-full min-h-0 min-w-0 flex-1">
        <div
          class="iff-canvas relative h-full min-h-0 rounded-lg border border-slate-700 bg-slate-950"
          :style="{ height: canvasHeight, minHeight: canvasHeight }"
          data-testid="integration-flow-visual-canvas"
          @dragover="onCanvasDragOver"
          @drop="onCanvasDrop"
        >
          <div
            v-if="!hasCanvasNodes"
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center"
            data-testid="integration-flow-visual-empty"
          >
            <p class="max-w-sm text-sm text-slate-400">
              {{
                readonly
                  ? t('integrationFlowVisual.canvasEmptyReadonly')
                  : t('integrationFlowVisual.canvasEmpty')
              }}
            </p>
          </div>
          <VueFlow
            :id="instanceFlowId"
            v-model:nodes="vfNodes"
            v-model:edges="vfEdges"
            :node-types="nodeTypes"
            :nodes-draggable="!readonly"
            :nodes-connectable="!readonly"
            :elements-selectable="true"
            :snap-to-grid="!readonly"
            :snap-grid="SNAP_GRID"
            :delete-key-code="readonly ? null : 'Delete'"
            :fit-view-on-init="false"
            :min-zoom="0.2"
            :max-zoom="2"
            :zoom-on-scroll="true"
            :pan-on-scroll="false"
            :is-valid-connection="isValidConnection"
            class="iff-vue-flow h-full"
            data-testid="integration-flow-visual-vue-flow"
            @node-drag-stop="onNodeDragStop"
            @connect="onConnect"
            @edges-change="onEdgesChange"
            @nodes-change="onNodesChange"
            @node-click="onNodeClick"
            @nodes-initialized="onNodesInitialized"
          >
            <Background pattern-color="#334155" :gap="SNAP_GRID[0]" />
            <Controls
              :show-zoom="true"
              :show-fit-view="true"
              :show-interactive="false"
              data-testid="integration-flow-visual-controls"
            />
            <MiniMap
              pannable
              zoomable
              data-testid="integration-flow-visual-minimap"
            />
            <Panel position="top-right" class="iff-panel-actions">
              <button
                type="button"
                class="rounded-md border border-slate-600 bg-slate-900/90 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                data-testid="integration-flow-visual-fit-view"
                @click="fitViewAll"
              >
                {{ t('integrationFlowVisual.fitView') }}
              </button>
            </Panel>
            <template #node-integrationFlow="nodeProps">
              <IntegrationFlowNodeCard
                v-bind="nodeProps"
                @open-run-step="onOpenRunStepFromNode"
              />
            </template>
          </VueFlow>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.iff-panel-actions {
  margin: 8px;
}
.iff-canvas :deep(.vue-flow__minimap) {
  border-radius: 6px;
  border: 1px solid rgb(71 85 105 / 0.8);
}
.iff-canvas :deep(.vue-flow__controls) {
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
}
</style>
