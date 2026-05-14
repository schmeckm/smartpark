<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getSqdcAssetBoardHierarchical,
  listMasterData,
  postSqdcBoardEvent,
  postSqdcDailySnapshot,
  postSqdcMoodFeedback,
  type MasterDataGridRow,
  type SqdcAssetBoardResponse,
  type SqdcRingTone,
} from '@/api/client'
import { useParkContextStore } from '@/stores/parkContext'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useToast } from '@/composables/useToast'
import SqdcMonthRingCard from '@/components/SqdcMonthRingCard.vue'
import SqdcOverallGaugePanel from '@/components/SqdcOverallGaugePanel.vue'
import {
  mergeLiveScoresIntoMonthRingDays,
  monthRingStatusToneFromRingDay,
  ringToneTrendLabel,
  utcCalendarTodayIso,
} from '@/utils/sqdcMonthRingHero'

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
const assetIdParam = computed(() => String(route.params.assetId || ''))

const date = ref(todayIsoDate())
const board = ref<SqdcAssetBoardResponse | null>(null)
const rides = ref<MasterDataGridRow[]>([])
const rideSearch = ref('')
const loading = ref(false)

const assetElectricityKwhDisplay = computed(() => {
  const k = board.value?.delivery?.electricityKwhPerDay
  return k != null && Number.isFinite(Number(k)) ? Number(k) : null
})
const assetElectricityEurDisplay = computed(() => {
  const e = board.value?.delivery?.electricityCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

const assetMaintenanceEurDisplay = computed(() => {
  const e = board.value?.delivery?.maintenanceCostEurPerDay
  return e != null && Number.isFinite(Number(e)) ? Number(e) : null
})

const assetCostEurForRing = computed(() => {
  const d = board.value?.delivery
  if (!d) return null
  const t = d.totalCostEurPerDay
  if (t != null && Number.isFinite(Number(t))) return Number(t)
  const elec = d.electricityCostEurPerDay
  const maint = d.maintenanceCostEurPerDay
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

const evTitle = ref('')
const evType = ref<'SAFETY' | 'QUALITY' | 'DELIVERY' | 'CUSTOMER' | 'PEOPLE' | 'MAINTENANCE'>('DELIVERY')
const evSeverity = ref<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM')
const evDesc = ref('')

const moodScore = ref(4)
const moodComment = ref('')
const highlightMoodId = ref('')
const moodSpotlightRef = ref<HTMLElement | null>(null)
let highlightMoodTimer: ReturnType<typeof setTimeout> | undefined

function moodNum(m: Record<string, unknown>): number {
  const n = Number(m.moodScore)
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3
}

function moodEmoji(score: number): string {
  const em = ['😟', '😕', '😐', '🙂', '😊']
  return em[score - 1] ?? '😐'
}

function moodSpotlightShell(score: number): string {
  if (score <= 2) return 'border-rose-500/55 bg-rose-950/35 shadow-[0_0_24px_rgba(244,63,94,0.12)]'
  if (score === 3) return 'border-amber-500/50 bg-amber-950/30 shadow-[0_0_20px_rgba(251,191,36,0.1)]'
  return 'border-emerald-500/50 bg-emerald-950/30 shadow-[0_0_24px_rgba(52,211,153,0.12)]'
}

function moodRowClasses(m: Record<string, unknown>, mIdx: number): string {
  const id = m.id != null ? String(m.id) : ''
  const isJustSaved = Boolean(highlightMoodId.value && id && id === highlightMoodId.value)
  const isLatest = mIdx === 0
  if (isJustSaved) {
    return 'rounded-md border border-brand-400/90 bg-brand-950/50 px-2 py-2 ring-2 ring-brand-400/60'
  }
  if (isLatest) {
    return 'rounded-md border border-amber-500/40 bg-slate-900/70 px-2 py-2'
  }
  return 'rounded-md border border-transparent px-2 py-1.5'
}

const snapOee = ref('')
const snapQueue = ref('')
const snapElectricityKwh = ref('')
const snapElectricityCostEur = ref('')
const snapMaintenanceCostEur = ref('')

function eventRowKey(ev: Record<string, unknown>, index: number) {
  const id = ev.id
  return typeof id === 'string' && id ? id : `ev-${index}`
}

function moodRowKey(m: Record<string, unknown>, index: number) {
  const id = m.id
  return typeof id === 'string' && id ? id : `mood-${index}`
}

const assetTitle = computed(() => {
  const a = board.value?.asset
  if (a && typeof a === 'object' && 'name' in a && a.name != null) return String(a.name)
  return ''
})

const assetDowntimeMix = computed(() => {
  const rows = board.value?.downtimeEvents ?? []
  let planned = 0
  let unplanned = 0
  for (const d of rows) {
    if (d.planned) planned += 1
    else unplanned += 1
  }
  return { planned, unplanned }
})

const todayMoodAvgAsset = computed(() => {
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
    scoreGreenMin: th?.scoreRingAsset.greenMin ?? 80,
    scoreAmberMin: th?.scoreRingAsset.amberMin ?? 55,
    scores: b.scores,
    costEurGreenMax: th?.ringCostEur.greenAtMost ?? 200,
    costEurAmberMax: th?.ringCostEur.amberAtMost ?? 500,
    costEurPerDayForRing: assetCostEurForRing.value,
    peopleMoodGreenMin: th?.ringPeopleMood.greenAtLeast ?? 4,
    peopleMoodAmberMin: th?.ringPeopleMood.amberAtLeast ?? 3,
    moodAvgSelectedDay: todayMoodAvgAsset.value,
  })
})

const ringSafety = computed(() => monthRingDays.value.map((d) => d.safety as SqdcRingTone))
const ringQuality = computed(() => monthRingDays.value.map((d) => d.quality as SqdcRingTone))
const ringDelivery = computed(() => monthRingDays.value.map((d) => d.delivery as SqdcRingTone))
const ringCost = computed(() => monthRingDays.value.map((d) => d.cost as SqdcRingTone))
const ringPeople = computed(() => monthRingDays.value.map((d) => d.people as SqdcRingTone))

const assetScoreTraffic = computed(() => board.value?.uiThresholds?.scoreRingAsset ?? { greenMin: 80, amberMin: 55 })

function trafficLightAsset(score: number | undefined | null): 'green' | 'amber' | 'red' {
  if (score == null || Number.isNaN(Number(score))) return 'amber'
  const n = Number(score)
  const g = assetScoreTraffic.value.greenMin
  const a = assetScoreTraffic.value.amberMin
  if (n >= g) return 'green'
  if (n >= a) return 'amber'
  return 'red'
}

function assetPillarLabelForScore(score: number | undefined | null): string {
  if (score == null || !Number.isFinite(Number(score))) return t('sqdc.pillarStatusNA')
  const l = trafficLightAsset(score)
  if (l === 'green') return t('sqdc.pillarStatusGood')
  if (l === 'amber') return t('sqdc.pillarStatusWatch')
  return t('sqdc.pillarStatusRisk')
}

function assetPillarToneForScore(score: number | undefined | null): SqdcRingTone | 'neutral' {
  if (score == null || !Number.isFinite(Number(score))) return 'neutral'
  return trafficLightAsset(score) as SqdcRingTone
}

function assetPillarLabelForRingTone(tone: SqdcRingTone | undefined): string {
  if (!tone || tone === 'empty') return t('sqdc.pillarStatusNA')
  if (tone === 'green') return t('sqdc.pillarStatusGood')
  if (tone === 'amber') return t('sqdc.pillarStatusWatch')
  return t('sqdc.pillarStatusRisk')
}

function assetRingTrendBundle() {
  return {
    up: t('sqdc.ringTrendUpBand'),
    down: t('sqdc.ringTrendDownBand'),
    flat: t('sqdc.ringTrendFlatBand'),
  }
}

const selectedDayRingRowAsset = computed(() => monthRingDays.value.find((d) => d.date === date.value))

const assetRingHeroS = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'safety', assetRingTrendBundle())
  const tone = selectedDayRingRowAsset.value?.safety
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: assetPillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.safety
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? assetPillarLabelForScore(n as number) : assetPillarLabelForRingTone(tone),
    statusTone: has ? assetPillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const assetRingHeroQ = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'quality', assetRingTrendBundle())
  const tone = selectedDayRingRowAsset.value?.quality
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: assetPillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.quality
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? assetPillarLabelForScore(n as number) : assetPillarLabelForRingTone(tone),
    statusTone: has ? assetPillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const assetRingHeroD = computed(() => {
  const b = board.value
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'delivery', assetRingTrendBundle())
  const tone = selectedDayRingRowAsset.value?.delivery
  if (!b?.scores) {
    return {
      centerValue: null as string | null,
      centerUnit: null as string | null,
      statusLabel: assetPillarLabelForRingTone(tone),
      statusTone: monthRingStatusToneFromRingDay(tone),
      trendText: tr,
    }
  }
  const n = b.scores.delivery
  const has = n != null && Number.isFinite(Number(n))
  return {
    centerValue: has ? String(Math.round(Number(n))) : null,
    centerUnit: has ? '%' : null,
    statusLabel: has ? assetPillarLabelForScore(n as number) : assetPillarLabelForRingTone(tone),
    statusTone: has ? assetPillarToneForScore(n as number) : monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const assetRingHeroC = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'cost', assetRingTrendBundle())
  const tone = selectedDayRingRowAsset.value?.cost
  const eur = assetCostEurForRing.value
  const has = eur != null && Number.isFinite(Number(eur))
  return {
    centerValue: has ? String(Math.round(Number(eur))) : null,
    centerUnit: has ? ' €' : null,
    statusLabel: assetPillarLabelForRingTone(tone),
    statusTone: monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

const assetRingHeroP = computed(() => {
  const days = monthRingDays.value
  const tr = ringToneTrendLabel(days, date.value, 'people', assetRingTrendBundle())
  const tone = selectedDayRingRowAsset.value?.people
  const avg = todayMoodAvgAsset.value
  const has = avg != null && Number.isFinite(avg)
  const pct = has ? Math.round((avg / 5) * 100) : null
  return {
    centerValue: pct != null ? String(pct) : null,
    centerUnit: pct != null ? '%' : null,
    statusLabel: assetPillarLabelForRingTone(tone),
    statusTone: monthRingStatusToneFromRingDay(tone),
    trendText: tr,
  }
})

function todayPillarSub(key: 'safety' | 'quality' | 'delivery' | 'customer'): string {
  const b = board.value
  if (!b?.scores) return ''
  const s = b.scores[key]
  if (s == null || !Number.isFinite(Number(s))) return ''
  return `${t('sqdc.todayShort')}: ${Number(s).toFixed(1)}`
}

const todayCostSub = computed(() => {
  const e = assetCostEurForRing.value
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

const latestMood = computed(() => {
  const rows = board.value?.moodFeedback ?? []
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => {
    const ta = String(a.createdAt ?? '')
    const tb = String(b.createdAt ?? '')
    return tb.localeCompare(ta)
  })
  return sorted[0] as Record<string, unknown>
})

const filteredRides = computed(() => {
  const q = rideSearch.value.trim().toLowerCase()
  let list = rides.value
  if (q) {
    list = list.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.slug || '').toLowerCase().includes(q) ||
        String(r.id).toLowerCase().includes(q)
    )
  }
  const aid = assetIdParam.value
  if (aid && !list.some((r) => r.id === aid)) {
    const sel = rides.value.find((r) => r.id === aid)
    if (sel) return [sel, ...list]
  }
  return list
})

async function loadRides() {
  const pid = parkIdParam.value
  if (!pid) {
    rides.value = []
    return
  }
  const pageSize = 200
  const acc: MasterDataGridRow[] = []
  try {
    setApiParkContextId(pid)
    for (let page = 0; page < 40; page += 1) {
      const res = await listMasterData('rides', { parkId: pid, page, pageSize })
      acc.push(...res.rows)
      if (res.rows.length < pageSize) break
      if (acc.length >= res.total) break
    }
    rides.value = acc.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
  } catch {
    rides.value = []
  }
}

async function syncPark() {
  const pid = parkIdParam.value
  if (pid && parkContext.parks.some((p) => p.id === pid)) parkContext.setActivePark(pid)
  if (pid) setApiParkContextId(pid)
}

async function loadBoard() {
  const pid = parkIdParam.value
  const aid = assetIdParam.value
  if (!pid || !aid) {
    board.value = null
    return
  }
  loading.value = true
  try {
    await syncPark()
    setApiParkContextId(pid)
    board.value = await getSqdcAssetBoardHierarchical(pid, aid, date.value)
  } catch (e) {
    board.value = null
    push(e instanceof Error ? e.message : t('sqdc.hierarchicalLoadError'), 'error')
  } finally {
    loading.value = false
  }
}

function onAssetSelect(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value
  if (!id || !parkIdParam.value) return
  router.push({ name: 'sqdc-asset-board', params: { parkId: parkIdParam.value, assetId: id } })
}

async function submitEvent() {
  const pid = parkIdParam.value
  if (!pid || !evTitle.value.trim()) return
  try {
    setApiParkContextId(pid)
    await postSqdcBoardEvent({
      assetId: assetIdParam.value,
      eventType: evType.value,
      severity: evSeverity.value,
      title: evTitle.value.trim(),
      description: evDesc.value.trim() || null,
    })
    evTitle.value = ''
    evDesc.value = ''
    push(t('sqdc.eventCreated'), 'success')
    await loadBoard()
  } catch (e) {
    push(e instanceof Error ? e.message : t('sqdc.eventFailed'), 'error')
  }
}

async function submitMood() {
  const pid = parkIdParam.value
  if (!pid) return
  try {
    setApiParkContextId(pid)
    const row = await postSqdcMoodFeedback({
      assetId: assetIdParam.value,
      feedbackDate: date.value,
      moodScore: moodScore.value,
      comment: moodComment.value.trim() || null,
    })
    const newId = row?.id != null ? String(row.id) : ''
    if (newId) {
      highlightMoodId.value = newId
      if (highlightMoodTimer) clearTimeout(highlightMoodTimer)
      highlightMoodTimer = setTimeout(() => {
        highlightMoodId.value = ''
        highlightMoodTimer = undefined
      }, 14000)
    }
    moodComment.value = ''
    push(t('sqdc.moodSaved'), 'success')
    await loadBoard()
    await nextTick()
    moodSpotlightRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch (e) {
    push(e instanceof Error ? e.message : t('sqdc.moodFailed'), 'error')
  }
}

async function saveSnapshot() {
  const pid = parkIdParam.value
  const aid = assetIdParam.value
  if (!pid || !aid || !board.value) return
  const oeeRaw = snapOee.value.trim()
  const qRaw = snapQueue.value.trim()
  const oee01 = oeeRaw === '' ? null : Number(oeeRaw)
  const queueMinutes = qRaw === '' ? null : Number(qRaw)
  const prevDj =
    board.value.deliveryJson && typeof board.value.deliveryJson === 'object'
      ? { ...board.value.deliveryJson }
      : {}
  const deliveryJson: Record<string, unknown> = { ...prevDj }
  if (oee01 != null && Number.isFinite(oee01)) deliveryJson.oee01 = oee01
  else delete deliveryJson.oee01
  const kwhRaw = snapElectricityKwh.value.trim()
  const eurRaw = snapElectricityCostEur.value.trim()
  const maintRaw = snapMaintenanceCostEur.value.trim()
  if (kwhRaw !== '') {
    const k = Number(kwhRaw.replace(',', '.'))
    if (Number.isFinite(k)) deliveryJson.electricityKwhPerDay = k
    else delete deliveryJson.electricityKwhPerDay
  } else delete deliveryJson.electricityKwhPerDay
  if (eurRaw !== '') {
    const e = Number(eurRaw.replace(',', '.'))
    if (Number.isFinite(e)) deliveryJson.electricityCostEurPerDay = e
    else delete deliveryJson.electricityCostEurPerDay
  } else delete deliveryJson.electricityCostEurPerDay
  if (maintRaw !== '') {
    const m = Number(maintRaw.replace(',', '.'))
    if (Number.isFinite(m)) deliveryJson.maintenanceCostEurPerDay = m
    else delete deliveryJson.maintenanceCostEurPerDay
  } else delete deliveryJson.maintenanceCostEurPerDay
  const customerJson: Record<string, unknown> = {}
  if (queueMinutes != null && Number.isFinite(queueMinutes)) customerJson.queueMinutes = queueMinutes

  const s = board.value.scores
  const overall =
    s && s.safety != null && s.quality != null && s.delivery != null && s.customer != null
      ? (Number(s.safety) + Number(s.quality) + Number(s.delivery) + Number(s.customer)) / 4
      : null

  try {
    setApiParkContextId(pid)
    await postSqdcDailySnapshot({
      level: 'ASSET',
      snapshotDate: date.value,
      assetId: aid,
      safetyScore: s.safety,
      qualityScore: s.quality,
      deliveryScore: s.delivery,
      customerScore: s.customer,
      overallScore: overall != null && Number.isFinite(overall) ? Math.round(overall * 100) / 100 : null,
      deliveryJson,
      customerJson,
    })
    push(t('sqdc.snapshotSaved'), 'success')
    await loadBoard()
  } catch (e) {
    push(e instanceof Error ? e.message : t('sqdc.snapshotFailed'), 'error')
  }
}

onMounted(async () => {
  await loadRides()
  await loadBoard()
})

watch(parkIdParam, async () => {
  await loadRides()
  await loadBoard()
})

watch([assetIdParam, date], async () => {
  highlightMoodId.value = ''
  if (highlightMoodTimer) {
    clearTimeout(highlightMoodTimer)
    highlightMoodTimer = undefined
  }
  await loadBoard()
})

watch(
  () => board.value?.lastUpdate,
  () => {
    const b = board.value
    if (!b?.delivery) return
    const d = b.delivery as Record<string, unknown>
    snapElectricityKwh.value =
      d.electricityKwhPerDay != null && Number.isFinite(Number(d.electricityKwhPerDay))
        ? String(d.electricityKwhPerDay)
        : ''
    snapElectricityCostEur.value =
      d.electricityCostEurPerDay != null && Number.isFinite(Number(d.electricityCostEurPerDay))
        ? String(d.electricityCostEurPerDay)
        : ''
    snapMaintenanceCostEur.value =
      d.maintenanceCostEurPerDay != null && Number.isFinite(Number(d.maintenanceCostEurPerDay))
        ? String(d.maintenanceCostEurPerDay)
        : ''
  }
)

onUnmounted(() => {
  if (highlightMoodTimer) clearTimeout(highlightMoodTimer)
})
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('sqdc.hierarchicalAssetTitle') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('sqdc.hierarchicalAssetSubtitle') }}</p>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        <RouterLink
          v-if="parkIdParam"
          class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
          :to="{ name: 'sqdc-park-board', params: { parkId: parkIdParam } }"
        >
          {{ t('sqdc.backToParkBoard') }}
        </RouterLink>
        <RouterLink class="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800" to="/analytics/sqdc">
          {{ t('sqdc.linkClassicBoard') }}
        </RouterLink>
      </div>
    </header>

    <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <label class="min-w-[min(100%,18rem)] flex-[2] text-xs text-slate-500">
        {{ t('sqdc.assetSelector') }}
        <input
          v-model="rideSearch"
          type="search"
          class="mb-1 mt-1 block w-full max-w-md rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          :placeholder="t('sqdc.searchRides')"
        />
        <select
          class="mt-1 block w-full max-w-xl rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          :value="assetIdParam"
          @change="onAssetSelect"
        >
          <option v-for="r in filteredRides" :key="r.id" :value="r.id">{{ r.name }} ({{ r.slug || r.id.slice(0, 8) }})</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('sqdc.dateUtc') }}
        <input v-model="date" type="date" class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="loading || !parkIdParam || !assetIdParam"
        @click="loadBoard"
      >
        {{ t('sqdc.refresh') }}
      </button>
    </div>

    <p v-if="!parkIdParam || !assetIdParam" class="text-sm text-amber-200/90">{{ t('sqdc.needParkAssetRoute') }}</p>

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
            :center-value="assetRingHeroS.centerValue"
            :center-unit="assetRingHeroS.centerUnit ?? undefined"
            :status-label="assetRingHeroS.statusLabel"
            :status-tone="assetRingHeroS.statusTone"
            :trend-text="assetRingHeroS.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="Q"
            size="hero"
            :label="t('sqdc.monthRingQuality')"
            :segments="ringQuality"
            :sub-label="todayPillarSub('quality')"
            :center-value="assetRingHeroQ.centerValue"
            :center-unit="assetRingHeroQ.centerUnit ?? undefined"
            :status-label="assetRingHeroQ.statusLabel"
            :status-tone="assetRingHeroQ.statusTone"
            :trend-text="assetRingHeroQ.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="D"
            size="hero"
            :label="t('sqdc.monthRingDelivery')"
            :segments="ringDelivery"
            :sub-label="todayPillarSub('delivery')"
            :center-value="assetRingHeroD.centerValue"
            :center-unit="assetRingHeroD.centerUnit ?? undefined"
            :status-label="assetRingHeroD.statusLabel"
            :status-tone="assetRingHeroD.statusTone"
            :trend-text="assetRingHeroD.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="C"
            size="hero"
            :label="t('sqdc.monthRingCost')"
            :segments="ringCost"
            :sub-label="todayCostSub"
            :center-value="assetRingHeroC.centerValue"
            :center-unit="assetRingHeroC.centerUnit ?? undefined"
            :status-label="assetRingHeroC.statusLabel"
            :status-tone="assetRingHeroC.statusTone"
            :trend-text="assetRingHeroC.trendText ?? undefined"
          />
          <SqdcMonthRingCard
            letter="P"
            size="hero"
            :label="t('sqdc.monthRingPeople')"
            :segments="ringPeople"
            :sub-label="todayPeopleSub"
            :center-value="assetRingHeroP.centerValue"
            :center-unit="assetRingHeroP.centerUnit ?? undefined"
            :status-label="assetRingHeroP.statusLabel"
            :status-tone="assetRingHeroP.statusTone"
            :trend-text="assetRingHeroP.trendText ?? undefined"
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
            <div class="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityKwhDay') }}</dt>
              <dd class="font-mono text-white">{{ assetElectricityKwhDisplay != null ? assetElectricityKwhDisplay : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.electricityCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{ assetElectricityEurDisplay != null ? `${assetElectricityEurDisplay} €` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }}</dt>
              <dd class="font-mono text-white">
                {{ assetMaintenanceEurDisplay != null ? `${assetMaintenanceEurDisplay} €` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2 border-t border-slate-800/80 pt-2">
              <dt class="text-slate-500">{{ t('sqdc.operatingCostTotalCringEurDay') }}</dt>
              <dd class="font-mono text-white">{{ assetCostEurForRing != null ? `${assetCostEurForRing} €` : '—' }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h2 class="text-sm font-semibold text-slate-200">{{ t('sqdc.assetMaster') }}</h2>
        <p class="mt-2 text-lg font-medium text-white">{{ assetTitle || board.assetId }}</p>
        <p class="text-xs text-slate-500">{{ board.assetId }}</p>
        <dl class="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
          <div>
            <dt class="text-slate-500">{{ t('sqdc.theoreticalPph') }}</dt>
            <dd class="font-mono text-white">{{ board.delivery.theoreticalCapacityPph ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('sqdc.plannedPph') }}</dt>
            <dd class="font-mono text-white">{{ board.delivery.plannedCapacityPph ?? '—' }}</dd>
          </div>
        </dl>
        <p class="mt-3 text-[10px] text-slate-600">
          MQTT examples: {{ board.integrationHooks.mqttSqdcEventTopicExample }}
        </p>
      </section>

      <section
        v-if="latestMood"
        ref="moodSpotlightRef"
        class="rounded-xl border-2 p-4"
        :class="moodSpotlightShell(moodNum(latestMood))"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-300/90">
              {{ t('sqdc.latestMoodSpotlight') }}
            </p>
            <div class="mt-3 flex flex-wrap items-end gap-4">
              <p class="text-5xl leading-none">{{ moodEmoji(moodNum(latestMood)) }}</p>
              <p class="font-mono text-4xl font-bold tabular-nums text-white">
                {{ moodNum(latestMood) }}<span class="text-lg font-normal text-slate-400">/5</span>
              </p>
            </div>
            <p v-if="latestMood.comment" class="mt-3 text-sm text-slate-100">“{{ latestMood.comment }}”</p>
            <p v-if="latestMood.createdAt" class="mt-2 text-[10px] text-slate-500">{{ latestMood.createdAt }}</p>
          </div>
          <span
            v-if="highlightMoodId && String(latestMood.id ?? '') === highlightMoodId"
            class="shrink-0 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            {{ t('sqdc.moodNewBadge') }}
          </span>
        </div>
      </section>

      <section
        class="rounded-xl border border-violet-500/25 bg-slate-950/50 p-4 shadow-[inset_0_1px_0_0_rgba(139,92,246,0.12)]"
      >
        <h3 class="text-sm font-semibold uppercase tracking-wide text-violet-300/95">D — {{ t('sqdc.deliveryPillar') }}</h3>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('sqdc.deliveryOpsSubtitle') }}</p>
        <dl class="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-slate-500">{{ t('sqdc.queueMinutes') }}</dt>
            <dd class="font-mono text-white">{{ board.customer.queueMinutes ?? '—' }}</dd>
          </div>
          <div v-if="board.customer.guestCount != null">
            <dt class="text-slate-500">{{ t('sqdc.guestCount') }}</dt>
            <dd class="font-mono text-white">{{ board.customer.guestCount }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">OEE (0–1)</dt>
            <dd class="font-mono text-white">{{ board.delivery.oee01 != null ? board.delivery.oee01.toFixed(3) : '—' }}</dd>
            <p v-if="board.deliveryProvenance?.oeeFrom" class="mt-0.5 text-[10px] text-slate-600">
              {{
                board.deliveryProvenance.oeeFrom === 'LEGACY_BOARD_SNAPSHOT'
                  ? t('sqdc.oeeFromClassicBoard')
                  : t('sqdc.oeeFromDailySnapshot')
              }}
            </p>
          </div>
        </dl>
        <p class="mt-2 text-[10px] text-violet-200/70">
          {{ t('sqdc.downtimeDeliveryMix', assetDowntimeMix) }}
          ·
          {{
            t('sqdc.downtimeAssetKpis', {
              downtimeEventCount: board.operationalKpis?.downtimeEventCount ?? 0,
              openUnplannedDowntime: board.operationalKpis?.openUnplannedDowntime ?? 0,
            })
          }}
        </p>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-slate-800/90 bg-slate-900/30 p-3 lg:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-xs font-semibold text-slate-200">{{ t('sqdc.downtimeUnderDelivery') }}</h4>
              <RouterLink class="text-[10px] text-brand-400 hover:text-brand-300" to="/platform/oee">
                {{ t('sqdc.openOeeUi') }} →
              </RouterLink>
            </div>
            <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.downtimeAssetUnderDeliveryHint') }}</p>
            <ul class="mt-3 max-h-52 space-y-2 overflow-y-auto text-xs text-slate-300">
              <li
                v-for="d in board.downtimeEvents || []"
                :key="String(d.id)"
                class="rounded border border-slate-800/80 bg-slate-950/40 p-2"
              >
                <span class="font-mono text-amber-200/90">{{ d.reasonCode }}</span>
                <span class="ml-1 text-slate-500">{{ d.planned ? t('sqdc.plannedShort') : t('sqdc.unplannedShort') }}</span>
                <p class="mt-0.5 text-[10px] text-slate-500">
                  {{ d.startedAt }}<span v-if="d.endedAt"> — {{ d.endedAt }}</span><span v-else class="text-rose-300/90"> · {{ t('sqdc.openEnded') }}</span>
                </p>
                <p v-if="d.notes" class="mt-1 line-clamp-2 text-slate-500">{{ d.notes }}</p>
              </li>
              <li v-if="!(board.downtimeEvents || []).length" class="text-slate-600">{{ t('sqdc.none') }}</li>
            </ul>
          </div>
          <div class="rounded-lg border border-slate-800/90 bg-slate-900/30 p-3 lg:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-xs font-semibold text-slate-200">{{ t('sqdc.shiftHandovers') }}</h4>
              <RouterLink class="text-[10px] text-brand-400 hover:text-brand-300" to="/platform/shift-handover">
                {{ t('sqdc.openShiftHandoverUi') }} →
              </RouterLink>
            </div>
            <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.shiftHandoversAssetHint') }}</p>
            <ul class="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs text-slate-300">
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
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-3">
        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4 lg:col-span-2">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.activeEvents') }}</h3>
          <ul class="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs text-slate-300">
            <li
              v-for="(ev, evIdx) in board.activeEvents"
              :key="eventRowKey(ev, evIdx)"
              class="rounded border border-slate-800/80 bg-slate-900/40 p-2"
            >
              <span class="text-amber-200/80">{{ ev.eventType }}</span>
              · {{ ev.title }}
            </li>
            <li v-if="!board.activeEvents.length" class="text-slate-600">{{ t('sqdc.none') }}</li>
          </ul>
        </section>
        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.moodFeedback') }}</h3>
          <ul class="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs text-slate-300">
            <li v-for="(m, mIdx) in board.moodFeedback" :key="moodRowKey(m, mIdx)" :class="moodRowClasses(m, mIdx)">
              <span class="font-mono text-amber-200/90">{{ m.moodScore }}/5</span>
              <span v-if="mIdx === 0" class="ml-1 text-[9px] font-medium uppercase tracking-wide text-amber-400/80">{{
                t('sqdc.moodLatestShort')
              }}</span>
              <span v-if="m.comment" class="text-slate-400"> — {{ m.comment }}</span>
            </li>
            <li v-if="!board.moodFeedback.length" class="text-slate-600">{{ t('sqdc.none') }}</li>
          </ul>
          <div class="mt-4 border-t border-slate-800 pt-3">
            <label class="text-[10px] text-slate-500">{{ t('sqdc.moodScore15') }}</label>
            <input v-model.number="moodScore" type="range" min="1" max="5" class="mt-1 block w-full" />
            <textarea
              v-model="moodComment"
              rows="2"
              class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
              :placeholder="t('sqdc.commentOptional')"
            />
            <button type="button" class="mt-2 w-full rounded bg-slate-700 py-1 text-xs text-white hover:bg-slate-600" @click="submitMood">
              {{ t('sqdc.saveMood') }}
            </button>
          </div>
        </section>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.manualEvent') }}</h3>
          <select v-model="evType" class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
            <option value="SAFETY">SAFETY</option>
            <option value="QUALITY">QUALITY</option>
            <option value="DELIVERY">DELIVERY</option>
            <option value="CUSTOMER">CUSTOMER</option>
            <option value="PEOPLE">PEOPLE</option>
            <option value="MAINTENANCE">MAINTENANCE</option>
          </select>
          <select v-model="evSeverity" class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <input
            v-model="evTitle"
            type="text"
            class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
            :placeholder="t('sqdc.eventTitlePh')"
          />
          <textarea v-model="evDesc" rows="2" class="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
          <button type="button" class="mt-2 w-full rounded-md bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-500" @click="submitEvent">
            {{ t('sqdc.createEvent') }}
          </button>
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.saveDailySnapshot') }}</h3>
          <p class="mt-1 text-[10px] text-slate-500">{{ t('sqdc.snapshotHint') }}</p>
          <label class="mt-3 block text-[10px] text-slate-500">OEE (0–1) → delivery_json</label>
          <input v-model="snapOee" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">{{ t('sqdc.queueMinutes') }} → customer_json</label>
          <input v-model="snapQueue" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">{{ t('sqdc.electricityKwhDay') }} → delivery_json</label>
          <input v-model="snapElectricityKwh" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">{{ t('sqdc.electricityCostEurDay') }} → delivery_json</label>
          <input v-model="snapElectricityCostEur" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <label class="mt-2 block text-[10px] text-slate-500">{{ t('sqdc.maintenanceCostEurDay') }} → delivery_json</label>
          <input v-model="snapMaintenanceCostEur" type="text" class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white" />
          <button type="button" class="mt-3 w-full rounded-md bg-brand-600 py-2 text-xs font-medium text-white hover:bg-brand-500" @click="saveSnapshot">
            {{ t('sqdc.saveSnapshot') }}
          </button>
        </section>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 class="text-sm font-semibold text-slate-200">{{ t('sqdc.aiRecommendations') }}</h3>
        <ul class="mt-3 grid gap-2 md:grid-cols-2">
          <li v-for="r in board.aiRecommendations" :key="r.recommendationId" class="rounded border border-slate-800/80 bg-slate-900/30 p-2 text-xs text-slate-300">
            <span class="font-medium text-brand-300/90">{{ r.category }}</span> · {{ r.message }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
