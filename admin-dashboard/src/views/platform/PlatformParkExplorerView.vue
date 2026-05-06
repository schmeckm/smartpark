<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  getIntegrationSettings,
  getPlatformParkOperationalContext,
  getPlatformParks,
  postSyncThemeParksFromSettings,
} from '@/api/client'
import type { PlatformOperationalContext, PlatformPark, ThemeParksSyncResult } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'

const { push } = useToast()
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

const selectedPark = computed(() => {
  const s = settings.value?.selectedPark as
    | { provider?: string; externalParkId?: string; parkName?: string; destinationName?: string }
    | undefined
    | null
  return s
})

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
      `Stammdaten synchron: ${lastSync.value.assetsUpserted} Assets, ${lastSync.value.observationsInserted} Observations`,
      'success'
    )
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Sync fehlgeschlagen', 'error')
  } finally {
    busy.value = false
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
      ThemeParks.wiki liefert Entities; Stammdaten landen in <span class="font-mono text-slate-300">park_assets</span>.
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
      <h2 class="text-sm font-medium text-white">Aktuelle Integration-Auswahl</h2>
      <dl v-if="selectedPark" class="mt-2 space-y-1 font-mono text-xs text-slate-400">
        <div><dt class="inline text-slate-500">provider</dt> {{ selectedPark.provider }}</div>
        <div><dt class="inline text-slate-500">externalParkId</dt> {{ selectedPark.externalParkId || '—' }}</div>
        <div v-if="selectedPark.parkName"><dt class="inline text-slate-500">parkName</dt> {{ selectedPark.parkName }}</div>
        <div v-if="selectedPark.destinationName">
          <dt class="inline text-slate-500">destinationName</dt> {{ selectedPark.destinationName }}
        </div>
      </dl>
      <p v-else class="mt-2 text-xs text-slate-500">Keine Park-Auswahl in den Settings geladen.</p>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          :disabled="busy || !canSyncFromSettings"
          @click="syncFromIntegrationSettings"
        >
          Stammdaten aus Integration settings synchronisieren
        </button>
        <RouterLink
          to="/integrations"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Zu Integration settings
        </RouterLink>
        <RouterLink
          to="/platform/assets"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Asset explorer (Stammdaten)
        </RouterLink>
      </div>
      <p v-if="!auth.hasPermission('integrations', 'manage')" class="mt-2 text-xs text-amber-500/90">
        integrations.manage erforderlich (wie „Sync entities“ in den Settings).
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
