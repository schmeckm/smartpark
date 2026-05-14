<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  acknowledgeShiftHandover,
  getPlatformAssets,
  getPlatformParks,
  listShiftHandoverDueReminders,
  listShiftHandovers,
  markShiftHandoverReminderSent,
  patchShiftHandoverTasks,
  shiftHandoverPdfUrl,
} from '@/api/client'
import type { PlatformAsset, PlatformPark, ShiftHandoverRow } from '@/types/api'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'

const { t } = useI18n()
const { push } = useToast()
const { formatDateTime } = useRegionalDateTime()
const auth = useAuthStore()
const parkContext = useParkContextStore()
const canEdit = computed(() => auth.hasPermission('rides', 'update'))

const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const entries = ref<ShiftHandoverRow[]>([])
const busy = ref(false)

const listFromDate = ref('')
const listToDate = ref('')
const listScope = ref<'all' | 'park' | 'asset'>('all')
const listScopeAssetId = ref('')
const listSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const assets = ref<PlatformAsset[]>([])
const assetsBusy = ref(false)
const reminderRows = ref<ShiftHandoverRow[]>([])

const GROUP_KEYS = ['RIDE', 'RESTAURANT', 'SHOW', 'SHOP', 'OTHER'] as const

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function localDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 13)
  return { from: localDateString(from), to: localDateString(to) }
}

function joinIsoUtc(day: string, hm: string): string {
  const d = day.trim()
  const t = (hm.trim() || '00:00') + ':00'
  if (!d) return ''
  const local = new Date(`${d}T${t}`)
  return Number.isNaN(local.getTime()) ? '' : local.toISOString()
}

function assetUuid(a: PlatformAsset): string {
  return String(a.assetId ?? a.id ?? '')
}

function assetTypeCode(a: PlatformAsset): string {
  const at = a.assetType as { code?: string } | undefined
  return String(at?.code || '').toUpperCase()
}

function assetLabel(a: PlatformAsset): string {
  const name = a.name != null ? String(a.name).trim() : ''
  if (name) return name
  const slug = a.slug != null ? String(a.slug).trim() : ''
  if (slug) return slug
  return assetUuid(a) || '—'
}

function bucketForType(code: string): (typeof GROUP_KEYS)[number] {
  const u = code.toUpperCase()
  if (u === 'RIDE' || u === 'RESTAURANT' || u === 'SHOW' || u === 'SHOP') return u
  return 'OTHER'
}

const assetGroups = computed(() => {
  const map = new Map<string, PlatformAsset[]>()
  for (const k of GROUP_KEYS) map.set(k, [])
  for (const a of assets.value) {
    const b = bucketForType(assetTypeCode(a))
    map.get(b)!.push(a)
  }
  for (const k of GROUP_KEYS) {
    map.get(k)!.sort((x, y) => assetLabel(x).localeCompare(assetLabel(y), undefined, { sensitivity: 'base' }))
  }
  return GROUP_KEYS.map((code) => ({
    code,
    label: t(`incidents.assetGroup.${code}`),
    items: map.get(code)!,
  })).filter((g) => g.items.length > 0)
})

const parkName = computed(() => parks.value.find((p) => p.id === parkId.value)?.name ?? '')

/** Älteste zuerst — Lesefluss wie Logbuch */
const entriesChronological = computed(() => [...entries.value].reverse())

function syncParkHeader(id: string) {
  if (parkContext.parks.some((p) => p.id === id)) parkContext.setActivePark(id)
  else setApiParkContextId(id)
}

async function loadParks() {
  parks.value = await getPlatformParks()
  const pref = parkContext.activeParkId
  if (pref && parks.value.some((p) => p.id === pref)) parkId.value = pref
  else if (!parkId.value && parks.value.length) parkId.value = parks.value[0].id
}

async function loadAssets() {
  if (!parkId.value) {
    assets.value = []
    return
  }
  assetsBusy.value = true
  try {
    assets.value = await getPlatformAssets({ parkId: parkId.value, limit: 500 })
    const lid = listScopeAssetId.value.trim()
    if (lid && !assets.value.some((a) => assetUuid(a) === lid)) listScopeAssetId.value = ''
  } catch {
    assets.value = []
  } finally {
    assetsBusy.value = false
  }
}

function handoverScopeLine(row: ShiftHandoverRow): string {
  const snap = row.downtimeSnapshot?.scope
  if (snap?.kind === 'PARK_ASSET') {
    const lab = snap.label?.trim()
    if (lab) return `Bezug: ${lab}`
    if (snap.assetId) {
      const a = assets.value.find((x) => assetUuid(x) === snap.assetId)
      if (a) return `Bezug: ${assetLabel(a)}`
    }
    return 'Bezug: Park-Objekt'
  }
  if (row.linkedEntityType === 'PARK_ASSET' && row.linkedEntityId) {
    const a = assets.value.find((x) => assetUuid(x) === row.linkedEntityId)
    if (a) return `Bezug: ${assetLabel(a)}`
    return `Bezug: Park-Objekt (${String(row.linkedEntityId).slice(0, 8)}…)`
  }
  return 'Bezug: gesamter Park'
}

function snapshotBlock(row: ShiftHandoverRow): string[] {
  const lines: string[] = []
  const d = row.downtimeSnapshot
  if (d && d.downtimeEventCount != null) {
    let oee = `Stillstände (OEE): ${d.downtimeEventCount} Buchungen schneiden das Schichtfenster · offen ${d.openDowntimeCount ?? '—'} · geplant ${d.plannedEventsInWindow ?? '—'} · ungeplant ${d.unplannedEventsInWindow ?? '—'}`
    if (d.plannedDowntimeMinutes !== undefined || d.unplannedDowntimeMinutes !== undefined) {
      oee += ` · Ausfallzeit im Fenster ca. ${d.plannedDowntimeMinutes ?? 0} min geplant / ${d.unplannedDowntimeMinutes ?? 0} min ungeplant`
    }
    lines.push(oee)
  }
  if (d?.incidents) {
    lines.push(
      `Vorfälle: ${d.incidents.createdInWindow} neu im Fenster · offen ${d.incidents.openActiveTotal} (hoch/kritisch ${d.incidents.openActiveHighOrCritical})`
    )
  }
  if (!lines.length) lines.push('Keine Snapshot-Kennzahlen (bei Speicherung keine Auswahl oder älterer Eintrag).')
  return lines
}

function diffLines(row: ShiftHandoverRow): string[] {
  const d = row.diffSnapshot?.delta
  if (!d) return []
  return [
    `Stillstände Δ: ${d.downtimeEventCount ?? 0} · offen Δ: ${d.openDowntimeCount ?? 0}`,
    `Ausfallzeit Δ: geplant ${d.plannedDowntimeMinutes ?? 0} min · ungeplant ${d.unplannedDowntimeMinutes ?? 0} min`,
    `Vorfälle Δ: neu ${d.incidentsCreatedInWindow ?? 0} · offen ${d.incidentsOpenActiveTotal ?? 0} · hoch/kritisch ${d.incidentsOpenHighOrCritical ?? 0}`,
  ]
}

function taskStatusLabel(status?: string) {
  if (status === 'DONE') return 'Erledigt'
  if (status === 'CANCELLED') return 'Abgebrochen'
  return 'Offen'
}

function isReminderDue(row: ShiftHandoverRow) {
  return Boolean(row.reminderDueAt && !row.acknowledgedAt && !row.reminderSentAt && new Date(row.reminderDueAt) <= new Date())
}

async function refreshDueReminders() {
  if (!parkId.value) return
  try {
    reminderRows.value = await listShiftHandoverDueReminders(parkId.value, 50)
  } catch {
    reminderRows.value = []
  }
}

async function acknowledgeRow(row: ShiftHandoverRow) {
  if (!parkId.value || !canEdit.value) return
  const note = window.prompt('Quittierungsnotiz (optional):', '') ?? ''
  try {
    await acknowledgeShiftHandover(parkId.value, row.id, { note: note.trim() || null })
    push('Übergabe quittiert', 'success')
    await loadEntries()
    await refreshDueReminders()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Quittierung fehlgeschlagen', 'error')
  }
}

async function markReminder(row: ShiftHandoverRow) {
  if (!parkId.value || !canEdit.value) return
  try {
    await markShiftHandoverReminderSent(parkId.value, row.id)
    push('Erinnerung als versendet markiert', 'success')
    await loadEntries()
    await refreshDueReminders()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Erinnerung markieren fehlgeschlagen', 'error')
  }
}

async function toggleTaskDone(row: ShiftHandoverRow, taskId: string, done: boolean) {
  if (!parkId.value || !canEdit.value) return
  const tasks = (row.followUpTasks || []).map((t) =>
    t.id === taskId ? { ...t, status: (done ? 'DONE' : 'OPEN') as 'OPEN' | 'DONE' | 'CANCELLED' } : t
  )
  try {
    await patchShiftHandoverTasks(
      parkId.value,
      row.id,
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt || null,
        ownerUserId: t.ownerUserId || null,
        status: t.status,
      }))
    )
    await loadEntries()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Aufgabenupdate fehlgeschlagen', 'error')
  }
}

async function loadEntries() {
  if (!parkId.value) return
  busy.value = true
  try {
    const fd = listFromDate.value.trim()
    const td = listToDate.value.trim()
    const params: {
      limit: number
      q?: string
      from?: string
      to?: string
      scope?: 'park' | 'asset'
      linkedAssetId?: string
    } = { limit: 200 }
    const q = listSearch.value.trim()
    if (q) params.q = q
    if (fd && td) {
      params.from = joinIsoUtc(fd, '00:00')
      params.to = joinIsoUtc(td, '23:59')
      if (!params.from || !params.to || new Date(params.from) >= new Date(params.to)) {
        push('Zeitraum ungültig: Ende muss nach Beginn liegen.', 'error')
        entries.value = []
        return
      }
    }
    if (listScope.value === 'park') params.scope = 'park'
    else if (listScope.value === 'asset') {
      const aid = listScopeAssetId.value.trim()
      if (aid) {
        params.scope = 'asset'
        params.linkedAssetId = aid
      }
    }
    entries.value = await listShiftHandovers(parkId.value, params)
    await refreshDueReminders()
  } catch (e) {
    entries.value = []
    push(e instanceof Error ? e.message : 'Laden fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

function clearFilters() {
  const r = defaultDateRange()
  listFromDate.value = r.from
  listToDate.value = r.to
  listScope.value = 'all'
  listScopeAssetId.value = ''
  listSearch.value = ''
  void loadEntries()
}

function printLogbook() {
  const safePark = (parkName.value || 'park').replace(/[^\w\-]+/g, '_')
  const prev = document.title
  document.title = `Schicht-Logbuch_${safePark}_${listFromDate.value}_${listToDate.value}`
  window.print()
  setTimeout(() => {
    document.title = prev
  }, 800)
}

watch(parkId, async () => {
  if (parkId.value) syncParkHeader(parkId.value)
  await loadAssets()
  void loadEntries()
})

watch([listFromDate, listToDate, listScope, listScopeAssetId], () => {
  void loadEntries()
})

watch(listSearch, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    searchDebounce = null
    void loadEntries()
  }, 380)
})

onMounted(async () => {
  const r = defaultDateRange()
  listFromDate.value = r.from
  listToDate.value = r.to
  try {
    await loadParks()
    await loadAssets()
    await loadEntries()
    await refreshDueReminders()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Laden fehlgeschlagen', 'error')
  }
})
</script>

<template>
  <!-- Eigene dunkle Fläche: bei hellem App-Theme wären text-white / slate-200 sonst auf hellem Grund unsichtbar -->
  <div class="logbook-root mx-auto max-w-3xl px-4 py-6 sm:px-6">
    <div
      class="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-6 text-slate-100 shadow-sm ring-1 ring-white/5 sm:px-6"
    >
    <!-- Nur Bildschirm: Steuerung -->
    <div class="logbook-no-print mb-6 space-y-4">
      <nav class="text-xs text-slate-500">
        <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
        <span class="mx-1">/</span>
        <RouterLink to="/platform/shift-handover" class="text-brand-400 hover:underline">Schichtübergabe</RouterLink>
        <span class="mx-1">/</span>
        <span class="text-slate-400">Logbuch</span>
      </nav>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="font-display text-xl font-semibold text-white">Schicht-Logbuch</h1>
          <p class="mt-1 text-sm text-slate-400">
            Chronologische Übersicht der gespeicherten Übergaben — zum Lesen und zum
            <strong class="font-medium text-slate-300">Drucken / PDF</strong> (Browservorschau → „Als PDF speichern“).
          </p>
        </div>
        <div
          class="flex w-full flex-col gap-2 sm:w-auto sm:max-w-md sm:flex-row sm:items-center sm:justify-end"
        >
          <button
            type="button"
            class="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg border-2 border-slate-500 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            :disabled="busy"
            @click="printLogbook"
          >
            Drucken / PDF
          </button>
          <RouterLink
            to="/platform/shift-handover"
            class="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white shadow hover:bg-brand-500"
          >
            Zur Übergabe
          </RouterLink>
        </div>
      </div>

      <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div v-if="reminderRows.length" class="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p class="font-semibold">Fällige Erinnerungen</p>
          <ul class="mt-1 space-y-1">
            <li v-for="r in reminderRows" :key="'r-' + r.id" class="flex items-center justify-between gap-3">
              <span>{{ r.shiftLabel || '—' }} · fällig {{ r.reminderDueAt ? formatDateTime(r.reminderDueAt) : '—' }}</span>
              <button
                v-if="canEdit"
                type="button"
                class="rounded border border-amber-400/60 px-2 py-1 text-[11px] hover:bg-amber-500/20"
                @click="markReminder(r)"
              >
                Als versendet markieren
              </button>
            </li>
          </ul>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label for="lb-park" class="block text-xs text-slate-500">Park</label>
            <select
              id="lb-park"
              v-model="parkId"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label for="lb-from" class="block text-xs text-slate-500">Einträge mit Fenster von</label>
            <input
              id="lb-from"
              v-model="listFromDate"
              type="date"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <div>
            <label for="lb-to" class="block text-xs text-slate-500">bis</label>
            <input
              id="lb-to"
              v-model="listToDate"
              type="date"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <div>
            <label for="lb-scope" class="block text-xs text-slate-500">Bezug</label>
            <select
              id="lb-scope"
              v-model="listScope"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="all">Alle</option>
              <option value="park">Nur gesamter Park</option>
              <option value="asset">Nur Objekt</option>
            </select>
          </div>
          <div v-if="listScope === 'asset'" class="min-w-[12rem]">
            <label for="lb-asset" class="block text-xs text-slate-500">Objekt</label>
            <select
              id="lb-asset"
              v-model="listScopeAssetId"
              class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              :disabled="assetsBusy"
            >
              <option value="">— Alle —</option>
              <optgroup v-for="g in assetGroups" :key="g.code" :label="g.label">
                <option v-for="a in g.items" :key="assetUuid(a)" :value="assetUuid(a)">
                  {{ assetLabel(a) }}
                </option>
              </optgroup>
            </select>
          </div>
          <div class="min-w-[10rem] flex-1">
            <label for="lb-q" class="block text-xs text-slate-500">Suche</label>
            <input
              id="lb-q"
              v-model="listSearch"
              type="search"
              placeholder="Notiz / Schicht …"
              class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            @click="clearFilters"
          >
            Standard (14 Tage)
          </button>
        </div>
        <p class="mt-2 text-[11px] text-slate-600">
          Es werden Übergaben geladen, deren <strong class="text-slate-500">Schichtfenster</strong> den gewählten Kalendertagen schneidet (max. 200 Einträge).
          <span v-if="listScope === 'asset' && !listScopeAssetId" class="text-amber-500/90">
            Ohne Objektwahl: wie „Alle“.
          </span>
        </p>
      </div>
      <p v-if="busy" class="text-sm text-slate-500">Laden…</p>
    </div>

    <!-- Druckbereich: nur dieser Block wird sichtbar gedruckt -->
    <div class="logbook-print-area rounded-xl border border-slate-800 bg-slate-950/40 p-6 print:border-0 print:bg-white print:p-0">
      <header class="logbook-print-header mb-8 border-b border-slate-700 pb-4 print:border-black print:pb-3">
        <p class="text-xs uppercase tracking-wide text-slate-500 print:text-gray-600">Schicht-Logbuch / Shift handover</p>
        <h2 class="mt-1 font-display text-2xl font-semibold text-white print:text-black">{{ parkName || 'Park' }}</h2>
        <p class="mt-2 text-sm text-slate-400 print:text-gray-700">
          Zeitraum-Filter: {{ listFromDate }} — {{ listToDate }}
          <span v-if="listSearch.trim()" class="print:inline"> · Suche: „{{ listSearch.trim() }}“</span>
        </p>
        <p class="mt-1 text-xs text-slate-600 print:text-gray-600">
          Ausgedruckt: {{ formatDateTime(new Date().toISOString()) }}
        </p>
        <p class="mt-3 text-[11px] leading-relaxed text-slate-500 print:text-gray-700">
          <strong class="text-slate-400 print:text-gray-900">Hinweis:</strong>
          „Stillstände“ sind gebuchte OEE-Einträge (<span class="font-mono">asset_downtime_events</span>), keine Vorfälle.
          Die Kennzahlen wurden beim <strong>Speichern</strong> der Übergabe ermittelt und werden im Logbuch nicht automatisch nachgezogen.
          Zeilen mit „0“ bedeuten: zum Speicherzeitpunkt lag für dieses Schichtfenster keine passende Buchung vor (oder Stillstands-Snapshot war deaktiviert).
        </p>
      </header>

      <div v-if="!busy && !entriesChronological.length" class="py-12 text-center text-slate-500 print:text-gray-600">
        Keine Einträge für diese Filter.
      </div>

      <article
        v-for="row in entriesChronological"
        :key="row.id"
        class="logbook-entry mb-8 break-inside-avoid border-b border-slate-800 pb-6 last:border-0 print:mb-6 print:border-black print:pb-5"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-lg font-semibold text-white print:text-black">{{ row.shiftLabel || '—' }}</h3>
          <time class="text-xs text-slate-500 print:text-gray-600" :datetime="row.createdAt">{{
            row.createdAt ? formatDateTime(row.createdAt) : ''
          }}</time>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-xs">
          <a
            class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800 print:hidden"
            :href="shiftHandoverPdfUrl(parkId, row.id)"
            target="_blank"
            rel="noopener noreferrer"
          >
            Server-PDF/HTML
          </a>
          <button
            v-if="canEdit && !row.acknowledgedAt"
            type="button"
            class="rounded border border-emerald-500/60 px-2 py-1 text-emerald-200 hover:bg-emerald-500/20 print:hidden"
            @click="acknowledgeRow(row)"
          >
            Quittieren
          </button>
          <button
            v-if="canEdit && isReminderDue(row)"
            type="button"
            class="rounded border border-amber-500/60 px-2 py-1 text-amber-200 hover:bg-amber-500/20 print:hidden"
            @click="markReminder(row)"
          >
            Erinnerung versendet
          </button>
        </div>
        <p class="mt-1 text-sm text-slate-400 print:text-gray-800">
          Schichtfenster: {{ formatDateTime(row.windowFrom) }} — {{ formatDateTime(row.windowTo) }}
        </p>
        <p class="mt-1 text-sm text-slate-500 print:text-gray-800">{{ handoverScopeLine(row) }}</p>
        <div v-if="row.createdBy" class="mt-1 text-xs text-slate-600 print:text-gray-700">
          Von {{ row.createdBy.firstName }} {{ row.createdBy.lastName }}
          <span v-if="row.createdBy.email" class="font-mono"> · {{ row.createdBy.email }}</span>
        </div>
        <div v-if="row.acknowledgedAt" class="mt-1 text-xs text-emerald-300 print:text-gray-700">
          Quittiert: {{ formatDateTime(row.acknowledgedAt) }}
          <span v-if="row.acknowledgedBy"> · {{ row.acknowledgedBy.firstName }} {{ row.acknowledgedBy.lastName }}</span>
          <span v-if="row.acknowledgementNote"> · {{ row.acknowledgementNote }}</span>
        </div>
        <div v-if="diffLines(row).length" class="mt-3 space-y-1 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
          <p class="font-medium text-slate-200">Diff zur vorherigen Übergabe</p>
          <p v-for="(line, idx) in diffLines(row)" :key="'d-' + idx">{{ line }}</p>
        </div>
        <div class="mt-3 space-y-1 rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-400 print:bg-gray-100 print:text-gray-900">
          <p v-for="(line, i) in snapshotBlock(row)" :key="i" class="leading-relaxed">{{ line }}</p>
        </div>
        <div v-if="row.followUpTasks?.length" class="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
          <p class="font-medium text-slate-200">Folgeaufgaben</p>
          <ul class="mt-1 space-y-1">
            <li v-for="task in row.followUpTasks" :key="task.id" class="flex items-center justify-between gap-3">
              <span>
                {{ task.title }} · {{ taskStatusLabel(task.status) }}
                <span v-if="task.dueAt"> · fällig {{ formatDateTime(task.dueAt) }}</span>
              </span>
              <label v-if="canEdit && task.status !== 'CANCELLED'" class="inline-flex items-center gap-1 print:hidden">
                <input
                  type="checkbox"
                  :checked="task.status === 'DONE'"
                  @change="toggleTaskDone(row, task.id, ($event.target as HTMLInputElement).checked)"
                />
                erledigt
              </label>
            </li>
          </ul>
        </div>
        <div v-if="row.notes?.trim()" class="mt-4 text-sm leading-relaxed text-slate-200 print:text-black">
          <p class="text-xs font-medium uppercase text-slate-500 print:text-gray-600">Notiz</p>
          <p class="mt-1 whitespace-pre-wrap">{{ row.notes }}</p>
        </div>
      </article>
    </div>
    </div>
  </div>
</template>

<style scoped>
.logbook-root {
  position: relative;
}
</style>

<style>
/* Nur den Logbuch-Block drucken; Rest der App ausblenden */
@media print {
  body * {
    visibility: hidden;
  }
  .logbook-print-area,
  .logbook-print-area * {
    visibility: visible;
  }
  .logbook-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    padding: 12mm 14mm !important;
    margin: 0 !important;
    background: #fff !important;
    color: #111 !important;
    border: none !important;
    box-shadow: none !important;
  }
  .logbook-print-header h2 {
    color: #000 !important;
  }
  .logbook-no-print {
    display: none !important;
  }
}
</style>
