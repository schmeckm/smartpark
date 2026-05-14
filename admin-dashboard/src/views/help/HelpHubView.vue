<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePageSurfaces } from '@/composables/usePageSurfaces'

const { t, tm } = useI18n()
const { surfaces: ui, isLight } = usePageSurfaces()

const sectionIds = [
  'overview',
  'adapters',
  'snapshots',
  'completeness',
  'forecast',
  'factorLevels',
  'aiScreens',
  'incidents',
  'simulator',
  'permissions',
] as const

type SectionId = (typeof sectionIds)[number]

function paragraphs(id: SectionId): string[] {
  const key = `help.sections.${id}.paragraphs`
  const raw = (tm as (k: string) => unknown)(key)
  return Array.isArray(raw) ? (raw as unknown[]).map(String) : []
}

const bodyClass = computed(() =>
  isLight.value ? 'text-sm leading-relaxed text-slate-700' : 'text-sm leading-relaxed text-slate-300',
)

/** Labels reuse menu / AI view i18n keys so wording stays aligned with navigation. */
const docLinks = [
  { to: '/simulator', labelKey: 'menu.simulator' },
  { to: '/platform/oee', labelKey: 'menu.oeeDowntime' },
  { to: '/incidents', labelKey: 'menu.incidents' },
  { to: '/integrations', labelKey: 'menu.integrations' },
  { to: '/settings/devices-services', labelKey: 'menu.devicesServices' },
  { to: '/settings/adapter-pipeline-log', labelKey: 'menu.adapterOperations' },
  { to: '/realtime/topics', labelKey: 'menu.realtimeTopicExplorer' },
  { to: '/ai-insights', labelKey: 'menu.aiForecasts' },
  { to: '/ai-insights/ride-waits', labelKey: 'aiRideGrid.navLink' },
  { to: '/ai-insights/timeseries', labelKey: 'aiTimeseries.navLink' },
  { to: '/ai-insights/accuracy', labelKey: 'aiAccuracy.navLink' },
  { to: '/ai-insights/ml-global-factors', labelKey: 'aiMl.navGlobal' },
  { to: '/ai-insights/ml-park-factors', labelKey: 'aiMl.navPark' },
  { to: '/ai-insights/ml-profiles', labelKey: 'aiMl.navProfiles' },
  { to: '/ai-insights/feature-store-monitor', labelKey: 'aiMl.navMonitor' },
  { to: '/ai-insights/data-quality', labelKey: 'aiDq.title' },
  { to: '/ai-insights/studio', labelKey: 'menu.aiModelsTraining' },
] as const

const factorTableRowKeys = ['baseline', 'snapshotX', 'mlL1', 'mlL2', 'mlL3'] as const

const tableHead =
  'border-b border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-100'
const tableCell =
  'border-b border-slate-200/90 px-2 py-2 align-top text-slate-700 dark:border-slate-800 dark:text-slate-300'
const tableRowHeader = `${tableCell} font-medium text-slate-900 dark:text-slate-100`
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 md:px-6">
    <header class="mb-8">
      <h1 :class="ui.title">{{ t('help.title') }}</h1>
      <p :class="ui.subtitle">{{ t('help.subtitle') }}</p>
    </header>

    <nav :class="[ui.card, 'mb-8']" aria-label="Help sections">
      <p :class="ui.h2">{{ t('help.tocTitle') }}</p>
      <ul class="mt-3 flex flex-col gap-1.5 text-sm">
        <li v-for="id in sectionIds" :key="id">
          <a :href="'#help-' + id" class="text-brand-500 hover:underline dark:text-brand-400">{{ t(`help.sections.${id}.title`) }}</a>
        </li>
      </ul>
    </nav>

    <article :class="ui.card">
      <div class="space-y-10">
        <section v-for="id in sectionIds" :key="'s-' + id" :id="'help-' + id" class="scroll-mt-24 space-y-3">
          <h2 :class="ui.h2">{{ t(`help.sections.${id}.title`) }}</h2>
          <p v-for="(line, i) in paragraphs(id)" :key="i" :class="bodyClass">{{ line }}</p>
          <template v-if="id === 'factorLevels'">
            <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              {{ t('help.factorTable.caption') }}
            </p>
            <div
              class="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"
              role="region"
              :aria-label="t('help.factorTable.caption')"
            >
              <table class="w-full min-w-[42rem] border-collapse text-left text-xs">
                <caption class="sr-only">{{ t('help.factorTable.caption') }}</caption>
                <thead>
                  <tr>
                    <th scope="col" :class="tableHead">{{ t('help.factorTable.colLevel') }}</th>
                    <th scope="col" :class="tableHead">{{ t('help.factorTable.colStorage') }}</th>
                    <th scope="col" :class="tableHead">{{ t('help.factorTable.colPipeline') }}</th>
                    <th scope="col" :class="tableHead">{{ t('help.factorTable.colPrecedence') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rk in factorTableRowKeys" :key="rk">
                    <th scope="row" :class="tableRowHeader">{{ t(`help.factorTable.row.${rk}.level`) }}</th>
                    <td :class="tableCell">{{ t(`help.factorTable.row.${rk}.storage`) }}</td>
                    <td :class="tableCell">{{ t(`help.factorTable.row.${rk}.pipeline`) }}</td>
                    <td :class="tableCell">{{ t(`help.factorTable.row.${rk}.precedence`) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>

        <section id="help-quicklinks" class="scroll-mt-24 border-t border-slate-200 pt-8 dark:border-slate-800">
          <h2 :class="ui.h2">{{ t('help.quickLinksTitle') }}</h2>
          <ul class="mt-3 list-disc space-y-1.5 pl-5 text-sm">
            <li v-for="link in docLinks" :key="link.to">
              <RouterLink :to="link.to" class="text-brand-500 hover:underline dark:text-brand-400">
                {{ t(link.labelKey) }}
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </article>
  </div>
</template>
