<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { createShiftHandover, getPlatformAssets, getPlatformParks, listShiftHandovers } from '@/api/client'
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

type ShiftPreset = {
  id: string
  label: string
  hint: string
  start: string
  end: string
  /** Enddatum = Beginndatum + N Tage (Nachtschicht über Mitternacht). */
  endPlusDays?: number
}

/** Schicht-Preset — echtes Fenster = Beginn/Ende-Datum + Uhrzeit. */
const SHIFT_PRESETS: ShiftPreset[] = [
  { id: 'early', label: 'Früh', hint: '08:00–16:00', start: '08:00', end: '16:00', endPlusDays: 0 },
  { id: 'late', label: 'Spät', hint: '14:00–22:00', start: '14:00', end: '22:00', endPlusDays: 0 },
  { id: 'long', label: 'Lang', hint: '08:00–20:00', start: '08:00', end: '20:00', endPlusDays: 0 },
  { id: 'night', label: 'Nacht', hint: '22:00–06:00 (+1 Tag)', start: '22:00', end: '06:00', endPlusDays: 1 },
]

const presetId = ref<string>('')
const shiftDayStart = ref('')
const shiftDayEnd = ref('')
const winFromTime = ref('')
const winToTime = ref('')
const shiftLabelCustom = ref('')
const notes = ref('')
const includeDowntimeSnapshot = ref(true)
const includeIncidentSnapshot = ref(true)
const reminderDelayMin = ref(60)
const taskDraftTitle = ref('')
const taskDraftDue = ref('')
const followUpTasks = ref<Array<{ id: string; title: string; dueAt: string | null; status: 'OPEN' | 'DONE' | 'CANCELLED' }>>([])

/** Optional: ein Park-Objekt — Snapshots + Eintrag sind dann nur für dieses Asset */
const formLinkedParkAssetId = ref('')
const assets = ref<PlatformAsset[]>([])
const assetsBusy = ref(false)

const GROUP_KEYS = ['RIDE', 'RESTAURANT', 'SHOW', 'SHOP', 'OTHER'] as const

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

/** Liste „Letzte Übergaben“ */
const listSearch = ref('')
const listFromDate = ref('')
const listToDate = ref('')
const listScope = ref<'all' | 'park' | 'asset'>('all')
const listScopeAssetId = ref('')
let listSearchDebounce: ReturnType<typeof setTimeout> | null = null

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function todayLocalDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function joinIsoUtc(day: string, hm: string): string {
  const d = day.trim()
  const t = (hm.trim() || '00:00') + ':00'
  if (!d) return ''
  const local = new Date(`${d}T${t}`)
  return Number.isNaN(local.getTime()) ? '' : local.toISOString()
}

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
    const fid = formLinkedParkAssetId.value.trim()
    if (fid && !assets.value.some((a) => assetUuid(a) === fid)) formLinkedParkAssetId.value = ''
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
    } = {
      limit: 100,
    }
    const q = listSearch.value.trim()
    if (q) params.q = q
    if (fd && td) {
      params.from = joinIsoUtc(fd, '00:00')
      params.to = joinIsoUtc(td, '23:59')
      if (!params.from || !params.to || new Date(params.from) >= new Date(params.to)) {
        push('Listenfilter: „Von/Bis“ ungültig oder Ende nicht nach Beginn.', 'error')
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
  } catch (e) {
    entries.value = []
    push(e instanceof Error ? e.message : 'Liste fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

function clearListFilters() {
  listSearch.value = ''
  listFromDate.value = ''
  listToDate.value = ''
  listScope.value = 'all'
  listScopeAssetId.value = ''
  void loadEntries()
}

function applyPreset() {
  const p = SHIFT_PRESETS.find((x) => x.id === presetId.value)
  if (!p) return
  winFromTime.value = p.start
  winToTime.value = p.end
  shiftLabelCustom.value = p.label
  const plus = p.endPlusDays ?? 0
  shiftDayEnd.value = addDays(shiftDayStart.value, plus)
}

function alignEndDateToStart() {
  shiftDayEnd.value = shiftDayStart.value
}

function addTaskDraft() {
  const title = taskDraftTitle.value.trim()
  if (!title) return
  followUpTasks.value.push({
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    dueAt: taskDraftDue.value ? joinIsoUtc(taskDraftDue.value, '23:59') : null,
    status: 'OPEN',
  })
  taskDraftTitle.value = ''
  taskDraftDue.value = ''
}

function removeTask(id: string) {
  followUpTasks.value = followUpTasks.value.filter((x) => x.id !== id)
}

async function submitHandover() {
  if (!canEdit.value || !parkId.value) return
  const wf = joinIsoUtc(shiftDayStart.value, winFromTime.value)
  const wt = joinIsoUtc(shiftDayEnd.value, winToTime.value)
  if (!wf || !wt) {
    push('Beginn/Ende-Datum und Von/Bis-Uhrzeit vollständig ausfüllen.', 'error')
    return
  }
  if (new Date(wt) <= new Date(wf)) {
    push('Ende muss nach Beginn liegen — bei Nachtschicht „Ende (Datum)“ auf den Folgetag setzen.', 'error')
    return
  }
  if (!includeDowntimeSnapshot.value && !includeIncidentSnapshot.value) {
    push('Mindestens einen Snapshot-Typ auswählen (Stillstände und/oder Vorfälle).', 'error')
    return
  }
  busy.value = true
  try {
    const lid = formLinkedParkAssetId.value.trim()
    await createShiftHandover(parkId.value, {
      windowFrom: wf,
      windowTo: wt,
      shiftLabel: shiftLabelCustom.value.trim() || null,
      notes: notes.value.trim() || null,
      includeDowntimeSnapshot: includeDowntimeSnapshot.value,
      includeIncidentSnapshot: includeIncidentSnapshot.value,
      followUpTasks: followUpTasks.value.map((x) => ({
        id: x.id,
        title: x.title,
        dueAt: x.dueAt,
        status: x.status,
      })),
      reminderDelayMin: reminderDelayMin.value,
      ...(lid ? { linkedParkAssetId: lid } : {}),
    })
    push('Schichtübergabe gespeichert', 'success')
    notes.value = ''
    followUpTasks.value = []
    await loadEntries()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

watch(parkId, async () => {
  if (parkId.value) syncParkHeader(parkId.value)
  await loadAssets()
  void loadEntries()
})

watch([listFromDate, listToDate], () => {
  void loadEntries()
})

watch([listScope, listScopeAssetId], () => {
  void loadEntries()
})

watch(listSearch, () => {
  if (listSearchDebounce) clearTimeout(listSearchDebounce)
  listSearchDebounce = setTimeout(() => {
    listSearchDebounce = null
    void loadEntries()
  }, 380)
})

onMounted(async () => {
  const day = todayLocalDate()
  shiftDayStart.value = day
  shiftDayEnd.value = day
  presetId.value = SHIFT_PRESETS[0].id
  winFromTime.value = SHIFT_PRESETS[0].start
  winToTime.value = SHIFT_PRESETS[0].end
  shiftLabelCustom.value = SHIFT_PRESETS[0].label
  try {
    await loadParks()
    await loadAssets()
    await loadEntries()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Laden fehlgeschlagen', 'error')
  }
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6">
    <div
      class="space-y-6 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-100 ring-1 ring-white/5 sm:p-6"
    >
    <nav class="text-xs text-slate-500">
      <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">Schichtübergabe</span>
    </nav>

    <h1 class="font-display text-xl font-semibold text-white">Schichtübergabe (Handover)</h1>

    <div class="flex flex-wrap gap-2">
      <RouterLink
        to="/platform/shift-handover/logbook"
        class="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-500"
      >
        Schicht-Logbuch (Lesen / PDF)
      </RouterLink>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
      <p class="font-medium text-slate-200">Sinnvolle Ausbaustufen (Überblick)</p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>
          <strong class="text-slate-300">Dokumentation</strong>: festes Zeitfenster + Freitext — was die nächste Schicht wissen muss.
        </li>
        <li>
          <strong class="text-slate-300">Bezug</strong>: <strong class="text-slate-200">ganzer Park</strong> oder ein
          <strong class="text-slate-200">Park-Objekt</strong> (Fahrgeschäft, Restaurant, Show, Shop …); Snapshots sind dann auf dieses Objekt begrenzt (<span class="font-mono text-xs">PARK_ASSET</span>).
        </li>
        <li>
          <strong class="text-slate-300">Stillstands-Snapshot</strong> (optional): Stillstände im Fenster — aus
          <span class="font-mono text-xs">asset_downtime_events</span>.
        </li>
        <li>
          <strong class="text-slate-300">Vorfalls-Snapshot</strong> (optional): neue Vorfälle im Fenster + aktuell offene (OPEN/IN_PROGRESS), davon hoch/kritisch — aus
          <span class="font-mono text-xs">incidents</span> (mit Objektbezug nur für dieses Objekt).
        </li>
        <li>
          <strong class="text-slate-300">Nachtschicht</strong>: eigenes <strong>Ende (Datum)</strong> (z. B. +1 Tag) oder Vorlage „Nacht“.
        </li>
        <li>
          <strong class="text-slate-300">Liste</strong>: Suche in Notiz/Schichtbezeichnung; optional Zeitraum (schneidendes Schichtfenster).
        </li>
        <li>
          <strong class="text-slate-300">Logbuch</strong>:
          <RouterLink to="/platform/shift-handover/logbook" class="text-brand-400 hover:underline">Schicht-Logbuch</RouterLink>
          — chronologisch lesen und per Browser als PDF speichern.
        </li>
        <li>
          <strong class="text-slate-300">Später</strong>: Quittierung Folgeschicht (gelesen), Signaturen, Server-PDF.
        </li>
      </ul>
    </div>

    <div class="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label for="sh-park" class="block text-xs font-medium text-slate-400">Park</label>
        <select
          id="sh-park"
          v-model="parkId"
          class="mt-1 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <p class="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-500">
          Zuerst den <strong class="text-slate-400">Park</strong> wählen. Unter „Neue Übergabe“ können Sie optional ein
          <strong class="text-slate-400">konkretes Park-Objekt</strong> setzen — sonst gilt die Übergabe für den gesamten Park (wie bisher).
        </p>
        <p v-if="parks.length <= 1" class="mt-1 max-w-2xl text-[11px] text-amber-500/90">
          In der Datenbank ist aktuell nur dieser eine Park hinterlegt — deshalb erscheint nur eine Option. Weitere Parks legen Sie unter
          <RouterLink to="/admin/master-data/parks" class="text-brand-400 hover:underline">{{ t('menu.masterData') }} → Parks</RouterLink>
          an (Berechtigung je nach Rolle).
        </p>
      </div>
    </div>

    <div v-if="canEdit" class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 class="text-sm font-medium text-white">Neue Übergabe</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label for="sh-linked-asset" class="block text-xs text-slate-500">Bezug (optional)</label>
          <p v-if="assetsBusy" class="mt-1 text-xs text-slate-500">Lade Park-Objekte…</p>
          <select
            v-else
            id="sh-linked-asset"
            v-model="formLinkedParkAssetId"
            class="mt-1 w-full max-w-xl rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="">— Gesamter Park —</option>
            <optgroup v-for="g in assetGroups" :key="g.code" :label="g.label">
              <option v-for="a in g.items" :key="assetUuid(a)" :value="assetUuid(a)">
                {{ assetLabel(a) }}
              </option>
            </optgroup>
          </select>
          <p class="mt-1 text-[11px] text-slate-600">
            Mit Objekt: Stillstands- und Vorfalls-Zahlen nur für diese Anlage; ohne Objekt: wie bisher parkweit.
          </p>
        </div>
        <div>
          <label for="sh-day-start" class="block text-xs text-slate-500">Beginn (Datum)</label>
          <input
            id="sh-day-start"
            v-model="shiftDayStart"
            type="date"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
        <div>
          <label for="sh-day-end" class="block text-xs text-slate-500">Ende (Datum)</label>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="sh-day-end"
              v-model="shiftDayEnd"
              type="date"
              class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <button
              type="button"
              class="shrink-0 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              @click="alignEndDateToStart"
            >
              = Beginn
            </button>
          </div>
          <p class="mt-1 text-[11px] text-slate-500">Nachtschicht: Ende oft am nächsten Kalendertag.</p>
        </div>
        <div>
          <label for="sh-preset" class="block text-xs text-slate-500">Vorlage (Uhrzeiten + Bezeichnung)</label>
          <select
            id="sh-preset"
            v-model="presetId"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            @change="applyPreset"
          >
            <option v-for="p in SHIFT_PRESETS" :key="p.id" :value="p.id">{{ p.label }} ({{ p.hint }})</option>
          </select>
        </div>
        <div>
          <label for="sh-from" class="block text-xs text-slate-500">Von (Uhrzeit)</label>
          <input
            id="sh-from"
            v-model="winFromTime"
            type="time"
            step="60"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
        <div>
          <label for="sh-to" class="block text-xs text-slate-500">Bis (Uhrzeit)</label>
          <input
            id="sh-to"
            v-model="winToTime"
            type="time"
            step="60"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
        <div class="sm:col-span-2">
          <label for="sh-label" class="block text-xs text-slate-500">Schichtbezeichnung (frei)</label>
          <input
            id="sh-label"
            v-model="shiftLabelCustom"
            type="text"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            placeholder="z. B. Früh, Spät, Team A"
          />
        </div>
        <div class="sm:col-span-2">
          <label for="sh-notes" class="block text-xs text-slate-500">Übergabenotiz</label>
          <textarea
            id="sh-notes"
            v-model="notes"
            rows="5"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            placeholder="Offene Punkte, Gäste, technische Hinweise …"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="includeDowntimeSnapshot" type="checkbox" class="rounded border-slate-600" />
          Stillstände (OEE)
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="includeIncidentSnapshot" type="checkbox" class="rounded border-slate-600" />
          Vorfälle (Incidents)
        </label>
        <div class="sm:col-span-2 grid gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p class="text-xs font-medium text-slate-300">Folgeaufgaben</p>
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              v-model="taskDraftTitle"
              type="text"
              class="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              placeholder="Aufgabe (z. B. Sensor X prüfen)"
            />
            <input
              v-model="taskDraftDue"
              type="date"
              class="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
            <button
              type="button"
              class="rounded border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
              @click="addTaskDraft"
            >
              Aufgabe hinzufügen
            </button>
          </div>
          <ul v-if="followUpTasks.length" class="space-y-1 text-xs text-slate-300">
            <li v-for="tItem in followUpTasks" :key="tItem.id" class="flex items-center justify-between gap-3 rounded bg-slate-900 px-2 py-1.5">
              <span>{{ tItem.title }}<span v-if="tItem.dueAt"> · fällig {{ formatDateTime(tItem.dueAt) }}</span></span>
              <button type="button" class="text-slate-400 hover:text-red-300" @click="removeTask(tItem.id)">Entfernen</button>
            </li>
          </ul>
        </div>
        <div class="sm:col-span-2">
          <label for="sh-reminder-delay" class="block text-xs text-slate-500">Erinnerung nach Schichtende (Minuten)</label>
          <input
            id="sh-reminder-delay"
            v-model.number="reminderDelayMin"
            type="number"
            min="0"
            max="20160"
            class="mt-1 w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>
      <button
        type="button"
        class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        :disabled="busy || !parkId"
        @click="submitHandover"
      >
        Übergabe speichern
      </button>
    </div>
    <p v-else class="text-xs text-amber-500/90">Anlegen nur mit <span class="font-mono">rides · update</span>.</p>

    <div class="rounded-xl border border-slate-800">
      <h2 class="border-b border-slate-800 bg-slate-950/80 px-4 py-3 text-sm font-medium text-white">Letzte Übergaben</h2>
      <div class="space-y-3 border-b border-slate-800 bg-slate-950/40 px-4 py-3">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label for="sh-list-scope" class="block text-xs text-slate-500">Bezug</label>
            <select
              id="sh-list-scope"
              v-model="listScope"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="all">Alle Übergaben</option>
              <option value="park">Nur gesamter Park</option>
              <option value="asset">Nur gewähltes Objekt</option>
            </select>
          </div>
          <div v-if="listScope === 'asset'" class="min-w-[14rem]">
            <label for="sh-list-asset" class="block text-xs text-slate-500">Park-Objekt</label>
            <select
              id="sh-list-asset"
              v-model="listScopeAssetId"
              class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              :disabled="assetsBusy"
            >
              <option value="">— Bitte wählen —</option>
              <optgroup v-for="g in assetGroups" :key="'l-' + g.code" :label="g.label">
                <option v-for="a in g.items" :key="'l-' + assetUuid(a)" :value="assetUuid(a)">
                  {{ assetLabel(a) }}
                </option>
              </optgroup>
            </select>
          </div>
          <div class="min-w-[12rem] flex-1">
            <label for="sh-list-q" class="block text-xs text-slate-500">Suche (Notiz oder Schicht)</label>
            <input
              id="sh-list-q"
              v-model="listSearch"
              type="search"
              autocomplete="off"
              placeholder="Stichwort …"
              class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
          </div>
          <div>
            <label for="sh-list-from" class="block text-xs text-slate-500">Fenster schneidet ab</label>
            <input
              id="sh-list-from"
              v-model="listFromDate"
              type="date"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <div>
            <label for="sh-list-to" class="block text-xs text-slate-500">… bis (Kalendertag)</label>
            <input
              id="sh-list-to"
              v-model="listToDate"
              type="date"
              class="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </div>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            @click="clearListFilters"
          >
            Filter leeren
          </button>
        </div>
        <p class="text-[11px] text-slate-600">
          Zeitraum: Es erscheinen Übergaben, deren Schichtfenster diesen Tagesbereich schneidet (UTC aus lokalem 00:00–23:59). Nur ein Datum gesetzt wird ignoriert.
          <span v-if="listScope === 'asset' && !listScopeAssetId" class="text-amber-500/90">
            Objektfilter: ohne gewähltes Objekt werden alle Einträge geladen (wie „Alle“).
          </span>
        </p>
      </div>
      <ul class="divide-y divide-slate-800">
        <li v-for="row in entries" :key="row.id" class="px-4 py-3 text-sm text-slate-300">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-medium text-white">{{ row.shiftLabel || '—' }}</span>
            <span class="text-xs text-slate-500">{{ row.createdAt ? formatDateTime(row.createdAt) : '—' }}</span>
          </div>
          <p class="mt-1 text-xs text-slate-400">
            {{ formatDateTime(row.windowFrom) }} → {{ formatDateTime(row.windowTo) }}
          </p>
          <p class="mt-1 text-xs text-slate-500">{{ handoverScopeLine(row) }}</p>
          <div
            v-if="row.downtimeSnapshot && row.downtimeSnapshot.downtimeEventCount != null"
            class="mt-2 rounded-lg bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400"
          >
            Stillstände (OEE): {{ row.downtimeSnapshot.downtimeEventCount }} Buchungen · offen
            {{ row.downtimeSnapshot.openDowntimeCount }} · geplant {{ row.downtimeSnapshot.plannedEventsInWindow }} · ungeplant
            {{ row.downtimeSnapshot.unplannedEventsInWindow }}
            <template
              v-if="
                row.downtimeSnapshot.plannedDowntimeMinutes !== undefined ||
                row.downtimeSnapshot.unplannedDowntimeMinutes !== undefined
              "
            >
              · Ausfallzeit im Fenster ca. {{ row.downtimeSnapshot.plannedDowntimeMinutes ?? 0 }} min geplant /
              {{ row.downtimeSnapshot.unplannedDowntimeMinutes ?? 0 }} min ungeplant
            </template>
          </div>
          <div
            v-if="row.downtimeSnapshot?.incidents"
            class="mt-2 rounded-lg bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400"
          >
            Vorfälle: {{ row.downtimeSnapshot.incidents.createdInWindow }} neu im Fenster · aktuell offen
            {{ row.downtimeSnapshot.incidents.openActiveTotal }} (hoch/kritisch
            {{ row.downtimeSnapshot.incidents.openActiveHighOrCritical }})
          </div>
          <p v-if="row.notes?.trim()" class="mt-2 whitespace-pre-wrap text-slate-300">{{ row.notes }}</p>
          <p v-if="row.createdBy" class="mt-1 text-xs text-slate-600">
            Von {{ row.createdBy.firstName }} {{ row.createdBy.lastName }}
          </p>
        </li>
        <li v-if="!entries.length" class="px-4 py-8 text-center text-slate-500">Noch keine Einträge für diesen Park.</li>
      </ul>
    </div>

    <p class="text-xs text-slate-600">
      <RouterLink to="/platform/shift-handover/logbook" class="text-brand-400 hover:underline">Schicht-Logbuch (Druck/PDF)</RouterLink>
      ·
      <RouterLink to="/platform/oee" class="text-brand-400 hover:underline">OEE — Verfügbarkeit &amp; Stillstände</RouterLink>
      ·
      <RouterLink to="/incidents" class="text-brand-400 hover:underline">Vorfälle</RouterLink>
    </p>
    </div>
  </div>
</template>
