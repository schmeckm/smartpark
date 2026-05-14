<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  getAdminPlatformSettings,
  patchAdminPlatformSetting,
  type AdminPlatformSettingsPayload,
  type PlatformSettingRow,
} from '@/api/client'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'

type TabId = 'AI' | 'WEATHER' | 'ADAPTERS' | 'SQDC' | 'MQTT' | 'GENERAL'

const tabs: { id: TabId; label: string }[] = [
  { id: 'AI', label: 'AI' },
  { id: 'WEATHER', label: 'Weather' },
  { id: 'ADAPTERS', label: 'Adapters & Integrations' },
  { id: 'SQDC', label: 'SQDCP' },
  { id: 'MQTT', label: 'MQTT' },
  { id: 'GENERAL', label: 'General' },
]

const { surfaces: ui } = usePageSurfaces()
const { push } = useToast()

const activeTab = ref<TabId>('AI')
const loading = ref(false)
const savingKey = ref<string | null>(null)
const payload = ref<AdminPlatformSettingsPayload | null>(null)
/** Row key → local edit value */
const edits = ref<Record<string, string | number | boolean>>({})

const friendlyLabels: Record<string, string> = {
  AI_SAMPLING_ENABLED: 'Enable AI sampling pipeline',
  AI_SAMPLING_INTERVAL_SECONDS: 'AI sampling interval (seconds)',
  AI_SAMPLING_ALIGN_TO_5M_UTC: 'Align AI pipeline ticks to 5-minute UTC buckets',
  WEATHER_OPEN_METEO_ENABLED: 'Enable Open-Meteo weather scheduler',
  WEATHER_OPEN_METEO_INTERVAL_SECONDS: 'Weather poll interval (seconds)',
  WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS: 'Rebuild feature snapshots after weather ingest',
  WEATHER_OPEN_METEO_FETCH_RETRIES: 'Open-Meteo HTTP retries per park',
  WEATHER_OPEN_METEO_RETRY_BASE_MS: 'Retry base delay (ms)',
  ADAPTER_SCHEDULER_ENABLED: 'Run adapter cron scheduler (API)',
  EXTERNAL_PARK_DATA_ENABLED: 'Allow external park live polling (platform master)',
  EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS: 'Bootstrap default poll interval (seconds)',
  EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC: 'Nudge polls toward 5-minute UTC boundaries',
  EXTERNAL_PARK_DATA_DEFAULT_PROVIDER: 'Bootstrap default provider key',
  SQDC_SCORE_RING_PARK_GREEN_MIN: 'Park board — month rings S/Q/D: green from score ≥',
  SQDC_SCORE_RING_PARK_AMBER_MIN: 'Park board — month rings S/Q/D: amber from score ≥',
  SQDC_SCORE_RING_ASSET_GREEN_MIN: 'Asset board — month rings S/Q/D: green from score ≥',
  SQDC_SCORE_RING_ASSET_AMBER_MIN: 'Asset board — month rings S/Q/D: amber from score ≥',
  SQDC_RING_COST_EUR_GREEN_MAX: 'Cost ring (C): daily electricity €/day ≤ this → green',
  SQDC_RING_COST_EUR_AMBER_MAX: 'Cost ring (C): ≤ this € (and above green max) → amber',
  SQDC_RING_PEOPLE_MOOD_GREEN_MIN: 'People ring (P): average mood ≥ this → green (1–5)',
  SQDC_RING_PEOPLE_MOOD_AMBER_MIN: 'People ring (P): average mood ≥ this → amber (1–5)',
}

/** Keys shown under “cron”; external section only surfaces the master switch (interval/provider stay in Integrations). */
const ADAPTER_CRON_KEYS = ['ADAPTER_SCHEDULER_ENABLED'] as const
const ADAPTER_EXTERNAL_KEYS = ['EXTERNAL_PARK_DATA_ENABLED'] as const
/** Shown only under Advanced (seed / emergency; normal ops use Integrations). */
const ADAPTER_ADVANCED_KEYS = [
  'EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS',
  'EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC',
  'EXTERNAL_PARK_DATA_DEFAULT_PROVIDER',
] as const

function syncEditsFromRows(rows: PlatformSettingRow[]) {
  const next: Record<string, string | number | boolean> = {}
  for (const r of rows) {
    next[r.settingKey] = r.effectiveValue as string | number | boolean
  }
  edits.value = next
}

async function load() {
  loading.value = true
  try {
    const cat =
      activeTab.value === 'MQTT' || activeTab.value === 'GENERAL'
        ? undefined
        : activeTab.value === 'SQDC'
          ? 'SQDC'
          : activeTab.value
    const data = await getAdminPlatformSettings(cat)
    payload.value = data
    if (cat) syncEditsFromRows(data.settings)
  } catch (e) {
    payload.value = null
    push(e instanceof Error ? e.message : 'Failed to load platform settings', 'error')
  } finally {
    loading.value = false
  }
}

watch(activeTab, () => void load(), { immediate: true })

const mqttBlock = computed(() => payload.value?.mqtt ?? null)
const generalBlock = computed(() => payload.value?.general ?? null)

const rowsForTab = computed(() => {
  if (!payload.value) return []
  if (activeTab.value === 'MQTT' || activeTab.value === 'GENERAL') return []
  return payload.value.settings
})


const adapterSections = computed(() => {
  if (activeTab.value !== 'ADAPTERS' || !payload.value?.settings?.length) return null
  const byKey = new Map(payload.value.settings.map((r) => [r.settingKey, r]))
  const pick = (keys: readonly string[]) =>
    keys.map((k) => byKey.get(k)).filter((r): r is PlatformSettingRow => Boolean(r))
  return [
    {
      id: 'cron',
      title: 'Installed adapters — cron runner',
      body: 'Each adapter keeps its own schedule (e.g. scheduleCron in install metadata). This toggle only starts or stops the API job that evaluates those schedules—it does not replace them.',
      link: { to: '/settings/devices-services', label: 'Devices & Services' },
      rows: pick(ADAPTER_CRON_KEYS),
    },
    {
      id: 'external',
      title: 'External park live sync — Integrations',
      body: 'Polling on/off, interval, and provider are edited under Integration settings. Here you only set the platform-wide master switch (operations can still disable live sync globally even if Integration polling is on).',
      link: { to: '/integrations#integration-polling', label: 'Integration settings — interval & provider' },
      rows: pick(ADAPTER_EXTERNAL_KEYS),
    },
  ] as const
})

const adapterAdvancedRows = computed(() => {
  if (activeTab.value !== 'ADAPTERS' || !payload.value?.settings?.length) return []
  const allow = new Set<string>(ADAPTER_ADVANCED_KEYS)
  return payload.value.settings.filter((r) => allow.has(r.settingKey))
})

function isDirty(row: PlatformSettingRow): boolean {
  const cur = edits.value[row.settingKey]
  return cur !== undefined && cur !== row.effectiveValue
}

async function saveRow(row: PlatformSettingRow) {
  const v = edits.value[row.settingKey]
  savingKey.value = row.settingKey
  try {
    await patchAdminPlatformSetting(row.settingKey, v as boolean | number | string)
    push(
      `Saved ${friendlyLabels[row.settingKey] || row.settingKey}. Schedulers use cached values within ~1 minute.`,
      'success'
    )
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    savingKey.value = null
  }
}

function resetRow(row: PlatformSettingRow) {
  edits.value[row.settingKey] = row.effectiveValue as string | number | boolean
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/settings" class="text-sm text-brand-400 hover:text-brand-300">← Settings</RouterLink>
    <div>
      <h1 :class="ui.title">Platform settings</h1>
      <p :class="ui.subtitle">
        System-wide schedulers and integrations. Values resolve as: database → environment variable → built-in default.
        Changes are written to the audit log. Use the sidebar (Governance) or Settings to reach this page.
      </p>
    </div>

    <div class="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="rounded-md px-3 py-1.5 text-sm font-medium transition"
        :class="
          activeTab === t.id
            ? 'bg-brand-600 text-white'
            : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
        "
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" :class="ui.card">Loading…</div>

    <template v-else-if="activeTab === 'MQTT' && mqttBlock">
      <div :class="ui.card" class="space-y-3 text-sm">
        <p class="text-slate-400">
          MQTT connection is configured via deployment environment (Docker Compose / host env). Read-only summary:
        </p>
        <div><span class="text-slate-500">Enabled</span> {{ mqttBlock.mqttEnabled ? 'yes' : 'no' }}</div>
        <div class="break-all">
          <span class="text-slate-500">Broker URL</span> {{ mqttBlock.mqttBrokerUrl }}
        </div>
        <div><span class="text-slate-500">Client ID</span> {{ mqttBlock.mqttClientId }}</div>
        <div>
          <span class="text-slate-500">Username configured</span> {{ mqttBlock.mqttUsernameConfigured ? 'yes' : 'no' }}
        </div>
      </div>
    </template>

    <template v-else-if="activeTab === 'GENERAL' && generalBlock">
      <div :class="ui.card" class="space-y-3 text-sm">
        <p class="text-slate-400">
          General runtime hints from environment (not stored in <code class="text-xs">platform_settings</code>).
        </p>
        <div><span class="text-slate-500">NODE_ENV</span> {{ generalBlock.nodeEnv }}</div>
        <div><span class="text-slate-500">PORT</span> {{ generalBlock.port }}</div>
        <div class="break-all"><span class="text-slate-500">CORS origin</span> {{ generalBlock.corsOrigin }}</div>
      </div>
    </template>

    <div v-else-if="adapterSections" class="space-y-10">
      <section v-for="sec in adapterSections" :key="sec.id" class="space-y-4">
        <div :class="ui.card" class="border-slate-700/80 !py-4">
          <h2 class="text-base font-semibold text-white">{{ sec.title }}</h2>
          <p class="mt-2 text-sm leading-relaxed text-slate-400">{{ sec.body }}</p>
          <RouterLink
            :to="sec.link.to"
            class="mt-3 inline-block text-sm font-medium text-brand-400 hover:text-brand-300"
          >
            {{ sec.link.label }} →
          </RouterLink>
        </div>
        <div
          v-for="row in sec.rows"
          :key="row.settingKey"
          :class="ui.card"
          class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0 flex-1 space-y-1">
            <div class="font-medium text-white">{{ friendlyLabels[row.settingKey] || row.settingKey }}</div>
            <p v-if="row.description" class="text-sm text-slate-400">{{ row.description }}</p>
            <div class="font-mono text-xs text-slate-500">
              {{ row.settingKey }} · type {{ row.valueType }} · source {{ row.resolvedSource }}
            </div>
          </div>
          <div class="flex shrink-0 flex-col gap-2 sm:w-64">
            <template v-if="row.valueType === 'boolean'">
              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input v-model="edits[row.settingKey]" type="checkbox" class="rounded border-slate-600" />
                Enabled
              </label>
            </template>
            <template v-else-if="row.valueType === 'number'">
              <input
                v-model.number="edits[row.settingKey]"
                type="number"
                :class="ui.control"
                class="font-mono text-sm"
              />
            </template>
            <template v-else>
              <input v-model="edits[row.settingKey]" type="text" :class="ui.control" class="font-mono text-sm" />
            </template>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                :disabled="!isDirty(row) || savingKey === row.settingKey"
                @click="saveRow(row)"
              >
                Save
              </button>
              <button
                type="button"
                class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                :disabled="!isDirty(row)"
                @click="resetRow(row)"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </section>

      <details
        v-if="adapterAdvancedRows.length"
        class="rounded-lg border border-slate-700/80 bg-slate-900/40 px-4 py-3 text-sm text-slate-300"
      >
        <summary class="cursor-pointer select-none font-medium text-slate-200">
          Advanced — bootstrap defaults (external park)
        </summary>
        <p class="mt-2 text-xs leading-relaxed text-slate-500">
          Used when Integration settings have no saved interval/provider yet, or for recovery via API. Day-to-day polling:
          <RouterLink to="/integrations#integration-polling" class="text-brand-400 hover:text-brand-300">
            Integrations → Polling
          </RouterLink>
          .
        </p>
        <div class="mt-4 space-y-4">
          <div
            v-for="row in adapterAdvancedRows"
            :key="row.settingKey"
            :class="ui.card"
            class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div class="min-w-0 flex-1 space-y-1">
              <div class="font-medium text-white">{{ friendlyLabels[row.settingKey] || row.settingKey }}</div>
              <p v-if="row.description" class="text-sm text-slate-400">{{ row.description }}</p>
              <div class="font-mono text-xs text-slate-500">
                {{ row.settingKey }} · type {{ row.valueType }} · source {{ row.resolvedSource }}
              </div>
            </div>
            <div class="flex shrink-0 flex-col gap-2 sm:w-64">
              <template v-if="row.valueType === 'boolean'">
                <label class="flex items-center gap-2 text-sm text-slate-300">
                  <input v-model="edits[row.settingKey]" type="checkbox" class="rounded border-slate-600" />
                  Enabled
                </label>
              </template>
              <template v-else-if="row.valueType === 'number'">
                <input
                  v-model.number="edits[row.settingKey]"
                  type="number"
                  :class="ui.control"
                  class="font-mono text-sm"
                />
              </template>
              <template v-else>
                <input v-model="edits[row.settingKey]" type="text" :class="ui.control" class="font-mono text-sm" />
              </template>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  :disabled="!isDirty(row) || savingKey === row.settingKey"
                  @click="saveRow(row)"
                >
                  Save
                </button>
                <button
                  type="button"
                  class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  :disabled="!isDirty(row)"
                  @click="resetRow(row)"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>

    <div v-else-if="rowsForTab.length" class="space-y-4">
      <div v-if="activeTab === 'SQDC'" :class="ui.card" class="space-y-2 text-sm leading-relaxed text-slate-400">
        <h2 class="text-base font-semibold text-white">SQDCP — UI thresholds</h2>
        <p>
          <strong class="text-slate-200">Park (level 0)</strong> uses the first two numbers for
          <span class="text-slate-300">month rings S/Q/D</span> built from <span class="font-mono text-xs">PARK</span> daily
          snapshots. <strong class="text-slate-200">Asset (level 3)</strong> uses the next pair for rings from
          <span class="font-mono text-xs">ASSET</span> snapshots.           <strong class="text-slate-200">Cost ring (C)</strong> uses the daily sum of positive
          <span class="font-mono text-xs">electricityCostEurPerDay</span> and
          <span class="font-mono text-xs">maintenanceCostEurPerDay</span> in snapshot
          <span class="font-mono text-xs">delivery_json</span>.
          <strong class="text-slate-200">People ring (P)</strong> uses average mood 1–5 per UTC day.
        </p>
        <p class="text-xs text-slate-500">
          Park score traffic-light dots use the <span class="font-mono">park</span> green/amber band. “Critical assets” on
          the park roll-up counts assets with delivery score below the <span class="font-mono">asset</span> amber line.
        </p>
      </div>
      <div
        v-for="row in rowsForTab"
        :key="row.settingKey"
        :class="ui.card"
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <div class="font-medium text-white">{{ friendlyLabels[row.settingKey] || row.settingKey }}</div>
          <p v-if="row.description" class="text-sm text-slate-400">{{ row.description }}</p>
          <div class="font-mono text-xs text-slate-500">
            {{ row.settingKey }} · type {{ row.valueType }} · source {{ row.resolvedSource }}
          </div>
        </div>
        <div class="flex shrink-0 flex-col gap-2 sm:w-64">
          <template v-if="row.valueType === 'boolean'">
            <label class="flex items-center gap-2 text-sm text-slate-300">
              <input v-model="edits[row.settingKey]" type="checkbox" class="rounded border-slate-600" />
              Enabled
            </label>
          </template>
          <template v-else-if="row.valueType === 'number'">
            <input
              v-model.number="edits[row.settingKey]"
              type="number"
              :class="ui.control"
              class="font-mono text-sm"
            />
          </template>
          <template v-else>
            <input v-model="edits[row.settingKey]" type="text" :class="ui.control" class="font-mono text-sm" />
          </template>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              :disabled="!isDirty(row) || savingKey === row.settingKey"
              @click="saveRow(row)"
            >
              Save
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              :disabled="!isDirty(row)"
              @click="resetRow(row)"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
