<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getPlatformParkZones,
  getRideSignalCapabilities,
  getSparkplugTopicPreviewForAsset,
  getUnsMqttLiveEvents,
  getUnsMqttLiveStatus,
  listAssetPdmRules,
  listMasterData,
  postUnsMqttLiveTestEvent,
  publishUnsTest,
  putRideSignalCapabilities,
  type AssetPdmRuleRow,
  type MasterDataGridRow,
  type PlatformParkZoneRow,
  type RideSignalCapabilitiesPayload,
  type RideSignalCapabilitySignalRow,
  type RideSignalSource,
  type SparkplugTopicPreviewPayload,
  type UnsMqttLiveEvent,
  type UnsMqttLiveStatus,
} from '@/api/client'
import { collectMatchingLiveEvents, pickLatestLiveEvent } from '@/composables/unsGovernanceHelpers'
import { resolveRawMqttSparkplugGroupKey, slugifyUnsParkKey } from '@/composables/useOeeMqttCockpit'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import type { PlatformPark } from '@/types/api'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()
const auth = useAuthStore()
const parkContext = useParkContextStore()

type TreeKind = 'park' | 'zone' | 'edge' | 'ride' | 'component' | 'signal'

type SparkEdge = {
  id: string
  label: string
  edgeNodeId: string
  zoneKey: string
  role: string
  notes: string
}

type HierarchyNode = {
  id: string
  kind: TreeKind
  label: string
  searchBlob: string
  children: HierarchyNode[]
  zone?: PlatformParkZoneRow
  edge?: SparkEdge
  ride?: MasterDataGridRow
  componentKey?: string
  signal?: RideSignalCapabilitySignalRow
  rideAssetId?: string
  /** Lowercase UNS ride segment (`/rides/{slug}/…`) for scoping MQTT buffer rows. */
  rideSlug?: string
  park?: Pick<PlatformPark, 'id' | 'name' | 'slug' | 'externalEntityId' | 'masterProfile'>
}

const UNASSIGNED = '__unassigned__'

function readSparkEdges(park: Pick<PlatformPark, 'masterProfile'> | null): {
  defaultEdgeNodeId: string
  edges: SparkEdge[]
} {
  const raw =
    park?.masterProfile && typeof park.masterProfile === 'object'
      ? (park.masterProfile as { sparkplug?: Record<string, unknown> }).sparkplug
      : undefined
  if (!raw || typeof raw !== 'object') return { defaultEdgeNodeId: '', edges: [] }
  const rawRec = raw as Record<string, unknown>
  const def = sparkRecordStr(rawRec, 'defaultEdgeNodeId').trim()
  const list = Array.isArray((raw as { edges?: unknown }).edges) ? (raw as { edges: unknown[] }).edges : []
  const edges: SparkEdge[] = list.map((row, idx) => {
    const e = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    return {
      id: typeof e.id === 'string' && e.id ? e.id : `edge_${idx}`,
      label: sparkRecordStr(e, 'label'),
      edgeNodeId: sparkRecordStr(e, 'edgeNodeId'),
      zoneKey: sparkRecordStr(e, 'zoneKey'),
      role: sparkRecordStr(e, 'role'),
      notes: sparkRecordStr(e, 'notes'),
    }
  })
  return { defaultEdgeNodeId: def, edges }
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function zoneRowForRide(zones: PlatformParkZoneRow[], ride: MasterDataGridRow): PlatformParkZoneRow | null {
  const rideWithZoneHints = ride as MasterDataGridRow & {
    zoneId?: string | null
    zoneSlug?: string | null
  }
  const zid = norm(String(rideWithZoneHints.zoneId ?? ''))
  if (zid) {
    const byId = zones.find((z) => norm(String(z.id || '')) === zid)
    if (byId) return byId
  }

  const zslug = norm(String(rideWithZoneHints.zoneSlug ?? ''))
  if (zslug) {
    const bySlug = zones.find((z) => norm(String(z.slug || '')) === zslug)
    if (bySlug) return bySlug
  }

  const zn = norm(ride.zoneName || '')
  if (zn) {
    const byName = zones.find((z) => norm(z.name) === zn)
    if (byName) return byName
    const bySlugFromName = zones.find((z) => norm(String(z.slug || '')) === zn)
    if (bySlugFromName) return bySlugFromName
  }
  return null
}

function edgesForZoneSlug(edges: SparkEdge[], zoneSlug: string, defaultEdge: string): SparkEdge[] {
  const matched = edges.filter((e) => norm(e.zoneKey) === norm(zoneSlug))
  if (matched.length) return matched
  if (defaultEdge.trim()) {
    return [
      {
        id: `synthetic_${zoneSlug}`,
        label: '',
        edgeNodeId: defaultEdge,
        zoneKey: zoneSlug,
        role: '',
        notes: '',
      },
    ]
  }
  return []
}

function primaryEdgeIndex(edges: SparkEdge[]): number {
  const i = edges.findIndex((e) => e.role === 'PRIMARY')
  return i >= 0 ? i : 0
}

function parsePdmMetric(
  sparkplugMetricPreview: string | null | undefined,
  signalCode: string
): { componentKey: string; signalKey: string; metric: string } {
  const raw = (sparkplugMetricPreview || '').trim()
  const m = raw.match(/^pdm\.([^.]+)\.(.+)$/i)
  if (m) return { componentKey: m[1], signalKey: m[2], metric: `pdm.${m[1]}.${m[2]}` }
  const sk = signalCode.trim()
  return { componentKey: 'ride', signalKey: sk, metric: `pdm.ride.${sk}` }
}

function isOeeSignalCode(code: string): boolean {
  return /oee|availability|performance|quality|cycle|dispatch|throughput|downtime|mtbf|mttr|queue/i.test(
    String(code || '')
  )
}

function sparkplugDdataTopic(groupId: string, edgeNodeId: string, deviceId: string): string {
  return `spBv1.0/${groupId}/DDATA/${edgeNodeId}/${deviceId}`
}

type CategoryFilter = { operations: boolean; ml: boolean; forecast: boolean; pdm: boolean; oee: boolean }
type StatusFilter = { active: boolean; prepared: boolean; missing: boolean; live: boolean }
const categoryFilter = reactive<CategoryFilter>({
  operations: true,
  ml: true,
  forecast: true,
  pdm: true,
  oee: true,
})
const statusFilter = reactive<StatusFilter>({
  active: true,
  prepared: true,
  missing: true,
  live: true,
})

const search = ref('')
const expanded = ref<Set<string>>(new Set())
const selectedId = ref<string | null>(null)
const busy = ref(false)

const zones = ref<PlatformParkZoneRow[]>([])
const rideRows = ref<MasterDataGridRow[]>([])
const liveStatus = ref<UnsMqttLiveStatus | null>(null)
const liveEvents = ref<UnsMqttLiveEvent[]>([])

const capabilitiesCache = ref<Record<string, RideSignalCapabilitiesPayload>>({})
const pdmRulesCache = ref<Record<string, AssetPdmRuleRow[]>>({})
const sparkPreviewCache = ref<Record<string, SparkplugTopicPreviewPayload>>({})

const mqttGroupResolved = ref<string>('')
const signalBusy = ref(false)
const testPayloadJson = ref('{"value": 42}')
const treeRevision = ref(0)

const canReadIntegrations = computed(() => auth.hasPermission('integrations', 'read'))
const canManageIntegrations = computed(() => auth.hasPermission('integrations', 'manage'))
const canUpdateRides = computed(() => auth.hasPermission('rides', 'update'))

function sparkRecordStr(obj: Record<string, unknown>, camelKey: string): string {
  const snakeKey = camelKey.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
  const v = obj[camelKey] ?? obj[snakeKey]
  return v == null ? '' : String(v)
}

function readParkGroupId(park: Pick<PlatformPark, 'masterProfile'> | null): string {
  const mp = park?.masterProfile && typeof park.masterProfile === 'object' ? park.masterProfile : null
  const sp =
    mp && typeof (mp as { sparkplug?: unknown }).sparkplug === 'object'
      ? (mp as { sparkplug: Record<string, unknown> }).sparkplug
      : null
  if (sp) {
    const g = sparkRecordStr(sp, 'groupId')
    if (g.trim()) return g.trim()
  }
  return ''
}

function nodeMatchesSearch(n: HierarchyNode, q: string): boolean {
  if (!q) return true
  return n.searchBlob.includes(q)
}

function categoryHitsSignal(sig: RideSignalCapabilitySignalRow, pdmRules: AssetPdmRuleRow[]): boolean {
  const hasPdm = pdmRules.some((r) => norm(r.metricName) === norm(sig.signalCode))
  const ml = Boolean(sig.useForMl)
  const fc = Boolean(sig.useForForecast)
  const oee = isOeeSignalCode(sig.signalCode)
  const ops = !ml && !fc && !hasPdm && !oee
  if (categoryFilter.ml && ml) return true
  if (categoryFilter.forecast && fc) return true
  if (categoryFilter.pdm && hasPdm) return true
  if (categoryFilter.oee && oee) return true
  if (categoryFilter.operations && ops) return true
  return !(
    categoryFilter.operations ||
    categoryFilter.ml ||
    categoryFilter.forecast ||
    categoryFilter.pdm ||
    categoryFilter.oee
  )
}

function statusHitsSignal(sig: RideSignalCapabilitySignalRow, liveKeys: Set<string>): boolean {
  const active = Boolean(sig.isActiveTopic || sig.isActiveSparkplug)
  const prepared = Boolean(sig.isPreparedTopic || sig.isPreparedSparkplug) && !active
  const eligible = sig.signalSource !== 'NOT_AVAILABLE' && sig.signalSource !== 'MASTER_DATA'
  const missing = eligible && !sig.isPreparedTopic && !sig.isPreparedSparkplug && !active
  const parts = parsePdmMetric(sig.sparkplugMetricPreview, sig.signalCode)
  const live =
    liveKeys.has(norm(sig.signalCode)) ||
    liveKeys.has(norm(parts.metric)) ||
    liveKeys.has(norm(`${parts.componentKey}.${parts.signalKey}`))

  if (statusFilter.active && active) return true
  if (statusFilter.prepared && prepared) return true
  if (statusFilter.missing && missing) return true
  if (statusFilter.live && live) return true
  return !(
    statusFilter.active ||
    statusFilter.prepared ||
    statusFilter.missing ||
    statusFilter.live
  )
}

function filterTree(
  nodes: HierarchyNode[],
  q: string,
  ridePdm: Map<string, AssetPdmRuleRow[]>,
  liveKeys: Set<string>
): HierarchyNode[] {
  const out: HierarchyNode[] = []
  for (const n of nodes) {
    const kids = n.children.length ? filterTree(n.children, q, ridePdm, liveKeys) : []
    if (n.kind === 'signal') {
      const sig = n.signal!
      const rules = ridePdm.get(n.rideAssetId || '') ?? []
      if (!categoryHitsSignal(sig, rules)) continue
      if (!statusHitsSignal(sig, liveKeys)) continue
      if (!nodeMatchesSearch(n, q) && !kids.length) continue
      out.push({ ...n, children: kids })
      continue
    }
    if (kids.length || (nodeMatchesSearch(n, q) && n.kind !== 'component')) {
      out.push({ ...n, children: kids })
    } else if (n.kind === 'component' && nodeMatchesSearch(n, q)) {
      out.push({ ...n, children: kids })
    }
  }
  return out
}

const liveMetricKeys = computed(() => {
  const s = new Set<string>()
  for (const e of liveEvents.value) {
    const m = norm(String(e.metric || ''))
    if (m) s.add(m)
  }
  return s
})

const pdmByRide = computed(() => {
  const m = new Map<string, AssetPdmRuleRow[]>()
  for (const [rid, rules] of Object.entries(pdmRulesCache.value)) {
    m.set(rid, rules)
  }
  return m
})

const filteredRoots = computed(() => {
  void treeRevision.value
  void liveMetricKeys.value
  const q = norm(search.value)
  const base = treeRoots.value
  if (!q && categoryFilter.operations && categoryFilter.ml && categoryFilter.forecast && categoryFilter.pdm && categoryFilter.oee && statusFilter.active && statusFilter.prepared && statusFilter.missing && statusFilter.live) {
    return base
  }
  return filterTree(base, q, pdmByRide.value, liveMetricKeys.value)
})

function findNode(nodes: HierarchyNode[], id: string): HierarchyNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const f = findNode(n.children, id)
    if (f) return f
  }
  return null
}

const selectedNode = computed(() => (selectedId.value ? findNode(treeRoots.value, selectedId.value) : null))

const treeRoots = ref<HierarchyNode[]>([])

async function refreshMqttGroupAndLive() {
  const park = parkContext.activePark
  const parkId = parkContext.activeParkId
  if (!parkId || !park) {
    mqttGroupResolved.value = ''
    liveStatus.value = null
    liveEvents.value = []
    return
  }
  const raw = resolveRawMqttSparkplugGroupKey(park.slug, parkId)
  const base = slugifyUnsParkKey(raw)
  if (!canReadIntegrations.value) {
    mqttGroupResolved.value = base.toLowerCase()
    liveEvents.value = []
    liveStatus.value = null
    return
  }
  try {
    setApiParkContextId(parkId)
    const st = await getUnsMqttLiveStatus(base)
    liveStatus.value = st
    const g =
      st.mqttGroupId != null && String(st.mqttGroupId).trim() !== ''
        ? String(st.mqttGroupId).toLowerCase()
        : base.toLowerCase()
    mqttGroupResolved.value = g
    liveEvents.value = await getUnsMqttLiveEvents(g, { limit: 2000 })
  } catch {
    mqttGroupResolved.value = base.toLowerCase()
    liveEvents.value = []
    liveStatus.value = null
  }
}

async function loadAllRides(parkId: string): Promise<MasterDataGridRow[]> {
  const acc: MasterDataGridRow[] = []
  const pageSize = 200
  for (let page = 0; page < 40; page += 1) {
    const res = await listMasterData('rides', { parkId, page, pageSize })
    acc.push(...res.rows)
    if (res.rows.length < pageSize) break
    if (acc.length >= res.total) break
  }
  return acc.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
}

function rebuildSkeletonTree() {
  const park = parkContext.activePark
  const parkId = parkContext.activeParkId
  if (!parkId || !park) {
    treeRoots.value = []
    return
  }

  const { defaultEdgeNodeId, edges } = readSparkEdges(park)
  const groupDisplay = readParkGroupId(park) || mqttGroupResolved.value || slugifyUnsParkKey(park.slug || parkId)

  const ridesByZone = new Map<string, MasterDataGridRow[]>()
  for (const r of rideRows.value) {
    const z = zoneRowForRide(zones.value, r)
    const key = z ? z.id : UNASSIGNED
    const list = ridesByZone.get(key) ?? []
    list.push(r)
    ridesByZone.set(key, list)
  }

  const zoneNodes: HierarchyNode[] = []

  for (const z of [...zones.value].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))) {
    const zoneEdges = edgesForZoneSlug(edges, z.slug, defaultEdgeNodeId)
    const peIdx = primaryEdgeIndex(zoneEdges)
    const zoneRides = ridesByZone.get(z.id) ?? []

    const edgeChildren: HierarchyNode[] = zoneEdges.map((edge, idx) => {
      const edgeNodeId = edge.edgeNodeId.trim() || defaultEdgeNodeId.trim() || 'edge'
      const rideChildren: HierarchyNode[] =
        idx === peIdx
          ? zoneRides.map((ride) => ({
              id: `ride:${ride.id}`,
              kind: 'ride' as const,
              label: ride.name || ride.slug || ride.id,
              searchBlob: norm(`${ride.name} ${ride.slug} ${ride.id} ${ride.externalId || ''}`),
              children: [],
              ride,
              rideAssetId: ride.id,
              park,
            }))
          : []

      return {
        id: `edge:${z.id}:${edge.id}:${edgeNodeId}`,
        kind: 'edge' as const,
        label: edge.label?.trim()
          ? `${edge.label} · ${edgeNodeId}`
          : edgeNodeId,
        searchBlob: norm(`${edge.label} ${edgeNodeId} ${edge.role} ${edge.notes}`),
        children: rideChildren,
        zone: z,
        edge,
        park,
      }
    })

    zoneNodes.push({
      id: `zone:${z.id}`,
      kind: 'zone',
      label: z.name,
      searchBlob: norm(`${z.name} ${z.slug} ${z.externalEntityId || ''}`),
      children: edgeChildren,
      zone: z,
      park,
    })
  }

  const unassignedRides = ridesByZone.get(UNASSIGNED) ?? []
  if (unassignedRides.length) {
    const fallbackEdge = defaultEdgeNodeId.trim() || (edges[0]?.edgeNodeId ?? '')
    zoneNodes.push({
      id: `zone:${UNASSIGNED}`,
      kind: 'zone',
      label: t('unsHierarchyExplorer.unassignedZone'),
      searchBlob: norm(t('unsHierarchyExplorer.unassignedZone')),
      children: [
        {
          id: `edge:${UNASSIGNED}:${fallbackEdge || 'none'}`,
          kind: 'edge',
          label: fallbackEdge || t('unsHierarchyExplorer.noEdge'),
          searchBlob: norm(fallbackEdge),
          children: unassignedRides.map((ride) => ({
            id: `ride:${ride.id}`,
            kind: 'ride' as const,
            label: ride.name || ride.slug || ride.id,
            searchBlob: norm(`${ride.name} ${ride.slug} ${ride.id}`),
            children: [],
            ride,
            rideAssetId: ride.id,
            park,
          })),
          park,
        },
      ],
      park,
    })
  }

  treeRoots.value = [
    {
      id: `park:${parkId}`,
      kind: 'park',
      label: park.name || park.slug,
      searchBlob: norm(`${park.name} ${park.slug} ${groupDisplay}`),
      children: zoneNodes,
      park,
    },
  ]

  expanded.value = new Set([`park:${parkId}`])
  treeRevision.value++
}

async function loadRideBranch(rideNode: HierarchyNode) {
  const rideId = rideNode.rideAssetId
  if (!rideId || rideNode.kind !== 'ride') return

  if (!capabilitiesCache.value[rideId]) {
    try {
      setApiParkContextId(parkContext.activeParkId)
      const [caps, pdm] = await Promise.all([
        getRideSignalCapabilities(rideId),
        listAssetPdmRules(rideId).catch(() => ({ rules: [] as AssetPdmRuleRow[] })),
      ])
      capabilitiesCache.value[rideId] = caps
      pdmRulesCache.value[rideId] = pdm.rules ?? []
    } catch (e) {
      push(e instanceof Error ? e.message : t('unsHierarchyExplorer.capabilitiesLoadFailed'), 'error')
      return
    }
  }

  if (!sparkPreviewCache.value[rideId] && parkContext.activeParkId) {
    try {
      setApiParkContextId(parkContext.activeParkId)
      sparkPreviewCache.value[rideId] = await getSparkplugTopicPreviewForAsset(parkContext.activeParkId, {
        assetId: rideId,
        messageType: 'DDATA',
      })
    } catch {
      sparkPreviewCache.value[rideId] = {
        assetSlug: rideNode.ride?.slug ?? null,
        zoneSlug: null,
        edgeNodeId: '',
        topicPreview: '',
        source: 'error',
        fallbackUsed: true,
        groupId: mqttGroupResolved.value,
      }
    }
  }

  const caps = capabilitiesCache.value[rideId]
  const rideSlug = sparkplugDeviceForRide(rideId)
  const byComp = new Map<string, RideSignalCapabilitySignalRow[]>()
  for (const s of caps.signals) {
    const { componentKey } = parsePdmMetric(s.sparkplugMetricPreview, s.signalCode)
    const list = byComp.get(componentKey) ?? []
    list.push(s)
    byComp.set(componentKey, list)
  }

  const compNodes: HierarchyNode[] = [...byComp.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([componentKey, signals]) => {
      const sorted = [...signals].sort((a, b) => a.signalCode.localeCompare(b.signalCode, undefined, { sensitivity: 'base' }))
      const ruleSet = new Set((pdmRulesCache.value[rideId] || []).map((r) => norm(r.metricName)))
      const signalNodes: HierarchyNode[] = sorted.map((sig) => {
        const parts = parsePdmMetric(sig.sparkplugMetricPreview, sig.signalCode)
        return {
          id: `sig:${rideId}:${sig.signalCatalogId}`,
          kind: 'signal' as const,
          label: sig.label?.trim() ? `${sig.signalCode} — ${sig.label}` : sig.signalCode,
          searchBlob: norm(`${sig.signalCode} ${sig.label || ''} ${parts.metric} ${sig.description || ''}`),
          children: [],
          signal: sig,
          rideAssetId: rideId,
          rideSlug,
          componentKey,
          park: rideNode.park,
        }
      })

      return {
        id: `comp:${rideId}:${componentKey}`,
        kind: 'component' as const,
        label: `${componentKey} (${sorted.length})`,
        searchBlob: norm(`${componentKey} ${ruleSet.has(norm(componentKey)) ? 'pdm' : ''}`),
        children: signalNodes,
        componentKey,
        rideAssetId: rideId,
        rideSlug,
        park: rideNode.park,
      }
    })

  rideNode.children = compNodes
  treeRevision.value++
}

watch(
  [categoryFilter, statusFilter],
  () => {
    treeRevision.value++
  },
  { deep: true }
)

watch(search, () => {
  treeRevision.value++
})

async function refreshAll() {
  const parkId = parkContext.activeParkId
  const park = parkContext.activePark
  if (!parkId || !park) {
    zones.value = []
    rideRows.value = []
    treeRoots.value = []
    return
  }
  busy.value = true
  try {
    setApiParkContextId(parkId)
    const [z, rides] = await Promise.all([getPlatformParkZones(parkId), loadAllRides(parkId)])
    zones.value = z
    rideRows.value = rides
    capabilitiesCache.value = {}
    pdmRulesCache.value = {}
    sparkPreviewCache.value = {}
    await refreshMqttGroupAndLive()
    rebuildSkeletonTree()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsHierarchyExplorer.loadFailed'), 'error')
  } finally {
    busy.value = false
  }
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

async function onRowClick(n: HierarchyNode) {
  selectedId.value = n.id
  if (n.kind === 'ride') {
    if (!expanded.value.has(n.id)) toggleExpand(n.id)
    await loadRideBranch(n)
  }
}

async function onToggleExpand(n: HierarchyNode, e: Event) {
  e.stopPropagation()
  const wasOpen = expanded.value.has(n.id)
  toggleExpand(n.id)
  if (n.kind === 'ride' && !wasOpen) await loadRideBranch(n)
}

function flattenVisible(nodes: HierarchyNode[], depth: number, out: { n: HierarchyNode; depth: number }[]) {
  for (const n of nodes) {
    out.push({ n, depth })
    if (n.children.length && expanded.value.has(n.id)) flattenVisible(n.children, depth + 1, out)
  }
}

const flatVisible = computed(() => {
  void treeRevision.value
  const _exp = expanded.value
  void _exp.size
  const out: { n: HierarchyNode; depth: number }[] = []
  flattenVisible(filteredRoots.value, 0, out)
  return out
})

const treeContextMenu = ref<{
  open: boolean
  x: number
  y: number
  nodeId: string | null
}>({
  open: false,
  x: 0,
  y: 0,
  nodeId: null,
})

const contextNode = computed(() =>
  treeContextMenu.value.nodeId ? findNode(treeRoots.value, treeContextMenu.value.nodeId) : null
)

function closeTreeContextMenu() {
  treeContextMenu.value.open = false
}

function onNodeContextMenu(n: HierarchyNode, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  selectedId.value = n.id
  treeContextMenu.value = {
    open: true,
    x: e.clientX,
    y: e.clientY,
    nodeId: n.id,
  }
}

function collectExpandableIds(nodes: HierarchyNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.children.length) ids.push(node.id)
    if (node.children.length) ids.push(...collectExpandableIds(node.children))
  }
  return ids
}

function expandAllNodes() {
  expanded.value = new Set(collectExpandableIds(treeRoots.value))
  treeRevision.value++
  closeTreeContextMenu()
}

function collapseAllNodes() {
  expanded.value = new Set()
  treeRevision.value++
  closeTreeContextMenu()
}

function expandNodeSubtree() {
  const root = contextNode.value
  if (!root) return
  const next = new Set(expanded.value)
  for (const id of collectExpandableIds([root])) next.add(id)
  expanded.value = next
  treeRevision.value++
  closeTreeContextMenu()
}

function collapseNodeSubtree() {
  const root = contextNode.value
  if (!root) return
  const next = new Set(expanded.value)
  for (const id of collectExpandableIds([root])) next.delete(id)
  expanded.value = next
  treeRevision.value++
  closeTreeContextMenu()
}

function expandExactNode() {
  const root = contextNode.value
  if (!root || !root.children.length) return
  const next = new Set(expanded.value)
  next.add(root.id)
  expanded.value = next
  treeRevision.value++
  closeTreeContextMenu()
}

function collapseExactNode() {
  const root = contextNode.value
  if (!root) return
  const next = new Set(expanded.value)
  next.delete(root.id)
  expanded.value = next
  treeRevision.value++
  closeTreeContextMenu()
}

/** Sparkplug device segment / UNS ride slug — scopes live buffer rows to one attraction. */
function rideSlugForAsset(rideAssetId: string | undefined, hint?: string): string {
  const fromHint = norm(String(hint || ''))
  if (fromHint) return fromHint
  if (!rideAssetId) return ''
  return norm(sparkplugDeviceForRide(rideAssetId))
}

function telemetryMatchOpts(
  sig: RideSignalCapabilitySignalRow,
  rideAssetId: string | undefined,
  rideSlug?: string
) {
  const slug = rideSlugForAsset(rideAssetId, rideSlug)
  if (!slug) {
    const fromPreview = String(sig.unsTopicPreview || '').match(/\/rides\/([^/]+)\//i)
    const parsed = fromPreview?.[1]?.trim().toLowerCase()
    if (parsed) return { rideAssetSlug: parsed }
    return undefined
  }
  return { rideAssetSlug: slug }
}

function liveEventForSignal(
  sig: RideSignalCapabilitySignalRow,
  rideAssetId?: string,
  rideSlug?: string
): UnsMqttLiveEvent | null {
  return pickLatestLiveEvent(sig, liveEvents.value, telemetryMatchOpts(sig, rideAssetId, rideSlug))
}

const selectedSignalTelemetry = computed(() => {
  const n = selectedNode.value
  if (!n || n.kind !== 'signal' || !n.signal) return [] as UnsMqttLiveEvent[]
  void liveEvents.value.length
  return collectMatchingLiveEvents(
    n.signal,
    liveEvents.value,
    telemetryMatchOpts(n.signal, n.rideAssetId, n.rideSlug)
  ).slice(0, 50)
})

const telemetryRefreshBusy = ref(false)
const autoRefreshSeconds = ref<0 | 2 | 5 | 10>(0)
const autoRefreshHandle = ref<ReturnType<typeof globalThis.setInterval> | null>(null)
const tabHidden = ref(false)

async function refreshTelemetryBuffer() {
  telemetryRefreshBusy.value = true
  try {
    await refreshMqttGroupAndLive()
  } finally {
    telemetryRefreshBusy.value = false
  }
}

async function refreshLiveBufferSafely() {
  if (!parkContext.activeParkId || telemetryRefreshBusy.value || tabHidden.value) return
  await refreshTelemetryBuffer()
}

function stopAutoRefresh() {
  if (autoRefreshHandle.value == null) return
  globalThis.clearInterval(autoRefreshHandle.value)
  autoRefreshHandle.value = null
}

function startAutoRefresh() {
  stopAutoRefresh()
  if (!parkContext.activeParkId || autoRefreshSeconds.value <= 0) return
  autoRefreshHandle.value = globalThis.setInterval(() => {
    void refreshLiveBufferSafely()
  }, autoRefreshSeconds.value * 1000)
}

function onVisibilityChange() {
  tabHidden.value = typeof document !== 'undefined' ? document.hidden : false
}

function telemetryDisplayValue(e: UnsMqttLiveEvent): string {
  const vd = e.valueDisplay?.trim()
  if (vd) return vd
  const v = e.value
  if (v == null) return '—'
  if (typeof v === 'string' && v.trim() === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Same formatting as telemetry rows — backend often fills `valueDisplay` while `value` stays empty. */
const liveValueDisplayForSelectedSignal = computed(() => {
  const n = selectedNode.value
  if (!n || n.kind !== 'signal' || !n.signal) return '—'
  const ev = liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)
  if (!ev) return '—'
  return telemetryDisplayValue(ev)
})

const canEditSignalSource = computed(() => canUpdateRides.value || canManageIntegrations.value)

function rideLabelForAsset(rideAssetId: string | undefined): string {
  if (!rideAssetId) return '—'
  const row = rideRows.value.find((r) => r.id === rideAssetId)
  return row?.name?.trim() || row?.slug?.trim() || rideAssetId
}

const selectedSignalTelemetryScope = computed(() => {
  const n = selectedNode.value
  if (!n || n.kind !== 'signal' || !n.signal || !n.rideAssetId) return null
  return {
    ride: rideLabelForAsset(n.rideAssetId),
    metric: n.signal.signalCode,
    count: selectedSignalTelemetry.value.length,
  }
})

function defaultTestPayloadForSignal(sig: RideSignalCapabilitySignalRow): string {
  const code = String(sig.signalCode || '').trim()
  if (code === 'wait_time' || code === 'queue_time') {
    return JSON.stringify({ value: 5 }, null, 2)
  }
  if (code === 'status' || code === 'ride_status' || code === 'operating_status') {
    return JSON.stringify({ value: 'OPERATING' }, null, 2)
  }
  if (sig.valueType === 'number' || sig.valueType === 'integer') {
    return JSON.stringify({ value: 42 }, null, 2)
  }
  if (sig.valueType === 'boolean') {
    return JSON.stringify({ value: true }, null, 2)
  }
  return JSON.stringify({ value: 'test' }, null, 2)
}

function resolveSparkplugPublishTopic(rideId: string): string {
  const park = parkContext.activePark
  const preview = sparkPreviewCache.value[rideId]
  const groupId = String(preview?.groupId || mqttGroupResolved.value || slugifyUnsParkKey(park?.slug || '')).replace(
    /\s+/g,
    ''
  )
  const topicSegs = preview?.topicPreview ? preview.topicPreview.split('/') : []
  const edgeNodeId =
    preview?.edgeNodeId ||
    (topicSegs.length >= 4 ? topicSegs[3] : '') ||
    readSparkEdges(park || null).defaultEdgeNodeId
  const deviceId =
    (topicSegs.length >= 5 ? topicSegs[4] : '') ||
    preview?.topicPreview?.split('/').pop() ||
    sparkplugDeviceForRide(rideId)
  if (!edgeNodeId || !deviceId) return ''
  return sparkplugDdataTopic(groupId, edgeNodeId, deviceId)
}

const sparkplugPublishTopicForSelected = computed(() => {
  const n = selectedNode.value
  if (!n || n.kind !== 'signal' || !n.rideAssetId) return ''
  return resolveSparkplugPublishTopic(n.rideAssetId)
})

function signalSourceDesc(source: RideSignalSource): string {
  if (source === 'MQTT_EDGE') return t('unsHierarchyExplorer.signalSourceMqttDesc')
  if (source === 'SIMULATION') return t('unsHierarchyExplorer.signalSourceSimDesc')
  if (source === 'NOT_AVAILABLE') return t('unsHierarchyExplorer.signalSourceOffDesc')
  return ''
}

function signalSourceButtonClass(source: RideSignalSource, current: RideSignalSource): string {
  const base = 'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default'
  if (current !== source) {
    return `${base} border border-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 disabled:opacity-50`
  }
  if (source === 'MQTT_EDGE') {
    return `${base} border border-emerald-600/80 bg-emerald-950/50 text-emerald-100 ring-1 ring-emerald-500/30`
  }
  if (source === 'SIMULATION') {
    return `${base} border border-amber-600/80 bg-amber-950/40 text-amber-100 ring-1 ring-amber-500/30`
  }
  return `${base} border border-rose-700/80 bg-rose-950/40 text-rose-100 ring-1 ring-rose-500/30`
}

function fillTestPayloadSample() {
  const n = selectedNode.value
  if (n?.kind === 'signal' && n.signal) {
    testPayloadJson.value = defaultTestPayloadForSignal(n.signal)
  }
}

watch(selectedId, () => {
  const n = selectedNode.value
  if (n?.kind === 'signal' && n.signal) {
    testPayloadJson.value = defaultTestPayloadForSignal(n.signal)
  }
})

function healthBadgeClass(quality: string | null | undefined): string {
  const q = String(quality || '').toUpperCase()
  if (q.includes('BAD') || q.includes('ERR')) return 'bg-rose-600/30 text-rose-200 border-rose-700/60'
  if (q.includes('GOOD') || q.includes('OK')) return 'bg-emerald-600/25 text-emerald-200 border-emerald-700/50'
  return 'bg-slate-700/40 text-slate-200 border-slate-600/60'
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    push(t('unsHierarchyExplorer.copied'), 'success')
  } catch {
    push(t('unsHierarchyExplorer.copyFailed'), 'error')
  }
}

async function saveSignalCapability(rideId: string, signalCatalogId: string, signalSource: RideSignalSource) {
  if (!canUpdateRides.value && !canManageIntegrations.value) {
    push(t('unsHierarchyExplorer.noPermission'), 'error')
    return
  }
  const cur = capabilitiesCache.value[rideId]
  if (!cur) return
  signalBusy.value = true
  try {
    const capabilities = cur.signals.map((s) => ({
      signalCatalogId: s.signalCatalogId,
      signalSource: s.signalCatalogId === signalCatalogId ? signalSource : (s.signalSource as RideSignalSource),
      valueType: s.valueType,
      useForMl: s.useForMl,
      useForForecast: s.useForForecast,
    }))
    const next = await putRideSignalCapabilities(rideId, { capabilities })
    capabilitiesCache.value[rideId] = next
    const rideNode = findNode(treeRoots.value, `ride:${rideId}`)
    if (rideNode) await loadRideBranch(rideNode)
    treeRevision.value++
    push(signalSource === 'NOT_AVAILABLE' ? t('unsHierarchyExplorer.signalDisabled') : t('unsHierarchyExplorer.signalUpdated'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsHierarchyExplorer.signalSaveFailed'), 'error')
  } finally {
    signalBusy.value = false
  }
}

async function onPublishTestSparkplug() {
  const n = selectedNode.value
  if (!n || n.kind !== 'signal' || !n.signal || !n.rideAssetId) return
  if (!canManageIntegrations.value) {
    push(t('unsHierarchyExplorer.noPermission'), 'error')
    return
  }
  const rideId = n.rideAssetId
  const topic = resolveSparkplugPublishTopic(rideId)
  if (!topic) {
    push(t('unsHierarchyExplorer.missingTopicContext'), 'error')
    return
  }
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(testPayloadJson.value || '{}') as Record<string, unknown>
  } catch {
    push(t('unsHierarchyExplorer.invalidJson'), 'error')
    return
  }
  try {
    await publishUnsTest(topic, payload)
    push(t('unsHierarchyExplorer.publishOk'), 'success')
    await refreshMqttGroupAndLive()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsHierarchyExplorer.publishFailed'), 'error')
  }
}

function sparkplugDeviceForRide(rideId: string): string {
  const sp = sparkPreviewCache.value[rideId]
  if (sp?.assetSlug?.trim()) return slugifyUnsParkKey(sp.assetSlug)
  const row = rideRows.value.find((r) => r.id === rideId)
  return row?.slug ? slugifyUnsParkKey(row.slug) : rideId
}

async function onSyntheticMqttTest() {
  if (!canManageIntegrations.value) {
    push(t('unsHierarchyExplorer.noPermission'), 'error')
    return
  }
  const raw = resolveRawMqttSparkplugGroupKey(parkContext.activePark?.slug, parkContext.activeParkId)
  const base = slugifyUnsParkKey(raw)
  try {
    await postUnsMqttLiveTestEvent(base)
    push(t('unsHierarchyExplorer.syntheticOk'), 'success')
    await refreshMqttGroupAndLive()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsHierarchyExplorer.syntheticFailed'), 'error')
  }
}

async function confirmDisableSignal(rideId: string, catalogId: string) {
  const ok = await askConfirm({
    title: t('unsHierarchyExplorer.disableTitle'),
    message: t('unsHierarchyExplorer.disableBody'),
    variant: 'danger',
    confirmLabel: t('unsHierarchyExplorer.disableConfirm'),
  })
  if (ok) await saveSignalCapability(rideId, catalogId, 'NOT_AVAILABLE')
}

function pdmRulesForRide(rideId: string | null | undefined): AssetPdmRuleRow[] {
  if (!rideId) return []
  return pdmRulesCache.value[rideId] ?? []
}

function thresholdDisplay(rideId: string | null | undefined, signalCode: string | undefined): string {
  const rules = pdmRulesForRide(rideId)
  const r = rules.find((x) => norm(x.metricName) === norm(signalCode || ''))
  if (!r) return '—'
  return [r.warnBelow, r.warnAbove, r.criticalBelow, r.criticalAbove].filter((x) => x != null).join(' / ') || '—'
}

function hasPdmForSignal(rideId: string | null | undefined, signalCode: string | undefined): boolean {
  return pdmRulesForRide(rideId).some((r) => norm(r.metricName) === norm(signalCode || ''))
}

onMounted(() => {
  globalThis.addEventListener('click', closeTreeContextMenu)
  globalThis.addEventListener('resize', closeTreeContextMenu)
  globalThis.addEventListener('scroll', closeTreeContextMenu, true)
  if (typeof document !== 'undefined') {
    tabHidden.value = document.hidden
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  void refreshAll()
})

onBeforeUnmount(() => {
  stopAutoRefresh()
  globalThis.removeEventListener('click', closeTreeContextMenu)
  globalThis.removeEventListener('resize', closeTreeContextMenu)
  globalThis.removeEventListener('scroll', closeTreeContextMenu, true)
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})

watch(
  () => parkContext.activeParkId,
  () => {
    void refreshAll()
    startAutoRefresh()
  }
)

watch(autoRefreshSeconds, () => {
  startAutoRefresh()
  if (autoRefreshSeconds.value > 0) void refreshLiveBufferSafely()
})

const sparkplugLineForSelected = computed(() => {
  const n = selectedNode.value
  const park = parkContext.activePark
  if (!park) return '—'
  const groupId =
    readParkGroupId(park) ||
    liveStatus.value?.mqttGroupId ||
    mqttGroupResolved.value ||
    slugifyUnsParkKey(park.slug || '')
  if (n?.kind === 'edge' && n.edge) {
    const deviceHint = t('unsHierarchyExplorer.deviceIdPlaceholder')
    return sparkplugDdataTopic(groupId, n.edge.edgeNodeId.trim() || 'edge_node', deviceHint)
  }
  if (n?.kind === 'ride' && n.rideAssetId) {
    const p = sparkPreviewCache.value[n.rideAssetId]
    if (p?.topicPreview) return p.topicPreview
  }
  if (n?.kind === 'signal' && n.rideAssetId) {
    const p = sparkPreviewCache.value[n.rideAssetId]
    if (p?.topicPreview) return p.topicPreview
  }
  return t('unsHierarchyExplorer.expandRideHint')
})

const unsPathForSelected = computed(() => {
  const n = selectedNode.value
  if (n?.kind === 'signal' && n.signal?.unsTopicPreview) return n.signal.unsTopicPreview
  return '—'
})

const pdmMetricForSelected = computed(() => {
  const n = selectedNode.value
  if (n?.kind === 'signal' && n.signal)
    return parsePdmMetric(n.signal.sparkplugMetricPreview, n.signal.signalCode).metric
  return '—'
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 p-4 text-slate-200">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('unsHierarchyExplorer.title') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('unsHierarchyExplorer.subtitle') }}</p>
      </div>
      <div class="flex items-end gap-2">
        <label class="text-xs text-slate-400">
          Auto-Refresh
          <select
            v-model.number="autoRefreshSeconds"
            class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
            :disabled="!parkContext.activeParkId"
          >
            <option :value="0">Aus</option>
            <option :value="2">2s</option>
            <option :value="5">5s</option>
            <option :value="10">10s</option>
          </select>
        </label>
        <button
          type="button"
          class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm font-medium text-white hover:border-slate-600 disabled:opacity-50"
          :disabled="busy || !parkContext.activeParkId"
          @click="refreshAll"
        >
          {{ busy ? '…' : t('unsHierarchyExplorer.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="!parkContext.activeParkId" class="rounded-lg border border-amber-800/60 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
      {{ t('unsHierarchyExplorer.pickPark') }}
    </div>

    <div v-else class="flex min-h-[32rem] flex-1 gap-4">
      <section
        class="flex w-full max-w-xl flex-col rounded-xl border border-slate-800 bg-slate-900/40"
        aria-label="tree"
      >
        <div class="border-b border-slate-800 p-3 space-y-3">
          <input
            v-model="search"
            type="search"
            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none"
            :placeholder="t('unsHierarchyExplorer.searchPlaceholder')"
          />
          <div class="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
            <span class="w-full font-semibold uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.categories') }}</span>
            <label v-for="k in (['operations', 'ml', 'forecast', 'pdm', 'oee'] as const)" :key="k" class="inline-flex items-center gap-1.5 text-slate-300">
              <input v-model="categoryFilter[k]" type="checkbox" class="rounded border-slate-600 bg-slate-950" />
              {{ t(`unsHierarchyExplorer.cat.${k}`) }}
            </label>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
            <span class="w-full font-semibold uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.status') }}</span>
            <label v-for="k in (['active', 'prepared', 'missing', 'live'] as const)" :key="k" class="inline-flex items-center gap-1.5 text-slate-300">
              <input v-model="statusFilter[k]" type="checkbox" class="rounded border-slate-600 bg-slate-950" />
              {{ t(`unsHierarchyExplorer.st.${k}`) }}
            </label>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-2 font-mono text-xs">
          <p v-if="busy" class="p-4 text-slate-500">…</p>
          <ul v-else class="space-y-0.5">
            <li v-for="{ n, depth } in flatVisible" :key="n.id">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-slate-800/80"
                :class="selectedId === n.id ? 'bg-slate-800/90' : ''"
                :style="{ paddingLeft: `${8 + depth * 12}px` }"
                @click="onRowClick(n)"
                @contextmenu="onNodeContextMenu(n, $event)"
              >
                <span
                  v-if="n.children.length"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-700 text-[10px] text-slate-300"
                  role="button"
                  tabindex="0"
                  @click="onToggleExpand(n, $event)"
                >
                  {{ expanded.has(n.id) ? '−' : '+' }}
                </span>
                <span v-else class="inline-block w-5 shrink-0" />

                <span class="min-w-0 flex-1 truncate text-slate-200">
                  <span class="mr-1 text-[10px] font-semibold uppercase text-slate-500">{{ n.kind }}</span>
                  {{ n.label }}
                </span>

                <span v-if="n.kind === 'signal' && n.signal" class="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <span
                    v-if="liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)"
                    class="max-w-[7rem] truncate rounded border border-emerald-800/70 bg-emerald-950/40 px-1 py-0.5 text-[10px] text-emerald-200"
                    :title="String(liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)?.value)"
                  >
                    {{ String(liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)?.value ?? '—') }}
                  </span>
                  <span
                    v-if="liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)?.quality"
                    class="rounded border px-1 py-0.5 text-[10px]"
                    :class="healthBadgeClass(liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)?.quality)"
                  >
                    {{ liveEventForSignal(n.signal, n.rideAssetId, n.rideSlug)?.quality }}
                  </span>
                  <span v-if="n.signal.isActiveTopic || n.signal.isActiveSparkplug" class="rounded border border-sky-700/60 bg-sky-950/35 px-1 py-0.5 text-[10px] text-sky-200">ACTIVE</span>
                  <span
                    v-else-if="n.signal.isPreparedTopic || n.signal.isPreparedSparkplug"
                    class="rounded border border-amber-700/50 bg-amber-950/30 px-1 py-0.5 text-[10px] text-amber-100"
                  >
                    PREP
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <section class="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/40" aria-label="detail">
        <div v-if="!selectedNode" class="p-6 text-sm text-slate-500">
          {{ t('unsHierarchyExplorer.selectNode') }}
        </div>

        <div v-else class="min-h-0 flex-1 overflow-auto p-4 text-sm">
          <!-- Park -->
          <template v-if="selectedNode.kind === 'park' && selectedNode.park">
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.park.name }}</h2>
            <dl class="mt-3 grid gap-2 text-xs">
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.slug') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.park.slug }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.parkId') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.park.id }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.sparkplugGroup') }}</dt>
              <dd class="font-mono text-slate-200">
                {{ readParkGroupId(selectedNode.park) || mqttGroupResolved || '—' }}
              </dd>
            </dl>
            <RouterLink
              class="mt-4 inline-block text-brand-400 hover:underline"
              :to="{ name: 'master-data', params: { entityType: 'parks' } }"
            >
              {{ t('unsHierarchyExplorer.editInMasterData') }}
            </RouterLink>
          </template>

          <!-- Zone -->
          <template v-else-if="selectedNode.kind === 'zone' && selectedNode.zone">
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.zone.name }}</h2>
            <dl class="mt-3 grid gap-2 text-xs">
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.slug') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.zone.slug }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.zoneId') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.zone.id }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.edgeNodesInZone') }}</dt>
              <dd class="font-mono text-slate-200">
                {{
                  selectedNode.children
                    .filter((c) => c.kind === 'edge')
                    .map((c) => c.edge?.edgeNodeId)
                    .filter(Boolean)
                    .join(', ') || '—'
                }}
              </dd>
            </dl>
            <RouterLink
              class="mt-4 inline-block text-brand-400 hover:underline"
              :to="{ name: 'master-data', params: { entityType: 'zones' } }"
            >
              {{ t('unsHierarchyExplorer.editInMasterData') }}
            </RouterLink>
            <p class="mt-2 text-xs text-slate-500">{{ t('unsHierarchyExplorer.zoneSparkplugNote') }}</p>
          </template>

          <!-- Edge -->
          <template v-else-if="selectedNode.kind === 'edge' && selectedNode.edge">
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.label }}</h2>
            <dl class="mt-3 grid gap-2 text-xs">
              <dt class="text-slate-500">edgeNodeId</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.edge.edgeNodeId }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.mqttState') }}</dt>
              <dd class="font-mono text-slate-200">{{ liveStatus?.mqtt ? JSON.stringify(liveStatus.mqtt) : '—' }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.buffer') }}</dt>
              <dd class="font-mono text-slate-200">{{ liveStatus ? `${liveStatus.buffer.bufferSize} evt · ${liveStatus.buffer.eventsPerSec}/s` : '—' }}</dd>
            </dl>
            <div class="mt-4 space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.topicPreview') }}</p>
              <code class="block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-emerald-200/95">{{ sparkplugLineForSelected }}</code>
              <button type="button" class="text-xs text-brand-400 hover:underline" @click="copyText(String(sparkplugLineForSelected))">
                {{ t('unsHierarchyExplorer.copy') }}
              </button>
            </div>
            <RouterLink class="mt-4 inline-block text-brand-400 hover:underline" to="/diagnostics/sparkplug">
              {{ t('menu.diagSparkplug') }}
            </RouterLink>
          </template>

          <!-- Ride -->
          <template v-else-if="selectedNode.kind === 'ride' && selectedNode.ride">
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.ride.name }}</h2>
            <dl class="mt-3 grid gap-2 text-xs">
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.assetId') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.ride.id }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.rideType') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.ride.type }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.templateKey') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.ride.templateCode || '—' }}</dd>
              <dt class="text-slate-500">deviceId · Sparkplug</dt>
              <dd class="font-mono text-slate-200">{{ sparkplugDeviceForRide(selectedNode.ride.id) }}</dd>
              <dt class="text-slate-500">zoneSlug (resolver)</dt>
              <dd class="font-mono text-slate-200">
                {{ sparkPreviewCache[selectedNode.ride.id]?.zoneSlug || '—' }}
              </dd>
              <dt class="text-slate-500">edgeNodeId (resolver)</dt>
              <dd class="font-mono text-slate-200">
                {{ sparkPreviewCache[selectedNode.ride.id]?.edgeNodeId || '—' }}
              </dd>
              <dt class="text-slate-500">source</dt>
              <dd class="font-mono text-slate-200">
                {{ sparkPreviewCache[selectedNode.ride.id]?.source || '—' }}
              </dd>
              <dt
                v-if="sparkPreviewCache[selectedNode.ride.id]?.fallbackUsed && sparkPreviewCache[selectedNode.ride.id]?.fallbackWarning"
                class="text-amber-400"
              >
                fallback
              </dt>
              <dd
                v-if="sparkPreviewCache[selectedNode.ride.id]?.fallbackUsed && sparkPreviewCache[selectedNode.ride.id]?.fallbackWarning"
                class="text-amber-200/90"
              >
                {{ sparkPreviewCache[selectedNode.ride.id]?.fallbackWarning }}
              </dd>
            </dl>
            <div class="mt-4 space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.topicPreview') }}</p>
              <code class="block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-emerald-200/95">{{ sparkplugLineForSelected }}</code>
              <button type="button" class="text-xs text-brand-400 hover:underline" @click="copyText(String(sparkplugLineForSelected))">
                {{ t('unsHierarchyExplorer.copy') }}
              </button>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <RouterLink
                class="inline-block text-brand-400 hover:underline"
                :to="{ name: 'platform-ride-master', params: { assetId: selectedNode.ride.id } }"
              >
                {{ t('unsHierarchyExplorer.editRideMaster') }} (bewaehrt)
              </RouterLink>
              <RouterLink
                class="inline-block text-slate-400 hover:text-slate-200 hover:underline"
                :to="{
                  name: 'master-data',
                  params: { entityType: 'rides' },
                  query: { q: String(selectedNode.ride.slug || selectedNode.ride.name || '').trim() || undefined },
                }"
              >
                Master Data Rides (neu)
              </RouterLink>
            </div>
          </template>

          <!-- Component -->
          <template v-else-if="selectedNode.kind === 'component'">
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.componentKey }}</h2>
            <dl class="mt-3 grid gap-2 text-xs">
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.componentType') }}</dt>
              <dd class="text-slate-200">{{ t('unsHierarchyExplorer.logicalComponent') }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.quantity') }}</dt>
              <dd class="text-slate-200">{{ selectedNode.children.length }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.criticality') }}</dt>
              <dd class="text-slate-200">
                {{
                  (pdmRulesForRide(selectedNode.rideAssetId).some(
                    (r) => r.enabled && (r.criticalAbove != null || r.criticalBelow != null)
                  )) ?
                    'HIGH'
                  : pdmRulesForRide(selectedNode.rideAssetId).some((r) => r.enabled) ? 'MED'
                  : 'LOW'
                }}
              </dd>
            </dl>
          </template>

          <!-- Signal -->
          <template v-else-if="selectedNode.kind === 'signal' && selectedNode.signal && selectedNode.rideAssetId">
            <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {{ rideLabelForAsset(selectedNode.rideAssetId) }}
            </p>
            <h2 class="font-display text-lg font-semibold text-white">{{ selectedNode.signal.signalCode }}</h2>
            <p v-if="selectedNode.signal.label" class="mt-0.5 text-xs text-slate-400">{{ selectedNode.signal.label }}</p>
            <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-[auto_1fr]">
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.unit') }}</dt>
              <dd class="text-slate-200">{{ selectedNode.signal.unit || '—' }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.dataType') }}</dt>
              <dd class="font-mono text-slate-200">{{ selectedNode.signal.valueType }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.liveValue') }}</dt>
              <dd class="break-words font-mono text-emerald-200/90">{{ liveValueDisplayForSelectedSignal }}</dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.threshold') }}</dt>
              <dd class="font-mono text-slate-200">{{ thresholdDisplay(selectedNode.rideAssetId, selectedNode.signal.signalCode) }}</dd>
              <dt class="text-slate-500">ML / Forecast / PdM</dt>
              <dd class="text-slate-200">
                ML {{ selectedNode.signal.useForMl ? '✓' : '—' }} · Forecast {{ selectedNode.signal.useForForecast ? '✓' : '—' }} · PdM
                {{ hasPdmForSignal(selectedNode.rideAssetId, selectedNode.signal.signalCode) ? '✓' : '—' }}
              </dd>
              <dt class="text-slate-500">{{ t('unsHierarchyExplorer.routeFlags') }}</dt>
              <dd class="flex flex-wrap gap-1">
                <span
                  v-if="selectedNode.signal.isActiveTopic || selectedNode.signal.isActiveSparkplug"
                  class="rounded border border-sky-700/60 bg-sky-950/35 px-1.5 py-0.5 text-[10px] text-sky-200"
                >{{ t('unsHierarchyExplorer.routeActive') }}</span>
                <span
                  v-else-if="selectedNode.signal.isPreparedTopic || selectedNode.signal.isPreparedSparkplug"
                  class="rounded border border-amber-700/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-100"
                >{{ t('unsHierarchyExplorer.routePrepared') }}</span>
                <span v-else class="text-slate-500">—</span>
              </dd>
            </dl>

            <div class="mt-5 border-t border-slate-800 pt-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {{ t('unsHierarchyExplorer.telemetryTitle') }}
                </p>
                <button
                  type="button"
                  class="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500 disabled:opacity-50"
                  :disabled="telemetryRefreshBusy"
                  @click="refreshTelemetryBuffer()"
                >
                  {{ telemetryRefreshBusy ? '…' : t('unsHierarchyExplorer.refreshTelemetry') }}
                </button>
              </div>
              <p
                v-if="selectedSignalTelemetryScope"
                class="mt-1 rounded border border-slate-800/80 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-400"
              >
                {{ t('unsHierarchyExplorer.telemetryScope', selectedSignalTelemetryScope) }}
              </p>
              <p class="mt-1 text-[11px] text-slate-500">{{ t('unsHierarchyExplorer.telemetryHint') }}</p>
              <p v-if="!canReadIntegrations" class="mt-2 text-[11px] text-slate-500">
                {{ t('unsHierarchyExplorer.telemetryNoPermission') }}
              </p>
              <div
                v-else-if="!selectedSignalTelemetry.length"
                class="mt-3 rounded border border-slate-800/80 bg-slate-950/40 px-3 py-4 text-xs text-slate-500"
              >
                {{ t('unsHierarchyExplorer.telemetryEmpty') }}
              </div>
              <div v-else class="mt-2 max-h-72 overflow-x-auto overflow-y-auto rounded border border-slate-800">
                <table class="w-full min-w-[36rem] table-fixed border-collapse text-left text-[11px]">
                  <colgroup>
                    <col class="w-[11rem]" />
                    <col class="w-[6rem]" />
                    <col class="w-[9rem]" />
                    <col />
                    <col class="w-[6rem]" />
                  </colgroup>
                  <thead class="sticky top-0 z-[1] bg-slate-900/95 text-slate-400">
                    <tr>
                      <th class="border-b border-slate-800 px-2 py-1.5 font-medium">{{ t('unsHierarchyExplorer.colReceived') }}</th>
                      <th class="border-b border-slate-800 px-2 py-1.5 font-medium">{{ t('unsHierarchyExplorer.colMetric') }}</th>
                      <th class="border-b border-slate-800 px-2 py-1.5 font-medium">{{ t('unsHierarchyExplorer.colValue') }}</th>
                      <th class="border-b border-slate-800 px-2 py-1.5 font-medium">{{ t('unsHierarchyExplorer.colTopic') }}</th>
                      <th class="border-b border-slate-800 px-2 py-1.5 font-medium">{{ t('unsHierarchyExplorer.colQuality') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="ev in selectedSignalTelemetry" :key="ev.id" class="border-b border-slate-800/60 text-slate-300">
                      <td class="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[10px] text-slate-400">
                        {{ formatDateTime(new Date(ev.receivedAt || ev.timestamp)) }}
                      </td>
                      <td class="break-words px-2 py-1.5 align-top font-mono">{{ ev.metric || '—' }}</td>
                      <td
                        class="break-words px-2 py-1.5 align-top font-mono text-emerald-200/90"
                        :title="telemetryDisplayValue(ev)"
                      >
                        {{ telemetryDisplayValue(ev) }}
                      </td>
                      <td
                        class="max-w-0 align-top break-all px-2 py-1.5 font-mono text-[10px] text-slate-500"
                        :title="String(ev.sparkplugTopic || ev.canonicalUnsTopic || '')"
                      >
                        {{ ev.sparkplugTopic || ev.canonicalUnsTopic || '—' }}
                      </td>
                      <td class="break-words px-2 py-1.5 align-top">{{ ev.quality || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mt-5 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.pathsTitle') }}</p>
              <p class="text-[10px] text-slate-500">UNS</p>
              <code class="block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-sky-200/90">{{ unsPathForSelected }}</code>
              <button type="button" class="text-xs text-brand-400 hover:underline" @click="copyText(String(unsPathForSelected))">
                {{ t('unsHierarchyExplorer.copy') }}
              </button>
              <p class="text-[10px] text-slate-500">Sparkplug · DDATA</p>
              <code class="block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-emerald-200/95">{{ sparkplugLineForSelected }}</code>
              <button type="button" class="text-xs text-brand-400 hover:underline" @click="copyText(String(sparkplugLineForSelected))">
                {{ t('unsHierarchyExplorer.copy') }}
              </button>
              <p class="text-[10px] text-slate-500">{{ t('unsHierarchyExplorer.metricPreviewLabel') }}</p>
              <code class="block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-amber-100/90">{{ pdmMetricForSelected }}</code>
            </div>

            <div class="mt-5 border-t border-slate-800 pt-4">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.signalSourceTitle') }}</p>
              <p class="mt-1 text-[11px] text-slate-500">{{ signalSourceDesc(selectedNode.signal.signalSource as RideSignalSource) }}</p>
              <div
                class="mt-2 flex flex-wrap gap-1 rounded-lg border border-slate-700 bg-slate-900/80 p-1"
                role="group"
                :aria-label="t('unsHierarchyExplorer.signalSourceTitle')"
              >
                <button
                  type="button"
                  :class="signalSourceButtonClass('MQTT_EDGE', selectedNode.signal.signalSource as RideSignalSource)"
                  :disabled="signalBusy || !canEditSignalSource || selectedNode.signal.signalSource === 'MQTT_EDGE'"
                  @click="saveSignalCapability(selectedNode.rideAssetId, selectedNode.signal.signalCatalogId, 'MQTT_EDGE')"
                >
                  {{ t('unsHierarchyExplorer.enableMqtt') }}
                </button>
                <button
                  type="button"
                  :class="signalSourceButtonClass('SIMULATION', selectedNode.signal.signalSource as RideSignalSource)"
                  :disabled="signalBusy || !canEditSignalSource || selectedNode.signal.signalSource === 'SIMULATION'"
                  @click="saveSignalCapability(selectedNode.rideAssetId, selectedNode.signal.signalCatalogId, 'SIMULATION')"
                >
                  {{ t('unsHierarchyExplorer.setSimulation') }}
                </button>
                <button
                  type="button"
                  :class="signalSourceButtonClass('NOT_AVAILABLE', selectedNode.signal.signalSource as RideSignalSource)"
                  :disabled="signalBusy || !canEditSignalSource || selectedNode.signal.signalSource === 'NOT_AVAILABLE'"
                  @click="confirmDisableSignal(selectedNode.rideAssetId!, selectedNode.signal.signalCatalogId)"
                >
                  {{ t('unsHierarchyExplorer.disableSignal') }}
                </button>
              </div>
              <p v-if="!canEditSignalSource" class="mt-2 text-[11px] text-slate-500">{{ t('unsHierarchyExplorer.noPermission') }}</p>
            </div>

            <div class="mt-6 border-t border-slate-800 pt-4">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.testPublish') }}</p>
              <p class="mt-1 text-[11px] text-slate-500">{{ t('unsHierarchyExplorer.publishPayloadHint') }}</p>
              <p class="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">{{ t('unsHierarchyExplorer.publishTargetLabel') }}</p>
              <code
                v-if="sparkplugPublishTopicForSelected"
                class="mt-1 block break-all rounded border border-slate-800 bg-slate-950/80 p-2 text-[11px] text-emerald-200/95"
              >{{ sparkplugPublishTopicForSelected }}</code>
              <p v-else class="mt-1 text-[11px] text-amber-200/90">{{ t('unsHierarchyExplorer.missingTopicContext') }}</p>
              <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span class="text-[10px] text-slate-500">{{ t('unsHierarchyExplorer.publishPayloadLabel') }}</span>
                <button type="button" class="text-[10px] text-brand-400 hover:underline" @click="fillTestPayloadSample">
                  {{ t('unsHierarchyExplorer.publishFillSample') }}
                </button>
              </div>
              <textarea
                v-model="testPayloadJson"
                rows="4"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-slate-200"
                :aria-label="t('unsHierarchyExplorer.publishPayloadLabel')"
              />
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-2 py-1 text-xs font-medium text-emerald-100 hover:border-emerald-600 disabled:opacity-50"
                  :disabled="!canManageIntegrations || !sparkplugPublishTopicForSelected"
                  :title="!sparkplugPublishTopicForSelected ? t('unsHierarchyExplorer.missingTopicContext') : undefined"
                  @click="onPublishTestSparkplug"
                >
                  {{ t('unsHierarchyExplorer.publishCustom') }}
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:border-slate-500 disabled:opacity-50"
                  :disabled="!canManageIntegrations"
                  @click="onSyntheticMqttTest"
                >
                  {{ t('unsHierarchyExplorer.syntheticPublish') }}
                </button>
              </div>
              <p class="mt-2 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-100/90">
                {{ t('unsHierarchyExplorer.syntheticWarning') }}
              </p>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="treeContextMenu.open"
      class="fixed z-[70] min-w-[13rem] rounded-lg border border-slate-700 bg-slate-950/95 p-1 text-xs shadow-2xl"
      :style="{ left: `${treeContextMenu.x}px`, top: `${treeContextMenu.y}px` }"
      @click.stop
    >
      <button type="button" class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800" @click="expandAllNodes">
        Alle Knoten aufklappen
      </button>
      <button type="button" class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800" @click="collapseAllNodes">
        Alle Knoten zuklappen
      </button>
      <div class="my-1 border-t border-slate-800" />
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        :disabled="!contextNode"
        @click="expandExactNode"
      >
        Diesen Knoten aufklappen
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        :disabled="!contextNode"
        @click="collapseExactNode"
      >
        Diesen Knoten zuklappen
      </button>
      <div class="my-1 border-t border-slate-800" />
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        :disabled="!contextNode"
        @click="expandNodeSubtree"
      >
        Unterbaum aufklappen
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        :disabled="!contextNode"
        @click="collapseNodeSubtree"
      >
        Unterbaum zuklappen
      </button>
    </div>
  </Teleport>
</template>
