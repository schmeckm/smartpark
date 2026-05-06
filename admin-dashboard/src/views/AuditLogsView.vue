<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAuditLogs } from '@/api/client'
import type { AuditLogRow } from '@/types/auth'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { formatDateTimeInPrefs } from '@/utils/dateTime'

const { t } = useI18n()
const dt = useRegionalDateTime()
const logAsUtc = ref(false)

function formatLogTime(iso: string | undefined) {
  if (!iso) return '—'
  if (logAsUtc.value) {
    return formatDateTimeInPrefs(iso, { ...dt.prefs.value, timeZone: 'UTC' })
  }
  return dt.formatDateTime(iso)
}

const rows = ref<AuditLogRow[]>([])
const total = ref(0)
const limit = ref(50)
const offset = ref(0)
const busy = ref(false)
const { push } = useToast()

async function load() {
  busy.value = true
  try {
    const res = await getAuditLogs({ limit: limit.value, offset: offset.value })
    rows.value = res.data
    total.value = res.meta.total
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load audit log', 'error')
  } finally {
    busy.value = false
  }
}

function prev() {
  offset.value = Math.max(0, offset.value - limit.value)
  void load()
}

function next() {
  if (offset.value + limit.value < total.value) {
    offset.value += limit.value
    void load()
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Audit log</h1>
        <p class="mt-1 text-sm text-slate-400">Security and compliance trail for critical changes.</p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          :disabled="busy || offset === 0"
          @click="prev"
        >
          Previous
        </button>
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          :disabled="busy || offset + limit >= total"
          @click="next"
        >
          Next
        </button>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
          :disabled="busy"
          @click="load"
        >
          Refresh
        </button>
      </div>
    </div>

    <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
      <input v-model="logAsUtc" type="checkbox" class="rounded border-slate-600" />
      {{ t('audit.useUtc') }}
    </label>

    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80">
          <tr>
            <th class="px-3 py-2 font-medium text-slate-400">Time</th>
            <th class="px-3 py-2 font-medium text-slate-400">Action</th>
            <th class="px-3 py-2 font-medium text-slate-400">User</th>
            <th class="px-3 py-2 font-medium text-slate-400">Entity</th>
            <th class="px-3 py-2 font-medium text-slate-400">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr v-for="r in rows" :key="r.id" class="hover:bg-slate-800/30">
            <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-300">
              {{ formatLogTime(r.createdAt) }}
            </td>
            <td class="px-3 py-2 font-mono text-xs text-brand-200">{{ r.action }}</td>
            <td class="px-3 py-2 text-xs text-slate-300">
              {{ r.user?.email || r.userId || '—' }}
            </td>
            <td class="px-3 py-2 text-xs text-slate-400">
              {{ r.entityType || '—' }} <span v-if="r.entityId" class="text-slate-600">{{ r.entityId }}</span>
            </td>
            <td class="px-3 py-2 text-xs text-slate-500">{{ r.ipAddress || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length && !busy" class="py-10 text-center text-sm text-slate-500">No entries.</p>
    </div>
    <p class="text-xs text-slate-500">Showing {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} of {{ total }}</p>
  </div>
</template>
