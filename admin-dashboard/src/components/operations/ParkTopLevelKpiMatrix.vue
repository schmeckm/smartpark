<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  PARK_TOP_LEVEL_KPIS,
  PARK_TOP_LEVEL_KPI_CATEGORY_ORDER,
  type ParkTopLevelKpiTyp,
} from '@/constants/parkTopLevelKpis'
import { resolveParkTopLevelKpi, type ParkTopLevelKpiValueCtx } from '@/utils/parkTopLevelKpiValues'

const props = defineProps<{
  ctx: ParkTopLevelKpiValueCtx
}>()

const { t } = useI18n()

function typPillClass(typ: ParkTopLevelKpiTyp): string {
  const base = 'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide'
  switch (typ) {
    case 'live':
      return `${base} bg-emerald-500/15 text-emerald-300`
    case 'aggregated':
      return `${base} bg-sky-500/15 text-sky-300`
    case 'daily':
      return `${base} bg-amber-500/15 text-amber-200`
    case 'ai':
      return `${base} bg-violet-500/15 text-violet-200`
    case 'operational':
      return `${base} bg-slate-500/20 text-slate-300`
    case 'historical':
      return `${base} bg-zinc-600/30 text-zinc-300`
    default:
      return `${base} bg-slate-700 text-slate-400`
  }
}

const groups = computed(() =>
  PARK_TOP_LEVEL_KPI_CATEGORY_ORDER.map((category) => ({
    category,
    title: t(`parkTopLevelKpis.categories.${category}`),
    rows: PARK_TOP_LEVEL_KPIS.filter((k) => k.category === category).map((def) => {
      const resolved = resolveParkTopLevelKpi(def.id, props.ctx)
      return {
        id: def.id,
        typ: def.typ,
        typLabel: t(`parkTopLevelKpis.typ.${def.typ}`),
        name: t(`parkTopLevelKpis.kpis.${def.id}.name`),
        desc: t(`parkTopLevelKpis.kpis.${def.id}.desc`),
        valueText: resolved.valueText,
        footnoteKey: resolved.footnoteKey,
      }
    }),
  }))
)
</script>

<template>
  <section class="rounded-xl border border-slate-800 bg-slate-950/35 p-4 sm:p-5">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-slate-100">{{ t('parkTopLevelKpis.title') }}</h2>
        <p class="mt-1 max-w-3xl text-xs text-slate-500">{{ t('parkTopLevelKpis.subtitle') }}</p>
      </div>
    </div>

    <div class="mt-5 space-y-6">
      <div v-for="g in groups" :key="g.category">
        <h3 class="border-b border-slate-800/90 pb-2 text-xs font-semibold uppercase tracking-widest text-brand-400/90">
          {{ g.title }}
        </h3>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="row in g.rows"
            :key="row.id"
            class="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5"
          >
            <div class="flex items-start justify-between gap-2">
              <p class="min-w-0 text-xs font-medium leading-snug text-slate-200">{{ row.name }}</p>
              <span :class="typPillClass(row.typ)">{{ row.typLabel }}</span>
            </div>
            <p class="mt-1 font-display text-lg font-bold tabular-nums text-white">{{ row.valueText }}</p>
            <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500" :title="row.desc">{{ row.desc }}</p>
            <p v-if="row.footnoteKey" class="mt-1.5 text-[10px] leading-snug text-slate-600">
              {{ t(row.footnoteKey) }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
