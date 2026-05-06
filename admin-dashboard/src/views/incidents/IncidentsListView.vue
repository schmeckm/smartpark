<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { listIncidents } from '@/api/client'
import type { Incident, IncidentSeverity, IncidentStatus } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const items = ref<Incident[]>([])
const total = ref(0)
const loading = ref(false)
const statusFilter = ref<IncidentStatus | ''>('')
const severityFilter = ref<IncidentSeverity | ''>('')
const sortMode = ref<'created_desc' | 'created_asc' | 'severity_desc'>('created_desc')

const canCreate = computed(() => auth.hasPermission('incidents', 'create'))

const statusOptions: { value: IncidentStatus | ''; labelKey: string }[] = [
  { value: '', labelKey: 'incidents.filterAll' },
  { value: 'OPEN', labelKey: 'incidents.statusOpen' },
  { value: 'IN_PROGRESS', labelKey: 'incidents.statusInProgress' },
  { value: 'RESOLVED', labelKey: 'incidents.statusResolved' },
  { value: 'CLOSED', labelKey: 'incidents.statusClosed' },
]

const severityOptions: { value: IncidentSeverity | ''; labelKey: string }[] = [
  { value: '', labelKey: 'incidents.filterSeverityAll' },
  { value: 'LOW', labelKey: 'incidents.severityLOW' },
  { value: 'MEDIUM', labelKey: 'incidents.severityMEDIUM' },
  { value: 'HIGH', labelKey: 'incidents.severityHIGH' },
  { value: 'CRITICAL', labelKey: 'incidents.severityCRITICAL' },
]

const sortOptions: { value: typeof sortMode.value; labelKey: string }[] = [
  { value: 'created_desc', labelKey: 'incidents.sortCreatedDesc' },
  { value: 'created_asc', labelKey: 'incidents.sortCreatedAsc' },
  { value: 'severity_desc', labelKey: 'incidents.sortSeverityDesc' },
]

const severityRank: Record<IncidentSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

const filteredItems = computed(() => {
  let list = items.value
  if (severityFilter.value) {
    list = list.filter((i) => i.severity === severityFilter.value)
  }
  const out = [...list]
  out.sort((a, b) => {
    if (sortMode.value === 'created_desc') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    if (sortMode.value === 'created_asc') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    }
    return severityRank[a.severity] - severityRank[b.severity]
  })
  return out
})

async function load() {
  if (!parkCtx.activeParkId) {
    items.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await listIncidents({
      status: statusFilter.value || undefined,
      limit: 100,
      offset: 0,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

watch([() => parkCtx.activeParkId, statusFilter], () => {
  void load()
})

function severityClass(s: string) {
  if (s === 'CRITICAL') return 'bg-rose-600/90 text-white'
  if (s === 'HIGH') return 'bg-orange-600/90 text-white'
  if (s === 'MEDIUM') return 'bg-amber-500/90 text-slate-900'
  return 'bg-slate-600/80 text-white'
}

function statusBadgeClass(status: IncidentStatus) {
  if (status === 'OPEN') return 'bg-sky-600/90 text-white'
  if (status === 'IN_PROGRESS') return 'bg-amber-500/90 text-slate-900'
  if (status === 'RESOLVED') return 'bg-emerald-600/90 text-white'
  return 'bg-slate-600/85 text-slate-100'
}

function statusLabelKey(status: IncidentStatus): string {
  if (status === 'OPEN') return 'incidents.statusOpen'
  if (status === 'IN_PROGRESS') return 'incidents.statusInProgress'
  if (status === 'RESOLVED') return 'incidents.statusResolved'
  return 'incidents.statusClosed'
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 :class="ui.title">{{ t('incidents.listTitle') }}</h1>
        <p :class="ui.subtitle">{{ t('incidents.listHint') }}</p>
      </div>
      <RouterLink
        v-if="canCreate"
        to="/incidents/new"
        class="inline-flex shrink-0 items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
      >
        {{ t('incidents.new') }}
      </RouterLink>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.infoBox">
      {{ t('incidents.noPark') }}
    </div>

    <template v-else>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-[10rem] flex-col gap-1">
          <label class="text-xs text-slate-500" for="inc-filter-status">{{ t('incidents.filterStatus') }}</label>
          <select
            id="inc-filter-status"
            v-model="statusFilter"
            :class="ui.control + ' !mt-0 max-w-xs py-1.5 text-xs'"
          >
            <option v-for="o in statusOptions" :key="o.value || 'all'" :value="o.value">{{ t(o.labelKey) }}</option>
          </select>
        </div>
        <div class="flex min-w-[10rem] flex-col gap-1">
          <label class="text-xs text-slate-500" for="inc-filter-severity">{{ t('incidents.filterSeverity') }}</label>
          <select
            id="inc-filter-severity"
            v-model="severityFilter"
            :class="ui.control + ' !mt-0 max-w-xs py-1.5 text-xs'"
          >
            <option v-for="o in severityOptions" :key="o.value || 'all-sev'" :value="o.value">{{
              t(o.labelKey)
            }}</option>
          </select>
        </div>
        <div class="flex min-w-[12rem] flex-col gap-1">
          <label class="text-xs text-slate-500" for="inc-sort">{{ t('incidents.sortLabel') }}</label>
          <select
            id="inc-sort"
            v-model="sortMode"
            :class="ui.control + ' !mt-0 max-w-xs py-1.5 text-xs'"
          >
            <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
          </select>
        </div>
        <span class="pb-2 text-xs text-slate-500">
          <template v-if="severityFilter">
            {{
              t('incidents.listCountFiltered', {
                shown: filteredItems.length,
                loaded: items.length,
                total,
              })
            }}
          </template>
          <template v-else>{{ total }} {{ t('incidents.total') }}</template>
        </span>
      </div>

      <div v-if="loading" :class="ui.muted">{{ t('incidents.loading') }}</div>

      <ul v-else class="space-y-2">
        <li v-for="row in filteredItems" :key="row.id">
          <RouterLink
            :to="`/incidents/${row.id}`"
            :class="[
              ui.card,
              'block transition hover:border-brand-500/50 hover:ring-1 hover:ring-brand-500/30',
            ]"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p :class="ui.h2" class="!text-base">{{ row.title }}</p>
                <p class="mt-0.5 text-xs text-slate-500">
                  {{ t('incidents.createdAtLabel') }}: {{ formatDateTime(row.createdAt) }}
                </p>
              </div>
              <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <span class="rounded px-2 py-0.5 text-xs font-medium" :class="statusBadgeClass(row.status)">
                  {{ t(statusLabelKey(row.status)) }}
                </span>
                <span class="rounded px-2 py-0.5 text-xs font-medium" :class="severityClass(row.severity)">
                  {{ row.severity }}
                </span>
              </div>
            </div>
            <p v-if="row.owner" class="mt-2 truncate text-xs text-slate-500">
              {{ t('incidents.owner') }}: {{ row.owner.displayName || `${row.owner.firstName} ${row.owner.lastName}` }}
            </p>
          </RouterLink>
        </li>
        <li v-if="!filteredItems.length" :class="ui.infoBox">{{ t('incidents.empty') }}</li>
      </ul>
    </template>
  </div>
</template>
