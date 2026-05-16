<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ApiRequestError,
  getTrafficProviders,
  listTrafficCorridors,
  putTomTomTrafficProvider,
  postTomTomTrafficProviderTest,
  type TrafficProviderConfigPublic,
} from '@/api/client'
import type { TrafficCorridorRow } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useParkContextStore } from '@/stores/parkContext'
import {
  dataFreshnessAmpel,
  dataFreshnessDotClass,
  dataFreshnessTitleDe,
} from '@/composables/trafficCorridorSnapshotDisplay'

const TRAFFIC_ROW_KEY = 'traffic_tomtom'

withDefaults(
  defineProps<{
    /** `integrations`: show link to adapter detail. `adapter-detail`: show link back to Integrations. */
    variant?: 'integrations' | 'adapter-detail'
  }>(),
  { variant: 'integrations' }
)

const { push } = useToast()
const { formatDateTime, formatRelativeTime } = useRegionalDateTime()
const parkCtx = useParkContextStore()

const trafficConfig = ref<TrafficProviderConfigPublic | null>(null)
const apiKeyDraft = ref('')
const busy = ref(false)
/** Set when GET /traffic-providers fails (any status — not only 403). */
const loadError = ref<string | null>(null)

const corridorRows = ref<TrafficCorridorRow[] | null>(null)
const corridorLoadError = ref<string | null>(null)

const latestTomtomSnapshotIso = computed(() => {
  const rows = corridorRows.value
  if (!rows?.length) return null
  let max: string | null = null
  for (const c of rows) {
    const snap = c.latestSnapshot
    if (!snap || snap.source !== 'tomtom' || !snap.snapshotTs) continue
    const ts = snap.snapshotTs
    if (!max || new Date(ts).getTime() > new Date(max).getTime()) max = ts
  }
  return max
})

const tomtomDataFreshness = computed(() =>
  dataFreshnessAmpel(latestTomtomSnapshotIso.value, trafficConfig.value?.pollIntervalMinutes ?? null)
)

async function loadCorridorFreshness() {
  corridorLoadError.value = null
  corridorRows.value = null
  const parkId = parkCtx.activeParkId
  if (!parkId) return
  try {
    if (!parkCtx.loaded) await parkCtx.hydrate()
    corridorRows.value = await listTrafficCorridors(parkId)
  } catch (e) {
    corridorLoadError.value = e instanceof Error ? e.message : String(e)
  }
}

async function load() {
  loadError.value = null
  try {
    const rows = await getTrafficProviders()
    const row = rows.find((r) => r.providerKey === TRAFFIC_ROW_KEY) || rows[0] || null
    if (!row) {
      trafficConfig.value = null
      loadError.value = 'Die API hat keine Traffic-Provider-Zeile geliefert.'
      return
    }
    trafficConfig.value = row
  } catch (e) {
    trafficConfig.value = null
    if (e instanceof ApiRequestError) {
      if (e.status === 403) {
        loadError.value =
          `Zugriff verweigert (403): ${e.message}. Deinem Konto fehlt vermutlich die Berechtigung „integrations.read“ — „Admin“ in der Anzeige ist nicht automatisch die Systemrolle ADMIN/SYSTEM_ADMIN. Rolle in der Nutzerverwaltung prüfen (z. B. OPERATIONS_MANAGER, PARK_MANAGER, OPERATOR, SYSTEM_ADMIN).`
      } else if (e.status === 401) {
        loadError.value = `Nicht angemeldet (401): ${e.message}`
      } else {
        loadError.value = `Traffic-Provider konnte nicht geladen werden (HTTP ${e.status}): ${e.message}. Bei 500 z. B. fehlende DB-Migration für traffic_provider_configs prüfen.`
      }
    } else {
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }
}

async function save() {
  const cfg = trafficConfig.value
  if (!cfg) return
  busy.value = true
  try {
    const body: {
      enabled: boolean
      pollIntervalMinutes: number
      timeoutMs: number
      baseUrl: string
      displayName?: string | null
      apiKey?: string
    } = {
      enabled: cfg.enabled,
      pollIntervalMinutes: cfg.pollIntervalMinutes,
      timeoutMs: cfg.timeoutMs,
      baseUrl: cfg.baseUrl,
      displayName: cfg.displayName,
    }
    if (apiKeyDraft.value.trim()) {
      body.apiKey = apiKeyDraft.value.trim()
    }
    trafficConfig.value = await putTomTomTrafficProvider(body)
    apiKeyDraft.value = ''
    push('TomTom traffic settings saved', 'success')
    await loadCorridorFreshness()
  } catch (e) {
    push(e instanceof Error ? e.message : 'TomTom save failed', 'error')
  } finally {
    busy.value = false
  }
}

async function testConnection() {
  busy.value = true
  try {
    const r = await postTomTomTrafficProviderTest()
    push(`TomTom test OK — travel ${r.travelTimeSeconds}s`, 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'TomTom test failed', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await load()
  if (!parkCtx.loaded) await parkCtx.hydrate()
  await loadCorridorFreshness()
})

watch(
  () => parkCtx.activeParkId,
  () => {
    void loadCorridorFreshness()
  }
)

async function reload() {
  await load()
  await loadCorridorFreshness()
}

defineExpose({ reload })
</script>

<template>
  <div class="space-y-3">
    <p v-if="variant === 'integrations'" class="text-xs text-slate-500">
      Modular adapter
      <span class="font-mono text-slate-400">traffic_tomtom</span>
      — same credentials here and under
      <RouterLink
        class="text-brand-400 hover:text-brand-300"
        :to="{ name: 'integration-detail', params: { id: encodeURIComponent('traffic_tomtom') } }"
      >
        Devices &amp; Services → TomTom Traffic
      </RouterLink>
      .
    </p>
    <p v-else class="text-xs text-slate-500">
      Same encrypted row as
      <RouterLink class="text-brand-400 hover:text-brand-300" to="/integrations#traffic-providers">
        Integration settings → Traffic providers
      </RouterLink>
      .
    </p>

    <div v-if="trafficConfig" class="space-y-3">
      <div
        v-if="parkCtx.activeParkId"
        class="rounded-lg border border-slate-800/90 bg-slate-950/50 p-3 text-xs text-slate-300"
      >
        <div class="font-medium text-slate-200">
          Korridor-Livedaten (Park: {{ parkCtx.activePark?.name || '…' }})
        </div>
        <p v-if="corridorLoadError" class="mt-1 text-amber-200/90">{{ corridorLoadError }}</p>
        <div v-else class="mt-2 flex items-start gap-2">
          <span
            class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            :class="dataFreshnessDotClass(tomtomDataFreshness)"
            :title="
              dataFreshnessTitleDe(
                tomtomDataFreshness,
                latestTomtomSnapshotIso,
                trafficConfig.pollIntervalMinutes
              )
            "
          />
          <div class="min-w-0">
            <template v-if="latestTomtomSnapshotIso">
              <div>
                Letzter <span class="font-mono text-slate-400">tomtom</span>-Snapshot:
                {{ formatDateTime(latestTomtomSnapshotIso) }}
                <span class="text-slate-500">({{ formatRelativeTime(latestTomtomSnapshotIso) }})</span>
              </div>
            </template>
            <template v-else>
              <div>Noch kein TomTom-Snapshot für einen Korridor in diesem Park.</div>
            </template>
            <p class="mt-1 text-slate-500">
              Ampel: Datenalter vs. Poll-Intervall ({{ trafficConfig.pollIntervalMinutes }} Min.). Pro Korridor:
              <RouterLink class="text-brand-400 hover:text-brand-300" :to="{ name: 'traffic-corridors' }">
                Traffic corridors
              </RouterLink>
              .
            </p>
          </div>
        </div>
      </div>
      <p v-else class="rounded-lg border border-slate-800/60 bg-slate-950/30 p-2 text-xs text-slate-500">
        Für eine Ampel / „Letzter Stand“ bitte einen Park wählen (Kontext in der App-Leiste bzw. gespeicherter
        Park). Technische Daten gelten trotzdem parkübergreifend.
      </p>
      <p class="text-xs text-slate-400">
        Stored key:
        <span class="font-mono text-slate-200">{{ trafficConfig.maskedApiKey || '—' }}</span>
      </p>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="trafficConfig.enabled" type="checkbox" class="rounded border-slate-600" />
        Enabled
      </label>
      <label class="block text-xs text-slate-400">
        New API key (optional)
        <input
          v-model="apiKeyDraft"
          type="password"
          autocomplete="new-password"
          placeholder="Leave empty to keep existing secret"
          class="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
        />
      </label>
      <div class="flex flex-wrap gap-3">
        <label class="text-xs text-slate-400">
          Poll interval (min)
          <input
            v-model.number="trafficConfig.pollIntervalMinutes"
            type="number"
            min="1"
            max="1440"
            class="mt-1 block w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          />
        </label>
        <label class="text-xs text-slate-400">
          Timeout (ms)
          <input
            v-model.number="trafficConfig.timeoutMs"
            type="number"
            min="1000"
            max="120000"
            step="500"
            class="mt-1 block w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label class="block text-xs text-slate-400">
        Base URL
        <input
          v-model="trafficConfig.baseUrl"
          type="url"
          class="mt-1 w-full max-w-2xl rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
        />
      </label>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          :disabled="busy"
          @click="save"
        >
          Save TomTom
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-40"
          :disabled="busy"
          @click="testConnection"
        >
          Test connection
        </button>
      </div>
    </div>
    <p v-else class="text-xs leading-relaxed text-amber-200/90">
      <template v-if="loadError">{{ loadError }}</template>
      <template v-else>
        Traffic provider settings could not be loaded (requires <span class="font-mono">integrations.read</span>).
      </template>
    </p>
  </div>
</template>
