<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { SqdcAssetBoardResponse, SqdcParkBoardResponse, SqdcRingTone } from '@/api/client'
import SqdcMonthRingCard from '@/components/SqdcMonthRingCard.vue'
import SqdcOverallGaugePanel from '@/components/SqdcOverallGaugePanel.vue'
import {
  mergeLiveScoresIntoMonthRingDays,
  monthRingStatusToneFromRingDay,
  ringToneTrendLabel,
  utcCalendarTodayIso,
} from '@/utils/sqdcMonthRingHero'

const props = defineProps<{
  mode: 'park' | 'asset'
  board: SqdcParkBoardResponse | SqdcAssetBoardResponse
  selectedDate: string
}>()

const { t } = useI18n()

const parkBoard = computed(() => (props.mode === 'park' ? (props.board as SqdcParkBoardResponse) : null))
const assetBoard = computed(() => (props.mode === 'asset' ? (props.board as SqdcAssetBoardResponse) : null))

const scoreTraffic = computed(() => {
  const u = props.board.uiThresholds
  if (props.mode === 'park') return u?.scoreRingPark ?? { greenMin: 80, amberMin: 55 }
  return u?.scoreRingAsset ?? { greenMin: 80, amberMin: 55 }
})

function trafficLight(score: number | undefined | null): 'green' | 'amber' | 'red' {
  if (score == null || Number.isNaN(Number(score))) return 'amber'
  const n = Number(score)
  const g = scoreTraffic.value.greenMin
  const a = scoreTraffic.value.amberMin
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

const todayMoodAvg = computed(() => {
  const rows = props.board.moodFeedback ?? []
  const ds = props.selectedDate
  const scores = rows
    .filter((m) => String(m.feedbackDate ?? '') === ds && m.moodScore != null)
    .map((m) => Number(m.moodScore))
    .filter((n) => Number.isFinite(n))
  if (!scores.length) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
})

const electricityEurDisplay = computed(() => {
  if (props.mode === 'park') {
    const e = parkBoard.value?.electricityCostEurPerDay
    return e != null && Number.isFinite(Number(e)) ? Number(e) : null
  }
  const e = assetBoard.value?.delivery?.electricityCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

const maintenanceEurDisplay = computed(() => {
  if (props.mode === 'park') {
    const e = parkBoard.value?.maintenanceCostEurPerDay
    return e != null && Number.isFinite(Number(e)) ? Number(e) : null
  }
  const e = assetBoard.value?.delivery?.maintenanceCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

/** Same EUR basis as API C-ring: total or fallback sum of positive electricity + maintenance. */
const costEurForRing = computed(() => {
  if (props.mode === 'park') {
    const t = parkBoard.value?.totalCostEurPerDay
    if (t != null && Number.isFinite(Number(t))) return Number(t)
  } else {
    const t = assetBoard.value?.delivery?.totalCostEurPerDay
    if (t != null && Number.isFinite(Number(t))) return Number(t)
  }
  const elec = electricityEurDisplay.value
  const maint = maintenanceEurDisplay.value
  let sum = 0
  let any = false
  if (elec != null && elec > 0) {
    sum += elec
    any = true
  }
  if (maint != null && maint > 0) {
    sum += maint
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
})

/** kWh/day from asset daily snapshot delivery_json — delivery may be absent on partial API payloads. */
const assetElectricityKwhDay = computed(() => {
  const v = assetBoard.value?.delivery?.electricityKwhPerDay
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null
})

const monthRingDays = computed(() => {
  const raw = props.board.monthRingOverview?.days ?? []
  const b = props.board
  const u = b.uiThresholds
  const scorePair = props.mode === 'park' ? u?.scoreRingPark : u?.scoreRingAsset
  return mergeLiveScoresIntoMonthRingDays(raw, {
    utcTodayIso: utcCalendarTodayIso(),
    selectedDateIso: props.selectedDate,
    scoreGreenMin: scorePair?.greenMin ?? 80,
    scoreAmberMin: scorePair?.amberMin ?? 55,
    scores: b.scores,
    costEurGreenMax: u?.ringCostEur.greenAtMost ?? 200,
    costEurAmberMax: u?.ringCostEur.amberAtMost ?? 500,
    costEurPerDayForRing: costEurForRing.value,
    peopleMoodGreenMin: u?.ringPeopleMood.greenAtLeast ?? 4,
    peopleMoodAmberMin: u?.ringPeopleMood.amberAtLeast ?? 3,
    moodAvgSelectedDay: todayMoodAvg.value,
  })
})

const selectedDayRingRow = computed(() => monthRingDays.value.find((d) => d.date === props.selectedDate))

const ringHeroS = computed(() => {
  const b = props.board
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, props.selectedDate, 'safety', ringTrendBundle())
  const tone = selectedDayRingRow.value?.safety
  const n = b.scores?.safety
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const ringHeroQ = computed(() => {
  const b = props.board
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, props.selectedDate, 'quality', ringTrendBundle())
  const tone = selectedDayRingRow.value?.quality
  const n = b.scores?.quality
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const ringHeroD = computed(() => {
  const b = props.board
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, props.selectedDate, 'delivery', ringTrendBundle())
  const tone = selectedDayRingRow.value?.delivery
  const n = b.scores?.delivery
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? pillarLabelForScore(n as number) : pillarLabelForRingTone(tone),
    statusTone: has ? pillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const ringHeroC = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, props.selectedDate, 'cost', ringTrendBundle())
  const tone = selectedDayRingRow.value?.cost
  const eur = costEurForRing.value
  const has = eur != null
  return {
    centerValue: has ? String(Math.round(eur as number)) : null,
    centerUnit: has ? ' €' : null,
    statusLabel: pillarLabelForRingTone(tone),
    statusTone: monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const ringHeroP = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, props.selectedDate, 'people', ringTrendBundle())
  const tone = selectedDayRingRow.value?.people
  const avg = todayMoodAvg.value
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
  const b = props.board
  const s = b.scores?.[key]
  if (s == null || !Number.isFinite(Number(s))) return ''
  return `${t('sqdc.todayShort')}: ${Number(s).toFixed(1)}`
}

const todayCostSub = computed(() => {
  const e = costEurForRing.value
  if (e == null) return ''
  return `${t('sqdc.todayShort')}: ${e} €`
})

const todayPeopleSub = computed(() => {
  const avg = todayMoodAvg.value
  if (avg == null) return ''
  return `${t('sqdc.todayShort')}: Ø ${avg.toFixed(1)}/5`
})

const overallHistory = computed(() => props.board.overallScoreHistory ?? [])
</script>

<template>
  <div class="space-y-4">
    <p class="rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
      {{ t('sqdc.classicHierarchicalPreviewHint') }}
    </p>

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
          :center-value="ringHeroS.centerValue"
          :center-unit="ringHeroS.centerUnit ?? undefined"
          :status-label="ringHeroS.statusLabel"
          :status-tone="ringHeroS.statusTone"
          :trend-text="ringHeroS.trendText ?? undefined"
        />
        <SqdcMonthRingCard
          letter="Q"
          size="hero"
          :label="t('sqdc.monthRingQuality')"
          :segments="ringQuality"
          :sub-label="todayPillarSub('quality')"
          :center-value="ringHeroQ.centerValue"
          :center-unit="ringHeroQ.centerUnit ?? undefined"
          :status-label="ringHeroQ.statusLabel"
          :status-tone="ringHeroQ.statusTone"
          :trend-text="ringHeroQ.trendText ?? undefined"
        />
        <SqdcMonthRingCard
          letter="D"
          size="hero"
          :label="t('sqdc.monthRingDelivery')"
          :segments="ringDelivery"
          :sub-label="todayPillarSub('delivery')"
          :center-value="ringHeroD.centerValue"
          :center-unit="ringHeroD.centerUnit ?? undefined"
          :status-label="ringHeroD.statusLabel"
          :status-tone="ringHeroD.statusTone"
          :trend-text="ringHeroD.trendText ?? undefined"
        />
        <SqdcMonthRingCard
          letter="C"
          size="hero"
          :label="t('sqdc.monthRingCost')"
          :segments="ringCost"
          :sub-label="todayCostSub"
          :center-value="ringHeroC.centerValue"
          :center-unit="ringHeroC.centerUnit ?? undefined"
          :status-label="ringHeroC.statusLabel"
          :status-tone="ringHeroC.statusTone"
          :trend-text="ringHeroC.trendText ?? undefined"
        />
        <SqdcMonthRingCard
          letter="P"
          size="hero"
          :label="t('sqdc.monthRingPeople')"
          :segments="ringPeople"
          :sub-label="todayPeopleSub"
          :center-value="ringHeroP.centerValue"
          :center-unit="ringHeroP.centerUnit ?? undefined"
          :status-label="ringHeroP.statusLabel"
          :status-tone="ringHeroP.statusTone"
          :trend-text="ringHeroP.trendText ?? undefined"
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
          :selected-date="selectedDate"
          :history="overallHistory"
        />
      </div>
      <section class="rounded-xl border border-amber-500/20 bg-slate-950/50 p-4 shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)]">
        <h3 class="text-sm font-semibold text-amber-200/95">{{ t('sqdc.costsElectricSection') }}</h3>
        <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.costsFromSnapshotHint') }}</p>
        <dl class="mt-4 space-y-3 text-xs text-slate-300">
          <template v-if="mode === 'asset' && assetBoard">
            <div class="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityKwhDay') }}</dt>
              <dd class="font-mono text-white">{{ assetElectricityKwhDay != null ? assetElectricityKwhDay : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityCostEurDay') }}</dt>
              <dd class="font-mono text-white">{{ electricityEurDisplay != null ? `${electricityEurDisplay} €` : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }}</dt>
              <dd class="font-mono text-white">{{ maintenanceEurDisplay != null ? `${maintenanceEurDisplay} €` : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
              <dt class="text-slate-500">{{ t('sqdc.operatingCostTotalCringEurDay') }}</dt>
              <dd class="font-mono text-white">{{ costEurForRing != null ? `${costEurForRing} €` : '—' }}</dd>
            </div>
          </template>
          <template v-else>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{ parkBoard?.electricityCostEurPerDay != null && Number.isFinite(parkBoard.electricityCostEurPerDay) ? `${parkBoard.electricityCostEurPerDay} €` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{ parkBoard?.maintenanceCostEurPerDay != null && Number.isFinite(parkBoard.maintenanceCostEurPerDay) ? `${parkBoard.maintenanceCostEurPerDay} €` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
              <dt class="text-slate-500">{{ t('sqdc.operatingCostTotalCringEurDay') }}</dt>
              <dd class="font-mono text-white">{{ costEurForRing != null ? `${costEurForRing} €` : '—' }}</dd>
            </div>
          </template>
        </dl>
      </section>
    </div>
  </div>
</template>
