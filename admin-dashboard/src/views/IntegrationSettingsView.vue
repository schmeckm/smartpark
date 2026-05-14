<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { CanonicalInboundMessage, ExternalEntityMapping, ProviderAdapterInfo } from '@/types/api'
import {
  getCanonicalMessages,
  getExternalEntityMappings,
  getProviderDestinations,
  getProviderParks,
  getIntegrationProviders,
  getIntegrationSettings,
  type ExternalDestinationOption,
  type ExternalParkOption,
  patchExternalEntityMapping,
  patchIntegrationSettings,
  reprocessCanonicalMessage,
  syncProviderCalendar,
  syncProviderAllParks,
  syncProviderDestinations,
  syncProviderEntities,
  syncProviderLive,
  syncProviderParks,
  getIntegrationFeatureFlags,
  postThemeparksDiscoveryScanFromSettings,
  type IntegrationFeatureFlags,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const { push } = useToast()
const { formatDateTime } = useRegionalDateTime()

const loading = ref(true)
const providers = ref<ProviderAdapterInfo[]>([])
const settings = ref<Record<string, unknown>>({})
const canonical = ref<CanonicalInboundMessage[]>([])
const mappings = ref<ExternalEntityMapping[]>([])
const destinations = ref<ExternalDestinationOption[]>([])
const parks = ref<ExternalParkOption[]>([])
const destinationQuery = ref('')
const parkQuery = ref('')

const selectedProvider = ref('themeparks_wiki')
const selectedDestinationId = ref('')
const selectedParkId = ref('')
const pollingEnabled = ref(false)
const pollingInterval = ref(300)
const autoApplyEnabled = ref(true)
const featureFlags = ref<IntegrationFeatureFlags | null>(null)
const discoveryScanBusy = ref(false)

/** Canonical orchestrator (DB, mappings, background sync) — separate from package adapters under Devices & Services. */
const showCanonicalPipelinePanel = ref(false)

const selectedProviderInfo = computed(() =>
  providers.value.find((p) => p.provider === selectedProvider.value) || null
)

const sortedDestinations = computed(() =>
  [...destinations.value].sort((a, b) => a.name.localeCompare(b.name))
)

const sortedParks = computed(() =>
  [...parks.value].sort((a, b) => a.name.localeCompare(b.name))
)

const filteredDestinations = computed(() => {
  const q = destinationQuery.value.trim().toLowerCase()
  if (!q) return sortedDestinations.value
  return sortedDestinations.value.filter((d) => d.name.toLowerCase().includes(q))
})

const filteredParks = computed(() => {
  const q = parkQuery.value.trim().toLowerCase()
  if (!q) return sortedParks.value
  return sortedParks.value.filter((p) => p.name.toLowerCase().includes(q))
})

async function refreshProviderSelectionData() {
  destinations.value = await getProviderDestinations(selectedProvider.value)
  parks.value = await getProviderParks(selectedProvider.value, selectedDestinationId.value || null)
}

async function loadAll() {
  loading.value = true
  try {
    const [p, s, c, m, ff] = await Promise.all([
      getIntegrationProviders(),
      getIntegrationSettings(),
      getCanonicalMessages({ limit: 80 }),
      getExternalEntityMappings(),
      getIntegrationFeatureFlags().catch(() => null),
    ])
    providers.value = p
    settings.value = s
    canonical.value = c
    mappings.value = m
    featureFlags.value = ff as IntegrationFeatureFlags | null

    const sp = (s.selectedProvider as { provider?: string } | undefined)?.provider
    selectedProvider.value = sp || selectedProvider.value
    selectedDestinationId.value =
      ((s.selectedDestination as { externalDestinationId?: string } | undefined)?.externalDestinationId as string) ||
      ''
    selectedParkId.value =
      ((s.selectedPark as { externalParkId?: string } | undefined)?.externalParkId as string) || ''
    pollingEnabled.value = Boolean((s.pollingEnabled as { enabled?: boolean } | undefined)?.enabled)
    pollingInterval.value = Number((s.pollingIntervalSeconds as { seconds?: number } | undefined)?.seconds || 300)
    autoApplyEnabled.value = Boolean((s.autoApplyEnabled as { enabled?: boolean } | undefined)?.enabled ?? true)
    await refreshProviderSelectionData()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load integration settings', 'error')
  } finally {
    loading.value = false
  }
}

async function runDiscoveryScan() {
  if (!featureFlags.value?.adapterDiscoverySpyEnabled) return
  discoveryScanBusy.value = true
  try {
    await postThemeparksDiscoveryScanFromSettings()
    push(t('integrationSettings.discoveryScanDone'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationSettings.discoveryScanFailed'), 'error')
  } finally {
    discoveryScanBusy.value = false
  }
}

/** Provider, destination, park, and polling only (keeps PATCH payload small and predictable). */
async function saveSelectionAndPolling() {
  try {
    await patchIntegrationSettings({
      selectedProvider: { provider: selectedProvider.value },
      selectedDestination: selectedDestinationId.value
        ? { provider: selectedProvider.value, externalDestinationId: selectedDestinationId.value }
        : null,
      selectedPark: selectedParkId.value
        ? {
            provider: selectedProvider.value,
            externalDestinationId: selectedDestinationId.value || null,
            externalParkId: selectedParkId.value,
            parkName: parks.value.find((p) => p.id === selectedParkId.value)?.name || null,
          }
        : null,
      pollingEnabled: { enabled: pollingEnabled.value },
      pollingIntervalSeconds: { seconds: pollingInterval.value },
      autoApplyEnabled: { enabled: autoApplyEnabled.value },
    })
    push('Selection & polling saved', 'success')
    await loadAll()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to save selection / polling', 'error')
  }
}

async function runSync(action: 'destinations' | 'parks' | 'entities' | 'live' | 'calendar') {
  try {
    if (action === 'destinations') await syncProviderDestinations(selectedProvider.value)
    if (action === 'parks') await syncProviderParks(selectedProvider.value, selectedDestinationId.value || null)
    if (action === 'live') await syncProviderLive(selectedProvider.value, selectedParkId.value || null)
    if (action === 'calendar') await syncProviderCalendar(selectedProvider.value, selectedParkId.value || null)

    if (action === 'entities') {
      const out = (await syncProviderEntities(
        selectedProvider.value,
        selectedParkId.value || null
      )) as Record<string, unknown>
      const pm = out.platformMasterData as
        | { error?: string; assetsUpserted?: number; parkId?: string }
        | null
        | undefined
      if (pm?.error) {
        push(
          `Asset data (park_assets) ist fehlgeschlagen — Asset data bleibt leer. API: ${String(pm.error)}`,
          'error'
        )
      } else if (pm && typeof pm.assetsUpserted === 'number') {
        push(
          `Sync entities OK. Plattform-Master-Data: ${pm.assetsUpserted} Asset(s) für diesen Park in der DB (park_assets).`,
          pm.assetsUpserted > 0 ? 'success' : 'info'
        )
      } else {
        push(
          'Sync entities abgeschlossen — kein platformMasterData (z. B. anderer Provider als themeparks_wiki).',
          'info'
        )
      }
    } else {
      push(`Sync ${action} completed`, 'success')
    }

    if (action === 'destinations' || action === 'parks') {
      await refreshProviderSelectionData()
    }
    await loadAll()
  } catch (e) {
    push(e instanceof Error ? e.message : `Sync ${action} failed`, 'error')
  }
}

async function syncAllForSelectedPark() {
  try {
    if (!selectedDestinationId.value) {
      await runSync('destinations')
      await runSync('parks')
    } else if (!parks.value.length) {
      await runSync('parks')
    }
    if (!selectedParkId.value) {
      throw new Error('Please select a park first')
    }
    await runSync('entities')
    await runSync('calendar')
    await runSync('live')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Full park sync failed', 'error')
  }
}

async function syncAllForDestination() {
  try {
    if (!selectedDestinationId.value) {
      throw new Error('Please select a destination first')
    }
    const out = await syncProviderAllParks(selectedProvider.value, selectedDestinationId.value)
    push(
      `Destination sync completed: ${out.parksProcessed}/${out.parksTotal} parks, entities ${out.entitiesMessages}, calendar ${out.calendarMessages}, live ${out.liveMessages}`,
      out.failedParks.length ? 'info' : 'success'
    )
    await loadAll()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Destination sync failed', 'error')
  }
}

async function reprocess(id: string) {
  try {
    await reprocessCanonicalMessage(id)
    push('Message reprocessed', 'success')
    await loadAll()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Reprocess failed', 'error')
  }
}

async function quickMapToRide(m: ExternalEntityMapping, rideId: string) {
  try {
    await patchExternalEntityMapping(m.id, {
      internalEntityType: 'RIDE',
      internalEntityId: rideId || null,
      mappingStatus: rideId ? 'MAPPED' : 'NEEDS_REVIEW',
    })
    push('Mapping updated', 'success')
    await loadAll()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Mapping update failed', 'error')
  }
}

onMounted(() => {
  void loadAll()
})

watch(selectedProvider, async () => {
  selectedDestinationId.value = ''
  selectedParkId.value = ''
  destinationQuery.value = ''
  parkQuery.value = ''
  try {
    await refreshProviderSelectionData()
  } catch {
    destinations.value = []
    parks.value = []
  }
})

watch(selectedDestinationId, async () => {
  parkQuery.value = ''
  try {
    parks.value = await getProviderParks(selectedProvider.value, selectedDestinationId.value || null)
  } catch {
    parks.value = []
  }
  const keep = String(selectedParkId.value || '')
  if (!keep || !parks.value.some((p) => String(p.id) === keep)) {
    selectedParkId.value = ''
  }
})
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Integration settings</h1>
      <p class="mt-1 text-sm text-slate-400">
        Steuerzentrale für Datenquellen, Park-Auswahl, Sync und UNS-Vorschau.
      </p>
      <p class="mt-2 text-sm text-slate-500">
        Adapter-Runtime / Geräte-Installationen:
        <RouterLink class="text-brand-400 hover:text-brand-300" to="/settings/devices-services">Devices &amp; Services</RouterLink>
        .
      </p>
      <p class="mt-2 text-sm text-slate-500">
        Forecast-Faktoren:
        <RouterLink class="text-brand-400 hover:text-brand-300" to="/ai-insights">AI insights</RouterLink>.
      </p>
      <p class="mt-3 rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
        {{ t('integrationSettings.discoveryHint') }}
      </p>
      <button
        v-if="featureFlags?.adapterDiscoverySpyEnabled"
        type="button"
        class="mt-2 rounded-lg border border-brand-600/50 bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-100 hover:bg-brand-950/50 disabled:opacity-50"
        :disabled="discoveryScanBusy"
        @click="runDiscoveryScan"
      >
        {{ discoveryScanBusy ? '…' : t('integrationSettings.sendDiscoveryScan') }}
      </button>
      <button
        type="button"
        class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-left text-sm text-slate-200 transition hover:border-slate-500 sm:w-auto"
        :aria-expanded="showCanonicalPipelinePanel"
        @click="showCanonicalPipelinePanel = !showCanonicalPipelinePanel"
      >
        <span class="text-slate-500">{{ showCanonicalPipelinePanel ? '▼' : '▶' }}</span>
        <span class="ml-2 font-medium">Pipeline-Einstellungen</span>
        <span class="ml-1 text-slate-500">— Provider, Park-Auswahl, Polling, manueller Sync</span>
      </button>
    </div>

    <div v-if="loading" class="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
      Loading integration configuration...
    </div>

    <template v-else>
      <div v-show="showCanonicalPipelinePanel" class="space-y-4">
      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Provider selection</h2>
        <p class="mt-1 text-xs text-slate-500">
          Core = registry sync &amp; canonical tables. <span class="text-slate-400">Package runtime</span> = separate installed adapter under
          <RouterLink class="text-brand-400/90 hover:text-brand-300" to="/settings/devices-services">Devices &amp; Services</RouterLink>.
        </p>
        <div
          v-if="selectedProviderInfo && selectedProviderInfo.runtimePackageAvailable === false"
          class="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/95"
        >
          <span class="font-medium text-amber-200">Package runtime not found</span>
          for <span class="font-mono">{{ selectedProviderInfo.provider }}</span> — integration lists and sync still use the core adapter. Install or fix the matching folder under
          <span class="font-mono text-amber-100/90">adapters/packages/{{ selectedProviderInfo.provider }}</span> or
          <span class="font-mono text-amber-100/90">integrations/adapter-packages/…</span> for package-only features (Adapter packages page).
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Core integration</span>
          <span
            v-if="selectedProviderInfo?.runtimePackageAvailable === true"
            class="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
          >Package runtime</span>
          <span
            v-else-if="selectedProviderInfo && selectedProviderInfo.runtimePackageAvailable === false"
            class="rounded-full border border-slate-600 bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >No package runtime</span>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <label class="text-xs text-slate-400"
            >Provider
            <select v-model="selectedProvider" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
              <option v-for="p in providers" :key="p.provider" :value="p.provider">
                {{ p.name }}{{ p.runtimePackageAvailable === false ? ' — core only' : '' }}
              </option>
            </select>
          </label>
          <details v-if="selectedProviderInfo" class="text-xs text-slate-400">
            <summary class="cursor-pointer text-slate-500 hover:text-slate-300">Capabilities (JSON)</summary>
            <pre class="mt-1 overflow-auto rounded-md border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-300">{{ selectedProviderInfo.capabilities }}</pre>
          </details>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Destination / park selection</h2>
        <p class="mt-1 text-xs text-amber-200/90">
          Choose a <strong class="font-medium">park</strong> and <strong class="font-medium">Save selection</strong> so orchestrator live sync and adapter fallback <span class="font-mono">parkId</span> have a UUID (not destination alone).
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <button class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" @click="runSync('destinations')">Sync destinations</button>
          <input
            v-model="destinationQuery"
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            placeholder="Search destination (A-Z)"
          />
          <select
            v-model="selectedDestinationId"
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          >
            <option value="">Select destination</option>
            <option v-for="d in filteredDestinations" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
          <button class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" @click="runSync('parks')">Sync parks</button>
          <input
            v-model="parkQuery"
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            placeholder="Search park (A-Z)"
          />
          <select
            v-model="selectedParkId"
            class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          >
            <option value="">Select park</option>
            <option v-for="p in filteredParks" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" @click="saveSelectionAndPolling">Save selection</button>
          <button class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white" @click="syncAllForSelectedPark">
            Sync all for selected park
          </button>
          <button class="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white" @click="syncAllForDestination">
            Sync all parks in destination
          </button>
        </div>
      </section>

      <section id="integration-polling" class="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Polling settings</h2>
        <p class="mt-1 text-xs text-slate-500">
          Server loop calls orchestrator <span class="font-mono">syncLive</span> on this interval when Integration polling is enabled and the platform master switch <span class="font-mono">EXTERNAL_PARK_DATA_ENABLED</span> allows it (see Platform settings). Independent of per-adapter YAML cron schedules.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <label><input v-model="pollingEnabled" type="checkbox" class="mr-2" />Polling enabled</label>
          <label><input v-model="autoApplyEnabled" type="checkbox" class="mr-2" />Auto apply</label>
          <label>Interval (s) <input v-model.number="pollingInterval" type="number" min="30" class="ml-2 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5" /></label>
          <button class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" @click="saveSelectionAndPolling">Save polling</button>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Manual sync</h2>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white" @click="runSync('entities')">Sync entities</button>
          <button class="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white" @click="runSync('live')">Sync live</button>
          <button class="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white" @click="runSync('calendar')">Sync calendar</button>
        </div>
      </section>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-white">UNS &amp; Namespace</h2>
        </div>
        <p class="mt-2 text-sm text-slate-400">
          UNS-Themenstruktur, Materialisierung und Sparkplug-Overrides werden zentral im UNS-Bereich gepflegt.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <RouterLink class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" to="/realtime/topics">
            UNS Explorer öffnen
          </RouterLink>
          <RouterLink
            class="rounded-md border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            to="/realtime/topics?mode=list"
          >
            Topic-Vorschau öffnen
          </RouterLink>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Mapping management</h2>
        <div class="mt-3 overflow-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-500">
              <tr>
                <th class="px-2 py-1 text-left">External entity</th>
                <th class="px-2 py-1 text-left">Type</th>
                <th class="px-2 py-1 text-left">Status</th>
                <th class="px-2 py-1 text-left">Internal ride id</th>
                <th class="px-2 py-1 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in mappings.slice(0, 120)" :key="m.id" class="border-t border-slate-800">
                <td class="px-2 py-1">{{ m.externalEntityName }}</td>
                <td class="px-2 py-1">{{ m.externalEntityType }}</td>
                <td class="px-2 py-1">{{ m.mappingStatus }}</td>
                <td class="px-2 py-1">{{ m.internalEntityId || '—' }}</td>
                <td class="px-2 py-1">
                  <button class="rounded border border-slate-600 px-2 py-0.5 text-[11px]" @click="quickMapToRide(m, m.internalEntityId || '')">
                    Save
                  </button>
                </td>
              </tr>
              <tr v-if="!mappings.length">
                <td colspan="5" class="px-2 py-3 text-center text-slate-500">No mappings yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Canonical message monitor</h2>
        <div class="mt-3 overflow-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-500">
              <tr>
                <th class="px-2 py-1 text-left">Type</th>
                <th class="px-2 py-1 text-left">Provider</th>
                <th class="px-2 py-1 text-left">Entity</th>
                <th class="px-2 py-1 text-left">Status</th>
                <th class="px-2 py-1 text-left">Occurred</th>
                <th class="px-2 py-1 text-left">Error</th>
                <th class="px-2 py-1 text-left"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in canonical" :key="m.id" class="border-t border-slate-800">
                <td class="px-2 py-1">{{ m.messageType }}</td>
                <td class="px-2 py-1">{{ m.provider }}</td>
                <td class="px-2 py-1">{{ m.externalEntityId || m.externalParkId || '—' }}</td>
                <td class="px-2 py-1">{{ m.status }}</td>
                <td class="px-2 py-1">{{ formatDateTime(m.occurredAt) }}</td>
                <td class="px-2 py-1 text-rose-300">{{ m.errorMessage || '—' }}</td>
                <td class="px-2 py-1">
                  <button class="rounded border border-slate-600 px-2 py-0.5 text-[11px]" @click="reprocess(m.id)">Reprocess</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 class="text-sm font-semibold text-white">Live data preview (canonical)</h2>
        <pre class="mt-3 max-h-80 overflow-auto rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">{{ canonical.slice(0, 10) }}</pre>
      </section>
    </template>
  </div>
</template>
