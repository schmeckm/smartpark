<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { Ride } from '@/types/api'
import { listMlRideProfiles, type MlRideProfileRow } from '@/api/client'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { buildRideBehaviorSummaryLines, hydrateRideBehaviorDraft } from '@/utils/mlOperationalProfileBehavior'

const props = defineProps<{ ride: Ride | null }>()
const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()

const mlProfiles = ref<MlRideProfileRow[]>([])
const mlLoading = ref(false)

async function loadMlProfiles() {
  mlProfiles.value = []
  if (!props.ride?.id) return
  mlLoading.value = true
  try {
    mlProfiles.value = await listMlRideProfiles({ rideId: props.ride.id })
  } catch {
    mlProfiles.value = []
  } finally {
    mlLoading.value = false
  }
}

watch(
  () => props.ride?.id,
  () => {
    void loadMlProfiles()
  },
  { immediate: true }
)

const primaryProfile = computed(() => mlProfiles.value[0] ?? null)

const profileCategory = computed(() => {
  const r = primaryProfile.value
  if (!r) return '—'
  const cap = r.capacityProfileJson as Record<string, unknown> | undefined
  const c = cap?.category
  if (c != null && String(c).trim() !== '') return String(c)
  return r.rideType && r.rideType.trim() !== '' ? r.rideType : '—'
})

const behaviorSummary = computed(() => {
  const r = primaryProfile.value
  if (!r) return ''
  const d = hydrateRideBehaviorDraft(
    r.rideType ?? '',
    JSON.stringify(r.capacityProfileJson ?? {}),
    JSON.stringify(r.weatherSensitivityJson ?? {}),
    JSON.stringify(r.queueBehaviorProfileJson ?? {}),
    JSON.stringify(r.downtimeSensitivityJson ?? {}),
    JSON.stringify(r.staffingDependencyJson ?? {}),
    JSON.stringify(r.throughputProfileJson ?? {})
  )
  return buildRideBehaviorSummaryLines(d, t).join(' ')
})
</script>

<template>
  <section v-if="props.ride" class="grid gap-4 lg:grid-cols-3">
    <article class="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-semibold text-white">{{ t('ride.overview.statusTitle') }}</h2>
      <p class="mt-2 text-3xl font-bold text-white">{{ props.ride.waitTime }}m</p>
      <p class="text-xs text-slate-400">{{ t('ride.kpi.waitTime') }}</p>
    </article>
    <article class="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-semibold text-white">{{ t('ride.overview.capacityTitle') }}</h2>
      <p class="mt-2 text-3xl font-bold text-white">{{ props.ride.capacityPerHour }}/h</p>
      <p class="text-xs text-slate-400">{{ t('ride.kpi.capacity') }}</p>
    </article>
    <article class="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-sm font-semibold text-white">{{ t('ride.overview.shortcutsTitle') }}</h2>
      <ul class="mt-2 space-y-1 text-sm">
        <li>
          <RouterLink :to="{ name: 'mvp-ride-live', params: { rideId: props.ride.id } }" class="text-brand-400 hover:underline">
            → {{ t('ride.tab.live') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="{ name: 'mvp-ride-maintenance', params: { rideId: props.ride.id } }" class="text-brand-400 hover:underline">
            → {{ t('ride.tab.maintenance') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="{ name: 'mvp-ride-ai', params: { rideId: props.ride.id } }" class="text-brand-400 hover:underline">
            → {{ t('ride.tab.ai') }}
          </RouterLink>
        </li>
      </ul>
    </article>
  </section>

  <article v-if="props.ride" class="mt-4 rounded-xl border border-slate-800 bg-slate-900/35 p-4">
    <h2 class="text-sm font-semibold text-white">{{ t('ride.overview.forecastBehaviorTitle') }}</h2>
    <p v-if="mlLoading" class="mt-2 text-xs text-slate-500">{{ t('ride.overview.forecastBehaviorLoading') }}</p>
    <template v-else-if="primaryProfile">
      <p class="mt-1 text-lg font-medium text-brand-100">{{ primaryProfile.profileName }}</p>
      <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt class="text-slate-500">{{ t('ride.overview.forecastBehaviorCategory') }}</dt>
          <dd class="mt-0.5 text-slate-200">{{ profileCategory }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">{{ t('ride.overview.forecastBehaviorVersion') }}</dt>
          <dd class="mt-0.5 font-mono text-slate-200">{{ primaryProfile.profileVersion }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">{{ t('ride.overview.forecastBehaviorActive') }}</dt>
          <dd class="mt-0.5 text-slate-200">{{ primaryProfile.enabled ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">{{ t('ride.overview.forecastBehaviorUpdated') }}</dt>
          <dd class="mt-0.5 text-slate-200">{{ formatDateTime(primaryProfile.updatedAt) }}</dd>
        </div>
        <div class="sm:col-span-2 lg:col-span-4">
          <dt class="text-slate-500">{{ t('ride.overview.forecastBehaviorSource') }}</dt>
          <dd class="mt-0.5 text-slate-200">{{ t('ride.overview.forecastBehaviorSourceAssignment') }}</dd>
        </div>
      </dl>
      <p class="mt-3 text-[11px] leading-relaxed text-slate-400">
        <span class="font-medium text-slate-500">{{ t('ride.overview.forecastBehaviorSummary') }}:</span>
        {{ behaviorSummary }}
      </p>
      <RouterLink
        class="mt-3 inline-block text-sm text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
        :to="{ path: '/ai/ml/profiles', query: { tab: 'ride', rideId: props.ride.id } }"
      >
        {{ t('ride.overview.forecastBehaviorOpen') }} →
      </RouterLink>
    </template>
    <p v-else class="mt-2 text-xs text-slate-500">{{ t('ride.overview.forecastBehaviorNone') }}</p>
  </article>

  <section v-else class="text-sm text-slate-400">{{ t('ride.overview.empty') }}</section>
</template>
