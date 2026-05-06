<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  ApiRequestError,
  createAssetDowntimeEvent,
  deleteAssetDowntimeEvent,
  deleteIncident,
  getAssetAvailabilitySummary,
  getOeeReasonCodes,
  getPlatformAssets,
  getPlatformParks,
  listAssetDowntimeEvents,
  listIncidents,
  patchAssetDowntimeEvent,
} from '@/api/client'
import type {
  AssetAvailabilitySummary,
  AssetDowntimeEventRow,
  AssetDowntimeParetoPayload,
  Incident,
  OeeReasonCodeRow,
  PlatformAsset,
  PlatformPark,
} from '@/types/api'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { wallDateTimePartsForPrefs } from '@/utils/dateTime'

const { push } = useToast()
const route = useRoute()
const auth = useAuthStore()
const parkContext = useParkContextStore()
const { prefs, formatDateTime, toUtcIsoFromUserLocal, getTimezoneLabel } = useRegionalDateTime()

const canEdit = computed(() => auth.hasPermission('rides', 'update'))
const canReadIncidents = computed(() => auth.hasPermission('incidents', 'read'))
const canDeleteIncidents = computed(() => auth.hasPermission('incidents', 'delete'))

const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const assets = ref<PlatformAsset[]>([])
const assetId = ref('')
const reasonCodes = ref<OeeReasonCodeRow[]>([])

/** Zeitfenster und Formular: getrennt date/time für klare Browser-Picker (Windows/Chrome). */
const rangeFromDate = ref('')
const rangeFromTime = ref('')
const rangeToDate = ref('')
const rangeToTime = ref('')

const events = ref<AssetDowntimeEventRow[]>([])
const incidentsForAsset = ref<Incident[]>([])
const summary = ref<AssetAvailabilitySummary | null>(null)
/** Pareto-Datenbasis: welche Stillstände einbeziehen */
const paretoPlannedScope = ref<'all' | 'planned' | 'unplanned'>('unplanned')
const paretoChartRef = ref<HTMLDivElement | null>(null)
let paretoChart: echarts.ECharts | null = null

const busy = ref(false)
const incidentsBusy = ref(false)

const paretoScopeLabel = computed(() => {
  switch (paretoPlannedScope.value) {
    case 'planned':
      return 'nur geplant'
    case 'unplanned':
      return 'nur ungeplant'
    default:
      return 'geplant und ungeplant'
  }
})

const formPlanned = ref(false)
const formReason = ref('')
const formStartedDate = ref('')
const formStartedTime = ref('')
const formEndedDate = ref('')
const formEndedTime = ref('')
const formNotes = ref('')

/** Zeilenbearbeitung */
const editingId = ref<string | null>(null)
const editPlanned = ref(false)
const editReason = ref('')
const editStartedDate = ref('')
const editStartedTime = ref('')
const editEndedDate = ref('')
const editEndedTime = ref('')
const editNotes = ref('')

function assetUuid(a: PlatformAsset): string {
  return String(a.assetId ?? a.id ?? '')
}

function assetName(a: PlatformAsset): string {
  return String(a.name ?? assetUuid(a))
}

/** HTML date (YYYY-MM-DD) + time (HH:mm) als UTC-ISO gemäß Kontoeinstellung Zeitzone. */
function wallPickerToUtcIso(dateStr: string, timeStr: string): string {
  const d = dateStr?.trim() ?? ''
  if (!d) return ''
  const t = (timeStr?.trim() ?? '') || '00:00'
  return toUtcIsoFromUserLocal(d, t) ?? ''
}

function initDefaultRangeAndFormTimes() {
  const now = new Date()
  const wall = wallDateTimePartsForPrefs(now, prefs.value)
  rangeFromDate.value = wall.date
  rangeFromTime.value = '00:00'
  rangeToDate.value = wall.date
  rangeToTime.value = wall.time
  formStartedDate.value = wall.date
  formStartedTime.value = wall.time
}

const queryFromIso = computed(() => wallPickerToUtcIso(rangeFromDate.value, rangeFromTime.value))
const queryToIso = computed(() => wallPickerToUtcIso(rangeToDate.value, rangeToTime.value))

const selectedAssetDisplayName = computed(() => {
  if (!assetId.value) return ''
  const a = assets.value.find((x) => assetUuid(x) === assetId.value)
  return a ? assetName(a) : ''
})

function incidentLinkedDisplayName(inc: Incident): string {
  const lid = inc.linkedEntityId?.trim()
  if (!lid) return '—'
  const ltype = inc.linkedEntityType?.trim()
  if (ltype === 'PARK_ASSET') {
    const a = assets.value.find((x) => assetUuid(x) === lid)
    return a ? assetName(a) : `${lid.slice(0, 8)}…`
  }
  return lid
}

const filteredReasonCodes = computed(() => {
  const prefix = formPlanned.value ? 'PLANNED_' : 'UNPLANNED_'
  return reasonCodes.value.filter((r) => String(r.code).startsWith(prefix))
})

const editFilteredReasonCodes = computed(() => {
  const prefix = editPlanned.value ? 'PLANNED_' : 'UNPLANNED_'
  return reasonCodes.value.filter((r) => String(r.code).startsWith(prefix))
})

function reasonMatchesPlanned(code: string, planned: boolean): boolean {
  return planned ? code.startsWith('PLANNED_') : code.startsWith('UNPLANNED_')
}

function reasonLabel(code: string): string {
  const row = reasonCodes.value.find((r) => r.code === code)
  return row?.labelDe ?? code
}

/** Gleiche Fenster-Kappung wie Backend (availability / pareto service). */
function clipDowntimeMs(
  startedAt: string,
  endedAt: string | null,
  fromD: Date,
  toD: Date,
  now: Date
): number {
  const s = new Date(startedAt)
  const eCap = endedAt ? new Date(endedAt) : now
  const e = eCap > toD ? toD : eCap
  const ss = s < fromD ? fromD : s
  if (e <= ss) return 0
  return e.getTime() - ss.getTime()
}

/** Pareto aus den gleichen Tabellen-Daten wie „Stillstände“ — kein zweiter API-Call (vermeidet 404 / alte Images). */
const paretoDisplay = computed((): AssetDowntimeParetoPayload | null => {
  if (!assetId.value || !queryFromIso.value || !queryToIso.value) return null
  const fromD = new Date(queryFromIso.value)
  const toD = new Date(queryToIso.value)
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || fromD >= toD) return null

  const scope = paretoPlannedScope.value
  const now = new Date()
  const byReason = new Map<string, number>()

  for (const ev of events.value) {
    if (scope === 'planned' && !ev.planned) continue
    if (scope === 'unplanned' && ev.planned) continue
    const ms = clipDowntimeMs(ev.startedAt, ev.endedAt, fromD, toD, now)
    if (ms <= 0) continue
    const code = ev.reasonCode || 'UNKNOWN'
    byReason.set(code, (byReason.get(code) || 0) + ms)
  }

  const totalMs = [...byReason.values()].reduce((a, b) => a + b, 0)
  const sorted = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reasonCode, durationMs]) => ({
      reasonCode,
      durationMs,
      durationMinutes: Math.round(durationMs / 60000),
      sharePct: totalMs > 0 ? Math.round((durationMs / totalMs) * 10000) / 100 : 0,
      labelDe: reasonLabel(reasonCode),
    }))

  let cumMs = 0
  const items = sorted.map((row) => {
    cumMs += row.durationMs
    return {
      ...row,
      cumulativeSharePct: totalMs > 0 ? Math.round((cumMs / totalMs) * 10000) / 100 : 0,
    }
  })

  return {
    assetId: assetId.value,
    window: { from: fromD.toISOString(), to: toD.toISOString() },
    plannedScope: scope,
    totalDowntimeMinutes: Math.round(totalMs / 60000),
    items,
  }
})

function downtimeOverlapToast(err: ApiRequestError): string {
  const raw = err.details as { conflictingEvent?: Partial<AssetDowntimeEventRow> } | undefined
  const ce = raw?.conflictingEvent
  const hint =
    'Es gibt bereits einen überlappenden Stillstand. Die untere Tabelle listet nur Einträge im gewählten „Von/Bis“-Fenster — „Bis“ nach hinten verlängern oder den bestehenden Eintrag finden, beenden oder löschen.'
  if (!ce?.startedAt) return `${err.message}. ${hint}`
  const endLabel = ce.endedAt ? formatDateTime(ce.endedAt) : 'offen (kein Ende)'
  const reasonBit = ce.reasonCode ? ` · ${reasonLabel(ce.reasonCode)}` : ''
  return `${hint} Konflikt: ${formatDateTime(ce.startedAt)} → ${endLabel}${reasonBit}.`
}

async function loadParks() {
  parks.value = await getPlatformParks()
  const qp = String(route.query.parkId ?? '').trim()
  const pref = parkContext.activeParkId
  if (qp && parks.value.some((p) => p.id === qp)) parkId.value = qp
  else if (pref && parks.value.some((p) => p.id === pref)) parkId.value = pref
  else if (!parkId.value && parks.value.length) parkId.value = parks.value[0].id
}

async function loadAssets() {
  if (!parkId.value) return
  busy.value = true
  try {
    assets.value = await getPlatformAssets({ parkId: parkId.value, limit: 500 })
    if (!assetId.value || !assets.value.some((a) => assetUuid(a) === assetId.value)) {
      const firstRide = assets.value.find((a) => {
        const at = a.assetType as { code?: string } | undefined
        return String(at?.code || '') === 'RIDE'
      })
      let next = ''
      if (firstRide) next = assetUuid(firstRide)
      else if (assets.value[0]) next = assetUuid(assets.value[0])
      assetId.value = next
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  } finally {
    busy.value = false
  }
}

async function loadMeta() {
  try {
    reasonCodes.value = await getOeeReasonCodes()
    const unplanned = reasonCodes.value.find((r) => String(r.code).startsWith('UNPLANNED_'))
    const planned = reasonCodes.value.find((r) => String(r.code).startsWith('PLANNED_'))
    const pick = formPlanned.value ? planned ?? reasonCodes.value[0] : unplanned ?? reasonCodes.value[0]
    if (pick && (!formReason.value || !reasonMatchesPlanned(formReason.value, formPlanned.value))) {
      formReason.value = pick.code
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Reason codes failed', 'error')
  }
}

async function loadIncidentsForAsset() {
  if (!assetId.value || !queryFromIso.value || !queryToIso.value || !canReadIncidents.value) {
    incidentsForAsset.value = []
    return
  }
  incidentsBusy.value = true
  try {
    const res = await listIncidents({
      linkedEntityType: 'PARK_ASSET',
      linkedEntityId: assetId.value,
      limit: 80,
      createdFrom: queryFromIso.value,
      createdTo: queryToIso.value,
    })
    incidentsForAsset.value = res.items
  } catch (e) {
    incidentsForAsset.value = []
    push(e instanceof Error ? e.message : 'Vorfälle laden fehlgeschlagen', 'error')
  } finally {
    incidentsBusy.value = false
  }
}

const DOWNTIME_LIST_LIMIT = 500

const downtimeListMaybeTruncated = computed(() => events.value.length >= DOWNTIME_LIST_LIMIT)

function escapeCsvCell(s: string): string {
  const v = String(s)
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function downloadOeeCsv() {
  if (!assetId.value || !queryFromIso.value || !queryToIso.value) return
  const parkLabel = parks.value.find((p) => p.id === parkId.value)?.name ?? parkId.value
  const assetLabel = selectedAssetDisplayName.value || assetId.value
  const fromD = new Date(queryFromIso.value)
  const toD = new Date(queryToIso.value)
  const now = new Date()
  const rows: string[][] = [
    ['OEE Stillstände Export'],
    ['Park', parkLabel],
    ['Park-ID', parkId.value],
    ['Anlage', assetLabel],
    ['Anlage-ID', assetId.value],
    ['Von (UTC ISO)', queryFromIso.value],
    ['Bis (UTC ISO)', queryToIso.value],
    ['Anzeigezeitzone', getTimezoneLabel()],
    [],
    ['id', 'startedAt (UTC)', 'endedAt (UTC)', 'planned', 'reasonCode', 'reasonLabel', 'notes', 'minutesInWindow'],
  ]
  for (const ev of events.value) {
    const ms = clipDowntimeMs(ev.startedAt, ev.endedAt, fromD, toD, now)
    rows.push([
      ev.id,
      ev.startedAt,
      ev.endedAt ?? '',
      ev.planned ? 'yes' : 'no',
      ev.reasonCode,
      reasonLabel(ev.reasonCode),
      ev.notes ?? '',
      String(Math.round(ms / 60000)),
    ])
  }
  const pareto = paretoDisplay.value
  if (pareto?.items?.length) {
    rows.push(
      [],
      ['Pareto (wie Diagramm)', `Umfang: ${paretoScopeLabel.value}`],
      ['reasonCode', 'labelDe', 'minutes', 'sharePct', 'cumulativePct']
    )
    for (const it of pareto.items) {
      rows.push([
        it.reasonCode,
        it.labelDe,
        String(it.durationMinutes),
        String(it.sharePct),
        String(it.cumulativeSharePct),
      ])
    }
  }
  const csvBody = rows.map((r) => r.map((c) => escapeCsvCell(c)).join(',')).join('\r\n')
  const csv = `\ufeff${csvBody}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeFrom = rangeFromDate.value.replace(/\s/g, '')
  const safeTo = rangeToDate.value.replace(/\s/g, '')
  a.download = `oee-downtime-${assetId.value.slice(0, 8)}_${safeFrom}_${safeTo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function refreshData() {
  if (!assetId.value || !queryFromIso.value || !queryToIso.value) return
  busy.value = true
  try {
    const from = queryFromIso.value
    const to = queryToIso.value
    const [ev, sum] = await Promise.all([
      listAssetDowntimeEvents(assetId.value, { from, to, limit: DOWNTIME_LIST_LIMIT }),
      getAssetAvailabilitySummary(assetId.value, { from, to }),
    ])
    events.value = ev
    summary.value = sum
    await loadIncidentsForAsset()
  } catch (e) {
    events.value = []
    summary.value = null
    incidentsForAsset.value = []
    push(e instanceof Error ? e.message : 'Failed', 'error')
  } finally {
    busy.value = false
  }
}

function onParetoResize() {
  paretoChart?.resize()
}

function renderParetoChart() {
  const el = paretoChartRef.value
  if (!el) return
  if (!paretoChart) paretoChart = echarts.init(el, undefined, { renderer: 'canvas' })

  const data = paretoDisplay.value
  if (!data?.items?.length) {
    const empty: EChartsOption = {
      title: {
        text: 'Keine Stillstandsminuten im Fenster für diese Auswahl.',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#64748b', fontSize: 13 },
      },
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
    }
    paretoChart.clear()
    paretoChart.setOption(empty, true)
    return
  }

  const categories = data.items.map((i) => i.labelDe)
  const minutes = data.items.map((i) => i.durationMinutes)
  const cumulativePct = data.items.map((i) => i.cumulativeSharePct)

  const opt: EChartsOption = {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['Ausfall (min)', 'Kumuliert %'],
      textStyle: { color: '#94a3b8' },
      top: 4,
    },
    grid: { left: 56, right: 52, bottom: 108, top: 40 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#94a3b8', rotate: 26, interval: 0, fontSize: 10 },
      axisLine: { lineStyle: { color: '#475569' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Minuten',
        nameTextStyle: { color: '#94a3b8' },
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#334155', type: 'dashed' } },
      },
      {
        type: 'value',
        name: 'kumul. %',
        max: 100,
        nameTextStyle: { color: '#94a3b8' },
        axisLabel: { color: '#94a3b8', formatter: '{value}%' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Ausfall (min)',
        type: 'bar',
        data: minutes,
        itemStyle: { color: '#38bdf8', borderRadius: [2, 2, 0, 0] },
      },
      {
        name: 'Kumuliert %',
        type: 'line',
        yAxisIndex: 1,
        data: cumulativePct,
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: '#fbbf24', width: 2 },
        itemStyle: { color: '#fbbf24' },
      },
    ],
  }

  paretoChart.clear()
  paretoChart.setOption(opt, true)
  paretoChart.resize()
}

async function removeIncidentRow(row: Incident) {
  if (!canDeleteIncidents.value) return
  if (!globalThis.confirm(`Vorfall „${row.title}“ wirklich unwiderruflich löschen?`)) return
  incidentsBusy.value = true
  try {
    await deleteIncident(row.id)
    push('Vorfall gelöscht', 'success')
    await loadIncidentsForAsset()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Löschen fehlgeschlagen', 'error')
  } finally {
    incidentsBusy.value = false
  }
}

async function submitEvent() {
  if (!canEdit.value || !assetId.value) return
  if (!reasonMatchesPlanned(formReason.value, formPlanned.value)) {
    push('Grund passt nicht zu „Geplant“ — bitte passenden Grund wählen.', 'error')
    return
  }
  const startedAt = wallPickerToUtcIso(formStartedDate.value, formStartedTime.value)
  if (!formStartedDate.value.trim() || !startedAt) {
    push('Start: Datum wählen (Uhrzeit über Uhr-Feld oder Standard 00:00)', 'error')
    return
  }
  const endDate = formEndedDate.value.trim()
  const endedAt = endDate ? wallPickerToUtcIso(endDate, formEndedTime.value.trim() || '23:59') : null
  busy.value = true
  try {
    await createAssetDowntimeEvent(assetId.value, {
      startedAt,
      endedAt,
      planned: formPlanned.value,
      reasonCode: formReason.value,
      notes: formNotes.value.trim() || null,
    })
    push('Stillstand gespeichert', 'success')
    formNotes.value = ''
    formEndedDate.value = ''
    formEndedTime.value = ''
    await refreshData()
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'DOWNTIME_OVERLAP') {
      push(downtimeOverlapToast(e), 'error')
    } else {
      push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
    }
  } finally {
    busy.value = false
  }
}

async function closeOpen(row: AssetDowntimeEventRow) {
  if (!canEdit.value || !assetId.value) return
  const endedAt = new Date().toISOString()
  busy.value = true
  try {
    await patchAssetDowntimeEvent(assetId.value, row.id, { endedAt })
    push('Beendet', 'success')
    if (editingId.value === row.id) cancelEdit()
    await refreshData()
  } catch (e) {
    push(e instanceof Error ? e.message : 'PATCH fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

function beginEdit(ev: AssetDowntimeEventRow) {
  editingId.value = ev.id
  editPlanned.value = ev.planned
  editReason.value = ev.reasonCode
  const s = wallDateTimePartsForPrefs(ev.startedAt, prefs.value)
  editStartedDate.value = s.date
  editStartedTime.value = s.time
  if (ev.endedAt) {
    const e = wallDateTimePartsForPrefs(ev.endedAt, prefs.value)
    editEndedDate.value = e.date
    editEndedTime.value = e.time
  } else {
    editEndedDate.value = ''
    editEndedTime.value = ''
  }
  editNotes.value = ev.notes ?? ''
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit() {
  if (!canEdit.value || !assetId.value || !editingId.value) return
  if (!reasonMatchesPlanned(editReason.value, editPlanned.value)) {
    push('Grund passt nicht zu „Geplant“.', 'error')
    return
  }
  const startedAt = wallPickerToUtcIso(editStartedDate.value, editStartedTime.value)
  if (!editStartedDate.value.trim() || !startedAt) {
    push('Start: Datum erforderlich.', 'error')
    return
  }
  const endDate = editEndedDate.value.trim()
  const endedAt = endDate ? wallPickerToUtcIso(endDate, editEndedTime.value.trim() || '23:59') : null
  busy.value = true
  try {
    await patchAssetDowntimeEvent(assetId.value, editingId.value, {
      startedAt,
      endedAt,
      planned: editPlanned.value,
      reasonCode: editReason.value,
      notes: editNotes.value.trim() || null,
    })
    push('Eintrag aktualisiert', 'success')
    cancelEdit()
    await refreshData()
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'DOWNTIME_OVERLAP') {
      push(downtimeOverlapToast(e), 'error')
    } else {
      push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
    }
  } finally {
    busy.value = false
  }
}

async function removeEvent(row: AssetDowntimeEventRow) {
  if (!canEdit.value || !assetId.value) return
  if (!globalThis.confirm('Diesen Stillstand wirklich löschen?')) return
  busy.value = true
  try {
    await deleteAssetDowntimeEvent(assetId.value, row.id)
    push('Gelöscht', 'success')
    if (editingId.value === row.id) cancelEdit()
    await refreshData()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Löschen fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

function syncParkHeader(id: string) {
  if (parkContext.parks.some((p) => p.id === id)) parkContext.setActivePark(id)
  else setApiParkContextId(id)
}

watch([parkId], () => {
  if (parkId.value) syncParkHeader(parkId.value)
  void loadAssets()
})
watch([assetId, queryFromIso, queryToIso], () => void refreshData())

watch(assetId, () => {
  cancelEdit()
})

watch([formPlanned, reasonCodes], () => {
  if (!reasonCodes.value.length) return
  if (!reasonMatchesPlanned(formReason.value, formPlanned.value)) {
    const first = filteredReasonCodes.value[0]
    if (first) formReason.value = first.code
  }
})

watch([editPlanned, reasonCodes], () => {
  if (!reasonCodes.value.length || !editingId.value) return
  if (!reasonMatchesPlanned(editReason.value, editPlanned.value)) {
    const first = editFilteredReasonCodes.value[0]
    if (first) editReason.value = first.code
  }
})

watch(
  paretoDisplay,
  async () => {
    await nextTick()
    renderParetoChart()
  },
  { flush: 'post' }
)

watch(
  () => [String(route.query.parkId ?? '').trim(), String(route.query.assetId ?? '').trim()] as const,
  async ([qp, qa]) => {
    if (!parks.value.length) return
    let changed = false
    if (qp && parks.value.some((p) => p.id === qp) && parkId.value !== qp) {
      parkId.value = qp
      syncParkHeader(qp)
      changed = true
      await loadAssets()
    }
    if (qa && assets.value.some((a) => assetUuid(a) === qa) && assetId.value !== qa) {
      assetId.value = qa
      changed = true
    }
    if (changed) await refreshData()
  }
)

onMounted(async () => {
  globalThis.addEventListener('resize', onParetoResize)
  initDefaultRangeAndFormTimes()
  try {
    await loadMeta()
    await loadParks()
    await loadAssets()
    const qa = String(route.query.assetId ?? '').trim()
    if (qa && assets.value.some((a) => assetUuid(a) === qa)) assetId.value = qa
    await refreshData()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
})

onUnmounted(() => {
  globalThis.removeEventListener('resize', onParetoResize)
  paretoChart?.dispose()
  paretoChart = null
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <nav class="text-xs text-slate-500">
      <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">OEE / Stillstände (MVP)</span>
      <span class="mx-2">·</span>
      <RouterLink to="/simulator" class="text-brand-400 hover:underline">Attraction-OEE-Simulator (MQTT)</RouterLink>
    </nav>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <h1 class="font-display text-xl font-semibold text-white">OEE — Stillstände (MVP)</h1>
      <button
        type="button"
        class="shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        :disabled="busy || !assetId || !queryFromIso || !queryToIso"
        title="Exportiert die aktuell geladenen Tabellenzeilen und die Pareto-Zusammenfassung (gleiches Zeitfenster)"
        @click="downloadOeeCsv"
      >
        CSV exportieren
      </button>
    </div>
    <p class="text-sm text-slate-400">
      Geplante und ungeplante Stillstände pro Anlage (<span class="font-mono text-slate-500">asset_downtime_events</span>)
      — das sind die **Buchungen**, die in die Verfügbarkeit einfließen.
      <strong class="text-slate-300">Vorfälle (Incidents)</strong> sind davon getrennt: operative Meldungen / zur Nachverfolgung,
      <strong class="text-slate-300">kein</strong> Stillstand und <strong class="text-slate-300">keine</strong> Ausfallzeit für OEE.
      Verfügbarkeit = Anteil des Zeitfensters <strong class="text-slate-200">ohne ungeplante</strong> Ausfallzeit (Ziel aus
      <span class="font-mono text-xs">asset_targets.target_availability_pct</span>, Ride MDM).
      Zeitfenster und Start/Ende: <strong class="text-slate-300">Kalender- und Uhrzeit-Picker</strong> (getrennte Felder).
      Die Stillstands-Tabelle ganz unten zeigt nur Einträge, die das gewählte „Von/Bis“ schneiden — ein Konflikt kann also außerhalb des sichtbaren Fensters liegen.
    </p>

    <div class="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-12">
      <div class="lg:col-span-2">
        <label for="oee-park" class="block text-xs font-medium text-slate-400">Park</label>
        <select
          id="oee-park"
          v-model="parkId"
          class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="sm:col-span-2 lg:col-span-4">
        <label for="oee-asset" class="block text-xs font-medium text-slate-400">Anlage</label>
        <select
          id="oee-asset"
          v-model="assetId"
          class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option value="">—</option>
          <option v-for="a in assets" :key="assetUuid(a)" :value="assetUuid(a)">{{ assetName(a) }}</option>
        </select>
      </div>
      <div class="sm:col-span-2 lg:col-span-3">
        <p class="text-xs font-medium text-slate-400">Von</p>
        <div class="mt-1 flex flex-wrap gap-2">
          <input
            id="oee-from-date"
            v-model="rangeFromDate"
            type="date"
            class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
          <input
            id="oee-from-time"
            v-model="rangeFromTime"
            type="time"
            step="60"
            class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
      </div>
      <div class="sm:col-span-2 lg:col-span-3">
        <p class="text-xs font-medium text-slate-400">Bis</p>
        <div class="mt-1 flex flex-wrap gap-2">
          <input
            id="oee-to-date"
            v-model="rangeToDate"
            type="date"
            class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
          <input
            id="oee-to-time"
            v-model="rangeToTime"
            type="time"
            step="60"
            class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
      </div>
    </div>
    <p class="mt-2 text-[11px] text-slate-600">
      Zeitfenster und Erfassung: Werte in <span class="font-medium text-slate-500">{{ getTimezoneLabel() }}</span>
      (leer im Profil = Browser-Zeitzone). Tabellen unten im Datums-/Zeitformat der Kontoeinstellungen.
    </p>

    <div v-if="summary" class="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <h2 class="text-sm font-medium text-white">Verfügbarkeit (MVP)</h2>
      <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt class="text-xs text-slate-500">Verfügbarkeit</dt>
          <dd class="font-mono text-lg text-emerald-300">
            {{ summary.availabilityPct != null ? `${summary.availabilityPct}%` : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">Ziel (asset_targets)</dt>
          <dd class="font-mono text-slate-200">
            {{ summary.targetAvailabilityPct != null ? `${summary.targetAvailabilityPct}%` : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">Δ zum Ziel</dt>
          <dd class="font-mono text-slate-200">
            {{ summary.deltaVsTargetPct != null ? `${summary.deltaVsTargetPct}` : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">Stillstand (min)</dt>
          <dd class="text-slate-300">
            geplant {{ summary.plannedDowntimeMinutes }} · ungeplant {{ summary.unplannedDowntimeMinutes }}
          </dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-slate-500">{{ summary.methodology }}</p>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-medium text-white">Störgründe — Pareto</h2>
          <p class="mt-1 text-xs text-slate-500">
            Ausfallzeit je Grund im gleichen Zeitfenster (Schnitt wie bei der Verfügbarkeit). Balken = Minuten, Linie =
            kumulierter Anteil am Gesamt-Stillstand der Auswahl (klassisches Pareto / 80-20-Einsicht).
          </p>
          <p v-if="paretoDisplay" class="mt-2 text-xs text-slate-500">
            Summe im Fenster (wie Tabelle, max. 500 Einträge geladen):
            <span class="font-mono text-slate-300">{{ paretoDisplay.totalDowntimeMinutes }} min</span>
            · {{ paretoScopeLabel }}
          </p>
        </div>
        <div class="shrink-0">
          <label for="oee-pareto-scope" class="block text-xs font-medium text-slate-500">Auswertung</label>
          <select
            id="oee-pareto-scope"
            v-model="paretoPlannedScope"
            class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="unplanned">Nur ungeplant</option>
            <option value="planned">Nur geplant</option>
            <option value="all">Alle</option>
          </select>
        </div>
      </div>
      <div ref="paretoChartRef" class="mt-4 h-[340px] w-full min-h-[260px]" />
    </div>

    <div v-if="canEdit" class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-medium text-white">Neuer Eintrag</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="formPlanned" type="checkbox" class="rounded border-slate-600" />
          Geplant
        </label>
        <div class="sm:col-span-2">
          <label for="oee-reason" class="block text-xs text-slate-500">Grund</label>
          <select id="oee-reason" v-model="formReason" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option v-for="r in filteredReasonCodes" :key="r.code" :value="r.code">{{ r.labelDe }}</option>
          </select>
          <p class="mt-1 text-xs text-slate-500">Nur Gründe passend zu „Geplant“ bzw. ungeplant.</p>
        </div>
        <div class="sm:col-span-2">
          <label for="oee-fs-d" class="block text-xs text-slate-500">Start</label>
          <div class="mt-1 flex flex-wrap gap-2">
            <input
              id="oee-fs-d"
              v-model="formStartedDate"
              type="date"
              class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              id="oee-fs-t"
              v-model="formStartedTime"
              type="time"
              step="60"
              class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
        </div>
        <div class="sm:col-span-2">
          <label for="oee-fe-d" class="block text-xs text-slate-500">Ende (optional)</label>
          <div class="mt-1 flex flex-wrap gap-2">
            <input
              id="oee-fe-d"
              v-model="formEndedDate"
              type="date"
              class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              id="oee-fe-t"
              v-model="formEndedTime"
              type="time"
              step="60"
              class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <p class="mt-1 text-[11px] text-slate-500">Nur Datum → Ende 23:59 desselben Tages.</p>
        </div>
        <div class="sm:col-span-2 lg:col-span-4">
          <label for="oee-notes" class="block text-xs text-slate-500">Notiz</label>
          <input id="oee-notes" v-model="formNotes" type="text" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </div>
      </div>
      <button
        type="button"
        class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        :disabled="busy || !assetId"
        @click="submitEvent"
      >
        Speichern
      </button>
    </div>
    <p v-else class="text-xs text-amber-500/90">Nur Lesen — Berechtigung <span class="font-mono">rides · update</span> zum Erfassen.</p>

    <div
      v-if="canEdit && editingId"
      class="rounded-xl border border-amber-800/60 bg-slate-950/70 p-4 ring-1 ring-amber-900/30"
    >
      <h2 class="text-sm font-medium text-amber-100">Eintrag bearbeiten</h2>
      <p class="mt-1 text-xs text-slate-500">ID <span class="font-mono text-slate-400">{{ editingId }}</span></p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="editPlanned" type="checkbox" class="rounded border-slate-600" />
          Geplant
        </label>
        <div class="sm:col-span-2">
          <label for="oee-edit-reason" class="block text-xs text-slate-500">Grund</label>
          <select
            id="oee-edit-reason"
            v-model="editReason"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option v-for="r in editFilteredReasonCodes" :key="r.code" :value="r.code">{{ r.labelDe }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label for="oee-es-d" class="block text-xs text-slate-500">Start</label>
          <div class="mt-1 flex flex-wrap gap-2">
            <input
              id="oee-es-d"
              v-model="editStartedDate"
              type="date"
              class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              id="oee-es-t"
              v-model="editStartedTime"
              type="time"
              step="60"
              class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
        </div>
        <div class="sm:col-span-2">
          <label for="oee-ee-d" class="block text-xs text-slate-500">Ende (leer = offen)</label>
          <div class="mt-1 flex flex-wrap gap-2">
            <input
              id="oee-ee-d"
              v-model="editEndedDate"
              type="date"
              class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <input
              id="oee-ee-t"
              v-model="editEndedTime"
              type="time"
              step="60"
              class="w-[7.5rem] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <p class="mt-1 text-[11px] text-slate-500">Datum ohne Uhrzeit → 23:59.</p>
        </div>
        <div class="sm:col-span-2 lg:col-span-4">
          <label for="oee-edit-notes" class="block text-xs text-slate-500">Notiz</label>
          <input
            id="oee-edit-notes"
            v-model="editNotes"
            type="text"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          :disabled="busy"
          @click="saveEdit"
        >
          Änderungen speichern
        </button>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          :disabled="busy"
          @click="cancelEdit"
        >
          Abbrechen
        </button>
      </div>
    </div>

    <div v-if="canReadIncidents" class="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-medium text-white">Vorfälle — nur Meldung / Ticket</h2>
        <RouterLink
          to="/incidents/new"
          class="text-xs text-brand-400 hover:underline"
        >
          Neuen Vorfall anlegen
        </RouterLink>
      </div>
      <p class="mt-2 rounded-md border border-slate-700/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        <strong class="text-slate-300">Hinweis:</strong> Vorfälle sind <strong class="text-slate-300">keine</strong> geplanten oder ungeplanten Stillstände und zählen
        <strong class="text-slate-300">nicht</strong> für die Verfügbarkeit / OEE. Ausfallzeiten erfassen Sie in der
        <strong class="text-slate-300">Stillstands-Tabelle darunter</strong>.
      </p>
      <p class="mt-2 text-xs text-slate-500">
        Liste gefiltert nach Anlage
        <strong v-if="selectedAssetDisplayName" class="font-medium text-slate-300">{{ selectedAssetDisplayName }}</strong>
        <span v-else class="text-slate-500">—</span>
        und Zeitfenster wie oben (nach Erstellungszeit des Vorfalls).
      </p>
      <div v-if="!assetId" class="mt-3 text-sm text-slate-500">Bitte eine Anlage wählen.</div>
      <div v-else-if="incidentsBusy && !incidentsForAsset.length" class="mt-3 text-sm text-slate-500">Laden…</div>
      <div v-else class="mt-3 overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead class="bg-slate-950/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">Erstellt</th>
              <th class="px-3 py-2">Titel</th>
              <th class="px-3 py-2">Anlage / Bezug</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Schwere</th>
              <th class="px-3 py-2 min-w-[10rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">
            <tr v-for="inc in incidentsForAsset" :key="inc.id" class="text-slate-300">
              <td class="px-3 py-2 text-xs text-slate-200">{{ formatDateTime(inc.createdAt) }}</td>
              <td class="px-3 py-2 max-w-xs truncate" :title="inc.title">{{ inc.title }}</td>
              <td
                class="px-3 py-2 max-w-[14rem] truncate text-xs text-slate-200"
                :title="inc.linkedEntityId || ''"
              >
                {{ incidentLinkedDisplayName(inc) }}
              </td>
              <td class="px-3 py-2 text-xs">{{ inc.status }}</td>
              <td class="px-3 py-2 text-xs">{{ inc.severity }}</td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-3">
                  <RouterLink
                    :to="{ name: 'incident-detail', params: { id: inc.id } }"
                    class="text-xs text-brand-400 hover:underline"
                  >
                    Öffnen
                  </RouterLink>
                  <button
                    v-if="canDeleteIncidents"
                    type="button"
                    class="text-left text-xs text-rose-400 hover:underline"
                    @click="removeIncidentRow(inc)"
                  >
                    Löschen
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="assetId && !incidentsBusy && !incidentsForAsset.length">
              <td colspan="6" class="px-3 py-6 text-center text-slate-500">
                Keine Vorfälle zu dieser Anlage im Zeitfenster.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="assetId && !canDeleteIncidents" class="mt-2 text-[11px] text-slate-600">
        Löschen erfordert Berechtigung <span class="font-mono">incidents · delete</span>.
      </p>
    </div>

    <div class="space-y-2">
      <div>
        <h2 class="text-sm font-medium text-white">Stillstände — Verfügbarkeit / OEE</h2>
        <p class="mt-1 text-xs text-slate-500">
          Geplante und ungeplante Ausfallzeiten (<span class="font-mono text-slate-600">asset_downtime_events</span>); diese Einträge wirken auf die Kennzahl oben.
        </p>
        <p v-if="downtimeListMaybeTruncated" class="mt-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
          Es werden höchstens {{ DOWNTIME_LIST_LIMIT }} Schnittmengen-Einträge geladen — die Liste kann unvollständig sein. Zeitfenster verkleinern oder Daten exportieren und prüfen.
        </p>
      </div>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-3 py-2">Start</th>
            <th class="px-3 py-2">Ende</th>
            <th class="px-3 py-2">Plan</th>
            <th class="px-3 py-2">Grund</th>
            <th class="px-3 py-2">Notiz</th>
            <th class="px-3 py-2 min-w-[11rem]">Aktionen</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr
            v-for="ev in events"
            :key="ev.id"
            class="text-slate-300"
            :class="editingId === ev.id ? 'bg-amber-950/20' : ''"
          >
            <td class="px-3 py-2 text-xs text-slate-200">{{ formatDateTime(ev.startedAt) }}</td>
            <td class="px-3 py-2 text-xs text-slate-200">
              {{ ev.endedAt ? formatDateTime(ev.endedAt) : '— offen —' }}
            </td>
            <td class="px-3 py-2">{{ ev.planned ? 'ja' : 'nein' }}</td>
            <td class="px-3 py-2 text-xs text-slate-200" :title="ev.reasonCode">{{ reasonLabel(ev.reasonCode) }}</td>
            <td class="px-3 py-2 max-w-xs truncate">{{ ev.notes || '—' }}</td>
            <td class="px-3 py-2">
              <div v-if="canEdit" class="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-2">
                <button type="button" class="text-left text-xs text-brand-400 hover:underline" @click="beginEdit(ev)">
                  Bearbeiten
                </button>
                <button type="button" class="text-left text-xs text-rose-400 hover:underline" @click="removeEvent(ev)">
                  Löschen
                </button>
                <button
                  v-if="!ev.endedAt"
                  type="button"
                  class="text-left text-xs text-slate-400 hover:underline"
                  @click="closeOpen(ev)"
                >
                  Beenden
                </button>
              </div>
              <span v-else class="text-xs text-slate-600">—</span>
            </td>
          </tr>
          <tr v-if="!events.length">
            <td colspan="6" class="px-3 py-6 text-center text-slate-500">Keine Einträge im Fenster.</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </div>
</template>
