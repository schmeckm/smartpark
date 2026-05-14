<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  getIntegrationSettings,
  patchIntegrationSettings,
  patchPlatformParkLevel0,
  getPlatformParkOperationalContext,
  getPlatformParks,
  postSyncThemeParksFromSettings,
} from '@/api/client'
import type { PlatformOperationalContext, PlatformPark, ThemeParksSyncResult } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'

const { push } = useToast()
const { t } = useI18n()
const auth = useAuthStore()
const parkContext = useParkContextStore()

const parks = ref<PlatformPark[]>([])
const settings = ref<Record<string, unknown> | null>(null)
const busy = ref(false)
const lastSync = ref<ThemeParksSyncResult | null>(null)

const detailParkId = ref('')
const operational = ref<PlatformOperationalContext | null>(null)
const operationalErr = ref<string | null>(null)
const opBusy = ref(false)
const level0Busy = ref(false)

const level0Form = ref({
  name: '',
  slug: '',
  timezone: '',
  latitude: '',
  longitude: '',
  baselineOpenTime: '',
  baselineCloseTime: '',
  annualOpenFrom: '',
  annualOpenUntil: '',
  annualVisitorsTarget: '',
  areaHectares: '',
  maxDailyCapacity: '',
  parkingSpaces: '',
  openingYear: '',
  operatorName: '',
  emergencyPhone: '',
  websiteUrl: '',
  openingHoursNotes: '',
  seasonNotes: '',
})
const selectedPark = computed(() => {
  const s = settings.value?.selectedPark as
    | { provider?: string; externalParkId?: string; parkName?: string; destinationName?: string }
    | undefined
    | null
  return s
})

type DataSourceMode = 'MQTT_UNS' | 'THEMEPARKS_ADAPTER' | 'HYBRID'
const sourceModeBusy = ref(false)
const sourceModeOptimistic = ref<DataSourceMode | null>(null)
const sourceModeFromSettings = computed<DataSourceMode>(() => {
  const raw = (settings.value?.dataSourceMode as { mode?: string } | undefined)?.mode
  if (raw === 'THEMEPARKS_ADAPTER' || raw === 'HYBRID' || raw === 'MQTT_UNS') return raw
  return 'MQTT_UNS'
})
const sourceMode = computed<DataSourceMode>(() => sourceModeOptimistic.value ?? sourceModeFromSettings.value)

const selectedDetailPark = computed(() => parks.value.find((p) => p.id === detailParkId.value) ?? null)
const canEditLevel0 = computed(() => auth.hasPermission('rides', 'update'))

const canSyncFromSettings = computed(
  () =>
    auth.hasPermission('integrations', 'manage') &&
    String(selectedPark.value?.provider || '').toLowerCase() === 'themeparks_wiki' &&
    !!String(selectedPark.value?.externalParkId || '').trim()
)

const interpretationDe: Record<string, string> = {
  INSIDE_HOURS: 'Innerhalb der geplanten Öffnungszeit',
  OUTSIDE_HOURS: 'Außerhalb der geplanten Öffnungszeit',
  CLOSED_DAY: 'Geschlossen (laut Plan)',
  UNKNOWN: 'Unbekannt (keine oder unvollständige Öffnungsdaten)',
}

function pickDefaultParkId(list: PlatformPark[]): string {
  const pref = parkContext.activeParkId
  if (pref && list.some((p) => p.id === pref)) return pref
  return list[0]?.id ?? ''
}

function applyLevel0FormFromPark(p: PlatformPark | null) {
  const level0Raw =
    p?.masterProfile && typeof p.masterProfile === 'object'
      ? (p.masterProfile as { level0?: Record<string, unknown> }).level0
      : undefined
  const level0 = level0Raw && typeof level0Raw === 'object' ? level0Raw : {}
  const keyFactsRaw =
    level0.keyFacts && typeof level0.keyFacts === 'object' ? (level0.keyFacts as Record<string, unknown>) : {}
  level0Form.value = {
    name: p?.name ?? '',
    slug: p?.slug ?? '',
    timezone: p?.timezone ?? '',
    latitude: p?.latitude == null ? '' : String(p.latitude),
    longitude: p?.longitude == null ? '' : String(p.longitude),
    baselineOpenTime: String(level0.baselineOpenTime ?? ''),
    baselineCloseTime: String(level0.baselineCloseTime ?? ''),
    annualOpenFrom: String(level0.annualOpenFrom ?? ''),
    annualOpenUntil: String(level0.annualOpenUntil ?? ''),
    annualVisitorsTarget: keyFactsRaw.annualVisitorsTarget == null ? '' : String(keyFactsRaw.annualVisitorsTarget),
    areaHectares: keyFactsRaw.areaHectares == null ? '' : String(keyFactsRaw.areaHectares),
    maxDailyCapacity: keyFactsRaw.maxDailyCapacity == null ? '' : String(keyFactsRaw.maxDailyCapacity),
    parkingSpaces: keyFactsRaw.parkingSpaces == null ? '' : String(keyFactsRaw.parkingSpaces),
    openingYear: keyFactsRaw.openingYear == null ? '' : String(keyFactsRaw.openingYear),
    operatorName: String(keyFactsRaw.operatorName ?? ''),
    emergencyPhone: String(keyFactsRaw.emergencyPhone ?? ''),
    websiteUrl: String(keyFactsRaw.websiteUrl ?? ''),
    openingHoursNotes: String(level0.openingHoursNotes ?? ''),
    seasonNotes: String(level0.seasonNotes ?? ''),
  }
}

function asNullableText(v: string): string | null {
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

function asNullableNumber(v: string): number | null {
  const trimmed = v.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function asNullableInteger(v: string): number | null {
  const n = asNullableNumber(v)
  if (n == null) return null
  return Number.isInteger(n) ? n : null
}

type ParsedLevel0Numbers = {
  lat: number | null
  lng: number | null
  annualVisitorsTarget: number | null
  maxDailyCapacity: number | null
  parkingSpaces: number | null
  openingYear: number | null
  areaHectares: number | null
}

function parseLevel0Numbers(): { data: ParsedLevel0Numbers } | { error: string } {
  const parsed: ParsedLevel0Numbers = {
    lat: asNullableNumber(level0Form.value.latitude),
    lng: asNullableNumber(level0Form.value.longitude),
    annualVisitorsTarget: asNullableInteger(level0Form.value.annualVisitorsTarget),
    maxDailyCapacity: asNullableInteger(level0Form.value.maxDailyCapacity),
    parkingSpaces: asNullableInteger(level0Form.value.parkingSpaces),
    openingYear: asNullableInteger(level0Form.value.openingYear),
    areaHectares: asNullableNumber(level0Form.value.areaHectares),
  }
  if (level0Form.value.latitude.trim() && parsed.lat == null) return { error: 'Latitude muss eine Zahl sein.' }
  if (level0Form.value.longitude.trim() && parsed.lng == null) return { error: 'Longitude muss eine Zahl sein.' }
  if (level0Form.value.annualVisitorsTarget.trim() && parsed.annualVisitorsTarget == null) {
    return { error: 'Jahresbesucher-Ziel muss eine ganze Zahl sein.' }
  }
  if (level0Form.value.maxDailyCapacity.trim() && parsed.maxDailyCapacity == null) {
    return { error: 'Tageskapazität muss eine ganze Zahl sein.' }
  }
  if (level0Form.value.parkingSpaces.trim() && parsed.parkingSpaces == null) {
    return { error: 'Parkplätze müssen als ganze Zahl angegeben werden.' }
  }
  if (level0Form.value.openingYear.trim() && parsed.openingYear == null) {
    return { error: 'Eröffnungsjahr muss eine ganze Zahl sein.' }
  }
  if (level0Form.value.areaHectares.trim() && parsed.areaHectares == null) {
    return { error: 'Fläche (ha) muss eine Zahl sein.' }
  }
  return { data: parsed }
}

async function loadOperational() {
  const id = detailParkId.value.trim()
  if (!id) {
    operational.value = null
    return
  }
  opBusy.value = true
  operationalErr.value = null
  try {
    operational.value = await getPlatformParkOperationalContext(id)
  } catch (e) {
    operational.value = null
    operationalErr.value = e instanceof Error ? e.message : 'Laden fehlgeschlagen'
  } finally {
    opBusy.value = false
  }
}

watch(detailParkId, () => {
  void loadOperational()
})

watch(
  selectedDetailPark,
  (park) => {
    applyLevel0FormFromPark(park)
  },
  { immediate: true }
)

async function load() {
  busy.value = true
  try {
    const [p, st] = await Promise.all([getPlatformParks(), getIntegrationSettings()])
    parks.value = p
    settings.value = st
    detailParkId.value = pickDefaultParkId(p)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  } finally {
    busy.value = false
  }
}

async function syncFromIntegrationSettings() {
  if (!canSyncFromSettings.value) {
    push('Wählen Sie in Integration settings einen ThemeParks-Park und speichern Sie die Auswahl.', 'error')
    return
  }
  busy.value = true
  try {
    lastSync.value = await postSyncThemeParksFromSettings()
    push(
      `Asset-Daten synchron: ${lastSync.value.assetsUpserted} Assets, ${lastSync.value.observationsInserted} Observations`,
      'success'
    )
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Sync fehlgeschlagen', 'error')
  } finally {
    busy.value = false
  }
}

async function setDataSourceMode(mode: DataSourceMode) {
  if (sourceModeBusy.value || sourceMode.value === mode) return
  sourceModeOptimistic.value = mode
  sourceModeBusy.value = true
  try {
    settings.value = await patchIntegrationSettings({ dataSourceMode: { mode } })
    sourceModeOptimistic.value = null
    push(`Datenquelle umgestellt: ${mode}`, 'success')
  } catch (e) {
    sourceModeOptimistic.value = null
    push(e instanceof Error ? e.message : 'Umschalten der Datenquelle fehlgeschlagen', 'error')
  } finally {
    sourceModeBusy.value = false
  }
}

async function saveLevel0() {
  const parkId = detailParkId.value.trim()
  if (!parkId) {
    push('Bitte zuerst einen Park auswählen.', 'error')
    return
  }
  if (!canEditLevel0.value) {
    push('rides.update erforderlich, um Grunddaten zu speichern.', 'error')
    return
  }
  const parsed = parseLevel0Numbers()
  if ('error' in parsed) {
    push(parsed.error, 'error')
    return
  }
  const { lat, lng, annualVisitorsTarget, maxDailyCapacity, parkingSpaces, openingYear, areaHectares } = parsed.data
  level0Busy.value = true
  try {
    const updated = await patchPlatformParkLevel0(parkId, {
      name: level0Form.value.name.trim(),
      slug: level0Form.value.slug.trim(),
      timezone: asNullableText(level0Form.value.timezone),
      latitude: lat,
      longitude: lng,
      level0: {
        baselineOpenTime: asNullableText(level0Form.value.baselineOpenTime),
        baselineCloseTime: asNullableText(level0Form.value.baselineCloseTime),
        annualOpenFrom: asNullableText(level0Form.value.annualOpenFrom),
        annualOpenUntil: asNullableText(level0Form.value.annualOpenUntil),
        keyFacts: {
          annualVisitorsTarget,
          areaHectares,
          maxDailyCapacity,
          parkingSpaces,
          openingYear,
          operatorName: asNullableText(level0Form.value.operatorName),
          emergencyPhone: asNullableText(level0Form.value.emergencyPhone),
          websiteUrl: asNullableText(level0Form.value.websiteUrl),
        },
        openingHoursNotes: asNullableText(level0Form.value.openingHoursNotes),
        seasonNotes: asNullableText(level0Form.value.seasonNotes),
      },
    })
    parks.value = parks.value.map((p) => (p.id === updated.id ? updated : p))
    applyLevel0FormFromPark(updated)
    push('Park-Grunddaten gespeichert.', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error')
  } finally {
    level0Busy.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
    <nav class="text-xs text-slate-500">
      <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">Park explorer</span>
    </nav>
    <h1 class="font-display text-xl font-semibold text-white">Park explorer</h1>
    <p class="text-sm text-slate-400">
      ThemeParks.wiki liefert Entities; Asset-Daten landen in <span class="font-mono text-slate-300">park_assets</span>.
      Die Park-UUID kommt aus den <strong class="text-slate-200">Integration settings</strong> (gleiche Auswahl wie
      „Save selection“ / Sync entities) — keine zweite Eingabe hier.
    </p>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-medium text-white">Öffnungszeiten &amp; Saison (Park-Zeit)</h2>
      <p class="mt-1 text-xs text-slate-500">
        Daten aus <span class="font-mono text-slate-400">park_operating_snapshots</span> (Kalender-Sync) und
        meteorologischer Saison · Referenzzeitpunkt: „Jetzt“ (UTC), Datum/Uhrzeit unten in Park-Zeitzone.
        Fehlen Zeiten: unter <RouterLink to="/integrations" class="text-brand-400 hover:underline">Integrationen</RouterLink>
        einen Kalender-Sync auslösen (z.&nbsp;B. „Sync all“ für die Destination — legt ThemeParks-<span class="font-mono">schedule</span>
        an).
      </p>
      <div class="mt-3">
        <label for="park-operational-select" class="block text-xs font-medium text-slate-400">Park</label>
        <select
          id="park-operational-select"
          v-model="detailParkId"
          class="mt-1 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option disabled value="">Park wählen…</option>
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }} ({{ p.slug }})</option>
        </select>
      </div>

      <div class="mt-4 text-sm">
        <p v-if="opBusy" class="text-slate-400">Lade Betriebskontext…</p>
        <p v-else-if="operationalErr" class="text-amber-400/90">{{ operationalErr }}</p>
        <div v-else-if="operational" class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-slate-400">Saison</span>
            <span
              v-if="operational.season.labelDe"
              class="rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-medium text-emerald-200"
            >
              {{ operational.season.labelDe }}
            </span>
            <span v-if="operational.season.code != null" class="font-mono text-xs text-slate-500">
              Code {{ operational.season.code }} (1=Frühling … 4=Winter)
            </span>
            <span v-if="!operational.season.labelDe" class="text-slate-500">—</span>
          </div>
          <dl class="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <div>
              <dt class="text-slate-500">Datum (lokal)</dt>
              <dd class="font-mono text-slate-300">{{ operational.localDate }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">Stunde (lokal)</dt>
              <dd class="font-mono text-slate-300">{{ operational.localHour }}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-slate-500">Zeitzone</dt>
              <dd class="font-mono text-slate-300">{{ operational.park.timezone || 'UTC' }}</dd>
            </div>
          </dl>
          <div class="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <h3 class="text-xs font-medium uppercase tracking-wide text-slate-500">Öffnungszeiten (Plan)</h3>
            <p v-if="operational.operatingHours.summary?.summaryDe" class="mt-2 text-white">
              {{ operational.operatingHours.summary.summaryDe }}
            </p>
            <p v-else-if="operational.operatingHours.summary?.summaryDe === null && operational.operatingHours.scheduleRow" class="mt-2 text-slate-400">
              Tag erkannt, aber keine vollständigen Öffnungs-/Schließzeiten im Payload.
            </p>
            <p v-else class="mt-2 text-slate-500">
              Keine Öffnungszeilen für <span class="font-mono">{{ operational.localDate }}</span> — ThemeParks-Kalender
              syncen oder Adapter „calendar“ ausführen.
            </p>
            <p class="mt-2 text-xs text-slate-500">
              Status:
              <span class="text-slate-300">{{
                interpretationDe[operational.operatingHours.interpretation] ||
                operational.operatingHours.interpretation
              }}</span>
              <span v-if="operational.operatingHours.scheduleSampledAt" class="ml-2 font-mono">
                · Stand {{ operational.operatingHours.scheduleSampledAt }}
              </span>
            </p>
          </div>
        </div>
        <p v-else class="text-slate-500">Park wählen für Öffnungszeiten und Saison.</p>
      </div>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-medium text-white">Park-Grunddaten (Level 0)</h2>
          <p class="mt-1 text-xs text-slate-500">
            Manuelle Basisdaten je Park: Name, Slug, Zeitzone, Koordinaten und L0-Notizen/Standardzeiten.
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          :disabled="level0Busy || !detailParkId || !canEditLevel0"
          @click="saveLevel0"
        >
          {{ level0Busy ? 'Speichere…' : 'Grunddaten speichern' }}
        </button>
      </div>
      <p v-if="!canEditLevel0" class="mt-2 text-xs text-amber-500/90">
        rides.update erforderlich, um Grunddaten zu ändern.
      </p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          Name
          <input v-model="level0Form.name" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Slug
          <input v-model="level0Form.slug" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Zeitzone
          <input v-model="level0Form.timezone" placeholder="Europe/Berlin" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Latitude
          <input v-model="level0Form.latitude" placeholder="48.2661" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Longitude
          <input v-model="level0Form.longitude" placeholder="7.7225" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Basis Öffnung
          <input
            v-model="level0Form.baselineOpenTime"
            type="time"
            step="60"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </label>
        <label class="text-xs text-slate-400">
          Basis Schließung
          <input
            v-model="level0Form.baselineCloseTime"
            type="time"
            step="60"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </label>
        <div>
          <label for="pe-annual-open-from" class="block text-xs text-slate-500">Park geöffnet von</label>
          <input
            id="pe-annual-open-from"
            v-model="level0Form.annualOpenFrom"
            type="date"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
        <div>
          <label for="pe-annual-open-until" class="block text-xs text-slate-500">Park geöffnet bis</label>
          <input
            id="pe-annual-open-until"
            v-model="level0Form.annualOpenUntil"
            type="date"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </div>
      </div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          Jahresbesucher Ziel
          <input v-model="level0Form.annualVisitorsTarget" placeholder="6000000" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Fläche (ha)
          <input v-model="level0Form.areaHectares" placeholder="95.5" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Max. Tageskapazität
          <input v-model="level0Form.maxDailyCapacity" placeholder="58000" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Parkplätze
          <input v-model="level0Form.parkingSpaces" placeholder="14000" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Eröffnungsjahr
          <input v-model="level0Form.openingYear" placeholder="1975" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Betreiber
          <input v-model="level0Form.operatorName" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Notfall-Telefon
          <input v-model="level0Form.emergencyPhone" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Webseite
          <input v-model="level0Form.websiteUrl" placeholder="https://..." class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
      </div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          Öffnungszeiten-Notizen
          <textarea v-model="level0Form.openingHoursNotes" rows="3" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
        <label class="text-xs text-slate-400">
          Saison-Notizen
          <textarea v-model="level0Form.seasonNotes" rows="3" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
      </div>
    </div>

    <p class="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
      Geplante Sparkplug-<span class="font-mono text-slate-400">edge_node_id</span>-Knoten (MQTT) pflegen Sie unter
      <RouterLink to="/diagnostics/sparkplug" class="text-brand-400 hover:text-brand-300">{{ t('menu.diagSparkplug') }}</RouterLink>.
    </p>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-medium text-white">Datenquellen &amp; Initial-Sync</h2>
      <p class="mt-1 text-xs text-slate-400">
        Primärquelle für Betrieb und Live-Zustände ist <span class="font-semibold text-emerald-300">MQTT / UNS (IT-OT)</span>.
        ThemeParks bleibt optional für Bootstrap/Fallback von Asset-Daten.
      </p>
      <div class="mt-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Source switch</p>
        <div class="mt-2 inline-flex flex-wrap gap-2 rounded-lg border border-slate-700 bg-slate-950 p-1">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs"
            :class="sourceMode === 'MQTT_UNS' ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-800'"
            :disabled="sourceModeBusy"
            @click="setDataSourceMode('MQTT_UNS')"
          >
            MQTT / UNS primär
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs"
            :class="sourceMode === 'HYBRID' ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800'"
            :disabled="sourceModeBusy"
            @click="setDataSourceMode('HYBRID')"
          >
            Hybrid
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs"
            :class="
              sourceMode === 'THEMEPARKS_ADAPTER' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            "
            :disabled="sourceModeBusy"
            @click="setDataSourceMode('THEMEPARKS_ADAPTER')"
          >
            ThemeParks/Adapter primär
          </button>
        </div>
        <p class="mt-2 text-xs text-slate-500">
          Aktuell:
          <span class="font-medium text-slate-300">{{
            sourceMode === 'MQTT_UNS'
              ? 'MQTT / UNS primär'
              : sourceMode === 'HYBRID'
                ? 'Hybrid'
                : 'ThemeParks/Adapter primär'
          }}</span>
          <span v-if="sourceModeBusy" class="ml-2">…speichere</span>
        </p>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-emerald-700/60 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">
          <p class="font-medium">Primary source</p>
          <p class="mt-0.5">MQTT / UNS ingest (IT-OT Layer)</p>
        </div>
        <div class="rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
          <p class="font-medium">Optional bootstrap / fallback</p>
          <p class="mt-0.5">ThemeParks adapter sync</p>
        </div>
      </div>
      <h3 class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">ThemeParks Selection (optional)</h3>
      <dl v-if="selectedPark" class="mt-2 space-y-1 font-mono text-xs text-slate-400">
        <div><dt class="inline text-slate-500">provider</dt> {{ selectedPark.provider }}</div>
        <div><dt class="inline text-slate-500">externalParkId</dt> {{ selectedPark.externalParkId || '—' }}</div>
        <div v-if="selectedPark.parkName"><dt class="inline text-slate-500">parkName</dt> {{ selectedPark.parkName }}</div>
        <div v-if="selectedPark.destinationName">
          <dt class="inline text-slate-500">destinationName</dt> {{ selectedPark.destinationName }}
        </div>
      </dl>
      <p v-else class="mt-2 text-xs text-slate-500">Keine ThemeParks-Auswahl in den Settings geladen.</p>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          :disabled="busy || !canSyncFromSettings"
          @click="syncFromIntegrationSettings"
        >
          Asset-Namen &amp; Asset-Daten initial/importieren (ThemeParks)
        </button>
        <RouterLink
          to="/integrations"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Datenquellen konfigurieren
        </RouterLink>
      </div>
      <p class="mt-2 text-xs text-slate-500">
        Detailpflege für Attraktionen:
        <RouterLink to="/admin/master-data/rides" class="text-brand-400 hover:underline">Attraction Asset-Daten öffnen</RouterLink>
      </p>
      <p v-if="!auth.hasPermission('integrations', 'manage')" class="mt-2 text-xs text-amber-500/90">
        `integrations.manage` erforderlich (nur für optionalen ThemeParks-Bootstrap-Sync).
      </p>
      <pre v-if="lastSync" class="mt-3 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-400">{{ JSON.stringify(lastSync, null, 2) }}</pre>
    </div>

    <div>
      <h2 class="text-sm font-medium text-white">Interne Parks (canonical)</h2>
      <ul class="mt-2 space-y-2">
        <li
          v-for="p in parks"
          :key="p.id"
          class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-sm"
        >
          <span class="font-medium text-white">{{ p.name }}</span>
          <span class="font-mono text-xs text-slate-500">{{ p.slug }}</span>
        </li>
      </ul>
      <p v-if="!busy && !parks.length" class="mt-2 text-sm text-slate-500">Noch keine Parks — zuerst Sync ausführen.</p>
    </div>
  </div>
</template>
