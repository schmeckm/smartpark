<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  applyMasterDataTemplate,
  createManualMasterDataAsset,
  deactivateMasterData,
  exportMasterDataBundle,
  exportMasterDataXlsxBlob,
  importMasterDataBundle,
  importMasterDataXlsx,
  getAdapterPipelineLog,
  getEntityTypeTemplate,
  getIntegrationSettings,
  getMasterDataAssetEnrichment,
  getMasterDataDetail,
  getUnsSuggestions,
  getPlatformParkZones,
  getPlatformParks,
  getAssetZoneNormalizationPreview,
  listEntityTypeTemplates,
  listMasterData,
  patchMasterData,
  patchMasterDataAssetEnrichment,
  postAssetZoneNormalizationApply,
  type AdapterPipelineLogResponse,
  type AssetZoneNormalizationRow,
  type EntityTypeTemplateRow,
  type MasterDataEntityType,
  type MasterDataGridRow,
  type MasterDataSpreadsheetEntityType,
  type PlatformParkZoneRow,
  type UnsSuggestedTopic,
  type UnsSuggestions,
} from '@/api/client'
import type { PlatformPark } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import { useAuthStore } from '@/stores/auth'
import MasterDataWizard from './MasterDataWizard.vue'
import RideSignalCapabilitiesPanel from './RideSignalCapabilitiesPanel.vue'
import SignalsCapabilitiesPanel from '@/components/masterdata/SignalsCapabilitiesPanel.vue'
import type { WizardEntityTab } from './masterDataWizard.utils'
import { slugifyName } from '@/lib/sparkplugTopicBuild'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { utcDateStampForFilename } from '@/utils/dateTime'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { push } = useToast()
const auth = useAuthStore()
const canPatchExtensions = computed(() => auth.hasPermission('rides', 'update'))
const { formatDateTime } = useRegionalDateTime()

function formatMasterTimestamp(v: string | null | undefined) {
  return v ? formatDateTime(v) : '—'
}

/** Tab order follows provider hierarchy: park, then the three primary child kinds (RIDE / SHOW / RESTAURANT assets), then shops & zones. */
const ENTITY_TAB_IDS: MasterDataEntityType[] = ['parks', 'rides', 'shows', 'restaurants', 'shops', 'zones', 'templates']

const ENTITY_ALIASES: Record<string, MasterDataEntityType> = {
  attraction: 'rides',
  attractions: 'rides',
}

const entityType = computed(() => {
  const raw = String(route.params.entityType || 'parks').toLowerCase()
  const normalized = ENTITY_ALIASES[raw] ?? raw
  const allowed = new Set(ENTITY_TAB_IDS)
  return (allowed.has(normalized as MasterDataEntityType) ? normalized : 'parks') as MasterDataEntityType
})

const isAssetSection = computed(() => ['rides', 'shows', 'restaurants', 'shops'].includes(entityType.value))
const isTemplatesTab = computed(() => entityType.value === 'templates')

const rows = ref<MasterDataGridRow[]>([])
const total = ref(0)
const page = ref(0)
const pageSize = ref(25)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const paginationPages = computed<number[]>(() => Array.from({ length: totalPages.value }, (_, idx) => idx + 1))
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const sortBy = ref('name')
const sortDir = ref<'asc' | 'desc'>('asc')
/** Park filter: internal UUID, slug, or external entity id (API resolves). */
const parkFilterKey = ref('')
const provider = ref('')
const status = ref('')
const enrichmentStatus = ref('')

const parks = ref<PlatformPark[]>([])

/** Datalist entries: slug (or id), external id, UUID — all resolvable by the API. */
const parkLookupSuggestions = computed(() => {
  void locale.value
  const o: { value: string; label: string }[] = []
  for (const p of parks.value) {
    o.push({ value: p.slug || p.id, label: p.name })
    if (p.externalEntityId)
      o.push({ value: p.externalEntityId, label: `${p.name} (${t('masterDataEntity.parkLabelExternal')})` })
    o.push({ value: p.id, label: `${p.name} (${t('masterDataEntity.parkLabelUuid')})` })
  }
  return o
})

/** Internal park UUID for `/platform/map` when the park filter matches a loaded park (id, slug, or external id). */
const mapPrefillParkId = computed(() => {
  const key = parkFilterKey.value.trim()
  if (!key) return null as string | null
  for (const p of parks.value) {
    if (p.id === key || p.slug === key || (p.externalEntityId && p.externalEntityId === key)) return p.id
  }
  return null
})

const assetMapTo = computed(() =>
  mapPrefillParkId.value
    ? ({ name: 'platform-map' as const, query: { parkId: mapPrefillParkId.value } } as const)
    : ({ name: 'platform-map' as const } as const)
)

const drawerOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<Record<string, unknown> | null>(null)
const detailError = ref<string | null>(null)
/** When refreshing the same asset, keep `detail` mounted so child tabs (e.g. ride signal sources) are not destroyed. */
const detailLoadedForAssetId = ref<string | null>(null)
type MasterDetailDrawerTab = 'overview' | 'extensions' | 'operational' | 'signals' | 'typed' | 'raw' | 'relations' | 'locks'
const detailTab = ref<MasterDetailDrawerTab>('overview')

const detailDrawerTabs = computed((): MasterDetailDrawerTab[] => {
  const isAsset = detail.value?.entityKind === 'asset'
  if (entityType.value === 'rides' && isAsset) {
    return ['overview', 'extensions', 'operational', 'signals', 'typed', 'raw', 'relations', 'locks']
  }
  if (isAssetSection.value && isAsset) {
    return ['overview', 'extensions', 'operational', 'typed', 'raw', 'relations', 'locks']
  }
  return ['overview', 'operational', 'typed', 'raw', 'relations', 'locks']
})

watch([entityType, detail, drawerOpen, detailDrawerTabs], () => {
  if (!drawerOpen.value) return
  const tabs = detailDrawerTabs.value
  if (!tabs.includes(detailTab.value)) detailTab.value = 'overview'
})

watch(drawerOpen, (open) => {
  if (!open) parkZonesForDrawer.value = []
})

const editAsset = ref<Record<string, unknown>>({})
const editRide = ref<Record<string, unknown>>({})
const editShow = ref<Record<string, unknown>>({})
const editRestaurant = ref<Record<string, unknown>>({})
const editShop = ref<Record<string, unknown>>({})
const editPark = ref<Record<string, unknown>>({})
const editZone = ref<Record<string, unknown>>({})
/** `park_zones` for the asset’s or zone’s park — zone assignment / parent zone. */
const parkZonesForDrawer = ref<PlatformParkZoneRow[]>([])
const parkZonesLoading = ref(false)
const locksJson = ref('{}')
const saving = ref(false)

const parkZoneParentOptions = computed(() =>
  parkZonesForDrawer.value.filter((z) => !selectedId.value || z.id !== selectedId.value)
)

async function refreshParkZonesForDrawer(parkId: string | null | undefined) {
  parkZonesForDrawer.value = []
  const pid = String(parkId || '').trim()
  if (!pid) return
  parkZonesLoading.value = true
  try {
    parkZonesForDrawer.value = await getPlatformParkZones(pid)
  } catch {
    parkZonesForDrawer.value = []
  } finally {
    parkZonesLoading.value = false
  }
}

/** UNS topic preview (Integrations API) for the selected integration park — filtered to the open asset in the drawer. */
const unsTopicPreview = ref<UnsSuggestions | null>(null)
const unsTopicPreviewLoading = ref(false)

const zoneNormalizationLoading = ref(false)
const zoneNormalizationRows = ref<AssetZoneNormalizationRow[]>([])
const zoneNormalizationOverrides = ref<Record<string, string>>({})
const zoneNormalizationParkSlug = ref('')

const selectedId = ref<string | null>(null)

/** Rows come from DB (`park_assets`); ThemeParks fills them via /integrations entity sync, not the Devices & Services adapter screen. */
const showIntegrationsSyncHint = computed(
  () =>
    !isTemplatesTab.value &&
    ['rides', 'shows', 'restaurants'].includes(entityType.value) &&
    !loading.value &&
    total.value === 0 &&
    !parkFilterKey.value.trim() &&
    !search.value.trim()
)

const wizardEntityTab = computed((): WizardEntityTab | null => {
  const t = entityType.value
  if (t === 'parks' || t === 'rides' || t === 'shows' || t === 'restaurants') return t
  return null
})

const wizardOpen = ref(false)
const wizardMode = ref<'create' | 'edit'>('edit')
const wizardEntityId = ref<string | null>(null)

const filterTemplateId = ref('')
const filterZoneId = ref('')
const filterProfileCompleteness = ref('')

const templateRows = ref<EntityTypeTemplateRow[]>([])
const selectedTemplate = ref<EntityTypeTemplateRow | null>(null)
const templateDrawerOpen = ref(false)

/** Traffic light + short English summary; optional detail lines (errors, last log line). */
const statusStrip = ref<{ traffic: 'green' | 'amber' | 'red'; lines: string[] } | null>(null)
const statusStripLoading = ref(false)
const statusStripExpanded = ref(false)
const statusHeadline = computed(() => statusStrip.value?.lines?.[0] || t('masterDataEntity.status.noStatusYet'))

function bannerErr(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

async function loadIntegrationStatusBanner() {
  if (isTemplatesTab.value) return
  statusStripLoading.value = true
  try {
    const [settingsRes, logRes] = await Promise.allSettled([
      getIntegrationSettings(),
      getAdapterPipelineLog({ adapterKey: 'themeparks_wiki', limit: 20 }),
    ])

    const details: string[] = []
    let traffic: 'green' | 'amber' | 'red' = 'amber'
    let headline = ''

    let pollOn = false
    let parkOk = false
    if (settingsRes.status === 'fulfilled') {
      const settings = settingsRes.value
      pollOn = Boolean((settings.pollingEnabled as { enabled?: boolean } | undefined)?.enabled)
      const sp = settings.selectedPark as { externalParkId?: string; parkName?: string } | undefined
      parkOk = Boolean(sp?.externalParkId && String(sp.externalParkId).trim())
    } else {
      headline = t('masterDataEntity.status.settingsLoadFailed', { msg: bannerErr(settingsRes.reason) })
      traffic = 'amber'
    }

    if (!headline && settingsRes.status === 'fulfilled') {
      if (!parkOk) {
        headline = t('masterDataEntity.status.noParkSaved')
        traffic = 'amber'
      } else {
        headline = pollOn ? t('masterDataEntity.status.okPollingOn') : t('masterDataEntity.status.okPollingOff')
        traffic = 'green'
      }
    }

    if (logRes.status === 'rejected') {
      details.push(t('masterDataEntity.status.pipelineLogFailed', { msg: bannerErr(logRes.reason) }))
      traffic = 'amber'
    } else {
      const log: AdapterPipelineLogResponse = logRes.value
      if (log.readError) {
        traffic = 'red'
        headline = t('masterDataEntity.status.pipelineUnreadable')
        details.push(log.readError)
      } else if (!log.loggingEnabled) {
        details.push(log.message || t('masterDataEntity.status.serverLoggingDisabled'))
        traffic = 'amber'
      } else if (log.entries?.length) {
        const lv = (s: string) => String(s || '').toLowerCase()
        const hasErr = log.entries.some((e) => ['error', 'fatal'].includes(lv(e.level)))
        const hasWarn = log.entries.some((e) => lv(e.level) === 'warn')
        const last = log.entries[0]
        if (hasErr) {
          traffic = 'red'
          const bad = log.entries.find((e) => ['error', 'fatal'].includes(lv(e.level)))
          headline = t('masterDataEntity.status.pipelineError')
          details.push(String(bad?.message || bad?.event || t('masterDataEntity.status.genericError')))
        } else if (hasWarn) {
          traffic = 'amber'
          headline = t('masterDataEntity.status.pipelineWarn')
          details.push(t('masterDataEntity.status.warningsDetail'))
        }
        const tsSuffix = last?.ts ? ` @ ${last.ts}` : ''
        details.push(
          t('masterDataEntity.status.latestTailLine', {
            tsSuffix,
            event: last?.event || '—',
            message: (last?.message || '').slice(0, 140) || '—',
          }),
        )
      } else if ((log.totalParsedInTail ?? 0) > 0) {
        details.push(t('masterDataEntity.status.tailNoneForAdapter'))
        traffic = 'amber'
      }
      // No extra copy for missing/empty log file; traffic already reflects settings.
    }

    const lines = [headline || t('masterDataEntity.status.statusUnavailable'), ...details.filter(Boolean)]
    statusStrip.value = { traffic, lines }
  } catch (e) {
    statusStrip.value = {
      traffic: 'amber',
      lines: [t('masterDataEntity.status.loadFailed', { msg: bannerErr(e) })],
    }
  } finally {
    statusStripLoading.value = false
  }
}

function resetGridFilters() {
  search.value = ''
  parkFilterKey.value = ''
  provider.value = ''
  status.value = ''
  enrichmentStatus.value = ''
  filterTemplateId.value = ''
  filterZoneId.value = ''
  filterProfileCompleteness.value = ''
  page.value = 0
  void loadGrid()
}

function statusBadgeClass(s: string): string {
  const v = String(s || '').toUpperCase()
  if (v === 'OPEN') return 'bg-emerald-900/40 text-emerald-300 ring-emerald-700/50'
  if (v === 'CLOSED' || v === 'INACTIVE') return 'bg-rose-900/40 text-rose-300 ring-rose-700/50'
  return 'bg-slate-800 text-slate-300 ring-slate-700/70'
}

function enrichmentBadgeClass(s: string): string {
  const v = String(s || '').toUpperCase()
  if (v === 'COMPLETE') return 'bg-emerald-900/40 text-emerald-300 ring-emerald-700/50'
  if (v === 'INCOMPLETE') return 'bg-amber-900/40 text-amber-200 ring-amber-700/50'
  if (v === 'ENRICHED') return 'bg-indigo-900/40 text-indigo-300 ring-indigo-700/50'
  if (v === 'LOCKED') return 'bg-amber-900/40 text-amber-300 ring-amber-700/50'
  return 'bg-slate-800 text-slate-300 ring-slate-700/70'
}

/** Native tooltip: required template keys + which are still missing (backend: templateRequiredFields / missingProfileFieldKeys). */
function profileFieldsTooltip(r: MasterDataGridRow): string {
  const req = r.templateRequiredFields
  if (!req?.length) return ''
  const missing = r.missingProfileFieldKeys ?? []
  let out = `${t('masterDataEntity.profileTooltip.required')}:\n${req.join(', ')}`
  if (missing.length)
    out += `\n\n${t('masterDataEntity.profileTooltip.missing')}:\n${missing.join(', ')}`
  else out += `\n\n${t('masterDataEntity.profileTooltip.allPresent')}`
  return out
}

const editMasterProfileJson = ref('{}')
const selectedApplyTemplateId = ref('')
const templatesForApply = ref<EntityTypeTemplateRow[]>([])

async function loadTemplatesForPicker() {
  if (isTemplatesTab.value) return
  const map: Record<string, string> = {
    parks: 'PARK',
    rides: 'RIDE',
    shows: 'SHOW',
    restaurants: 'RESTAURANT',
    shops: 'SHOP',
  }
  const key = map[entityType.value]
  if (!key) {
    templatesForApply.value = []
    return
  }
  try {
    templatesForApply.value = await listEntityTypeTemplates(key)
  } catch {
    templatesForApply.value = []
  }
}

async function applyTemplateFromDrawer() {
  if (!selectedApplyTemplateId.value || !selectedId.value) return
  if (entityType.value === 'zones' || entityType.value === 'templates') return
  try {
    const et = entityType.value as 'parks' | 'rides' | 'shows' | 'restaurants' | 'shops'
    await applyMasterDataTemplate(et, selectedId.value, selectedApplyTemplateId.value)
    push('Template applied', 'success')
    selectedApplyTemplateId.value = ''
    await loadDetail()
    await loadGrid()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

async function loadTemplates() {
  loading.value = true
  error.value = null
  try {
    templateRows.value = await listEntityTypeTemplates()
    total.value = templateRows.value.length
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    templateRows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadParks() {
  try {
    parks.value = await getPlatformParks()
  } catch {
    parks.value = []
  }
}

/** Query params shared by grid list and export (no pagination — export pages server-side). */
function masterDataExportQueryParams(): Record<string, string | number | undefined> {
  return {
    search: search.value || undefined,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    parkId: parkFilterKey.value.trim() || undefined,
    provider: provider.value || undefined,
    status: status.value || undefined,
    enrichmentStatus: enrichmentStatus.value || undefined,
    templateId: filterTemplateId.value.trim() || undefined,
    zoneId: filterZoneId.value.trim() || undefined,
    profileCompleteness: filterProfileCompleteness.value.trim() || undefined,
  }
}

const masterDataImportInput = ref<HTMLInputElement | null>(null)
const masterDataExcelImportInput = ref<HTMLInputElement | null>(null)
const exportImportBusy = ref(false)

const excelMasterDataSupported = computed(() =>
  ['rides', 'shows', 'restaurants', 'shops'].includes(entityType.value)
)

async function downloadMasterDataExport() {
  if (isTemplatesTab.value) return
  exportImportBusy.value = true
  try {
    const et = entityType.value as Exclude<MasterDataEntityType, 'templates'>
    const data = await exportMasterDataBundle(et, masterDataExportQueryParams())
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `master-data-${et}-${utcDateStampForFilename()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    push(`Exported ${data.totalExported} row(s) (cap ${data.maxCap}).`, 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Export failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

function triggerMasterDataImportPick() {
  masterDataImportInput.value?.click()
}

async function downloadMasterDataExcel() {
  if (!excelMasterDataSupported.value || isTemplatesTab.value) return
  exportImportBusy.value = true
  try {
    const et = entityType.value as MasterDataSpreadsheetEntityType
    const blob = await exportMasterDataXlsxBlob(et, masterDataExportQueryParams())
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `master-data-${et}-${utcDateStampForFilename()}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    push('Excel export downloaded.', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Excel export failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

function triggerMasterDataExcelImportPick() {
  masterDataExcelImportInput.value?.click()
}

async function onMasterDataExcelImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !excelMasterDataSupported.value || isTemplatesTab.value) return
  exportImportBusy.value = true
  try {
    const et = entityType.value as MasterDataSpreadsheetEntityType
    const res = await importMasterDataXlsx(et, file)
    const msg = `Excel import: ${res.appliedCount} applied, ${res.failedCount} failed.`
    push(msg, res.failedCount ? 'error' : 'success')
    if (res.failedCount && res.failed.length) console.warn('Master data Excel import failures', res.failed)
    await loadGrid()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Excel import failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

async function onMasterDataImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || isTemplatesTab.value) return
  exportImportBusy.value = true
  try {
    const text = await file.text()
    const json = JSON.parse(text) as {
      schemaVersion?: number
      entityType?: string
      items?: { id: string; patch?: Record<string, unknown> }[]
    }
    if (!json.items || !Array.isArray(json.items) || !json.items.length) {
      push('File must contain a non-empty "items" array.', 'error')
      return
    }
    const items = json.items
      .filter((x) => x && x.id && x.patch && typeof x.patch === 'object')
      .map((x) => ({ id: String(x.id), patch: x.patch as Record<string, unknown> }))
    if (!items.length) {
      push('No valid entries: each item needs "id" and "patch".', 'error')
      return
    }
    const et = entityType.value as Exclude<MasterDataEntityType, 'templates'>
    const res = await importMasterDataBundle(et, {
      schemaVersion: json.schemaVersion === 1 ? 1 : undefined,
      entityType: json.entityType,
      items,
    })
    const msg = `Import finished: ${res.appliedCount} applied, ${res.failedCount} failed.`
    push(msg, res.failedCount ? 'error' : 'success')
    if (res.failedCount && res.failed.length) {
      console.warn('Master data import failures', res.failed)
    }
    await loadGrid()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Import failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

function resolveRestaurantNormalizationParkSlug(): string {
  const key = parkFilterKey.value.trim()
  if (!key) return ''
  const byLookup = parks.value.find((p) => p.id === key || p.slug === key || p.externalEntityId === key)
  if (byLookup?.slug) return byLookup.slug
  return key
}

function zoneNormalizationType(): 'RESTAURANT' | 'SHOW' | null {
  if (entityType.value === 'restaurants') return 'RESTAURANT'
  if (entityType.value === 'shows') return 'SHOW'
  return null
}

const zoneNormalizationTitle = computed(() =>
  entityType.value === 'shows' ? 'Show Zone Normalization' : 'Restaurant Zone Normalization'
)

async function loadAssetZoneNormalizationPreview() {
  const type = zoneNormalizationType()
  if (!type) {
    zoneNormalizationRows.value = []
    zoneNormalizationParkSlug.value = ''
    return
  }
  const parkSlug = resolveRestaurantNormalizationParkSlug()
  zoneNormalizationParkSlug.value = parkSlug
  if (!parkSlug) {
    zoneNormalizationRows.value = []
    return
  }
  zoneNormalizationLoading.value = true
  try {
    const preview = await getAssetZoneNormalizationPreview({ parkSlug, type })
    zoneNormalizationRows.value = preview.rows
    zoneNormalizationOverrides.value = {}
  } catch {
    zoneNormalizationRows.value = []
  } finally {
    zoneNormalizationLoading.value = false
  }
}

async function applyAssetZoneNormalization(dryRun: boolean) {
  const type = zoneNormalizationType()
  if (!type) return
  if (!zoneNormalizationParkSlug.value) {
    push('Choose a park first.', 'error')
    return
  }
  zoneNormalizationLoading.value = true
  try {
    const manualOverrides = Object.entries(zoneNormalizationOverrides.value)
      .filter(([, zoneSlug]) => String(zoneSlug || '').trim() !== '')
      .map(([assetId, zoneSlug]) => ({ assetId, zoneSlug: String(zoneSlug).trim() }))
    const manualOverrideAssetIds = new Set(manualOverrides.map((x) => String(x.assetId)))
    const safetyOverrides =
      dryRun
        ? []
        : zoneNormalizationRows.value
            .filter(
              (row) =>
                !manualOverrideAssetIds.has(String(row.assetId)) &&
                !['HIGH', 'MEDIUM'].includes(String(row.confidence || '').toUpperCase())
            )
            .map((row) => ({ assetId: row.assetId, zoneSlug: row.currentZoneSlug || null }))
    const overrides = [...manualOverrides, ...safetyOverrides]
    const out = await postAssetZoneNormalizationApply({
      parkSlug: zoneNormalizationParkSlug.value,
      type,
      dryRun,
      overrides,
    })
    zoneNormalizationRows.value = out.rows
    if (!dryRun) {
      push(`Zone normalization applied: ${out.updated} ${type === 'SHOW' ? 'show(s)' : 'restaurant(s)'}.`, 'success')
      await loadGrid()
    } else {
      push('Dry-run completed.', 'success')
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Zone normalization failed', 'error')
  } finally {
    zoneNormalizationLoading.value = false
  }
}

async function loadGrid() {
  if (isTemplatesTab.value) {
    await loadTemplates()
    return
  }
  loading.value = true
  error.value = null
  try {
    const et = entityType.value as Exclude<MasterDataEntityType, 'templates'>
    const res = await listMasterData(et, {
      page: page.value,
      pageSize: pageSize.value,
      ...masterDataExportQueryParams(),
    })
    rows.value = res.rows
    total.value = res.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
  await loadAssetZoneNormalizationPreview()
}

function setSort(col: string) {
  if (sortBy.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = col
    sortDir.value = 'asc'
  }
  page.value = 0
  void loadGrid()
}

function sortChevron(col: string): string {
  if (sortBy.value !== col) return ''
  return sortDir.value === 'asc' ? '▲' : '▼'
}

function openWizardForRow(row: MasterDataGridRow) {
  if (!wizardEntityTab.value) return
  wizardMode.value = 'edit'
  wizardEntityId.value = row.id
  wizardOpen.value = true
  drawerOpen.value = false
}

function openWizardCreate() {
  if (!wizardEntityTab.value || wizardEntityTab.value === 'parks') {
    push('Manual create is only available for attractions, shows, and restaurants.', 'info')
    return
  }
  wizardMode.value = 'create'
  wizardEntityId.value = null
  wizardOpen.value = true
}

function openDrawerQuick(row: MasterDataGridRow) {
  if (isTemplatesTab.value) return
  selectedId.value = row.id
  drawerOpen.value = true
  detailTab.value = 'overview'
  void loadDetail()
}

function openRow(row: MasterDataGridRow) {
  if (isTemplatesTab.value) return
  /** Row click: guided wizard (basic data, capacity, staffing, ML profile, …). */
  if (wizardEntityTab.value) {
    openWizardForRow(row)
    return
  }
  openDrawerQuick(row)
}

async function openTemplateRow(t: EntityTypeTemplateRow) {
  try {
    selectedTemplate.value = await getEntityTypeTemplate(t.id)
    templateDrawerOpen.value = true
  } catch (e) {
    push(e instanceof Error ? e.message : 'Load failed', 'error')
  }
}

async function loadUnsTopicPreviewForDrawer() {
  unsTopicPreviewLoading.value = true
  unsTopicPreview.value = null
  try {
    unsTopicPreview.value = await getUnsSuggestions()
  } catch {
    unsTopicPreview.value = null
  } finally {
    unsTopicPreviewLoading.value = false
  }
}

async function loadDetail() {
  if (!selectedId.value || isTemplatesTab.value) return
  const assetKey = selectedId.value
  const switchingAsset = detailLoadedForAssetId.value !== assetKey
  detailLoading.value = true
  detailError.value = null
  unsTopicPreview.value = null
  if (switchingAsset) {
    detail.value = null
    detailLoadedForAssetId.value = null
  }
  try {
    const et = entityType.value as Exclude<MasterDataEntityType, 'templates'>
    const d = await getMasterDataDetail(et, assetKey)
    if (!d || typeof d !== 'object') {
      detailError.value = 'Keine Detaildaten vom Server erhalten.'
      return
    }
    detail.value = d
    detailLoadedForAssetId.value = assetKey
    if (d.entityKind === 'asset') {
      const a = (d.asset as Record<string, unknown> & { rideMaster?: Record<string, unknown> }) || {}
      const {
        rideMaster: _rm,
        showMaster: _sm,
        restaurantMaster: _rmd,
        shopMaster: _sh,
        assetType: _at,
        park: _pk,
        zone: _zn,
        parentAsset: _pa,
        childAssets: _ch,
        assetTarget: _tgt,
        runtimeOverrides: _ro,
        observations: _ob,
        ...assetScalars
      } = a
      editAsset.value = { ...assetScalars }
      if (editAsset.value.zoneId == null || editAsset.value.zoneId === undefined) {
        editAsset.value.zoneId = ''
      }
      editRide.value = { ...(a.rideMaster || {}) }
      editShow.value = { ...((a as { showMaster?: Record<string, unknown> }).showMaster || {}) }
      editRestaurant.value = { ...((a as { restaurantMaster?: Record<string, unknown> }).restaurantMaster || {}) }
      editShop.value = { ...((a as { shopMaster?: Record<string, unknown> }).shopMaster || {}) }
      const enr = await getMasterDataAssetEnrichment(assetKey)
      locksJson.value = JSON.stringify(enr.locks || {}, null, 2)
      const pres = d.masterDataPresentation as { master_profile?: Record<string, unknown> } | undefined
      editMasterProfileJson.value = JSON.stringify(pres?.master_profile || {}, null, 2)
      if (['rides', 'shows', 'restaurants', 'shops'].includes(entityType.value)) {
        await loadUnsTopicPreviewForDrawer()
        await refreshParkZonesForDrawer(String(editAsset.value.parkId || ''))
      }
    } else if (d.entityKind === 'park') {
      const p = (d.park as Record<string, unknown>) || {}
      editPark.value = { ...p }
      const pres = d.masterDataPresentation as { master_profile?: Record<string, unknown> } | undefined
      editMasterProfileJson.value = JSON.stringify(pres?.master_profile || {}, null, 2)
    } else if (d.entityKind === 'zone') {
      const z = (d.zone as Record<string, unknown>) || {}
      editZone.value = { ...z }
      editMasterProfileJson.value = '{}'
    }
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : 'Load failed'
    push(detailError.value, 'error')
  } finally {
    detailLoading.value = false
  }
}

async function saveDetail() {
  if (!selectedId.value) return
  saving.value = true
  let masterProfile: Record<string, unknown> | undefined
  if (entityType.value === 'parks' || isAssetSection.value) {
    try {
      masterProfile = JSON.parse(editMasterProfileJson.value || '{}') as Record<string, unknown>
    } catch {
      push('Typed profile JSON invalid', 'error')
      saving.value = false
      return
    }
  }
  try {
    if (entityType.value === 'parks') {
      await patchMasterData('parks', selectedId.value, {
        name: editPark.value.name,
        slug: editPark.value.slug,
        timezone: editPark.value.timezone,
        ...(masterProfile !== undefined ? { masterProfile } : {}),
      })
    } else if (entityType.value === 'zones') {
      await patchMasterData('zones', selectedId.value, {
        name: editZone.value.name,
        slug: editZone.value.slug,
        sortOrder: editZone.value.sortOrder,
        parentZoneId: editZone.value.parentZoneId ? String(editZone.value.parentZoneId) : null,
      })
    } else {
      const body: Record<string, unknown> = { asset: { ...editAsset.value } }
      if (entityType.value === 'rides') body.rideMaster = { ...editRide.value }
      if (entityType.value === 'shows') body.showMaster = { ...editShow.value }
      if (entityType.value === 'restaurants') body.restaurantMaster = { ...editRestaurant.value }
      if (entityType.value === 'shops') body.shopMaster = { ...editShop.value }
      let locks: Record<string, string[]> = {}
      try {
        locks = JSON.parse(locksJson.value || '{}') as Record<string, string[]>
      } catch {
        push('Locks JSON invalid', 'error')
        saving.value = false
        return
      }
      await patchMasterDataAssetEnrichment(selectedId.value, { locks })
      const et = entityType.value as 'rides' | 'shows' | 'restaurants' | 'shops'
      await patchMasterData(et, selectedId.value, {
        ...body,
        ...(masterProfile !== undefined ? { masterProfile } : {}),
      })
    }
    push('Saved', 'success')
    await loadGrid()
    await loadDetail()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

async function onDeactivate() {
  if (!selectedId.value) return
  const et = entityType.value
  if (et !== 'parks' && et !== 'rides' && et !== 'shows' && et !== 'restaurants' && et !== 'shops') return
  const ok = await askConfirm({
    message: 'Deactivate this record? Provider-linked rows stay in the database (active flag / park enrichment).',
    confirmLabel: 'Ja',
    cancelLabel: 'Abbrechen',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await deactivateMasterData(et, selectedId.value)
    push('Deactivated', 'success')
    drawerOpen.value = false
    await loadGrid()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

const createOpen = ref(false)
/** Manual create: park as UUID, slug, or external id. */
const createParkKey = ref('')
const createName = ref('')
const createSlug = ref('')

async function submitCreate() {
  if (!['rides', 'shows', 'restaurants', 'shops'].includes(entityType.value)) return
  const pk = createParkKey.value.trim()
  if (!pk) {
    push('Enter a park (UUID, slug, or external id).', 'error')
    return
  }
  try {
    await createManualMasterDataAsset(entityType.value as 'rides' | 'shows' | 'restaurants' | 'shops', {
      parkId: pk,
      name: createName.value,
      slug: createSlug.value || undefined,
    })
    push('Created', 'success')
    createOpen.value = false
    createName.value = ''
    createSlug.value = ''
    await loadGrid()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Create failed', 'error')
  }
}

const capacityHint = computed(() => {
  const c = detail.value?.capacity as Record<string, unknown> | undefined
  if (!c) return ''
  const parts = [`theoretical: ${c.theoreticalCapacityPerHour ?? '—'}`, `derived: ${c.capacityPerHourDerived ?? '—'}`]
  return parts.join(' · ')
})

const rawProvider = computed(() => {
  const d = detail.value
  if (!d) return null
  if (d.entityKind === 'park') return (d.park as { providerSnapshot?: unknown })?.providerSnapshot
  if (d.entityKind === 'asset') return (d.asset as { providerSnapshot?: unknown })?.providerSnapshot
  return null
})

const detailChildCount = computed(() => {
  const d = detail.value as { childCount?: number } | null
  return d?.childCount ?? 0
})

const detailParentAssetId = computed(() => {
  const d = detail.value
  if (!d || d.entityKind !== 'asset') return null
  const a = d.asset as { parentAssetId?: string | null }
  return a?.parentAssetId || null
})

const unsTopicRowsForSelectedAsset = computed(() => {
  const tree = unsTopicPreview.value?.tree
  const d = detail.value
  if (!tree?.length || d?.entityKind !== 'asset') return [] as UnsSuggestedTopic[]
  const a = d.asset as {
    externalEntityId?: string | null
    slug?: string | null
    name?: string | null
    assetId?: string | null
  }
  const ext = a.externalEntityId != null && String(a.externalEntityId).trim() !== '' ? String(a.externalEntityId).trim() : null
  const aid = a.assetId != null ? String(a.assetId) : null
  const slugified = slugifyName(String(a.slug || a.name || ''))
  const matched: UnsSuggestedTopic[] = []
  const seen = new Set<string>()
  for (const g of tree) {
    for (const it of g.items) {
      const hit =
        (!!ext && it.externalEntityId === ext) ||
        (!!aid && it.externalEntityId === aid) ||
        (!!slugified && it.assetSlug === slugified)
      if (hit && !seen.has(it.topicPath)) {
        seen.add(it.topicPath)
        matched.push(it)
      }
    }
  }
  return matched.sort((a, b) => a.topicPath.localeCompare(b.topicPath))
})

const unsTopicMetricsForSelectedAsset = computed(() => {
  const codes = new Set<string>()
  for (const r of unsTopicRowsForSelectedAsset.value) {
    if (r.metric) codes.add(r.metric)
  }
  return [...codes].sort((a, b) => a.localeCompare(b))
})

const masterPresentation = computed(
  () => detail.value?.masterDataPresentation as Record<string, unknown> | undefined
)

function jsonComputed(r: Ref<Record<string, unknown>>) {
  return computed({
    get: () => JSON.stringify(r.value, null, 2),
    set: (v: string) => {
      try {
        r.value = JSON.parse(v) as Record<string, unknown>
      } catch {
        /* ignore invalid JSON while typing */
      }
    },
  })
}

const editRideJson = jsonComputed(editRide)
const editShowJson = jsonComputed(editShow)
const editRestaurantJson = jsonComputed(editRestaurant)
const editShopJson = jsonComputed(editShop)

watch(
  () => route.params.entityType,
  (p) => {
    const raw = String(p || '').toLowerCase()
    const normalized = ENTITY_ALIASES[raw] ?? raw
    const allowed = new Set<string>(ENTITY_TAB_IDS)
    if (ENTITY_ALIASES[raw]) {
      void router.replace({ name: 'master-data', params: { entityType: ENTITY_ALIASES[raw] } })
      return
    }
    if (!allowed.has(normalized)) {
      void router.replace({ name: 'master-data', params: { entityType: 'parks' as MasterDataEntityType } })
      return
    }
    page.value = 0
    void loadTemplatesForPicker()
    void loadGrid()
    void loadIntegrationStatusBanner()
  }
)

onMounted(() => {
  void loadParks()
  void loadTemplatesForPicker()
  void loadGrid()
  void loadIntegrationStatusBanner()
})

watch([page, pageSize], () => {
  if (isTemplatesTab.value) return
  void loadGrid()
})
</script>

<template>
  <div class="mx-auto max-w-[1200px] space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('menu.masterData') }}</h1>
      </div>
      <RouterLink class="text-sm text-brand-400 hover:text-brand-300" to="/">{{
        t('masterDataEntity.backToOperations')
      }}</RouterLink>
    </div>

    <nav class="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
      <RouterLink
        v-for="tabId in ENTITY_TAB_IDS"
        :key="tabId"
        :to="{ name: 'master-data', params: { entityType: tabId } }"
        class="rounded-md px-3 py-1.5 text-sm font-medium"
        :class="
          entityType === tabId ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
        "
      >
        {{ t(`masterDataEntity.tabs.${tabId}`) }}
      </RouterLink>
    </nav>

    <div
      v-if="!isTemplatesTab"
      class="space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-3 text-xs text-slate-300"
    >
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-medium text-slate-100">{{ t('masterDataEntity.bannerTitle') }}</span>
          <span class="text-[10px] text-slate-500">{{ t('masterDataEntity.bannerSubtitle') }}</span>
          <template v-if="!statusStripLoading && statusStrip">
            <span
              class="inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-slate-600 ring-offset-2 ring-offset-slate-900"
              :class="{
                'bg-emerald-500': statusStrip.traffic === 'green',
                'bg-amber-500': statusStrip.traffic === 'amber',
                'bg-rose-500': statusStrip.traffic === 'red',
              }"
              :title="
                statusStrip.traffic === 'green'
                  ? t('masterDataEntity.tooltipGreen')
                  : statusStrip.traffic === 'red'
                    ? t('masterDataEntity.tooltipRed')
                    : t('masterDataEntity.tooltipAmber')
              "
            />
            <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400">{{
              statusStrip.traffic === 'green'
                ? t('masterDataEntity.trafficOk')
                : statusStrip.traffic === 'red'
                  ? t('masterDataEntity.trafficError')
                  : t('masterDataEntity.trafficCheck')
            }}</span>
          </template>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <button
            type="button"
            class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
            @click="void loadIntegrationStatusBanner()"
          >
            {{ t('masterDataEntity.refresh') }}
          </button>
        </div>
      </div>

      <div v-if="statusStripLoading" class="text-sm text-slate-400">{{ t('masterDataEntity.loadingStatus') }}</div>
      <div v-else-if="statusStrip" class="space-y-2">
        <p class="break-words border-l-2 border-slate-600 pl-3 text-[12px] leading-relaxed text-slate-200">
          {{ statusHeadline }}
        </p>
        <button
          type="button"
          class="text-[11px] text-brand-400 underline hover:text-brand-300"
          @click="statusStripExpanded = !statusStripExpanded"
        >
          {{ statusStripExpanded ? t('masterDataEntity.hideDetails') : t('masterDataEntity.showDetails') }}
        </button>
        <div v-if="statusStripExpanded" class="space-y-2">
          <p
            v-for="(ln, i) in statusStrip.lines.slice(1)"
            :key="i"
            class="break-words border-l-2 border-slate-700 pl-3 text-[11px] leading-relaxed text-slate-300"
          >
            {{ ln }}
          </p>
        </div>
      </div>
      <p v-else class="text-sm text-slate-400">
        {{ t('masterDataEntity.noStatusLines') }}
        <button
          type="button"
          class="ml-1 text-brand-400 underline hover:text-brand-300"
          @click="void loadIntegrationStatusBanner()"
        >
          {{ t('masterDataEntity.reload') }}
        </button>
      </p>
    </div>

    <aside
      v-if="showIntegrationsSyncHint"
      class="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/95"
    >
      <p class="font-medium text-amber-200">{{ t('masterDataEntity.syncHintTitle') }}</p>
      <p class="mt-2 text-xs leading-relaxed text-amber-100/85">
        {{ t('masterDataEntity.syncHintBody') }}
      </p>
      <p class="mt-2 text-xs text-amber-200/80">
        {{ t('masterDataEntity.syncHintTest') }}
      </p>
      <RouterLink
        class="mt-3 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-500"
        to="/integrations"
      >
        {{ t('masterDataEntity.syncHintLink') }}
      </RouterLink>
    </aside>

    <div v-if="!isTemplatesTab" class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <label class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.search') }}
        <input
          v-model="search"
          type="search"
          class="mt-1 block w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          :placeholder="t('masterDataEntity.filters.searchPlaceholder')"
          @keydown.enter="page = 0; void loadGrid()"
        />
      </label>
      <label v-if="entityType !== 'parks'" class="text-xs text-slate-500">
        <span class="block">{{ t('masterDataEntity.filters.filterByPark') }}</span>
        <span class="mt-0.5 block text-[10px] font-normal text-slate-600">{{
          t('masterDataEntity.filters.filterByParkHint')
        }}</span>
        <input
          v-model="parkFilterKey"
          list="md-park-filter-dl"
          type="text"
          autocomplete="off"
          class="mt-1 block w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
          :placeholder="t('masterDataEntity.filters.parkPlaceholder')"
          @keydown.enter="page = 0; void loadGrid()"
        />
        <datalist id="md-park-filter-dl">
          <option v-for="(s, idx) in parkLookupSuggestions" :key="`f-${idx}-${s.value}`" :value="s.value" :label="s.label" />
        </datalist>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.provider') }}
        <input
          v-model="provider"
          class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          :placeholder="t('masterDataEntity.filters.providerPlaceholder')"
          @keydown.enter="page = 0; void loadGrid()"
        />
      </label>
      <label class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.status') }}
        <select
          v-model="status"
          class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          @change="page = 0; void loadGrid()"
        >
          <option value="">{{ t('masterDataEntity.filters.any') }}</option>
          <option value="OPEN">OPEN</option>
          <option value="CLOSED">CLOSED</option>
          <option value="UNKNOWN">UNKNOWN</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.enrichment') }}
        <select
          v-model="enrichmentStatus"
          class="mt-1 block w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          @change="page = 0; void loadGrid()"
        >
          <option value="">{{ t('masterDataEntity.filters.any') }}</option>
          <option value="BASIC">BASIC</option>
          <option value="ENRICHED">ENRICHED</option>
          <option value="LOCKED">LOCKED</option>
        </select>
      </label>
      <label v-if="isAssetSection" class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.zoneUuid') }}
        <input
          v-model="filterZoneId"
          class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
          :placeholder="t('masterDataEntity.filters.zonePlaceholder')"
          @keydown.enter="page = 0; void loadGrid()"
        />
      </label>
      <label v-if="entityType === 'parks' || isAssetSection" class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.templateUuid') }}
        <input
          v-model="filterTemplateId"
          class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
          :placeholder="t('masterDataEntity.filters.templatePlaceholder')"
          @keydown.enter="page = 0; void loadGrid()"
        />
      </label>
      <label v-if="entityType === 'parks' || isAssetSection" class="text-xs text-slate-500">
        {{ t('masterDataEntity.filters.profile') }}
        <select
          v-model="filterProfileCompleteness"
          class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          @change="page = 0; void loadGrid()"
        >
          <option value="">{{ t('masterDataEntity.filters.any') }}</option>
          <option value="COMPLETE">COMPLETE</option>
          <option value="INCOMPLETE">INCOMPLETE</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
        @click="page = 0; void loadGrid()"
      >
        {{ t('masterDataEntity.filters.apply') }}
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        @click="resetGridFilters"
      >
        {{ t('masterDataEntity.filters.reset') }}
      </button>
      <RouterLink
        class="inline-flex items-center rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        :to="assetMapTo"
        :title="t('masterDataEntity.filters.assetMapTitle')"
      >
        {{ t('masterDataEntity.filters.assetMap') }}
      </RouterLink>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="exportImportBusy"
        :title="t('masterDataEntity.filters.downloadJsonTitle')"
        @click="void downloadMasterDataExport()"
      >
        {{ t('masterDataEntity.filters.downloadJson') }}
      </button>
      <input
        ref="masterDataImportInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="void onMasterDataImportFile($event)"
      />
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="exportImportBusy"
        :title="t('masterDataEntity.filters.uploadJsonTitle')"
        @click="triggerMasterDataImportPick()"
      >
        {{ t('masterDataEntity.filters.uploadJson') }}
      </button>
      <template v-if="excelMasterDataSupported">
        <button
          type="button"
          class="rounded-md border border-emerald-700/80 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
          :disabled="exportImportBusy"
          :title="t('masterDataEntity.filters.downloadExcelTitle')"
          @click="void downloadMasterDataExcel()"
        >
          {{ t('masterDataEntity.filters.downloadExcel') }}
        </button>
        <input
          ref="masterDataExcelImportInput"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="hidden"
          @change="void onMasterDataExcelImportFile($event)"
        />
        <button
          type="button"
          class="rounded-md border border-emerald-700/80 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
          :disabled="exportImportBusy"
          :title="t('masterDataEntity.filters.uploadExcelTitle')"
          @click="triggerMasterDataExcelImportPick()"
        >
          {{ t('masterDataEntity.filters.uploadExcel') }}
        </button>
      </template>
      <button
        v-if="isAssetSection && wizardEntityTab && wizardEntityTab !== 'parks'"
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        @click="openWizardCreate"
      >
        {{ t('masterDataEntity.filters.createWizard') }}
      </button>
      <button
        v-else-if="isAssetSection"
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        @click="createOpen = true"
      >
        {{ t('masterDataEntity.filters.createManual') }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-rose-400">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">{{ t('masterDataEntity.loadingGrid') }}</p>
    <div
      v-if="entityType === 'restaurants' || entityType === 'shows'"
      class="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold text-slate-200">{{ zoneNormalizationTitle }}</span>
        <span class="text-slate-500">Park: {{ zoneNormalizationParkSlug || 'set park filter' }}</span>
        <button
          type="button"
          class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800 disabled:opacity-50"
          :disabled="zoneNormalizationLoading || !zoneNormalizationParkSlug"
          @click="void loadAssetZoneNormalizationPreview()"
        >
          Preview
        </button>
        <button
          type="button"
          class="rounded border border-emerald-700 px-2 py-1 text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
          :disabled="zoneNormalizationLoading || !zoneNormalizationParkSlug"
          @click="void applyAssetZoneNormalization(true)"
        >
          Dry-run apply
        </button>
        <button
          type="button"
          class="rounded border border-brand-700 px-2 py-1 text-brand-200 hover:bg-brand-900/30 disabled:opacity-50"
          :disabled="zoneNormalizationLoading || !zoneNormalizationParkSlug"
          @click="void applyAssetZoneNormalization(false)"
        >
          Bulk apply
        </button>
      </div>
      <p class="text-[10px] text-slate-500">Bulk apply updates HIGH and MEDIUM confidence by default; use override per row for exceptions.</p>
      <p v-if="zoneNormalizationLoading" class="text-slate-500">Resolving zones…</p>
      <div v-else-if="zoneNormalizationRows.length" class="max-h-64 overflow-auto rounded border border-slate-800">
        <table class="min-w-full text-left text-[11px]">
          <thead class="bg-slate-900 text-slate-500">
            <tr>
              <th class="px-2 py-1">Asset</th>
              <th class="px-2 py-1">Venue hint</th>
              <th class="px-2 py-1">Current zone</th>
              <th class="px-2 py-1">Proposed zone</th>
              <th class="px-2 py-1">Override</th>
              <th class="px-2 py-1">Match type</th>
              <th class="px-2 py-1">Confidence</th>
              <th class="px-2 py-1">Reason</th>
              <th class="px-2 py-1">Edge</th>
              <th class="px-2 py-1">Sparkplug topic</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in zoneNormalizationRows.slice(0, 50)" :key="r.assetId" class="border-t border-slate-800">
              <td class="px-2 py-1 text-slate-200">{{ r.assetName }}</td>
              <td class="px-2 py-1">{{ r.venueName || '—' }}</td>
              <td class="px-2 py-1">{{ r.currentZoneSlug || '—' }}</td>
              <td class="px-2 py-1">{{ r.proposedZoneSlug || '—' }}</td>
              <td class="px-2 py-1">
                <input
                  v-model="zoneNormalizationOverrides[r.assetId]"
                  class="w-32 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px]"
                  :placeholder="r.proposedZoneSlug || 'zone_slug'"
                />
              </td>
              <td class="px-2 py-1">{{ r.matchType || '—' }}</td>
              <td class="px-2 py-1">{{ r.confidence }}</td>
              <td class="max-w-[16rem] truncate px-2 py-1" :title="r.reason">{{ r.reason }}</td>
              <td class="px-2 py-1 font-mono text-[10px]">{{ r.edgeNodeId || '—' }}</td>
              <td class="max-w-[22rem] truncate px-2 py-1 font-mono text-[10px]" :title="r.topicPreview">{{ r.topicPreview }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="!isTemplatesTab" class="overflow-x-auto rounded-lg border border-slate-800">
      <table class="min-w-full text-left text-sm text-slate-200">
        <thead class="border-b border-slate-800 bg-slate-900/80 text-xs uppercase text-slate-500">
          <tr>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('name')">
              {{ t('masterDataEntity.table.name') }} {{ sortChevron('name') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('slug')">
              {{ t('masterDataEntity.table.slug') }} {{ sortChevron('slug') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('type')">
              {{ t('masterDataEntity.table.type') }} {{ sortChevron('type') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('parkName')">
              {{ t('masterDataEntity.table.park') }} {{ sortChevron('parkName') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('zoneName')">
              {{ t('masterDataEntity.table.zone') }} {{ sortChevron('zoneName') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('parentName')">
              {{ t('masterDataEntity.table.parent') }} {{ sortChevron('parentName') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('provider')">
              {{ t('masterDataEntity.table.provider') }} {{ sortChevron('provider') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('externalId')">
              {{ t('masterDataEntity.table.externalId') }} {{ sortChevron('externalId') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('status')">
              {{ t('masterDataEntity.table.status') }} {{ sortChevron('status') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('waitTimeMin')">
              {{ t('masterDataEntity.table.waitMin') }} {{ sortChevron('waitTimeMin') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('active')">
              {{ t('masterDataEntity.table.active') }} {{ sortChevron('active') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('templateCode')">
              {{ t('masterDataEntity.table.template') }} {{ sortChevron('templateCode') }}
            </th>
            <th
              class="cursor-pointer select-none px-3 py-2"
              :title="t('masterDataEntity.profileTooltip.columnHint')"
              @click="setSort('enrichmentStatus')"
            >
              {{ t('masterDataEntity.table.profileEnrichment') }} {{ sortChevron('enrichmentStatus') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('lastSyncedAt')">
              {{ t('masterDataEntity.table.lastSync') }} {{ sortChevron('lastSyncedAt') }}
            </th>
            <th class="cursor-pointer select-none px-3 py-2" @click="setSort('updatedAt')">
              {{ t('masterDataEntity.table.updated') }} {{ sortChevron('updatedAt') }}
            </th>
            <th v-if="wizardEntityTab" class="px-3 py-2">{{ t('masterDataEntity.table.detailPanel') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.id"
            class="cursor-pointer border-b border-slate-800/80 hover:bg-slate-800/40"
            @click="openRow(r)"
          >
            <td class="px-3 py-2 font-medium text-white">{{ r.name }}</td>
            <td class="max-w-[7rem] truncate px-3 py-2 font-mono text-[11px] text-slate-400" :title="r.slug || ''">
              {{ r.slug || '—' }}
            </td>
            <td class="px-3 py-2 font-mono text-xs">{{ r.type }}</td>
            <td class="px-3 py-2 text-slate-400">{{ r.parkName || '—' }}</td>
            <td class="max-w-[6rem] truncate px-3 py-2 text-xs text-slate-400" :title="r.zoneName || ''">
              {{ r.zoneName || '—' }}
            </td>
            <td class="px-3 py-2 text-slate-400">{{ r.parentName || '—' }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ r.provider }}</td>
            <td class="max-w-[8rem] truncate px-3 py-2 font-mono text-xs" :title="r.externalId || ''">
              {{ r.externalId || '—' }}
            </td>
            <td class="px-3 py-2">
              <span class="inline-flex rounded px-2 py-0.5 text-[11px] font-medium ring-1" :class="statusBadgeClass(r.status)">
                {{ r.status || 'UNKNOWN' }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                class="inline-flex min-w-[3.5rem] justify-end rounded px-2 py-0.5 text-[11px] font-medium ring-1"
                :class="
                  typeof r.waitTimeMin === 'number' && r.waitTimeMin >= 45
                    ? 'bg-amber-900/40 text-amber-300 ring-amber-700/50'
                    : 'bg-slate-800 text-slate-300 ring-slate-700/70'
                "
              >
                {{ typeof r.waitTimeMin === 'number' ? `${Math.round(r.waitTimeMin)}m` : '—' }}
              </span>
            </td>
            <td class="px-3 py-2">{{ r.active === false ? t('masterDataEntity.no') : t('masterDataEntity.yes') }}</td>
            <td class="max-w-[6rem] truncate px-3 py-2 font-mono text-[10px] text-slate-400" :title="r.templateCode || ''">
              {{ r.templateCode || '—' }}
            </td>
            <td class="px-3 py-2 text-xs">
              <span
                class="inline-flex cursor-help rounded px-2 py-0.5 text-[11px] font-medium ring-1"
                :class="enrichmentBadgeClass(r.enrichmentStatus)"
                :title="profileFieldsTooltip(r) || undefined"
              >
                {{ r.enrichmentStatus || 'BASIC' }}
              </span>
            </td>
            <td class="px-3 py-2 font-mono text-[10px] text-slate-500">{{ formatMasterTimestamp(r.lastSyncedAt) }}</td>
            <td class="px-3 py-2 font-mono text-[10px] text-slate-500">{{ formatMasterTimestamp(r.updatedAt) }}</td>
            <td v-if="wizardEntityTab" class="px-3 py-2" @click.stop>
              <button
                type="button"
                class="text-xs text-slate-400 underline hover:text-white"
                @click="openDrawerQuick(r)"
              >
                {{ t('masterDataEntity.table.detailPanel') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-slate-800">
      <table class="min-w-full text-left text-sm text-slate-200">
        <thead class="border-b border-slate-800 bg-slate-900/80 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-3 py-2">{{ t('masterDataEntity.table.entityType') }}</th>
            <th class="px-3 py-2">{{ t('masterDataEntity.table.code') }}</th>
            <th class="px-3 py-2">{{ t('masterDataEntity.table.name') }}</th>
            <th class="px-3 py-2">{{ t('masterDataEntity.table.description') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in templateRows"
            :key="t.id"
            class="cursor-pointer border-b border-slate-800/80 hover:bg-slate-800/40"
            @click="openTemplateRow(t)"
          >
            <td class="px-3 py-2 font-mono text-xs">{{ t.entityType }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ t.templateCode }}</td>
            <td class="px-3 py-2 text-white">{{ t.templateName }}</td>
            <td class="max-w-md truncate px-3 py-2 text-xs text-slate-400">{{ t.description || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between gap-3 text-sm text-slate-400">
      <span>{{ t('masterDataEntity.pagination.rows', { count: total }) }}</span>
      <div v-if="!isTemplatesTab" class="flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          :disabled="page <= 0"
          @click="page -= 1; void loadGrid()"
        >
          {{ t('masterDataEntity.pagination.prev') }}
        </button>
        <div class="flex max-w-[50vw] items-center gap-1 overflow-x-auto">
          <button
            v-for="(item, idx) in paginationPages"
            :key="`p-${idx}-${item}`"
            type="button"
            class="rounded border px-2 py-1 text-xs"
            :class="item === page + 1 ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800/70'"
            :disabled="item === page + 1"
            @click="page = item - 1; void loadGrid()"
          >
            {{ item }}
          </button>
        </div>
        <span class="whitespace-nowrap text-xs text-slate-500">{{ t('masterDataEntity.pagination.page', { n: page + 1 }) }} / {{ totalPages }}</span>
        <button
          type="button"
          class="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          :disabled="(page + 1) * pageSize >= total"
          @click="page += 1; void loadGrid()"
        >
          {{ t('masterDataEntity.pagination.next') }}
        </button>
      </div>
    </div>

    <MasterDataWizard
      v-if="wizardEntityTab"
      :open="wizardOpen"
      :tab="wizardEntityTab"
      :mode="wizardMode"
      :entity-id="wizardEntityId"
      :parks="parks"
      @update:open="wizardOpen = $event"
      @saved="void loadGrid()"
    />

    <!-- Detail drawer -->
    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/50"
        @click.self="drawerOpen = false"
      >
        <div class="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-950 shadow-xl">
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 class="text-sm font-semibold text-white">{{ t('masterDataEntity.detailDrawerTitle') }}</h2>
            <button type="button" class="text-slate-400 hover:text-white" @click="drawerOpen = false">✕</button>
          </div>
          <div v-if="detailError && !detail" class="p-4 text-sm text-rose-300">
            {{ detailError }}
          </div>
          <div v-else-if="detailLoading && !detail" class="p-4 text-sm text-slate-500">{{ t('masterDataEntity.detailLoading') }}</div>
          <div v-else-if="detail" class="space-y-3 p-4">
            <div
              v-if="detailLoading"
              class="rounded border border-slate-700/80 bg-slate-900/70 px-2 py-1.5 text-[11px] text-slate-400"
            >
              {{ t('masterDataEntity.detailLoading') }}
            </div>
            <div
              v-if="detailError"
              class="rounded border border-rose-900/50 bg-rose-950/35 px-2 py-1.5 text-[11px] text-rose-200"
            >
              {{ detailError }}
            </div>
            <div class="flex flex-wrap gap-1 text-xs">
              <button
                v-for="tab in detailDrawerTabs"
                :key="tab"
                type="button"
                class="rounded px-2 py-1 capitalize"
                :class="detailTab === tab ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300'"
                @click="detailTab = tab"
              >
                {{
                  tab === 'signals'
                    ? t('rideSignalCaps.tabTitle')
                    : tab === 'extensions'
                      ? t('signalsCapabilities.tabTitle')
                      : tab
                }}
              </button>
            </div>

            <template v-if="detailTab === 'typed' && (detail.entityKind === 'asset' || detail.entityKind === 'park')">
              <p class="text-xs text-slate-500">
                Typed master profile (<span class="font-mono">master_profile</span> JSON). Provider sync does not write
                this object; use <span class="font-mono">enrichment.locks.masterProfile</span> for field paths to protect
                from overwrites.
              </p>
              <textarea
                v-model="editMasterProfileJson"
                rows="14"
                class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
              />
              <label class="mt-3 block text-xs text-slate-500">Apply template (fills empty keys only)</label>
              <select
                v-model="selectedApplyTemplateId"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
              >
                <option value="">— Select template —</option>
                <option v-for="opt in templatesForApply" :key="opt.id" :value="opt.id">
                  {{ opt.templateCode }} — {{ opt.templateName }}
                </option>
              </select>
              <button
                type="button"
                class="mt-2 rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                @click="applyTemplateFromDrawer"
              >
                Apply template
              </button>
              <p v-if="masterPresentation?.profile_completeness != null" class="mt-2 text-xs text-slate-400">
                Profile completeness: {{ masterPresentation.profile_completeness }}
              </p>
              <p v-if="masterPresentation?.providerReadOnly" class="mt-2 text-xs font-semibold text-slate-500">Provider (read-only)</p>
              <pre
                v-if="masterPresentation?.providerReadOnly"
                class="mt-1 max-h-32 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400"
                >{{ JSON.stringify(masterPresentation.providerReadOnly, null, 2) }}</pre>
              <p v-if="masterPresentation?.calculated_fields" class="mt-2 text-xs font-semibold text-slate-500">Calculated</p>
              <pre
                v-if="masterPresentation?.calculated_fields"
                class="mt-1 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400"
                >{{ JSON.stringify(masterPresentation.calculated_fields, null, 2) }}</pre>
            </template>

            <template v-if="detail.entityKind === 'asset'">
              <template v-if="detailTab === 'overview'">
                <p v-if="entityType === 'rides' && capacityHint" class="text-xs text-slate-400">{{ capacityHint }}</p>
                <label class="block text-xs text-slate-500">Name</label>
                <input v-model="editAsset.name" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                <label class="mt-2 block text-xs text-slate-500">Slug</label>
                <input v-model="editAsset.slug" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                <template v-if="['rides', 'shows', 'restaurants', 'shops'].includes(entityType)">
                  <label class="mt-2 block text-xs text-slate-500">Zone (Datenbank <span class="font-mono text-slate-400">park_zones</span>)</label>
                  <p v-if="parkZonesLoading" class="mt-1 text-xs text-slate-500">Zonen werden geladen…</p>
                  <select
                    v-else
                    v-model="editAsset.zoneId"
                    class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">— Keine Zuordnung —</option>
                    <option v-for="z in parkZonesForDrawer" :key="z.id" :value="z.id">
                      {{ z.name }} ({{ z.slug }})
                    </option>
                  </select>
                  <p
                    v-if="!parkZonesLoading && !parkZonesForDrawer.length && editAsset.parkId"
                    class="mt-1 text-[10px] leading-snug text-amber-500/90"
                  >
                    Für diesen Park gibt es noch keine Zonen in der Datenbank — Tab „Zones“ oder Provider-Sync prüfen.
                  </p>
                </template>
                <label class="mt-2 block text-xs text-slate-500">Status</label>
                <input v-model="editAsset.status" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                <div
                  v-if="['rides', 'shows', 'restaurants', 'shops'].includes(entityType)"
                  class="mt-4 rounded-lg border border-slate-700/80 bg-slate-950/50 p-3"
                >
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-300">UNS topics</h4>
                  <p class="mt-1 text-[10px] leading-relaxed text-slate-500">
                    Preview from the integration park (asset data + mappings + schema). Match by external id, asset id, or slug.
                  </p>
                  <p v-if="unsTopicPreview?.sparkplug" class="mt-2 font-mono text-[10px] text-slate-500">
                    Sparkplug: {{ unsTopicPreview.sparkplug.groupId }} / {{ unsTopicPreview.sparkplug.edgeNodeId }}
                  </p>
                  <div v-if="unsTopicPreviewLoading" class="mt-2 text-xs text-slate-500">Loading topic preview…</div>
                  <template v-else-if="unsTopicRowsForSelectedAsset.length">
                    <p class="mt-2 text-[11px] text-slate-400">
                      <span class="text-slate-500">Metrics in preview:</span>
                      {{ unsTopicMetricsForSelectedAsset.join(', ') || '—' }}
                    </p>
                    <ul class="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-[10px] leading-snug text-slate-300">
                      <li v-for="row in unsTopicRowsForSelectedAsset.slice(0, 12)" :key="row.topicPath" class="break-all">
                        <span class="font-mono text-brand-200/90">{{ row.metric }}</span>
                        <span class="mx-1 text-slate-600">·</span>
                        <span class="font-mono text-slate-400">{{ row.topicPath }}</span>
                        <span v-if="row.sparkplugTopic" class="mt-0.5 block font-mono text-amber-200/80">{{ row.sparkplugTopic }}</span>
                      </li>
                    </ul>
                    <p v-if="unsTopicRowsForSelectedAsset.length > 12" class="mt-1 text-[10px] text-slate-600">
                      +{{ unsTopicRowsForSelectedAsset.length - 12 }} more in UNS.
                    </p>
                  </template>
                  <p v-else class="mt-2 text-xs text-slate-500">
                    No matching rows. Align Integrations park with this asset’s park and run
                    <span class="text-slate-400">Generate from asset data</span> on the Integrations page.
                  </p>
                  <RouterLink
                    class="mt-3 inline-flex rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-brand-300 hover:bg-slate-800"
                    :to="{ name: 'uns-topics', query: { q: String(editAsset.slug || editAsset.name || '').trim() } }"
                  >
                    Open in UNS
                  </RouterLink>
                </div>
              </template>
              <template v-if="detailTab === 'operational'">
                <p class="text-xs text-slate-500">
                  Operational JSON fields (subset of platform schema). Incomplete master data if key throughput fields are
                  missing.
                </p>
                <textarea
                  v-if="entityType === 'rides'"
                  v-model="editRideJson"
                  rows="12"
                  class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                />
                <textarea
                  v-else-if="entityType === 'shows'"
                  v-model="editShowJson"
                  rows="12"
                  class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                />
                <textarea
                  v-else-if="entityType === 'restaurants'"
                  v-model="editRestaurantJson"
                  rows="12"
                  class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                />
                <textarea
                  v-else-if="entityType === 'shops'"
                  v-model="editShopJson"
                  rows="12"
                  class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                />
                <p v-else class="text-xs text-slate-500">No specialization table for this tab.</p>
              </template>
              <template v-if="detailTab === 'extensions' && selectedId">
                <SignalsCapabilitiesPanel entity-type="park_asset" :entity-id="selectedId" :editable="canPatchExtensions" />
              </template>
              <template v-if="detailTab === 'signals' && entityType === 'rides' && selectedId">
                <RideSignalCapabilitiesPanel
                  :ride-asset-id="selectedId"
                  :asset-slug="String(editAsset.slug || '').trim()"
                />
              </template>
              <template v-if="detailTab === 'raw'">
                <pre class="max-h-80 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400">{{
                  JSON.stringify(masterPresentation?.raw_payload_json ?? rawProvider, null, 2)
                }}</pre>
              </template>
              <template v-if="detailTab === 'relations'">
                <p class="text-xs text-slate-400">Child assets: {{ detailChildCount }}</p>
                <p class="mt-2 font-mono text-[10px] text-slate-500">parent_asset_id: {{ detailParentAssetId || '—' }}</p>
                <pre
                  v-if="masterPresentation?.parent_child"
                  class="mt-2 max-h-48 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400"
                  >{{ JSON.stringify(masterPresentation.parent_child, null, 2) }}</pre>
              </template>
              <template v-if="detailTab === 'locks'">
                <p class="text-xs text-slate-500">
                  JSON map of lock lists, e.g. <span class="font-mono text-slate-400">{"asset":["name"],"rideMaster":["theoreticalCapacityPph"]}</span>
                </p>
                <textarea v-model="locksJson" rows="10" class="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px]" />
              </template>
            </template>

            <template v-else-if="detail.entityKind === 'park'">
              <template v-if="detailTab === 'overview'">
                <label class="block text-xs text-slate-500">Name</label>
                <input v-model="editPark.name" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                <label class="mt-2 block text-xs text-slate-500">Slug</label>
                <input v-model="editPark.slug" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                <label class="mt-2 block text-xs text-slate-500">Timezone</label>
                <input v-model="editPark.timezone" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
              </template>
              <template v-else-if="detailTab === 'raw'">
                <pre class="max-h-80 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400">{{
                  JSON.stringify(masterPresentation?.raw_payload_json ?? rawProvider, null, 2)
                }}</pre>
              </template>
              <template v-else-if="['operational', 'relations', 'locks', 'signals', 'extensions'].includes(detailTab)">
                <p class="text-xs text-slate-500">Not used for parks in this view.</p>
              </template>
            </template>

            <template v-else-if="detail.entityKind === 'zone'">
              <label class="block text-xs text-slate-500">Name</label>
              <input v-model="editZone.name" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
              <label class="mt-2 block text-xs text-slate-500">Slug</label>
              <input v-model="editZone.slug" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
              <label class="mt-2 block text-xs text-slate-500">Sort order</label>
              <input
                v-model.number="editZone.sortOrder"
                type="number"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              />
              <label class="mt-2 block text-xs text-slate-500">Übergeordnete Zone (optional)</label>
              <p v-if="parkZonesLoading" class="mt-1 text-xs text-slate-500">Zonen werden geladen…</p>
              <select
                v-else
                v-model="editZone.parentZoneId"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              >
                <option value="">— Top-Level (keine Parent-Zone) —</option>
                <option v-for="z in parkZoneParentOptions" :key="z.id" :value="z.id">
                  {{ z.name }} ({{ z.slug }})
                </option>
              </select>
            </template>

            <template v-else>
              <pre class="text-xs text-slate-400">{{ JSON.stringify(detail, null, 2) }}</pre>
            </template>

            <div class="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                :disabled="saving"
                @click="saveDetail"
              >
                Save
              </button>
              <button
                v-if="entityType !== 'zones'"
                type="button"
                class="rounded-md border border-rose-800 px-3 py-2 text-sm text-rose-200"
                @click="onDeactivate"
              >
                Deactivate
              </button>
            </div>
          </div>
          <div v-else class="p-4 text-sm text-slate-500">Keine Detaildaten geladen.</div>
        </div>
      </div>
    </Teleport>

    <!-- Create modal -->
    <Teleport to="body">
      <div v-if="createOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="createOpen = false">
        <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
          <h3 class="text-sm font-semibold text-white">Create manual asset</h3>
          <label class="mt-3 block text-xs text-slate-500">Park (UUID, slug, or external id)</label>
          <input
            v-model="createParkKey"
            list="md-park-create-dl"
            type="text"
            autocomplete="off"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm"
            placeholder="e.g. park slug or ThemeParks park UUID"
          />
          <datalist id="md-park-create-dl">
            <option v-for="(s, idx) in parkLookupSuggestions" :key="`c-${idx}-${s.value}`" :value="s.value" :label="s.label" />
          </datalist>
          <label class="mt-3 block text-xs text-slate-500">Name</label>
          <input v-model="createName" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm" />
          <label class="mt-3 block text-xs text-slate-500">Slug (optional)</label>
          <input v-model="createSlug" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm" />
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded-md bg-brand-600 px-3 py-2 text-sm text-white" @click="submitCreate">Create</button>
            <button
              type="button"
              class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300"
              @click="createOpen = false"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
