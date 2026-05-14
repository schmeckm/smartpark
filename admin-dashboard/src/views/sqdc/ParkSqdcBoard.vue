<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getSqdcParkBoardHierarchical,
  type SqdcParkBoardResponse,
  type SqdcRingTone,
} from '@/api/client'
import SqdcMonthRingCard from '@/components/SqdcMonthRingCard.vue'
import SqdcOverallGaugePanel from '@/components/SqdcOverallGaugePanel.vue'
import {
  mergeLiveScoresIntoMonthRingDays,
  monthRingStatusToneFromRingDay,
  ringToneTrendLabel,
  utcCalendarTodayIso,
} from '@/utils/sqdcMonthRingHero'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const parkContext = useParkContextStore()
const { push } = useToast()

function todayIsoDate() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const parkIdParam = computed(() => String(route.params.parkId || ''))
const date = ref(todayIsoDate())
const board = ref<SqdcParkBoardResponse | null>(null)
const loading = ref(false)

/** EUR/day for C-ring: API total or sum of positive electricity + maintenance. */
const parkCostEurForRing = computed(() => {
  const b = board.value
  if (!b) return null
  const t = b.totalCostEurPerDay
  if (t != null && Number.isFinite(Number(t))) return Number(t)
  const elec = b.electricityCostEurPerDay
  const maint = b.maintenanceCostEurPerDay
  let sum = 0
  let any = false
  if (elec != null && Number(elec) > 0) {
    sum += Number(elec)
    any = true
  }
  if (maint != null && Number(maint) > 0) {
    sum += Number(maint)
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
})

const parkScoreTraffic = computed(() => board.value?.uiThresholds?.scoreRingPark ?? { greenMin: 80, amberMin: 55 })

function trafficLight(score: number | undefined | null): 'green' | 'amber' | 'red' {
  if (score == null || Number.isNaN(Number(score))) return 'amber'
  const n = Number(score)
  const g = parkScoreTraffic.value.greenMin
  const a = parkScoreTraffic.value.amberMin
  if (n >= g) return 'green'
  if (n >= a) return 'amber'
  return 'red'
}

function pillarLabelForScore(score: number | undefined | null): string {
  if (score == null || !Number.isFinite(Number(score))) return t('sqdc.pillarStatusNA')
  const l = trafficLight(score)
  if (l === 'green') return t('sqdc.pillarStatusGood')
  if (l === 'amber') return t('sqdc.pillarStatusWatch')
  return t('sqdc.pillarStatusRisk')
}

function pillarToneForScore(score: number | undefined | null): SqdcRingTone | 'neutral' {
  if (score == null || !Number.isFinite(Number(score))) return 'neutral'
  return trafficLight(score) as SqdcRingTone
}

function pillarLabelForRingTone(tone: SqdcRingTone | undefined): string {
  if (!tone || tone === 'empty') return t('sqdc.pillarStatusNA')
  if (tone === 'green') return t('sqdc.pillarStatusGood')
  if (tone === 'amber') return t('sqdc.pillarStatusWatch')
  return t('sqdc.pillarStatusRisk')
}

function ringTrendBundle() {
  return {
    up: t('sqdc.ringTrendUpBand'),
    down: t('sqdc.ringTrendDownBand'),
    flat: t('sqdc.ringTrendFlatBand'),
  }
}

const lightDot = {
  green: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]',
  amber: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]',
  red: 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.55)]',
}

const sqdcCardDims = [
  { key: 'safety' as const, label: 'S — Safety', accent: 'text-emerald-300/90' },
  { key: 'quality' as const, label: 'Q — Quality', accent: 'text-sky-300/90' },
  { key: 'delivery' as const, label: 'D — Delivery', accent: 'text-violet-300/90' },
  { key: 'customer' as const, label: 'C — Customer', accent: 'text-amber-200/90' },
]

function eventRowKey(ev: Record<string, unknown>, index: number) {
  const id = ev.id
  return typeof id === 'string' && id ? id : `ev-${index}`
}

async function syncParkFromRoute() {
  const id = parkIdParam.value
  if (!id) return
  if (parkContext.parks.some((p) => p.id === id)) parkContext.setActivePark(id)
  setApiParkContextId(id)
}

async function load() {
  const pid = parkIdParam.value
  if (!pid) {
    board.value = null
    return
  }
  loading.value = true
  try {
    await syncParkFromRoute()
    setApiParkContextId(pid)
    board.value = await getSqdcParkBoardHierarchical(pid, date.value)
  } catch (e) {
    board.value = null
    push(e instanceof Error ? e.message : t('sqdc.hierarchicalLoadError'), 'error')
  } finally {
    loading.value = false
  }
}

function onParkSelect(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value
  if (!id) return
  router.push({ name: 'sqdc-park-board', params: { parkId: id } })
}

function moodNumPark(m: Record<string, unknown>): number {
  const n = Number(m.moodScore)
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3
}

function moodEmojiPark(score: number): string {
  const em = ['😟', '😕', '😐', '🙂', '😊']
  return em[score - 1] ?? '😐'
}

function moodSpotlightShellPark(score: number): string {
  if (score <= 2) return 'border-rose-500/55 bg-rose-950/35 shadow-[0_0_24px_rgba(244,63,94,0.12)]'
  if (score === 3) return 'border-amber-500/50 bg-amber-950/30 shadow-[0_0_20px_rgba(251,191,36,0.1)]'
  return 'border-emerald-500/50 bg-emerald-950/30 shadow-[0_0_24px_rgba(52,211,153,0.12)]'
}

const latestParkMood = computed(() => {
  const rows = board.value?.moodFeedback ?? []
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => {
    const ta = String(a.createdAt ?? '')
    const tb = String(b.createdAt ?? '')
    return tb.localeCompare(ta)
  })
  return sorted[0] as Record<string, unknown>
})

const parkDowntimeMix = computed(() => {
  const rows = board.value?.downtimeEvents ?? []
  let planned = 0
  let unplanned = 0
  for (const d of rows) {
    if (d.planned) planned += 1
    else unplanned += 1
  }
  return { planned, unplanned }
})

const todayMoodAvgPark = computed(() => {
  const rows = board.value?.moodFeedback ?? []
  const ds = date.value
  const scores = rows
    .filter((m) => String(m.feedbackDate ?? '') === ds && m.moodScore != null)
    .map((m) => Number(m.moodScore))
    .filter((n) => Number.isFinite(n))
  if (!scores.length) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
})

const monthRingDays = computed(() => {
  const raw = board.value?.monthRingOverview?.days ?? []
  const b = board.value
  if (!b) return raw
  const th = b.uiThresholds
  return mergeLiveScoresIntoMonthRingDays(raw, {
    utcTodayIso: utcCalendarTodayIso(),
    selectedDateIso: date.value,
    scoreGreenMin: th?.scoreRingPark.greenMin ?? 80,
    scoreAmberMin: th?.scoreRingPark.amberMin ?? 55,
    scores: b.scores,
    costEurGreenMax: th?.ringCostEur.greenAtMost ?? 200,
    costEurAmberMax: th?.ringCostEur.amberAtMost ?? 500,
    costEurPerDayForRing: parkCostEurForRing.value,
    peopleMoodGreenMin: th?.ringPeopleMood.greenAtLeast ?? 4,
    peopleMoodAmberMin: th?.ringPeopleMood.amberAtLeast ?? 3,
    moodAvgSelectedDay: todayMoodAvgPark.value,
  })
})

const selectedDayRingRow = computed(() => monthRingDays.value.find((d) => d.date === date.value))

const parkRingHeroS = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'safety', ringTrendBundle())
  const tone = selectedDayRingRow.value?.safety
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: pillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.safety
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const parkRingHeroQ = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'quality', ringTrendBundle())
  const tone = selectedDayRingRow.value?.quality
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: pillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.quality
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const parkRingHeroD = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'delivery', ringTrendBundle())
  const tone = selectedDayRingRow.value?.delivery
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: pillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.delivery
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const parkRingHeroC = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'cost', ringTrendBundle())
  const tone = selectedDayRingRow.value?.cost
  const eur = parkCostEurForRing.value
  const has = eur != null && Number.isFinite(Number(eur))
  return {
    centerValue: has ? String(Math.round(Number(eur))) : null,
    centerUnit: has ? ' €' : null,
    statusLabel: pillarLabelForRingTone(tone),
    statusTone: monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const parkRingHeroP = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'people', ringTrendBundle())
  const tone = selectedDayRingRow.value?.people
  const avg = todayMoodAvgPark.value
  const has = avg != null && Number.isFinite(avg)
  const pct = has ? Math.round((avg / 5) * 100) : null
  return {
    centerValue: pct != null ? String(pct) : null,
    centerUnit: pct != null ? '%' : null,
    statusLabel: pillarLabelForRingTone(tone),
    statusTone: monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const ringSafety = computed(() => monthRingDays.value.map((d) => d.safety as SqdcRingTone))
const ringQuality = computed(() => monthRingDays.value.map((d) => d.quality as SqdcRingTone))
const ringDelivery = computed(() => monthRingDays.value.map((d) => d.delivery as SqdcRingTone))
const ringCost = computed(() => monthRingDays.value.map((d) => d.cost as SqdcRingTone))
const ringPeople = computed(() => monthRingDays.value.map((d) => d.people as SqdcRingTone))

function todayPillarSub(key: 'safety' | 'quality' | 'delivery' | 'customer'): string {
  const b = board.value
  if (!b?.scores) return ''
  const s = b.scores[key]
  if (s == null || !Number.isFinite(Number(s))) return ''
  return `${t('sqdc.todayShort')}: ${Number(s).toFixed(1)}`
}

const todayCostSub = computed(() => {
  const e = parkCostEurForRing.value
  if (e == null || !Number.isFinite(Number(e))) return ''
  return `${t('sqdc.todayShort')}: ${e} €`
})

const todayPeopleSub = computed(() => {
  const rows = board.value?.moodFeedback ?? []
  const ds = date.value
  const scores = rows
    .filter((m) => String(m.feedbackDate ?? '') === ds && m.moodScore != null)
    .map((m) => Number(m.moodScore))
    .filter((n) => Number.isFinite(n))
  if (!scores.length) return ''
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return `${t('sqdc.todayShort')}: Ø ${avg.toFixed(1)}/5`
})

onMounted(load)
watch([parkIdParam, date], load)
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('sqdc.hierarchicalParkTitle') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          {{ t('sqdc.hierarchicalParkSubtitle') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        <RouterLink
          class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
          to="/analytics/sqdc"
        >
          {{ t('sqdc.linkClassicBoard') }}
        </RouterLink>
      </div>
    </header>

    <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <label v-if="parkContext.parks.length > 1" class="text-xs text-slate-500">
        {{ t('sqdc.parkSelector') }}
        <select
          class="mt-1 block min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          :value="parkIdParam"
          @change="onParkSelect"
        >
          <option v-for="p in parkContext.parks" :key="p.id" :value="p.id">{{ p.name || p.slug || p.id }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('sqdc.dateUtc') }}
        <input
          v-model="date"
          type="date"
          class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        />
      </label>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="loading || !parkIdParam"
        @click="load"
      >
        {{ t('sqdc.refresh') }}
      </button>
    </div>

    <p v-if="!parkIdParam" class="text-sm text-amber-200/90">{{ t('sqdc.needParkInRoute') }}</p>
    <p v-else-if="parkContext.parks.length && !parkContext.parks.some((p) => p.id === parkIdParam)" class="text-sm text-amber-200/90">
      {{ t('sqdc.parkNotInList') }}
    </p>

    <div v-else-if="board" class="space-y-6">
      <div class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-200">{{ t('sqdc.sqdcpPillarRingsTitle') }}</h2>
          <p class="text-[10px] text-slate-500">
            {{ t('sqdc.monthAtAGlanceYm', { ym: board.monthRingOverview?.yearMonth ?? '—' }) }}
            ·
            {{ t('sqdc.monthAtAGlanceLegend') }}
          </p>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SqdcMonthRingCard
            letter="S"
            size="hero"
            :label="t('sqdc.monthRingSafety')"
            :segments="ringSafety"
            :sub-label="todayPillarSub('safety')"
            :center-value="parkRingHeroS.centerValue"
            :center-unit="parkRingHeroS.centerUnit ?? undefined"
            :status-label="parkRingHeroS.statusLabel"
            :status-tone="parkRingHeroS.statusTone"
            :trend-text="parkRingHeroS.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="Q"
            size="hero"
            :label="t('sqdc.monthRingQuality')"
            :segments="ringQuality"
            :sub-label="todayPillarSub('quality')"
            :center-value="parkRingHeroQ.centerValue"
            :center-unit="parkRingHeroQ.centerUnit ?? undefined"
            :status-label="parkRingHeroQ.statusLabel"
            :status-tone="parkRingHeroQ.statusTone"
            :trend-text="parkRingHeroQ.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="D"
            size="hero"
            :label="t('sqdc.monthRingDelivery')"
            :segments="ringDelivery"
            :sub-label="todayPillarSub('delivery')"
            :center-value="parkRingHeroD.centerValue"
            :center-unit="parkRingHeroD.centerUnit ?? undefined"
            :status-label="parkRingHeroD.statusLabel"
            :status-tone="parkRingHeroD.statusTone"
            :trend-text="parkRingHeroD.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="C"
            size="hero"
            :label="t('sqdc.monthRingCost')"
            :segments="ringCost"
            :sub-label="todayCostSub"
            :center-value="parkRingHeroC.centerValue"
            :center-unit="parkRingHeroC.centerUnit ?? undefined"
            :status-label="parkRingHeroC.statusLabel"
            :status-tone="parkRingHeroC.statusTone"
            :trend-text="parkRingHeroC.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="P"
            size="hero"
            :label="t('sqdc.monthRingPeople')"
            :segments="ringPeople"
            :sub-label="todayPeopleSub"
            :center-value="parkRingHeroP.centerValue"
            :center-unit="parkRingHeroP.centerUnit ?? undefined"
            :status-label="parkRingHeroP.statusLabel"
            :status-tone="parkRingHeroP.statusTone"
            :trend-text="parkRingHeroP.trendText ?? undefined"
          />
        </div>
        <p class="mt-3 text-center text-[10px] text-slate-600">
          {{ board.scores.source === 'STORED_SNAPSHOT' ? t('sqdc.scoreStored') : t('sqdc.scoreComputed') }}
          ·
          {{ t('sqdc.monthRingCostBands') }}
          ·
          {{ t('sqdc.monthRingPeopleBands') }}
        </p>
        <p v-if="board.uiThresholds" class="mt-2 text-center text-[10px] leading-relaxed text-slate-500">
          {{
            t('sqdc.thresholdsFromSettings', {
              pg: board.uiThresholds.scoreRingPark.greenMin,
              pa: board.uiThresholds.scoreRingPark.amberMin,
              ag: board.uiThresholds.scoreRingAsset.greenMin,
              aa: board.uiThresholds.scoreRingAsset.amberMin,
              ce: board.uiThresholds.ringCostEur.greenAtMost,
              ca: board.uiThresholds.ringCostEur.amberAtMost,
              pgM: board.uiThresholds.ringPeopleMood.greenAtLeast,
              paM: board.uiThresholds.ringPeopleMood.amberAtLeast,
            })
          }}
          <RouterLink class="text-brand-400 hover:text-brand-300" to="/admin/platform-settings">{{ t('sqdc.openPlatformSettings') }}</RouterLink>
        </p>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <SqdcOverallGaugePanel
            :overall-score="board.scores.overall"
            :selected-date="date"
            :history="board.overallScoreHistory ?? []"
          />
        </div>
        <section class="rounded-xl border border-amber-500/20 bg-slate-950/50 p-4 shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)]">
          <h3 class="text-sm font-semibold text-amber-200/95">{{ t('sqdc.costsElectricSection') }}</h3>
          <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.costsFromSnapshotHint') }}</p>
          <dl class="mt-4 space-y-3 text-xs text-slate-300">
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{
                  board.electricityCostEurPerDay != null && Number.isFinite(board.electricityCostEurPerDay)
                    ? `${board.electricityCostEurPerDay} €`
                    : '—'
                }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{
                  board.maintenanceCostEurPerDay != null && Number.isFinite(board.maintenanceCostEurPerDay)
                    ? `${board.maintenanceCostEurPerDay} €`
                    : '—'
                }}
              </dd>
            </div>
            <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
              <dt class="text-slate-500">{{ t('sqdc.operatingCostTotalCringEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{ parkCostEurForRing != null ? `${parkCostEurForRing} €` : '—' }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <section
          v-for="dim in sqdcCardDims"
          :key="dim.key"
          class="rounded-xl border border-slate-800 bg-slate-950/50 p-4"
        >
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide" :class="dim.accent">{{ dim.label }}</h2>
            <span
              class="h-3 w-3 shrink-0 rounded-full"
              :class="lightDot[trafficLight(board.scores[dim.key])]"
              :title="String(board.scores[dim.key] ?? '—')"
            />
          </div>
          <p class="mt-3 font-mono text-3xl font-semibold text-white">{{ board.scores[dim.key]?.toFixed?.(1) ?? '—' }}</p>
          <p class="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
            {{ board.scores.source === 'STORED_SNAPSHOT' ? t('sqdc.scoreStored') : t('sqdc.scoreComputed') }}
          </p>
        </section>
      </div>

      <section
        v-if="latestParkMood"
        class="rounded-xl border-2 p-4"
        :class="moodSpotlightShellPark(moodNumPark(latestParkMood))"
      >
        <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-300/90">
          {{ t('sqdc.latestMoodSpotlightPark') }}
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-4">
          <p class="text-4xl leading-none">{{ moodEmojiPark(moodNumPark(latestParkMood)) }}</p>
          <p class="font-mono text-3xl font-bold tabular-nums text-white">
            {{ moodNumPark(latestParkMood) }}<span class="text-base font-normal text-slate-400">/5</span>
          </p>
        </div>
        <p v-if="latestParkMood.comment" class="mt-2 text-sm text-slate-100">“{{ latestParkMood.comment }}”</p>
        <p v-if="latestParkMood.createdAt" class="mt-1 text-[10px] text-slate-500">{{ latestParkMood.createdAt }}</p>
      </section>

      <div class="grid gap-4 lg:grid-cols-3">
        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4 lg:col-span-2">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.activeEvents') }}</h3>
          <ul class="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs text-slate-300">
            <li
              v-for="(ev, evIdx) in board.activeEvents"
              :key="eventRowKey(ev, evIdx)"
              class="rounded border border-slate-800/80 bg-slate-900/40 p-2"
            >
              <span class="text-amber-200/80">{{ ev.eventType }}</span>
              · {{ ev.severity }}
              <span class="font-medium text-white"> {{ ev.title }}</span>
              <p class="text-[10px] text-slate-500">{{ ev.eventTime }}</p>
            </li>
            <li v-if="!board.activeEvents.length" class="text-slate-600">{{ t('sqdc.none') }}</li>
          </ul>
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.rollup') }}</h3>
          <dl class="mt-3 space-y-2 text-xs text-slate-400">
            <div class="flex justify-between gap-2"><dt>{{ t('sqdc.parkScore') }}</dt><dd class="font-mono text-white">{{ board.rollup.parkScore?.toFixed?.(1) }}</dd></div>
            <div class="flex justify-between gap-2"><dt>{{ t('sqdc.assetCount') }}</dt><dd class="font-mono text-white">{{ board.rollup.assetCount }}</dd></div>
            <div class="flex justify-between gap-2"><dt>{{ t('sqdc.openAssetIncidents') }}</dt><dd class="font-mono text-white">{{ board.rollup.openAssetIncidents }}</dd></div>
            <div class="flex justify-between gap-2"><dt>{{ t('sqdc.criticalAssets') }}</dt><dd class="font-mono text-white">{{ board.rollup.criticalAssets }}</dd></div>
          </dl>
        </section>
      </div>

      <section
        class="rounded-xl border border-violet-500/25 bg-slate-950/50 p-4 shadow-[inset_0_1px_0_0_rgba(139,92,246,0.12)]"
      >
        <h3 class="text-sm font-semibold uppercase tracking-wide text-violet-300/95">D — {{ t('sqdc.deliveryPillar') }}</h3>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.deliveryOpsSubtitle') }}</p>
        <dl class="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
          <div class="flex justify-between gap-2 sm:flex-col sm:justify-start">
            <dt>{{ t('sqdc.avgDeliverySnapshots') }}</dt>
            <dd class="font-mono text-white sm:mt-0.5">{{ board.rollup.averageDeliveryFromSnapshots ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-2 sm:flex-col sm:justify-start">
            <dt>{{ t('sqdc.avgOeeMerged') }}</dt>
            <dd class="font-mono text-white sm:mt-0.5">
              {{ board.rollup.averageOee != null ? board.rollup.averageOee.toFixed(3) : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-2 sm:flex-col sm:justify-start">
            <dt>{{ t('sqdc.avgQueueMerged') }}</dt>
            <dd class="font-mono text-white sm:mt-0.5">
              {{ board.rollup.averageQueueTime != null ? board.rollup.averageQueueTime.toFixed(1) : '—' }}
            </dd>
          </div>
        </dl>
        <p class="mt-2 text-[10px] text-violet-200/70">
          {{ t('sqdc.downtimeDeliveryMix', parkDowntimeMix) }}
        </p>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-slate-800/90 bg-slate-900/30 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-xs font-semibold text-slate-200">{{ t('sqdc.shiftHandovers') }}</h4>
              <RouterLink class="text-[10px] text-brand-400 hover:text-brand-300" to="/platform/shift-handover">
                {{ t('sqdc.openShiftHandoverUi') }} →
              </RouterLink>
            </div>
            <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.shiftHandoversHint') }}</p>
            <ul class="mt-3 max-h-52 space-y-2 overflow-y-auto text-xs text-slate-300">
              <li
                v-for="sh in board.shiftHandovers || []"
                :key="String(sh.id)"
                class="rounded border border-slate-800/80 bg-slate-950/40 p-2"
              >
                <span class="text-violet-300/90">{{ sh.scopeKind === 'ASSET' ? t('sqdc.scopeAsset') : t('sqdc.scopePark') }}</span>
                <span v-if="sh.shiftLabel" class="ml-1 font-medium text-white">{{ sh.shiftLabel }}</span>
                <p class="mt-0.5 text-[10px] text-slate-500">{{ sh.windowFrom }} → {{ sh.windowTo }}</p>
                <p v-if="sh.notes" class="mt-1 line-clamp-3 text-slate-400">{{ sh.notes }}</p>
              </li>
              <li v-if="!(board.shiftHandovers || []).length" class="text-slate-600">{{ t('sqdc.none') }}</li>
            </ul>
          </div>
          <div class="rounded-lg border border-slate-800/90 bg-slate-900/30 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-xs font-semibold text-slate-200">{{ t('sqdc.downtimeUnderDelivery') }}</h4>
              <RouterLink class="text-[10px] text-brand-400 hover:text-brand-300" to="/platform/oee">
                {{ t('sqdc.openOeeUi') }} →
              </RouterLink>
            </div>
            <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.downtimeParkHint') }}</p>
            <ul class="mt-3 max-h-52 space-y-2 overflow-y-auto text-xs text-slate-300">
              <li
                v-for="d in board.downtimeEvents || []"
                :key="String(d.id)"
                class="rounded border border-slate-800/80 bg-slate-950/40 p-2"
              >
                <RouterLink
                  v-if="d.assetId"
                  :to="{ name: 'sqdc-asset-board', params: { parkId: board.parkId, assetId: String(d.assetId) } }"
                  class="font-medium text-brand-400 hover:text-brand-300"
                >
                  {{ d.assetName || d.assetId }}
                </RouterLink>
                <span class="text-slate-500"> · {{ d.reasonCode }}</span>
                <span class="ml-1 text-amber-200/80">{{ d.planned ? t('sqdc.plannedShort') : t('sqdc.unplannedShort') }}</span>
                <p class="mt-0.5 text-[10px] text-slate-500">
                  {{ d.startedAt }}<span v-if="d.endedAt"> — {{ d.endedAt }}</span><span v-else class="text-rose-300/90"> · {{ t('sqdc.openEnded') }}</span>
                </p>
              </li>
              <li v-if="!(board.downtimeEvents || []).length" class="text-slate-600">{{ t('sqdc.none') }}</li>
            </ul>
          </div>
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.topRiskAssets') }}</h3>
          <ul class="mt-3 space-y-2 text-xs">
            <li v-for="a in board.topRiskAssets" :key="a.assetId" class="flex items-center justify-between gap-2 rounded border border-slate-800/80 bg-slate-900/30 px-2 py-1.5">
              <RouterLink
                :to="{ name: 'sqdc-asset-board', params: { parkId: board.parkId, assetId: a.assetId } }"
                class="truncate text-brand-400 hover:text-brand-300"
              >
                {{ a.label }}
              </RouterLink>
              <span class="shrink-0 font-mono text-slate-400">{{ a.deliveryScore ?? '—' }}</span>
            </li>
            <li v-if="!board.topRiskAssets.length" class="text-slate-600">{{ t('sqdc.noSnapshotRollupHint') }}</li>
          </ul>
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.aiRecommendations') }}</h3>
          <ul class="mt-3 max-h-64 space-y-3 overflow-y-auto text-xs text-slate-300">
            <li v-for="r in board.aiRecommendations" :key="r.recommendationId" class="rounded border border-slate-800/80 bg-slate-900/30 p-2">
              <p class="font-medium text-brand-300/90">{{ r.category }} · {{ r.severity }}</p>
              <p class="mt-1">{{ r.message }}</p>
              <p class="mt-1 text-[10px] text-slate-500">{{ r.suggestedAction }}</p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
