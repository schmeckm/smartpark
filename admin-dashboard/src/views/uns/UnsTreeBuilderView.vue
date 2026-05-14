<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  createUnsNode,
  deleteUnsNode,
  downloadUnsHierarchySchema,
  getIntegrationSettings,
  getUnsTree,
  materializeUnsNodesFromIntegration,
  previewUnsHierarchySchema,
  updateUnsNode,
  uploadUnsHierarchySchema,
  type UnsHierarchyPreviewEntry,
  type UnsHierarchyPreviewResult,
  type UnsHierarchySchemaDoc,
  type UnsNode,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'

const { push } = useToast()

/** Typical tpuns domain segment (4th part of path). Not a server enum—any slug consistent with topicPath works. */
const DOMAIN_SLUG_SUGGESTIONS = [
  'rides',
  'restaurants',
  'shows',
  'shops',
  'hotels',
  'playgrounds',
  'services',
  'transport',
  'operations',
  'parks',
  'destinations',
  'entities',
] as const
const domainDatalistId = 'uns-domain-slug-suggestions'

const ENTITY_KINDS = ['ORGANIZATION', 'PARK', 'ZONE', 'ASSET', 'METRIC'] as const
type EntityKind = (typeof ENTITY_KINDS)[number]

const ALLOWED_CHILDREN: Record<string, EntityKind[]> = {
  _ROOT: ['ORGANIZATION', 'PARK', 'ZONE'],
  ORGANIZATION: ['PARK'],
  PARK: ['ZONE'],
  ZONE: ['ZONE', 'ASSET', 'METRIC'],
  ASSET: ['METRIC'],
  METRIC: [],
}

function effectiveEntityKind(n: UnsNode): EntityKind {
  const ek = (n.entityKind || '').trim()
  if (ek && (ENTITY_KINDS as readonly string[]).includes(ek)) return ek as EntityKind
  if (n.isLeaf) return 'METRIC'
  const nt = (n.nodeType || '').toUpperCase()
  if (nt === 'METRIC') return 'METRIC'
  return 'ZONE'
}

function allowedChildKinds(parent: UnsNode | null): EntityKind[] {
  const pk = parent ? effectiveEntityKind(parent) : '_ROOT'
  return [...(ALLOWED_CHILDREN[pk] || [])]
}

function sortSiblings(nodes: UnsNode[]): UnsNode[] {
  return [...nodes].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
  )
}

function sortTree(nodes: UnsNode[]): UnsNode[] {
  return sortSiblings(nodes).map((n) => ({
    ...n,
    children: n.children?.length ? sortTree(n.children) : [],
  }))
}

function findNode(nodes: UnsNode[], id: string): UnsNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) {
      const f = findNode(n.children, id)
      if (f) return f
    }
  }
  return null
}

function collectIdsWithChildren(nodes: UnsNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.children?.length) {
      out.push(n.id)
      out.push(...collectIdsWithChildren(n.children))
    }
  }
  return out
}

type FlatRow = { node: UnsNode; depth: number; hasChildren: boolean; isExpanded: boolean }

function flattenVisible(
  nodes: UnsNode[],
  depth: number,
  expanded: Set<string>,
  out: FlatRow[]
) {
  for (const node of sortSiblings(nodes)) {
    const kids = node.children || []
    const hasChildren = kids.length > 0
    const isExpanded = hasChildren && expanded.has(node.id)
    out.push({ node, depth, hasChildren, isExpanded })
    if (hasChildren && isExpanded) flattenVisible(kids, depth + 1, expanded, out)
  }
}

const parkId = ref('')
const schemaImportMode = ref<'merge' | 'replace'>('merge')
const hierarchyFileInput = ref<HTMLInputElement | null>(null)
const hierarchyPreviewFileInput = ref<HTMLInputElement | null>(null)
const hierarchyPreview = ref<UnsHierarchyPreviewResult | null>(null)
const tree = ref<UnsNode[]>([])
const expandedIds = ref<Set<string>>(new Set())
const selectedId = ref<string | null>(null)
const showAdvancedSchema = ref(false)
const showTreeTechHint = ref(false)
const showNodeTechDetails = ref(false)

const flatRows = computed(() => {
  const out: FlatRow[] = []
  flattenVisible(tree.value, 0, expandedIds.value, out)
  return out
})

const selectedNode = computed(() =>
  selectedId.value ? findNode(tree.value, selectedId.value) : null
)

/** Park key + parent names: reconciles the tpuns `.../europa_park/...` segment with the (flat) tree, which has no ORG/PARK materialized. */
const selectedContextBreadcrumb = computed(() => {
  const p = parkId.value.trim()
  if (!p || !selectedNode.value) return ''
  const names: string[] = []
  let cur: UnsNode | null = selectedNode.value
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    names.push(cur.name)
    cur = cur.parentId ? findNode(tree.value, cur.parentId) : null
  }
  return [p, ...names.slice().reverse()].join(' › ')
})

const detail = ref({
  name: '',
  description: '',
  isActive: true,
  entityKind: '' as string,
  sparkplugEnabled: false,
  isStructureLocked: false,
  sortOrder: 0,
  parentId: '' as string,
  domain: '',
  metric: '',
})

watch(
  selectedNode,
  (n) => {
    if (!n) {
      detail.value = {
        name: '',
        description: '',
        isActive: true,
        entityKind: '',
        sparkplugEnabled: false,
        isStructureLocked: false,
        sortOrder: 0,
        parentId: '',
        domain: '',
        metric: '',
      }
      return
    }
    detail.value = {
      name: n.name,
      description: n.description || '',
      isActive: n.isActive,
      entityKind: effectiveEntityKind(n),
      sparkplugEnabled: Boolean(n.sparkplugEnabled),
      isStructureLocked: Boolean(n.isStructureLocked),
      sortOrder: n.sortOrder ?? 0,
      parentId: n.parentId || '',
      domain: n.domain || '',
      metric: n.metric || '',
    }
  },
  { immediate: true }
)

const structureLocked = computed(() => Boolean(selectedNode.value?.isStructureLocked))

const allowedKindsForSelected = computed(() => {
  const n = selectedNode.value
  if (!n) return [] as EntityKind[]
  const parent = n.parentId ? findNode(tree.value, n.parentId) : null
  const base = allowedChildKinds(parent)
  const cur = effectiveEntityKind(n)
  if (!(base as readonly string[]).includes(cur)) return [...base, cur] as EntityKind[]
  return base
})

const canAddChild = computed(() => {
  const n = selectedNode.value
  if (!n) return false
  return allowedChildKinds(n).length > 0
})

const createParent = ref<UnsNode | null>(null)
const createForm = ref({
  name: '',
  entityKind: 'ZONE' as EntityKind,
  domain: 'rides',
  metric: 'queue_time',
  sparkplugEnabled: true,
  isStructureLocked: false,
  sortOrder: 0,
})

const allowedForCreate = computed(() => allowedChildKinds(createParent.value))

watch(createParent, () => {
  const opts = allowedForCreate.value
  if (!opts.includes(createForm.value.entityKind)) {
    createForm.value.entityKind = opts[0] ?? 'ZONE'
  }
})

watch(
  () => createForm.value.entityKind,
  (k) => {
    if (k !== 'METRIC') createForm.value.sparkplugEnabled = false
    else createForm.value.sparkplugEnabled = true
  }
)

function toggleExpanded(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function selectNode(id: string) {
  selectedId.value = id
}

function openCreateChild(parent: UnsNode) {
  createParent.value = parent
  const opts = allowedChildKinds(parent)
  createForm.value.entityKind = opts.includes('METRIC') ? 'ZONE' : opts[0] || 'ZONE'
  createForm.value.name = ''
  createForm.value.sortOrder = 0
  createForm.value.isStructureLocked = false
}

function openCreateRoot() {
  createParent.value = null
  const opts = allowedChildKinds(null)
  createForm.value.entityKind = opts.includes('ZONE') ? 'ZONE' : opts[0] || 'ZONE'
  createForm.value.name = ''
}

async function resolveParkId() {
  const settings = await getIntegrationSettings()
  const key = typeof settings.unsParkKey === 'string' ? settings.unsParkKey.trim() : ''
  const p = (settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId
  parkId.value = key || p || 'europa_park'
}

async function loadTree() {
  if (!parkId.value) await resolveParkId()
  const raw = await getUnsTree(parkId.value)
  tree.value = sortTree(raw)
  expandedIds.value = new Set(collectIdsWithChildren(tree.value))
}

async function materializeUns() {
  try {
    const r = await materializeUnsNodesFromIntegration()
    await loadTree()
    push(
      `Materialized UNS: ${r.totalLeaves} leaves (${r.leavesCreated} new, ${r.leavesUpdated} updated, ${r.pruned} pruned)`,
      'success'
    )
  } catch (e) {
    push(e instanceof Error ? e.message : 'Materialize failed', 'error')
  }
}

async function downloadHierarchySchema() {
  if (!parkId.value) await resolveParkId()
  try {
    await downloadUnsHierarchySchema(parkId.value)
    push('Hierarchy schema downloaded', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Download failed', 'error')
  }
}

function openHierarchyFilePicker() {
  hierarchyFileInput.value?.click()
}

async function onHierarchyFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!parkId.value) await resolveParkId()
  try {
    const text = await file.text()
    const doc = JSON.parse(text) as UnsHierarchySchemaDoc
    const summary = await uploadUnsHierarchySchema(parkId.value, doc, { mode: schemaImportMode.value })
    await loadTree()
    hierarchyPreview.value = null
    push(
      `Hierarchy import (${summary.mode}): created ${summary.created}, updated ${summary.updated}, skipped locked ${summary.skippedLocked}`,
      'success'
    )
  } catch (e) {
    push(e instanceof Error ? e.message : 'Import failed', 'error')
  }
}

function openHierarchyPreviewPicker() {
  hierarchyPreviewFileInput.value?.click()
}

function formatPreviewLine(entry: UnsHierarchyPreviewEntry): string {
  if (entry.action === 'replace_would_delete_all') {
    return `replace: would delete all ${entry.nodeCount} existing node(s) for this park`
  }
  const bits = [entry.action, entry.path]
  if ('name' in entry && entry.name) bits.push(`name=${entry.name}`)
  if ('id' in entry && entry.id) bits.push(`id=${entry.id}`)
  if ('note' in entry && entry.note) bits.push(`(${entry.note})`)
  return bits.join(' · ')
}

async function onHierarchyPreviewFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!parkId.value) await resolveParkId()
  try {
    const text = await file.text()
    const doc = JSON.parse(text) as UnsHierarchySchemaDoc
    hierarchyPreview.value = await previewUnsHierarchySchema(parkId.value, doc, { mode: schemaImportMode.value })
    push(
      `Preview: would create ${hierarchyPreview.value.created}, update ${hierarchyPreview.value.updated}, skip locked ${hierarchyPreview.value.skippedLocked}`,
      'success'
    )
  } catch (e) {
    hierarchyPreview.value = null
    push(e instanceof Error ? e.message : 'Preview failed', 'error')
  }
}

async function saveDetail() {
  const orig = selectedNode.value
  if (!orig) return
  const p: Record<string, unknown> = {}
  if (detail.value.name !== orig.name) p.name = detail.value.name
  const desc = detail.value.description.trim() ? detail.value.description : null
  if (desc !== (orig.description || null)) p.description = desc
  if (detail.value.isActive !== orig.isActive) p.isActive = detail.value.isActive

  if (!structureLocked.value) {
    if (detail.value.entityKind !== effectiveEntityKind(orig)) {
      p.entityKind = detail.value.entityKind
      p.isLeaf = detail.value.entityKind === 'METRIC'
    }
    if ((detail.value.parentId || null) !== (orig.parentId || null)) {
      p.parentId = detail.value.parentId.trim() || null
    }
    if (detail.value.sortOrder !== (orig.sortOrder ?? 0)) p.sortOrder = detail.value.sortOrder
    if (detail.value.isStructureLocked !== Boolean(orig.isStructureLocked)) {
      p.isStructureLocked = detail.value.isStructureLocked
    }
    if (effectiveEntityKind(orig) === 'METRIC' || detail.value.entityKind === 'METRIC') {
      const d = detail.value.domain.trim() || null
      const m = detail.value.metric.trim() || null
      if (d !== (orig.domain || null)) p.domain = d
      if (m !== (orig.metric || null)) p.metric = m
    }
    if (detail.value.entityKind === 'METRIC' || effectiveEntityKind(orig) === 'METRIC') {
      if (detail.value.sparkplugEnabled !== Boolean(orig.sparkplugEnabled)) {
        p.sparkplugEnabled = detail.value.sparkplugEnabled
      }
    }
  }

  if (Object.keys(p).length === 0) {
    push('No changes', 'info')
    return
  }
  try {
    await updateUnsNode(orig.id, p)
    await loadTree()
    push('UNS node saved', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  }
}

async function submitCreate() {
  if (!parkId.value || !createForm.value.name.trim()) {
    push('Name is required', 'error')
    return
  }
  const kind = createForm.value.entityKind
  const isLeaf = kind === 'METRIC'
  try {
    await createUnsNode(parkId.value, {
      name: createForm.value.name.trim(),
      parentId: createParent.value?.id || null,
      entityKind: kind,
      isLeaf,
      domain: createForm.value.domain.trim() || null,
      metric: isLeaf ? createForm.value.metric.trim() || null : null,
      sparkplugEnabled: kind === 'METRIC' ? createForm.value.sparkplugEnabled : false,
      isStructureLocked: createForm.value.isStructureLocked,
      sortOrder: createForm.value.sortOrder,
      parkSlug: parkId.value,
    })
    createForm.value.name = ''
    createParent.value = null
    await loadTree()
    push('Node created', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Create failed', 'error')
  }
}

async function removeNode(node: UnsNode) {
  if (node.isStructureLocked) {
    push('Structure locked: cannot delete', 'error')
    return
  }
  const ok = await askConfirm({
    message: `Delete node "${node.name}"?`,
    confirmLabel: 'Ja',
    cancelLabel: 'Abbrechen',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await deleteUnsNode(node.id)
    if (selectedId.value === node.id) selectedId.value = null
    await loadTree()
    push('Node deleted', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

function kindBadgeClass(kind: string) {
  if (kind === 'METRIC') return 'bg-emerald-900/50 text-emerald-200 ring-emerald-700/40'
  if (kind === 'ASSET') return 'bg-amber-900/40 text-amber-200 ring-amber-700/30'
  if (kind === 'ZONE') return 'bg-slate-700/80 text-slate-200 ring-slate-600/50'
  if (kind === 'PARK') return 'bg-indigo-900/50 text-indigo-200 ring-indigo-700/40'
  if (kind === 'ORGANIZATION') return 'bg-violet-900/40 text-violet-200 ring-violet-700/30'
  return 'bg-slate-800 text-slate-400 ring-slate-700'
}

onMounted(() => {
  void loadTree()
})
</script>

<template>
  <div class="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
    <datalist :id="domainDatalistId">
      <option v-for="d in DOMAIN_SLUG_SUGGESTIONS" :key="d" :value="d" />
    </datalist>
    <div>
      <h1 class="font-display text-xl font-semibold text-white">UNS Explorer</h1>
      <p class="mt-1 text-sm text-slate-400">Bearbeite den Namespace-Baum pro Park. Basisaktionen sind oben, technische Import-/Schema-Tools optional.</p>
    </div>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-slate-400">
        Park key: <span class="font-mono text-white">{{ parkId || '—' }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="loadTree"
          >
            Refresh
          </button>
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
            @click="materializeUns"
          >
            Materialize UNS
          </button>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-500"
            @click="openCreateRoot"
          >
            Add root node
          </button>
        </div>
      </div>
    </section>

    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        @click="showAdvancedSchema = !showAdvancedSchema"
      >
        <span class="text-sm font-semibold text-white">Advanced: Hierarchy schema (Import/Export)</span>
        <span class="text-xs text-slate-400">{{ showAdvancedSchema ? 'ausblenden' : 'einblenden' }}</span>
      </button>
      <div v-if="showAdvancedSchema" class="mt-3">
        <p class="text-xs text-slate-500">
          JSON-Schema fuer Massen-Import/Export. <span class="font-semibold text-amber-200/90">Replace</span> loescht zuerst alle Knoten dieses Parks.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="downloadHierarchySchema"
          >
            Download JSON
          </button>
          <input ref="hierarchyFileInput" type="file" accept="application/json,.json" class="hidden" @change="onHierarchyFile" />
          <button
            type="button"
            class="rounded-md bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-600"
            @click="openHierarchyFilePicker"
          >
            Upload JSON…
          </button>
          <input
            ref="hierarchyPreviewFileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onHierarchyPreviewFile"
          />
          <button
            type="button"
            class="rounded-md border border-cyan-800/60 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/70"
            @click="openHierarchyPreviewPicker"
          >
            Preview JSON…
          </button>
          <div class="flex items-center gap-2 text-xs text-slate-400">
            <label class="flex cursor-pointer items-center gap-1.5">
              <input v-model="schemaImportMode" type="radio" value="merge" class="border-slate-600" />
              Merge
            </label>
            <label class="flex cursor-pointer items-center gap-1.5">
              <input v-model="schemaImportMode" type="radio" value="replace" class="border-slate-600" />
              Replace
            </label>
          </div>
        </div>
        <div v-if="hierarchyPreview" class="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Dry-run (no DB writes)</span>
            <button type="button" class="text-slate-500 underline hover:text-slate-300" @click="hierarchyPreview = null">
              Dismiss
            </button>
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            {{ hierarchyPreview.preview.length }} operation(s) — first 40 lines:
          </p>
          <pre class="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-slate-300">{{
            hierarchyPreview.preview.slice(0, 40).map(formatPreviewLine).join('\n')
          }}</pre>
        </div>
      </div>
    </section>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <!-- Tree -->
      <section class="rounded-xl border border-slate-800 bg-slate-900/60">
        <div class="border-b border-slate-800 px-3 py-2">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Namespace tree</p>
          <p class="mt-1 text-[10px] leading-relaxed text-slate-500">Baumansicht fuer Zonen, Assets und Metriken dieses Parks.</p>
          <button type="button" class="mt-1 text-[10px] text-slate-400 underline hover:text-slate-200" @click="showTreeTechHint = !showTreeTechHint">
            {{ showTreeTechHint ? 'Technische Hinweise ausblenden' : 'Technische Hinweise anzeigen' }}
          </button>
          <p v-if="showTreeTechHint" class="mt-1 text-[10px] leading-relaxed text-slate-500">
            Nach <span class="text-slate-400">Materialize UNS</span> entstehen pro Domain ZONE-Wurzeln mit METRIC-Kindern.
            Organisation/Park werden hier nicht als eigene Nodes angelegt; der Park steckt im Topic-Pfad.
          </p>
        </div>
        <div class="max-h-[min(70vh,720px)] overflow-auto p-2">
          <div v-if="!flatRows.length" class="px-2 py-8 text-center text-sm text-slate-500">No nodes</div>
          <div
            v-for="{ node, depth, hasChildren, isExpanded } in flatRows"
            :key="node.id"
            class="flex items-start gap-1 rounded-md py-0.5 pr-2 hover:bg-slate-800/60"
            :class="selectedId === node.id ? 'bg-slate-800/90 ring-1 ring-indigo-500/40' : ''"
            :style="{ paddingLeft: `${8 + depth * 16}px` }"
          >
            <button
              v-if="hasChildren"
              type="button"
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
              :aria-expanded="isExpanded"
              @click.stop="toggleExpanded(node.id)"
            >
              <span class="text-[10px]">{{ isExpanded ? '▼' : '▶' }}</span>
            </button>
            <span v-else class="mt-0.5 inline-block w-7 shrink-0" />

            <button
              type="button"
              class="min-w-0 flex-1 rounded py-1 text-left text-sm text-slate-200 hover:bg-slate-800/40 hover:text-white"
              @click="selectNode(node.id)"
            >
              <div class="truncate">{{ node.name }}</div>
              <div
                v-if="node.isLeaf && node.topicPath"
                class="mt-0.5 break-all font-mono text-[10px] leading-snug text-slate-500"
                :title="String(node.topicPath)"
              >
                {{ node.topicPath }}
              </div>
              <div
                v-if="node.isLeaf && node.sparkplugTopic"
                class="break-all font-mono text-[10px] leading-snug text-slate-500/90"
                :title="String(node.sparkplugTopic)"
              >
                {{ node.sparkplugTopic }}
              </div>
            </button>

            <span
              class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset"
              :class="kindBadgeClass(effectiveEntityKind(node))"
            >
              {{ effectiveEntityKind(node) }}
            </span>
            <span v-if="node.sparkplugEnabled" class="mt-0.5 shrink-0 text-[10px] text-emerald-400" title="Sparkplug">SP</span>
            <span v-if="node.isStructureLocked" class="mt-0.5 shrink-0 text-[10px] text-amber-400" title="Structure locked">🔒</span>
          </div>
        </div>
      </section>

      <!-- Detail + create -->
      <div class="space-y-4">
        <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 class="text-sm font-semibold text-white">Create node</h2>
          <p class="mt-1 text-xs text-slate-500">
            Parent:
            <span class="font-mono text-slate-300">{{ createParent ? createParent.name : '(root)' }}</span>
          </p>
          <div class="mt-3 space-y-3">
            <label class="block text-xs text-slate-400">
              Name
              <input
                v-model="createForm.name"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                placeholder="Display name"
              />
            </label>
            <label class="block text-xs text-slate-400">
              entityKind
              <select
                v-model="createForm.entityKind"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              >
                <option v-for="k in allowedForCreate" :key="k" :value="k">{{ k }}</option>
              </select>
            </label>
            <template v-if="createForm.entityKind === 'METRIC'">
              <label class="block text-xs text-slate-400">
                Domain
                <p class="mb-1 mt-0.5 text-[10px] font-normal leading-relaxed text-slate-500">
                  <strong class="text-slate-400">Tree:</strong> groups leaves under one zone per value (Rides, Restaurants, …).
                  <strong class="text-slate-400">Path:</strong> the same slug is the domain segment in <span class="font-mono">tpuns/…/v1/…/…</span> — keep them aligned.
                </p>
                <input
                  v-model="createForm.domain"
                  :list="domainDatalistId"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  placeholder="e.g. rides, restaurants, my_custom"
                />
              </label>
              <label class="block text-xs text-slate-400">
                Metric
                <input
                  v-model="createForm.metric"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label class="flex items-center gap-2 text-xs text-slate-300">
                <input v-model="createForm.sparkplugEnabled" type="checkbox" class="rounded border-slate-600" />
                Sparkplug for this metric topic
              </label>
            </template>
            <label class="block text-xs text-slate-400">
              sortOrder
              <input
                v-model.number="createForm.sortOrder"
                type="number"
                min="0"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label class="flex items-center gap-2 text-xs text-slate-300">
              <input v-model="createForm.isStructureLocked" type="checkbox" class="rounded border-slate-600" />
              Lock structure after create
            </label>
            <div class="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                class="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-500"
                @click="submitCreate"
              >
                Create
              </button>
              <button
                v-if="createParent"
                type="button"
                class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                @click="createParent = null"
              >
                Clear parent
              </button>
            </div>
          </div>
        </section>

        <section v-if="selectedNode" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p
            v-if="selectedContextBreadcrumb"
            class="mb-3 text-[10px] leading-relaxed text-slate-500"
            title="Park key and ancestor names in this tree (sync does not add ORG/PARK rows)"
          >
            <span class="text-slate-500">Context</span>
            <code class="mt-0.5 block break-all text-slate-300">{{ selectedContextBreadcrumb }}</code>
          </p>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h2 class="text-sm font-semibold text-white">Edit node</h2>
            <div class="flex flex-wrap gap-2">
              <button
                v-if="canAddChild"
                type="button"
                class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                @click="openCreateChild(selectedNode)"
              >
                Add child
              </button>
              <button
                type="button"
                class="rounded border border-rose-800 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/50 disabled:opacity-40"
                :disabled="selectedNode.isStructureLocked"
                @click="removeNode(selectedNode)"
              >
                Delete
              </button>
            </div>
          </div>
          <button type="button" class="mt-2 text-[11px] text-slate-400 underline hover:text-slate-200" @click="showNodeTechDetails = !showNodeTechDetails">
            {{ showNodeTechDetails ? 'Technische Details ausblenden' : 'Technische Details anzeigen' }}
          </button>
          <div v-if="showNodeTechDetails" class="mt-2 space-y-1.5 rounded border border-slate-700/80 bg-slate-950/60 p-2 text-[11px]">
            <div>
              <span class="text-slate-500">TP-UNS</span>
              <code class="mt-0.5 block break-all text-slate-300">{{ selectedNode.topicPath || '—' }}</code>
            </div>
            <div v-if="selectedNode.isLeaf && (selectedNode.sparkplugTopic != null || selectedNode.sparkplug)">
              <span class="text-slate-500">Sparkplug ({{ selectedNode.sparkplugMessageType || 'DDATA' }})</span>
              <code class="mt-0.5 block break-all text-slate-300">{{
                selectedNode.sparkplugTopic || '—'
              }}</code>
            </div>
            <p
              v-if="selectedNode.sparkplug?.groupId"
              class="pt-1 text-[10px] text-slate-500"
            >
              group <span class="font-mono text-slate-400">{{ selectedNode.sparkplug?.groupId }}</span> · edge
              <span class="font-mono text-slate-400">{{ selectedNode.sparkplug?.edgeNodeId }}</span>
            </p>
          </div>

          <div class="mt-4 space-y-3">
            <label class="block text-xs text-slate-400">
              Name
              <input
                v-model="detail.name"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label class="block text-xs text-slate-400">
              Description
              <textarea
                v-model="detail.description"
                rows="2"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label class="flex items-center gap-2 text-xs text-slate-300">
              <input v-model="detail.isActive" type="checkbox" class="rounded border-slate-600" />
              Active <span class="text-slate-500">(saved with Save below)</span>
            </label>

            <template v-if="!structureLocked">
              <label class="block text-xs text-slate-400">
                entityKind
                <select
                  v-model="detail.entityKind"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                >
                  <option v-for="k in allowedKindsForSelected" :key="k" :value="k">{{ k }}</option>
                </select>
              </label>
              <p v-if="!allowedKindsForSelected.length" class="text-[11px] text-amber-400/90">
                No allowed kinds for this parent context.
              </p>
              <label class="block text-xs text-slate-400">
                parentId (UUID, empty = root)
                <input
                  v-model="detail.parentId"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
                  placeholder="optional"
                />
              </label>
              <label class="block text-xs text-slate-400">
                sortOrder
                <input
                  v-model.number="detail.sortOrder"
                  type="number"
                  min="0"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                />
              </label>
            </template>
            <p v-else class="rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-200/90">
              Structure locked: entityKind, parent, sort order, and metric fields are fixed. Name, description, and active remain editable.
            </p>

            <template v-if="!structureLocked && (detail.entityKind === 'METRIC' || selectedNode.isLeaf)">
              <label class="block text-xs text-slate-400">
                Domain
                <p class="mb-1 mt-0.5 text-[10px] font-normal leading-relaxed text-slate-500">
                  <strong class="text-slate-400">Tree:</strong> which zone folder this leaf belongs to (sibling metrics share the same domain).
                  <strong class="text-slate-400">Path:</strong> same slug in <span class="font-mono">topicPath</span> — do not desync.
                </p>
                <input
                  v-model="detail.domain"
                  :list="domainDatalistId"
                  autocomplete="off"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  placeholder="e.g. rides, restaurants"
                />
              </label>
              <label class="block text-xs text-slate-400">
                Metric
                <input
                  v-model="detail.metric"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label class="flex items-center gap-2 text-xs text-slate-300">
                <input v-model="detail.sparkplugEnabled" type="checkbox" class="rounded border-slate-600" />
                Sparkplug
              </label>
            </template>

            <label v-if="!structureLocked" class="flex items-center gap-2 text-xs text-slate-300">
              <input v-model="detail.isStructureLocked" type="checkbox" class="rounded border-slate-600" />
              Lock structure
            </label>

            <button
              type="button"
              class="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              @click="saveDetail"
            >
              Save
            </button>
          </div>
        </section>

        <section v-else class="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center text-sm text-slate-500">
          Select a node in the tree or create one above.
        </section>
      </div>
    </div>
  </div>
</template>
