<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  deleteInstalledAdapter,
  fetchAdapterAssetText,
  getInstalledAdapter,
  getProviderDestinations,
  getProviderEntity,
  getProviderParks,
  patchInstalledAdapter,
  postAdapterRunLocal,
} from '@/api/client'
import type { ExternalDestinationOption, ExternalParkOption } from '@/api/client'
import AdapterUiBanner from '@/components/adapter/AdapterUiBanner.vue'
import TrafficTomTomAdapterPanel from '@/components/adapter/TrafficTomTomAdapterPanel.vue'
import type { AdapterPackageDto, AdapterRunLocalBody, AdapterRunLocalDebug, AdapterRunLocalResult } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import { defaultsFromConfigSchema, fillMissingConfigDefaults } from '@/utils/adapterConfigDefaults'

const route = useRoute()
const router = useRouter()
const { push } = useToast()

const loading = ref(true)
const pkg = ref<AdapterPackageDto | null>(null)
const configText = ref('{}')
/** Encoder / run-local context (parkSlug, edgeNode, …). */
const contextText = ref('{}')
/** Default install / preview: Sparkplug MQTT + historian (see adapter-output-profile-names on server). */
const DEFAULT_OUTPUT_PROFILES = ['SPARKPLUG_JSON', 'CANONICAL_HISTORIAN'] as const

/** JSON array of profile names, e.g. ["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]. */
const outputProfilesText = ref(JSON.stringify([...DEFAULT_OUTPUT_PROFILES], null, 2))
/** Cron-style poll schedule for installed adapter scheduler. */
const scheduleCronText = ref('')
const saveLoading = ref(false)
const removeLoading = ref(false)
const readmeText = ref<string | null>(null)
const readmeLoading = ref(false)
const readmeError = ref<string | null>(null)
const logoImageFailed = ref(false)

function onLogoImageError() {
  logoImageFailed.value = true
}

const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const previewLast = ref<AdapterRunLocalResult | null>(null)
/** Flags actually sent with the last successful `run-local` request (checkbox state at click time). */
const lastPreviewEmitFlags = ref<{ emitMqtt: boolean; ingestCanonical: boolean } | null>(null)
/** If true, run-local sends observations to MQTT (UNS_JSON / Sparkplug per profiles). */
const previewEmitMqtt = ref(false)
/** Optional canonical DB ingest (usually off for weather-only runs). */
const previewIngestCanonical = ref(false)
const weatherRecommendedCron = '*/10 * * * *'
const TP_PROVIDER = 'themeparks_wiki' as const

const tpDestinations = ref<ExternalDestinationOption[]>([])
const tpDestLoading = ref(false)
const tpDestError = ref<string | null>(null)
const tpSelectedDestinationId = ref('')

const tpParks = ref<ExternalParkOption[]>([])
const tpParksLoading = ref(false)
const tpParksError = ref<string | null>(null)
const tpSelectedParkId = ref('')

const tpOrphanParkId = ref('')

function parseJsonObjectText(raw: string): Record<string, unknown> {
  const text = raw.trim()
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

function slugFromParkName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parkSlugForContext(p: ExternalParkOption): string {
  return p.slug && String(p.slug).trim() ? String(p.slug).trim() : slugFromParkName(p.name)
}

function resetThemeParksAdapterUi() {
  tpDestinations.value = []
  tpParks.value = []
  tpSelectedDestinationId.value = ''
  tpSelectedParkId.value = ''
  tpDestError.value = null
  tpParksError.value = null
  tpOrphanParkId.value = ''
}

async function loadTpDestinations() {
  if (!pkg.value || pkg.value.adapterKey !== TP_PROVIDER) return
  tpDestLoading.value = true
  tpDestError.value = null
  try {
    tpDestinations.value = (await getProviderDestinations(TP_PROVIDER))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (e) {
    tpDestinations.value = []
    tpDestError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tpDestLoading.value = false
  }
}

async function loadTpParks() {
  if (!pkg.value || pkg.value.adapterKey !== TP_PROVIDER) return
  if (!tpSelectedDestinationId.value.trim()) {
    tpParks.value = []
    return
  }
  tpParksLoading.value = true
  tpParksError.value = null
  try {
    tpParks.value = (await getProviderParks(TP_PROVIDER, tpSelectedDestinationId.value.trim()))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (e) {
    tpParks.value = []
    tpParksError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tpParksLoading.value = false
  }
}

async function refreshTpLists() {
  await loadTpDestinations()
  if (tpSelectedDestinationId.value.trim()) await loadTpParks()
}

/** User changed destination in the select — clear park and reload park list (not used during programmatic hydrate). */
async function onTpDestinationUserChange() {
  if (!pkg.value || pkg.value.adapterKey !== TP_PROVIDER) return
  tpSelectedParkId.value = ''
  await loadTpParks()
}

async function hydrateTpAfterAdapterLoad() {
  if (pkg.value?.adapterKey !== TP_PROVIDER) {
    resetThemeParksAdapterUi()
    return
  }
  await loadTpDestinations()

  const cfg = parseJsonObjectText(configText.value)
  const pid = typeof cfg.parkId === 'string' ? cfg.parkId.trim() : ''
  tpOrphanParkId.value = ''

  if (!pid) {
    tpSelectedParkId.value = ''
    tpSelectedDestinationId.value = ''
    if (tpDestinations.value.length > 0) {
      tpSelectedDestinationId.value = tpDestinations.value[0].id
      await loadTpParks()
    }
    return
  }

  try {
    const ent = await getProviderEntity(TP_PROVIDER, pid)
    const et = String(ent.entityType || '').toUpperCase()
    if (et === 'DESTINATION') {
      tpOrphanParkId.value = pid
      tpSelectedDestinationId.value = pid
      await loadTpParks()
      tpSelectedParkId.value = ''
      return
    }
    if (ent.destinationId) {
      tpSelectedDestinationId.value = String(ent.destinationId)
      await loadTpParks()
      if (tpParks.value.some((p) => p.id === pid)) {
        tpSelectedParkId.value = pid
      } else {
        tpSelectedParkId.value = ''
        tpOrphanParkId.value = pid
      }
      return
    }
    tpOrphanParkId.value = pid
    tpSelectedParkId.value = ''
  } catch {
    tpOrphanParkId.value = pid
    tpSelectedParkId.value = ''
  }
}

async function applyTpParkToConfig() {
  if (!pkg.value || pkg.value.adapterKey !== TP_PROVIDER) return
  if (!tpSelectedDestinationId.value.trim()) {
    push('Please select a destination first.', 'error')
    return
  }
  if (!tpSelectedParkId.value.trim()) {
    push('Please select a park.', 'error')
    return
  }
  const destIds = new Set(tpDestinations.value.map((d) => d.id))
  const parkId = tpSelectedParkId.value.trim()
  if (destIds.has(parkId)) {
    push('Selected ID is a destination, not a park. Please select a park entity.', 'error')
    return
  }
  try {
    const ent = await getProviderEntity(TP_PROVIDER, parkId)
    const et = String(ent.entityType || '').toUpperCase()
    if (et === 'DESTINATION') {
      push('Selected ID is a destination, not a park. Please select a park entity.', 'error')
      return
    }
    if (et && et !== 'PARK') {
      push(`Selected entity is not a park (type: ${et}).`, 'error')
      return
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Could not validate selected park.', 'error')
    return
  }
  const park = tpParks.value.find((p) => p.id === parkId) || null
  if (!park) {
    push('Selected park is not in the loaded list for this destination. Pick another destination or refresh the page.', 'error')
    return
  }
  try {
    const cfg = parseJsonObjectText(configText.value)
    const ctx = parseJsonObjectText(contextText.value)
    cfg.parkId = park.id
    ctx.parkSlug = parkSlugForContext(park)
    configText.value = JSON.stringify(cfg, null, 2)
    contextText.value = JSON.stringify(ctx, null, 2)
    tpOrphanParkId.value = ''
    push('configJson / contextJson updated from selection (save with Save configuration).', 'success')
  } catch {
    push('Invalid JSON in config or context — fix Advanced mode before applying.', 'error')
  }
}

async function assertThemeParksPreviewOk(config: Record<string, unknown>): Promise<boolean> {
  const raw = config.parkId
  const parkId = typeof raw === 'string' ? raw.trim() : ''
  if (!parkId) {
    push('Set configJson.parkId or use ThemeParks.wiki Park Selection → Apply selected park to config.', 'error')
    return false
  }
  try {
    const ent = await getProviderEntity(TP_PROVIDER, parkId)
    const et = String(ent.entityType || '').toUpperCase()
    if (et === 'DESTINATION') {
      push('Selected ID is a destination, not a park. Please select a park entity.', 'error')
      return false
    }
    if (et && et !== 'PARK') {
      push(`parkId must reference a PARK entity (got ${et}).`, 'error')
      return false
    }
    return true
  } catch (e) {
    push(e instanceof Error ? e.message : 'Could not validate parkId.', 'error')
    return false
  }
}

function resolveParkSlug(config: Record<string, unknown>, row: AdapterPackageDto): string {
  const pc = config.parkSlug
  if (typeof pc === 'string' && pc.trim()) return pc.trim()
  const meta = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {}
  const install = meta.install as { contextJson?: { parkSlug?: string } } | undefined
  const fromCtx = install?.contextJson?.parkSlug
  if (typeof fromCtx === 'string' && fromCtx.trim()) return fromCtx.trim()
  return 'europa_park'
}

function flattenEncoded(data: AdapterRunLocalResult | null) {
  const rows: { profile?: string; topic?: string; error?: string }[] = []
  for (const block of data?.encodedOutputs ?? []) {
    for (const r of block.results ?? []) rows.push(r)
  }
  return rows
}

const unsPreviewRows = computed(() =>
  flattenEncoded(previewLast.value).filter((r) => r.profile === 'uns_json' && r.topic && !r.error)
)

function countMqttPublished(data: AdapterRunLocalResult | null): number {
  const blocks = data?.emittedOutputs ?? data?.emitted ?? []
  let n = 0
  for (const block of blocks) {
    const mqtt = block.actions?.mqtt
    if (Array.isArray(mqtt)) n += mqtt.length
  }
  return n
}

const lastMqttPublishCount = computed(() => countMqttPublished(previewLast.value))

const previewTab = ref<'summary' | 'api' | 'observations' | 'mqtt' | 'canonical' | 'raw'>('summary')

const previewTabs = [
  { id: 'summary' as const, label: 'Summary' },
  { id: 'api' as const, label: 'API raw input' },
  { id: 'observations' as const, label: 'Observations' },
  { id: 'mqtt' as const, label: 'MQTT outputs' },
  { id: 'canonical' as const, label: 'Canonical outputs' },
  { id: 'raw' as const, label: 'Raw JSON' },
]

const previewDebug = computed(() => {
  const d = previewLast.value?.debug
  return d && typeof d === 'object' ? (d as AdapterRunLocalDebug) : null
})

/** Shown when API raw tab has no apiCalls table (wrong adapter, poll skipped, or rare server mismatch). */
const apiRawInputEmptyHint = computed(() => {
  const d = previewDebug.value
  const adapterKey = previewLast.value?.adapterKey || pkg.value?.adapterKey
  if (d?.pollSkipped === true && typeof d.pollSkippedMessage === 'string' && d.pollSkippedMessage.trim()) {
    return `Poll did not run (${String(d.pollSkippedReason || 'skipped')}): ${d.pollSkippedMessage.trim()}`
  }
  if (adapterKey === 'calendar_school_holidays' && Array.isArray(d?.apiCalls) && d.apiCalls.length) {
    return 'This adapter has no external HTTP. Rows here are local READ steps for data/calendar-holidays/*.yaml (same windows as Calendar Demand). Open Raw JSON for full detail.'
  }
  if (adapterKey !== 'themeparks_wiki') {
    return 'This adapter does not attach ThemeParks-style HTTP debug (no apiCalls). Use the Observations tab for poll output; only themeparks_wiki fills this tab after a successful poll.'
  }
  return 'No HTTP call rows in this response. For ThemeParks.wiki, set a valid configJson.parkId and run preview again; if observations exist but this stays empty, the API may be stripping debug — check server version.'
})

function countEncodeErrors(data: AdapterRunLocalResult | null): number {
  let n = 0
  for (const block of data?.encodedOutputs ?? []) {
    for (const r of block.results ?? []) {
      if (r.error) n += 1
    }
  }
  return n
}

function countEncodedOutputRows(data: AdapterRunLocalResult | null): number {
  let n = 0
  for (const block of data?.encodedOutputs ?? []) {
    for (const r of block.results ?? []) {
      if (!r.error && !r.skipped) n += 1
    }
  }
  return n
}

function mqttPublishStats(data: AdapterRunLocalResult | null) {
  const blocks = data?.emittedOutputs ?? data?.emitted ?? []
  let attempts = 0
  let ok = 0
  let fail = 0
  for (const block of blocks) {
    const mqtt = block.actions?.mqtt
    if (!Array.isArray(mqtt)) continue
    for (const m of mqtt) {
      attempts += 1
      if (m && m.published === true) ok += 1
      else fail += 1
    }
  }
  return { attempts, ok, fail }
}

function canonicalIngestStats(data: AdapterRunLocalResult | null) {
  const blocks = data?.emittedOutputs ?? data?.emitted ?? []
  let count = 0
  const ids: string[] = []
  for (const block of blocks) {
    const ing = block.actions?.canonicalIngest as { count?: number; ids?: string[] } | undefined
    if (ing && typeof ing.count === 'number') count += ing.count
    if (ing && Array.isArray(ing.ids)) ids.push(...ing.ids)
  }
  return { count, ids }
}

function flattenMqttPreviewRows(data: AdapterRunLocalResult | null) {
  const encoded = data?.encodedOutputs ?? []
  const emitted = data?.emittedOutputs ?? data?.emitted ?? []
  const rows: Array<{
    observationIndex: number
    profile?: string
    topic?: string
    payloadPreview: string
    published?: boolean
    reason?: string | null
    liveBuffered?: boolean
  }> = []
  for (let i = 0; i < encoded.length; i++) {
    const enc = encoded[i]
    const em = emitted[i]
    const mqttList = Array.isArray(em?.actions?.mqtt) ? em.actions.mqtt : []
    for (const r of enc?.results ?? []) {
      if (r.error || r.skipped) continue
      if (!r.topic) continue
      const pub =
        mqttList.find((m) => m && String((m as { topic?: string }).topic) === String(r.topic)) ||
        null
      const p = pub as { published?: boolean; reason?: string | null; liveBuffered?: boolean } | null
      rows.push({
        observationIndex: i,
        profile: r.profile,
        topic: r.topic,
        payloadPreview: stringifyPreview(r.payload, 1800),
        published: p?.published,
        reason: p?.reason === undefined || p?.reason === null ? null : String(p.reason),
        liveBuffered: p?.liveBuffered === true,
      })
    }
  }
  return rows
}

function stringifyPreview(v: unknown, max: number): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return String(v)
  }
}

const previewSealStatus = computed(() => {
  const data = previewLast.value
  if (!data) return null as 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
  if (data.errors?.length) return 'FAILED'
  if (data.success === false) return 'FAILED'
  if ((data.observations?.length ?? 0) === 0 && (data.validationErrors?.length ?? 0) > 0) return 'FAILED'
  const mqtt = mqttPublishStats(data)
  if (
    (data.validationErrors?.length ?? 0) > 0 ||
    countEncodeErrors(data) > 0 ||
    mqtt.fail > 0
  ) {
    return 'PARTIAL'
  }
  return 'SUCCESS'
})

const previewSummary = computed(() => {
  const data = previewLast.value
  if (!data) return null
  const dbg = previewDebug.value
  const mqtt = mqttPublishStats(data)
  const can = canonicalIngestStats(data)
  return {
    adapterKey: data.adapterKey ?? pkg.value?.adapterKey ?? '—',
    provider:
      (typeof dbg?.provider === 'string' && dbg.provider) ||
      (pkg.value?.adapterKey === 'themeparks_wiki' ? 'themeparks_wiki' : '—'),
    parkId: typeof dbg?.parkId === 'string' ? dbg.parkId : null,
    parkName: typeof dbg?.parkName === 'string' ? dbg.parkName : null,
    runStartedAt: dbg?.run?.startedAt ?? null,
    runCompletedAt: dbg?.run?.completedAt ?? null,
    durationMs: dbg?.run?.durationMs ?? null,
    apiCalls: dbg?.apiCalls?.length ?? 0,
    observations: data.observations?.length ?? 0,
    encodedRows: countEncodedOutputRows(data),
    mqttAttempts: mqtt.attempts,
    mqttOk: mqtt.ok,
    mqttFail: mqtt.fail,
    canonicalMessages: can.count,
    status: previewSealStatus.value,
  }
})

function parseProfilesForRun(): string[] {
  try {
    const pr = outputProfilesText.value.trim()
    if (!pr) return [...DEFAULT_OUTPUT_PROFILES]
    const p = JSON.parse(pr) as unknown
    if (Array.isArray(p) && p.length && p.every((x) => typeof x === 'string')) return p as string[]
  } catch {
    /* fall through */
  }
  return [...DEFAULT_OUTPUT_PROFILES]
}

async function runPreview() {
  if (!pkg.value) return
  let parsed: Record<string, unknown> = {}
  try {
    const t = configText.value.trim()
    parsed = t ? (JSON.parse(t) as Record<string, unknown>) : {}
  } catch {
    push('configJson ist kein gültiges JSON.', 'error')
    return
  }
  let ctxParsed: Record<string, unknown> = {}
  try {
    const ct = contextText.value.trim()
    ctxParsed = ct ? (JSON.parse(ct) as Record<string, unknown>) : {}
  } catch {
    push('contextJson ist kein gültiges JSON.', 'error')
    return
  }
  if (pkg.value.adapterKey === TP_PROVIDER) {
    const ok = await assertThemeParksPreviewOk(parsed)
    if (!ok) return
  }
  const parkSlug =
    typeof ctxParsed.parkSlug === 'string' && ctxParsed.parkSlug.trim()
      ? ctxParsed.parkSlug.trim()
      : resolveParkSlug(parsed, pkg.value)
  const context = { ...ctxParsed, parkSlug }
  const profiles = parseProfilesForRun()
  previewLoading.value = true
  previewLast.value = null
  previewError.value = null
  lastPreviewEmitFlags.value = null
  const emitMqttSent = previewEmitMqtt.value
  const ingestCanonicalSent = previewIngestCanonical.value
  try {
    const body: AdapterRunLocalBody = {
      adapterKey: pkg.value.adapterKey,
      mode: 'poll',
      config: parsed,
      context,
      profiles,
      emit: false,
    }
    if (previewEmitMqtt.value || previewIngestCanonical.value) {
      body.emitMqtt = emitMqttSent
      body.ingestCanonical = ingestCanonicalSent
    }
    const data = await postAdapterRunLocal(body)
    previewLast.value = data
    lastPreviewEmitFlags.value = { emitMqtt: emitMqttSent, ingestCanonical: ingestCanonicalSent }
    previewTab.value = 'summary'
    if (data.errors?.length || data.validationErrors?.length) {
      push('Vorschau: Fehler oder ungültige Beobachtungen — siehe Abschnitt unten.', 'info')
    } else if (data.observations?.length) {
      const mqttN = countMqttPublished(data)
      const mqttHint = mqttN > 0 ? `, MQTT: ${mqttN} Publish(es)` : ''
      push(`Vorschau: ${data.observations.length} Beobachtung(en)${mqttHint}.`, 'success')
    } else {
      push('Vorschau abgeschlossen (keine Beobachtungen).', 'info')
    }
  } catch (e) {
    previewError.value = e instanceof Error ? e.message : String(e)
    push(previewError.value, 'error')
  } finally {
    previewLoading.value = false
  }
}

type LoadOptions = { silent?: boolean }

async function saveConfiguration() {
  if (!pkg.value || saveLoading.value) return
  let configJson: Record<string, unknown>
  let contextJson: Record<string, unknown>
  let outputProfiles: string[]
  try {
    configJson = configText.value.trim() ? (JSON.parse(configText.value) as Record<string, unknown>) : {}
  } catch {
    push('configJson: Ungültiges JSON.', 'error')
    return
  }
  try {
    contextJson = contextText.value.trim() ? (JSON.parse(contextText.value) as Record<string, unknown>) : {}
  } catch {
    push('contextJson: Ungültiges JSON.', 'error')
    return
  }
  try {
    const pr = outputProfilesText.value.trim()
    const raw = pr ? (JSON.parse(pr) as unknown) : []
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
      push(
        'outputProfiles: JSON-Array aus Strings nötig, z. B. ["SPARKPLUG_JSON","CANONICAL_HISTORIAN"].',
        'error'
      )
      return
    }
    outputProfiles = raw as string[]
  } catch {
    push('outputProfiles: Ungültiges JSON.', 'error')
    return
  }

  saveLoading.value = true
  try {
    const idParam = decodeURIComponent(route.params.id as string)
    await patchInstalledAdapter(idParam, {
      configJson,
      contextJson,
      outputProfiles,
      emitEnabled: previewEmitMqtt.value,
      ingestCanonicalEnabled: previewIngestCanonical.value,
      scheduleCron: scheduleCronText.value.trim() ? scheduleCronText.value.trim() : null,
    })
    push('Configuration saved', 'success')
    await load({ silent: true })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
  } finally {
    saveLoading.value = false
  }
}

async function removeIntegration() {
  if (!pkg.value) return
  const ok = await askConfirm({
    message: `Integration „${pkg.value.name}“ wirklich entfernen? Die YAML-Konfiguration auf dem Server wird gelöscht.`,
    confirmLabel: 'Ja',
    cancelLabel: 'Abbrechen',
    variant: 'danger',
  })
  if (!ok) return
  removeLoading.value = true
  try {
    const idParam = decodeURIComponent(route.params.id as string)
    await deleteInstalledAdapter(idParam)
    push('Integration entfernt (inkl. YAML-Konfigurationsdatei).', 'success')
    await router.push({ name: 'devices-services' })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen', 'error')
  } finally {
    removeLoading.value = false
  }
}

async function load(opts: LoadOptions = {}) {
  const silent = opts.silent === true
  const raw = route.params.id as string
  const id = decodeURIComponent(raw)
  if (!silent) {
    loading.value = true
  }
  try {
    pkg.value = await getInstalledAdapter(id)
    logoImageFailed.value = false
    const meta = pkg.value.metadata && typeof pkg.value.metadata === 'object' ? pkg.value.metadata : {}
    const inst = (meta as {
      install?: {
        configJson?: unknown
        contextJson?: unknown
        outputProfiles?: unknown
        emitEnabled?: boolean
        ingestCanonicalEnabled?: boolean
        scheduleCron?: string | null
      }
    }).install
    const manifest = (pkg.value.manifest as Record<string, unknown> | undefined) || {}
    const schemaManifest = manifest.configSchema as Record<string, unknown> | undefined
    const schemaDb = (pkg.value as { configSchema?: Record<string, unknown> }).configSchema
    const cfgDefaults = {
      ...defaultsFromConfigSchema(schemaDb),
      ...defaultsFromConfigSchema(schemaManifest),
    }
    const cfgRaw = inst && typeof inst.configJson === 'object' && inst.configJson ? inst.configJson : {}
    configText.value = JSON.stringify(fillMissingConfigDefaults(cfgDefaults, cfgRaw as Record<string, unknown>), null, 2)

    const ctxDefaults =
      manifest.defaultContextJson && typeof manifest.defaultContextJson === 'object'
        ? (manifest.defaultContextJson as Record<string, unknown>)
        : { parkSlug: 'europapark' }
    const ctxRaw =
      inst && typeof inst.contextJson === 'object' && inst.contextJson ? inst.contextJson : { parkSlug: 'europapark' }
    contextText.value = JSON.stringify(fillMissingConfigDefaults(ctxDefaults, ctxRaw as Record<string, unknown>), null, 2)
    const prof =
      inst && Array.isArray(inst.outputProfiles) && inst.outputProfiles.length
        ? inst.outputProfiles
        : [...DEFAULT_OUTPUT_PROFILES]
    outputProfilesText.value = JSON.stringify(prof, null, 2)
    previewEmitMqtt.value = inst?.emitEnabled === true
    const cronFromManifest =
      typeof manifest.defaultScheduleCron === 'string' ? manifest.defaultScheduleCron.trim() : ''
    scheduleCronText.value =
      inst?.scheduleCron != null && String(inst.scheduleCron).trim() !== ''
        ? String(inst.scheduleCron).trim()
        : cronFromManifest
    readmeText.value = null
    readmeError.value = null
    const readmeUrl = pkg.value.readmeAssetUrl
    if (readmeUrl) {
      readmeLoading.value = true
      try {
        readmeText.value = await fetchAdapterAssetText(readmeUrl)
      } catch (e) {
        readmeError.value = e instanceof Error ? e.message : 'Could not load README'
        readmeText.value = null
      } finally {
        readmeLoading.value = false
      }
    }
    await hydrateTpAfterAdapterLoad()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load integration', 'error')
    pkg.value = null
    resetThemeParksAdapterUi()
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

watch(
  () => route.params.id,
  () => {
    void load()
  }
)

onMounted(() => {
  void load()
})

watch(configText, (text) => {
  if (!pkg.value || pkg.value.adapterKey !== TP_PROVIDER) return
  try {
    const cfg = parseJsonObjectText(text)
    const parkId = typeof cfg.parkId === 'string' ? cfg.parkId.trim() : ''
    if (parkId && tpParks.value.some((p) => p.id === parkId)) {
      tpSelectedParkId.value = parkId
      tpOrphanParkId.value = ''
    }
  } catch {
    /* ignore while user types invalid JSON */
  }
})

function placeholder(msg: string) {
  push(msg, 'info')
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<template>
  <div class="mx-auto max-w-[900px] space-y-6 px-4 py-6 sm:px-6">
    <button
      type="button"
      class="text-sm text-brand-400 hover:text-brand-300"
      @click="router.push({ name: 'devices-services' })"
    >
      ← Adapter
    </button>

    <div v-if="loading" class="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
      Loading…
    </div>
    <template v-else-if="pkg">
      <AdapterUiBanner :src="pkg.bannerAssetUrl" :title="pkg.name" size="lg" />

      <div class="flex flex-wrap items-start gap-4">
        <div
          class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-950"
        >
          <img
            v-if="pkg.logoAssetUrl && !logoImageFailed"
            :src="pkg.logoAssetUrl"
            alt=""
            class="h-full w-full object-contain p-2"
            @error="onLogoImageError"
          />
          <span v-else class="text-3xl text-slate-600">{{ pkg.name.slice(0, 1) }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="font-display text-xl font-semibold text-white">
            {{ pkg.name }}
            <RouterLink
              class="ml-2 align-middle text-xs font-normal text-brand-400 hover:text-brand-300"
              :to="{ name: 'adapter-pipeline-log', query: { adapterKey: pkg.adapterKey } }"
            >
              Adapter operations center
            </RouterLink>
          </h1>
          <p class="mt-1 font-mono text-xs text-brand-300">{{ pkg.adapterKey }}</p>
          <p class="mt-2 text-sm text-slate-400">{{ pkg.description || pkg.ui?.description || '—' }}</p>
          <p class="mt-2 text-xs text-slate-500">Status: <span class="text-slate-300">{{ pkg.status || '—' }}</span></p>
        </div>
      </div>

      <section id="package-readme" v-if="pkg.readmeAssetUrl" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Package README</h2>
        <p v-if="readmeLoading" class="mt-2 text-xs text-slate-500">Loading README…</p>
        <p v-else-if="readmeError" class="mt-2 text-xs text-rose-400">{{ readmeError }}</p>
        <div
          v-else-if="readmeText"
          class="mt-3 max-h-[min(28rem,50vh)] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-300"
        >
          <pre class="whitespace-pre-wrap font-sans leading-relaxed">{{ readmeText }}</pre>
        </div>
      </section>

      <section
        v-if="pkg.adapterKey === 'traffic_tomtom'"
        class="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <h2 class="text-sm font-semibold text-white">Traffic API (TomTom)</h2>
        <p class="mt-1 text-xs text-slate-500">
          Adapter package <span class="font-mono text-slate-400">traffic_tomtom</span> — credentials live in the encrypted traffic-provider row (not in <span class="font-mono">configJson</span>).
        </p>
        <div class="mt-3">
          <TrafficTomTomAdapterPanel variant="adapter-detail" />
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Configuration (configJson)</h2>
        <div v-if="pkg.adapterKey === 'themeparks_wiki'" class="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-xs font-semibold text-slate-300">ThemeParks.wiki Park Selection</p>
          <p v-if="tpDestLoading || tpParksLoading" class="text-xs text-slate-500">
            {{ tpDestLoading ? 'Loading destinations…' : 'Loading parks…' }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="tpDestLoading || tpParksLoading"
              @click="refreshTpLists"
            >
              Refresh lists
            </button>
            <button
              type="button"
              class="rounded-md border border-brand-600 bg-brand-900/30 px-3 py-2 text-xs text-brand-200 hover:bg-brand-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              @click="applyTpParkToConfig"
            >
              Apply selected park to config
            </button>
          </div>
          <p v-if="tpDestError" class="text-xs text-rose-400">{{ tpDestError }}</p>
          <p v-if="tpParksError" class="text-xs text-rose-400">{{ tpParksError }}</p>
          <div>
            <label for="tp-dest-select" class="block text-[11px] font-medium text-slate-500">Destination</label>
            <select
              id="tp-dest-select"
              v-model="tpSelectedDestinationId"
              class="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
              @change="onTpDestinationUserChange"
            >
              <option value="">Select destination</option>
              <option v-for="d in tpDestinations" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div>
            <label for="tp-park-select" class="block text-[11px] font-medium text-slate-500">Park</label>
            <select
              id="tp-park-select"
              v-model="tpSelectedParkId"
              class="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
              :disabled="!tpSelectedDestinationId"
            >
              <option value="">Select park</option>
              <option v-for="p in tpParks" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <p v-if="tpOrphanParkId" class="text-xs text-amber-300/90">
            Current configured parkId: <span class="font-mono">{{ tpOrphanParkId }}</span> (not in the loaded park list — choose the correct destination, use Refresh lists, or fix Advanced JSON).
          </p>
          <p class="text-xs text-slate-500">
            Destinations and parks load automatically when you open this page (first destination is pre-selected if <span class="font-mono">parkId</span> is empty).
            The selected park ID will be written to <span class="font-mono">configJson</span> for children, live and schedule calls.
            <span class="font-mono">contextJson.parkSlug</span> is set when you apply. Advanced JSON below is unchanged.
          </p>
        </div>
        <p v-if="pkg.adapterKey === 'themeparks_wiki'" class="mt-3 text-xs font-medium text-slate-400">Advanced mode (JSON)</p>
        <textarea
          v-model="configText"
          rows="10"
          class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
          spellcheck="false"
        />
        <p v-if="pkg.adapterKey === 'weather_open_meteo'" class="mt-2 text-xs text-slate-500">
          Für Live-Werte mindestens
          <span class="font-mono text-slate-400">parkSlug, latitude, longitude</span>
          in <span class="font-mono text-slate-400">configJson</span> setzen, z.&nbsp;B.
          <span class="mt-1 block font-mono text-[10px] leading-relaxed text-slate-400">
            {"parkSlug":"europapark","latitude":48.2661,"longitude":7.7225,"timezone":"Europe/Berlin"}
          </span>
        </p>
        <p v-else-if="pkg.adapterKey === 'themeparks_wiki'" class="mt-2 text-xs text-slate-500">
          <span class="font-mono">parkId</span> (PARK entity UUID) in <span class="font-mono">configJson</span> — set it with
          <strong class="font-normal text-slate-400">ThemeParks.wiki Park Selection</strong> above or in Advanced JSON. Do not use a destination ID as
          <span class="font-mono">parkId</span>.
        </p>
        <h3 class="mt-4 text-xs font-semibold text-slate-300">Context (contextJson)</h3>
        <p class="mt-1 text-xs text-slate-500">
          Wird bei Poll/Encode mitgegeben (mindestens <span class="font-mono">parkSlug</span> für UNS-Themen). Kann
          <span class="font-mono">edgeNode</span> / <span class="font-mono">sparkplugGroupId</span> enthalten.
        </p>
        <p v-if="pkg.adapterKey === 'weather_open_meteo'" class="mt-1 text-xs text-slate-500">
          Sparkplug-Kontext für Weather empfohlen:
          <span class="mt-1 block font-mono text-[10px] leading-relaxed text-slate-400">
            {"parkSlug":"europapark","sparkplugGroupId":"europa_park","sparkplugEdgeNode":"weather_gateway"}
          </span>
        </p>
        <p
          v-else-if="pkg.adapterKey === 'calendar_school_holidays' || pkg.adapterKey === 'calendar_demand'"
          class="mt-1 text-xs text-slate-500"
        >
          Sparkplug-Kontext für Kalender empfohlen:
          <span class="mt-1 block font-mono text-[10px] leading-relaxed text-slate-400">
            {"parkSlug":"europapark","sparkplugGroupId":"europa_park","sparkplugEdgeNode":"calendar_gateway"}
          </span>
        </p>
        <textarea
          v-model="contextText"
          rows="6"
          class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
          spellcheck="false"
        />
        <h3 class="mt-4 text-xs font-semibold text-slate-300">Output profiles (JSON-Array)</h3>
        <p class="mt-1 text-xs text-slate-500">
          Standard (MQTT + Historian):
          <span class="font-mono text-slate-400">["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]</span>
        </p>
        <p class="mt-1 text-xs text-amber-300/90">
          <span class="font-mono">UNS_JSON</span> nur ergänzen, wenn du zusätzlich lesbare
          <span class="font-mono">tpuns/…</span>-Topics brauchst.
        </p>
        <textarea
          v-model="outputProfilesText"
          rows="3"
          class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
          spellcheck="false"
        />
        <h3 class="mt-4 text-xs font-semibold text-slate-300">Polling interval (scheduleCron)</h3>
        <p class="mt-1 text-xs text-slate-500">
          Cron-Ausdruck (5 Felder): Minute Stunde Tag Monat Wochentag.
          <span class="ml-1 text-slate-400">Beispiele:</span>
        </p>
        <ul class="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-slate-400">
          <li><span class="font-mono">*/5 * * * *</span> = every 5 minutes</li>
          <li><span class="font-mono">*/10 * * * *</span> = every 10 minutes</li>
          <li><span class="font-mono">0 * * * *</span> = hourly</li>
          <li><span class="font-mono">0 6 * * *</span> = daily at 06:00</li>
        </ul>
        <p v-if="pkg.adapterKey === 'weather_open_meteo'" class="mt-1 text-xs text-emerald-300/90">
          Empfehlung für Weather Adapter: <span class="font-mono">{{ weatherRecommendedCron }}</span>
        </p>
        <input
          v-model="scheduleCronText"
          type="text"
          placeholder="z. B. */10 * * * *"
          class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
        />
        <p class="mt-1 text-xs text-amber-300/90">
          Adapter must be ACTIVE and ADAPTER_SCHEDULER_ENABLED=true for automatic polling.
        </p>
        <p class="mt-2 text-xs text-slate-500">
          <span class="font-mono">Save configuration</span> schreibt die Werte in eine YAML-Datei pro Adapter auf dem
          Server (<span class="font-mono">data/adapter-install-config/&lt;adapterKey&gt;.install.yaml</span>, per Env
          <span class="font-mono">ADAPTER_INSTALL_CONFIG_DIR</span> steuerbar). Die Datenbank behält nur die
          Registry-Zeile — keine Konfiguration mehr in <span class="font-mono">metadata.install</span>.
        </p>
        <div class="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p class="text-xs font-medium text-slate-400">Ausgabe bei „Run preview“</p>
          <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input v-model="previewEmitMqtt" type="checkbox" class="rounded border-slate-600 bg-slate-900" />
            <span>MQTT publizieren</span>
            <span class="text-slate-600">(primär Sparkplug <span class="font-mono">spBv1.0/…</span>; Broker muss erreichbar sein)</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input v-model="previewIngestCanonical" type="checkbox" class="rounded border-slate-600 bg-slate-900" />
            <span>Canonical ingest</span>
            <span class="text-slate-600">(Historian-DB; für Wetter meist aus)</span>
          </label>
          <p v-if="pkg.metadata && typeof pkg.metadata === 'object'" class="text-[10px] text-slate-600">
            Hinweis: Die Häkchen entsprechen <span class="font-mono">emitEnabled</span> und
            <span class="font-mono">ingestCanonicalEnabled</span> in der YAML — mit „Save configuration“ speichern.
          </p>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="saveLoading"
            @click="saveConfiguration"
          >
            {{ saveLoading ? 'Speichern…' : 'Save configuration' }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="previewLoading"
            @click="runPreview"
          >
            {{ previewLoading ? 'Vorschau läuft…' : 'Run preview' }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/30"
            @click="placeholder('Activate — next step')"
          >
            Activate
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-800/50 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-950/40"
            @click="placeholder('Disable — next step')"
          >
            Disable
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-600 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-950/50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="removeLoading"
            @click="removeIntegration"
          >
            {{ removeLoading ? 'Entfernen…' : 'Remove integration' }}
          </button>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Run preview</h2>
        <p class="mt-1 text-xs text-slate-500">
          Ruft <span class="font-mono text-slate-400">POST …/adapters/run-local</span> auf (ein Poll). Ohne angehakte
          Ausgabe-Optionen nur Kodierung — mit
          <span class="font-mono text-slate-400">MQTT publizieren</span> werden die encodierten Topics an den Broker
          geschickt (<span class="font-mono text-slate-400">emitMqtt</span> in der API).
        </p>
        <p v-if="previewError" class="mt-2 text-xs text-rose-400">{{ previewError }}</p>
        <template v-if="previewLast">
          <p
            v-if="lastMqttPublishCount > 0"
            class="mt-2 rounded border border-emerald-900/40 bg-emerald-950/25 px-2 py-1.5 text-xs text-emerald-200/90"
          >
            MQTT: {{ lastMqttPublishCount }} Publish-Versuch(e) in der Antwort (siehe Tab „MQTT outputs“ /
            <span class="font-mono">emittedOutputs</span>).
          </p>
          <div
            v-if="previewLast.errors?.length"
            class="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/30 p-3 text-xs text-rose-200"
          >
            <p class="font-semibold text-rose-100">Fehler</p>
            <ul class="mt-1 list-inside list-disc font-mono text-[11px] text-rose-200/90">
              <li v-for="(err, i) in previewLast.errors" :key="`e-${i}`">{{ err }}</li>
            </ul>
          </div>
          <div
            v-if="previewLast.validationErrors?.length"
            class="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-100/90"
          >
            <p class="font-semibold text-amber-100">Validierung</p>
            <ul class="mt-1 list-inside list-disc font-mono text-[11px]">
              <li v-for="(ve, i) in previewLast.validationErrors" :key="`v-${i}`">
                Index {{ ve.index }}:
                {{ ve.errors?.map((x) => x.message).join('; ') }}
              </li>
            </ul>
          </div>

          <div class="mt-5 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <h3 class="text-sm font-semibold text-white">Output Seal / Preview Result</h3>
            <div class="mt-2 flex flex-wrap gap-1 border-b border-slate-800 pb-2">
              <button
                v-for="t in previewTabs"
                :key="t.id"
                type="button"
                class="rounded-md px-2.5 py-1 text-xs font-medium transition"
                :class="
                  previewTab === t.id
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                "
                @click="previewTab = t.id"
              >
                {{ t.label }}
              </button>
            </div>

            <div v-if="previewTab === 'summary' && previewSummary" class="mt-3 space-y-3 text-xs text-slate-300">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  :class="{
                    'bg-emerald-900/50 text-emerald-200': previewSummary.status === 'SUCCESS',
                    'bg-amber-900/40 text-amber-200': previewSummary.status === 'PARTIAL',
                    'bg-rose-900/50 text-rose-200': previewSummary.status === 'FAILED',
                  }"
                >
                  {{ previewSummary.status }}
                </span>
              </div>
              <dl class="grid gap-2 sm:grid-cols-2">
                <div><dt class="text-slate-500">Adapter key</dt><dd class="font-mono text-slate-200">{{ previewSummary.adapterKey }}</dd></div>
                <div><dt class="text-slate-500">Provider</dt><dd class="font-mono text-slate-200">{{ previewSummary.provider }}</dd></div>
                <div><dt class="text-slate-500">Park ID</dt><dd class="font-mono text-slate-200">{{ previewSummary.parkId || '—' }}</dd></div>
                <div><dt class="text-slate-500">Park name</dt><dd class="text-slate-200">{{ previewSummary.parkName || '—' }}</dd></div>
                <div><dt class="text-slate-500">Run started</dt><dd class="font-mono text-[10px] text-slate-400">{{ previewSummary.runStartedAt || '—' }}</dd></div>
                <div><dt class="text-slate-500">Run completed</dt><dd class="font-mono text-[10px] text-slate-400">{{ previewSummary.runCompletedAt || '—' }}</dd></div>
                <div><dt class="text-slate-500">Duration (server)</dt><dd class="text-slate-200">{{ previewSummary.durationMs != null ? `${previewSummary.durationMs} ms` : '—' }}</dd></div>
                <div><dt class="text-slate-500">API calls</dt><dd class="text-slate-200">{{ previewSummary.apiCalls }}</dd></div>
                <div><dt class="text-slate-500">Observations</dt><dd class="text-slate-200">{{ previewSummary.observations }}</dd></div>
                <div><dt class="text-slate-500">Encoded outputs (rows)</dt><dd class="text-slate-200">{{ previewSummary.encodedRows }}</dd></div>
                <div><dt class="text-slate-500">Canonical messages ingested</dt><dd class="text-slate-200">{{ previewSummary.canonicalMessages }}</dd></div>
              </dl>
              <div class="rounded border border-slate-800 bg-slate-900/80 p-2 font-mono text-[11px] text-slate-300">
                <p class="text-slate-500">MQTT</p>
                <p>{{ previewSummary.encodedRows }} encoded outputs (rows with topic)</p>
                <p>{{ previewSummary.mqttAttempts }} publish attempts</p>
                <p class="text-emerald-300/90">{{ previewSummary.mqttOk }} successful</p>
                <p class="text-rose-300/90">{{ previewSummary.mqttFail }} failed / skipped</p>
              </div>
              <div v-if="unsPreviewRows.length">
                <p class="text-xs font-medium text-slate-400">UNS topics (UNS_JSON, sample)</p>
                <ul class="mt-1 list-inside list-disc font-mono text-[10px] text-slate-400">
                  <li v-for="(r, idx) in unsPreviewRows.slice(0, 12)" :key="`su-${idx}-${r.topic}`">{{ r.topic }}</li>
                </ul>
              </div>
            </div>

            <div v-else-if="previewTab === 'api'" class="mt-3 space-y-4 text-xs">
              <div>
                <h4 class="font-semibold text-slate-200">API Debug / Provider Messages</h4>
                <p class="mt-1 text-slate-500">
                  ThemeParks.wiki HTTP calls performed during this poll (relative paths as returned by the API).
                </p>
                <div v-if="!previewDebug?.apiCalls?.length" class="mt-2 space-y-1 text-slate-500">
                  <p>No API call table in this preview.</p>
                  <p class="text-[11px] leading-relaxed text-slate-400">{{ apiRawInputEmptyHint }}</p>
                </div>
                <div v-else class="mt-2 overflow-x-auto">
                  <table class="min-w-full border-collapse text-left text-[11px] text-slate-200">
                    <thead class="text-slate-500">
                      <tr>
                        <th class="border-b border-slate-800 py-1 pr-2">Method</th>
                        <th class="border-b border-slate-800 py-1 pr-2">URL</th>
                        <th class="border-b border-slate-800 py-1 pr-2">Status</th>
                        <th class="border-b border-slate-800 py-1 pr-2">ms</th>
                        <th class="border-b border-slate-800 py-1 pr-2">Count</th>
                        <th class="border-b border-slate-800 py-1">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(c, i) in previewDebug.apiCalls" :key="`api-${i}`" class="border-b border-slate-800/80 align-top">
                        <td class="py-1 pr-2 font-mono">{{ c.method || 'GET' }}</td>
                        <td class="max-w-[14rem] break-all py-1 pr-2 font-mono text-[10px]">{{ c.url }}</td>
                        <td class="py-1 pr-2">{{ c.status ?? '—' }}</td>
                        <td class="py-1 pr-2">{{ c.durationMs ?? '—' }}</td>
                        <td class="py-1 pr-2">{{ c.responseCount ?? '—' }}</td>
                        <td class="py-1 text-rose-300/90">{{ c.error || '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="previewDebug?.apiCalls?.length" class="mt-3 space-y-1">
                  <p class="text-[11px] font-medium text-slate-400">Response preview per call</p>
                  <details
                    v-for="(c, i) in previewDebug.apiCalls"
                    :key="`pv-${i}`"
                    class="rounded border border-slate-800 bg-slate-950/60 px-2 py-1"
                  >
                    <summary class="cursor-pointer font-mono text-[10px] text-slate-300">{{ c.url }}</summary>
                    <pre class="mt-1 max-h-40 overflow-auto text-[10px] text-slate-500">{{
                      JSON.stringify(c.responsePreview ?? null, null, 2)
                    }}</pre>
                  </details>
                </div>
              </div>
              <div>
                <h4 class="font-semibold text-slate-200">Raw provider payloads (truncated)</h4>
                <pre class="mt-2 max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] text-slate-400">{{
                  JSON.stringify(previewDebug?.rawInput ?? {}, null, 2)
                }}</pre>
              </div>
            </div>

            <div v-else-if="previewTab === 'observations'" class="mt-3">
              <div v-if="previewLast.observations?.length" class="overflow-x-auto">
                <p class="text-xs font-medium text-slate-400">Observations ({{ previewLast.observations.length }})</p>
                <table class="mt-2 w-full min-w-[32rem] border-collapse text-left text-xs text-slate-200">
                  <thead>
                    <tr class="border-b border-slate-700 text-slate-500">
                      <th class="py-2 pr-3 font-medium">Metrik</th>
                      <th class="py-2 pr-3 font-medium">Wert</th>
                      <th class="py-2 pr-3 font-medium">Einheit</th>
                      <th class="py-2 pr-3 font-medium">Zeit</th>
                      <th class="py-2 font-medium">Quelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(o, idx) in previewLast.observations"
                      :key="idx"
                      class="border-b border-slate-800/80 hover:bg-slate-800/40"
                    >
                      <td class="py-2 pr-3 font-mono text-brand-200/90">{{ o.metric ?? '—' }}</td>
                      <td class="max-w-[12rem] truncate py-2 pr-3 font-mono text-slate-100" :title="formatValue(o.value)">
                        {{ formatValue(o.value) }}
                      </td>
                      <td class="py-2 pr-3 text-slate-400">{{ o.unit ?? '—' }}</td>
                      <td class="py-2 pr-3 font-mono text-[10px] text-slate-500">{{ o.eventTime ?? '—' }}</td>
                      <td class="py-2 font-mono text-[10px] text-slate-500">{{ o.source ?? '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="text-xs text-slate-500">Keine Beobachtungen in der Antwort.</p>
            </div>

            <div v-else-if="previewTab === 'mqtt'" class="mt-3">
              <p class="text-xs text-slate-500">
                Encoded topics and payloads; publish outcome comes from <span class="font-mono">emittedOutputs[].actions.mqtt</span>
                (skipped / disabled brokers count as failed for this summary).
              </p>
              <div v-if="flattenMqttPreviewRows(previewLast).length" class="mt-2 overflow-x-auto">
                <table class="min-w-full border-collapse text-left text-[11px] text-slate-200">
                  <thead class="text-slate-500">
                    <tr>
                      <th class="border-b border-slate-800 py-1 pr-2">#</th>
                      <th class="border-b border-slate-800 py-1 pr-2">Profile</th>
                      <th class="border-b border-slate-800 py-1 pr-2">Topic</th>
                      <th class="border-b border-slate-800 py-1 pr-2">Published</th>
                      <th class="border-b border-slate-800 py-1">Payload (preview)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in flattenMqttPreviewRows(previewLast)" :key="`mq-${i}-${row.topic}`" class="border-b border-slate-800/80 align-top">
                      <td class="py-1 pr-2 font-mono text-slate-500">{{ row.observationIndex }}</td>
                      <td class="py-1 pr-2 font-mono">{{ row.profile }}</td>
                      <td class="max-w-[12rem] break-all py-1 pr-2 font-mono text-[10px]">{{ row.topic }}</td>
                      <td class="py-1 pr-2">
                        <span v-if="row.published === true" class="text-emerald-300">yes</span>
                        <span v-else-if="row.published === false" class="text-rose-300">no</span>
                        <span v-else class="text-slate-500">—</span>
                        <span v-if="row.reason" class="block text-[10px] text-slate-500">{{ row.reason }}</span>
                        <span v-if="row.liveBuffered" class="block text-[10px] text-sky-400/90">live buffer</span>
                      </td>
                      <td class="py-1 font-mono text-[10px] text-slate-400">
                        <pre class="max-h-32 overflow-auto whitespace-pre-wrap break-all">{{ row.payloadPreview }}</pre>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="mt-2 text-xs text-slate-500">No MQTT-style rows (emit off or encode errors only).</p>
            </div>

            <div v-else-if="previewTab === 'canonical'" class="mt-3 space-y-2 text-xs text-slate-300">
              <div class="rounded border border-slate-800 bg-slate-950/50 p-2 text-slate-400">
                <p>
                  Dieser Tab zeigt nur den <strong class="text-slate-300">Historian-/Canonical-Ingest</strong> aus
                  <strong class="text-slate-300">genau dem letzten „Run preview“</strong> — gesteuert durch das Häkchen
                  <strong class="text-slate-300">„Canonical ingest“</strong> im Abschnitt darüber (nicht durch „Save
                  configuration“).
                </p>
                <p class="mt-1 text-[11px] text-slate-500">
                  Ohne dieses Häkchen führt der Server keinen DB-Ingest aus; <span class="font-semibold text-slate-400">0</span>
                  ist dann normal und kein Fehler der Anzeige.
                </p>
              </div>
              <template v-if="!lastPreviewEmitFlags?.ingestCanonical">
                <p class="rounded border border-amber-900/35 bg-amber-950/20 p-2 text-amber-100/95">
                  Beim letzten Preview war <strong class="font-medium">Canonical ingest aus</strong> — deshalb wurden
                  <span class="font-semibold text-white">{{ canonicalIngestStats(previewLast).count }}</span>
                  Nachricht(en) über die Historian-Pipeline ingestiert (typisch: 0).
                </p>
                <p class="text-slate-500">Zum Testen: „Canonical ingest“ aktivieren und erneut „Run preview“ klicken.</p>
              </template>
              <template v-else>
                <p class="text-slate-500">
                  Profil <span class="font-mono text-slate-400">canonical_historian</span> war für diesen Lauf aktiv.
                  Ingestierte Zeilen (Inbound / Historian):
                  <span class="font-semibold text-white">{{ canonicalIngestStats(previewLast).count }}</span>
                </p>
                <p v-if="canonicalIngestStats(previewLast).ids.length" class="text-slate-400">
                  IDs (Auszug):
                  <span class="font-mono text-[10px] text-slate-300">{{
                    canonicalIngestStats(previewLast).ids.slice(0, 40).join(', ')
                  }}</span>
                </p>
                <p
                  v-else-if="canonicalIngestStats(previewLast).count === 0"
                  class="rounded border border-slate-800 bg-slate-950/40 p-2 text-slate-400"
                >
                  Ingest war <strong class="text-slate-300">an</strong>, es wurden aber keine Zeilen geschrieben (z.&nbsp;B.
                  keine <span class="font-mono">canonicalMessages</span> aus dem Encoder oder Ingest lief leer). Details
                  siehe Tab „Raw JSON“ → <span class="font-mono">emittedOutputs</span>.
                </p>
              </template>
            </div>

            <div v-else-if="previewTab === 'raw'" class="mt-3">
              <pre class="max-h-[min(28rem,55vh)] overflow-auto whitespace-pre-wrap break-all rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] text-slate-500">{{
                JSON.stringify(previewLast, null, 2)
              }}</pre>
            </div>
          </div>
        </template>
        <p v-else-if="!previewError" class="mt-2 text-xs text-slate-600">
          Noch keine Vorschau — oben „Run preview“ klicken (Benutzer mit Berechtigung
          <span class="font-mono">integrations:manage</span>).
        </p>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Devices &amp; entities</h2>
        <p class="mt-1 text-xs text-slate-500">Linked devices/entities for this integration are not exposed by the API yet.</p>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Run logs</h2>
        <p class="mt-1 text-xs text-slate-500">Adapter run history UI — TODO.</p>
        <RouterLink to="/integrations" class="mt-2 inline-block text-xs text-brand-400 hover:underline">Open integration settings</RouterLink>
      </section>
    </template>
    <p v-else class="text-sm text-slate-500">Integration not found.</p>
  </div>
</template>
