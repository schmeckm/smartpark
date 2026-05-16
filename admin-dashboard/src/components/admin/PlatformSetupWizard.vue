<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { getUnsRegistryMirrorSummary, listSignalCatalog } from '@/api/client'
import type { usePageSurfaces } from '@/composables/usePageSurfaces'

type UiSurfaces = ReturnType<typeof usePageSurfaces>['surfaces']['value']

type StepStatus = 'done' | 'current' | 'pending' | 'optional'

type SetupStep = {
  id: string
  status: StepStatus
  to?: RouteLocationRaw
  hidden?: boolean
}

const props = defineProps<{
  ui: UiSurfaces
}>()

const { t } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()

const probing = ref(false)
const mirrorSignalCount = ref<number | null>(null)
const operatorSignalCount = ref<number | null>(null)
const mirroredSignalCount = ref<number | null>(null)

const canReadRides = computed(() => auth.hasPermission('rides', 'read'))
const canIotSettings = computed(() => auth.hasPermission('iotOt', 'settings.read'))
const canIntegrations = computed(() => auth.hasPermission('integrations', 'read'))

const activeParkName = computed(() => parkCtx.activePark?.name ?? '')

async function probeProgress() {
  probing.value = true
  mirrorSignalCount.value = null
  operatorSignalCount.value = null
  mirroredSignalCount.value = null
  try {
    if (canIotSettings.value) {
      const summary = await getUnsRegistryMirrorSummary()
      mirrorSignalCount.value = summary.counts?.signalCatalog ?? 0
    }
    if (canReadRides.value) {
      const cat = await listSignalCatalog()
      const signals = cat.signals ?? []
      mirroredSignalCount.value = signals.filter((s) => s.registrySource === 'MIRRORED_FROM_LEGACY').length
      operatorSignalCount.value = signals.filter((s) => s.registrySource === 'OPERATOR_CONFIGURED').length
    }
  } catch {
    /* wizard stays usable without probe data */
  } finally {
    probing.value = false
  }
}

onMounted(() => {
  if (!parkCtx.loaded && auth.isAuthenticated && canReadRides.value) {
    void parkCtx.hydrate()
  }
  void probeProgress()
})

const steps = computed((): SetupStep[] => {
  const hasPark = Boolean(parkCtx.activeParkId)
  const hasMirror = (mirrorSignalCount.value ?? 0) > 0 || (mirroredSignalCount.value ?? 0) > 0
  const hasCatalog = (mirroredSignalCount.value ?? 0) + (operatorSignalCount.value ?? 0) > 0

  const list: Omit<SetupStep, 'status'>[] = [
    {
      id: 'park',
      to: undefined,
      hidden: !canReadRides.value,
    },
    {
      id: 'masterData',
      to: { name: 'master-data', params: { entityType: 'parks' } },
      hidden: !canReadRides.value,
    },
    {
      id: 'integrations',
      to: { path: '/integrations' },
      hidden: !canIntegrations.value,
    },
    {
      id: 'uns',
      to: { path: '/realtime/topics' },
      hidden: !canIotSettings.value && !canReadRides.value,
    },
    {
      id: 'registryMirror',
      to: { name: 'diagnostics-registry-mirror' },
      hidden: !canIotSettings.value,
    },
    {
      id: 'signalCatalog',
      to: { name: 'master-data-signal-catalog' },
      hidden: !canReadRides.value,
    },
    {
      id: 'rideCapabilities',
      to: { name: 'master-data', params: { entityType: 'rides' } },
      hidden: !canReadRides.value,
    },
    {
      id: 'adapters',
      to: { path: '/settings/devices-services' },
      hidden: !canIotSettings.value,
    },
    {
      id: 'platformTabs',
      hidden: false,
    },
  ]

  function isDone(id: string): boolean {
    if (id === 'park') return hasPark
    if (id === 'masterData') return parkCtx.parks.length > 0
    if (id === 'registryMirror') return hasMirror
    if (id === 'signalCatalog') return hasCatalog
    return false
  }

  const visible = list.filter((s) => !s.hidden)
  let assignedCurrent = false

  return visible.map((s) => {
    if (s.id === 'integrations' || s.id === 'adapters' || s.id === 'platformTabs') {
      return { ...s, status: 'optional' as StepStatus }
    }
    if (isDone(s.id)) {
      return { ...s, status: 'done' as StepStatus }
    }
    if (!assignedCurrent) {
      assignedCurrent = true
      return { ...s, status: 'current' as StepStatus }
    }
    return { ...s, status: 'pending' as StepStatus }
  })
})

const doneCount = computed(() => steps.value.filter((s) => s.status === 'done').length)
const totalCount = computed(() => steps.value.filter((s) => s.status !== 'optional').length)

function statusRingClass(status: StepStatus): string {
  if (status === 'done') return 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
  if (status === 'current') return 'border-brand-500/70 bg-brand-500/20 text-brand-200'
  if (status === 'optional') return 'border-slate-600 bg-slate-800/50 text-slate-400'
  return 'border-slate-700 bg-slate-900/80 text-slate-500'
}

function statusLabel(status: StepStatus): string {
  if (status === 'done') return t('platformSetup.status.done')
  if (status === 'current') return t('platformSetup.status.current')
  if (status === 'optional') return t('platformSetup.status.optional')
  return t('platformSetup.status.pending')
}
</script>

<template>
  <div :class="props.ui.card" class="space-y-5" data-testid="platform-setup-wizard">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-white">{{ t('platformSetup.title') }}</h2>
        <p class="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
          {{ t('platformSetup.subtitle') }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="probing"
        data-testid="platform-setup-wizard-refresh"
        @click="probeProgress"
      >
        {{ probing ? t('platformSetup.refreshing') : t('platformSetup.refresh') }}
      </button>
    </div>

    <p class="text-xs text-slate-500">
      {{
        t('platformSetup.progress', {
          done: doneCount,
          total: totalCount,
        })
      }}
      <template v-if="mirrorSignalCount != null && canIotSettings">
        · {{ t('platformSetup.mirrorCount', { count: mirrorSignalCount }) }}
      </template>
      <template v-if="mirroredSignalCount != null && canReadRides">
        · {{ t('platformSetup.catalogMirrored', { count: mirroredSignalCount }) }}
      </template>
    </p>

    <ol class="space-y-3">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="flex gap-3 rounded-lg border border-slate-800/90 bg-slate-950/40 p-4"
        :data-testid="`platform-setup-step-${step.id}`"
      >
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
          :class="statusRingClass(step.status)"
          aria-hidden="true"
        >
          {{ index + 1 }}
        </div>
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-white">
              {{ t(`platformSetup.steps.${step.id}.title`) }}
            </h3>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              :class="statusRingClass(step.status)"
            >
              {{ statusLabel(step.status) }}
            </span>
          </div>
          <p class="text-sm leading-relaxed text-slate-400">
            <template v-if="step.id === 'park' && activeParkName">
              {{ t('platformSetup.steps.park.bodyActive', { name: activeParkName }) }}
            </template>
            <template v-else>
              {{ t(`platformSetup.steps.${step.id}.body`) }}
            </template>
          </p>
          <p v-if="step.id === 'registryMirror'" class="text-xs text-amber-200/90">
            {{ t('platformSetup.steps.registryMirror.hint') }}
          </p>
          <div v-if="step.to" class="flex flex-wrap gap-2 pt-1">
            <RouterLink
              :to="step.to"
              class="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
            >
              {{ t(`platformSetup.steps.${step.id}.action`) }} →
            </RouterLink>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>
