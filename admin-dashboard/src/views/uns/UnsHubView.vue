<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const tabs = computed(() => [
  { to: '/uns/tree', label: 'Namespace Tree' },
  { to: '/uns/topics', label: 'Topic Preview' },
  { to: '/uns/live', label: 'Live MQTT State' },
  { to: '/uns/oee-cockpit', label: 'OEE cockpit' },
  { to: '/uns/registry-mirror', label: t('menu.unsRegistryMirror') },
  { to: '/uns/governance', label: t('menu.unsGovernance') },
  { to: '/uns/spy-inbox', label: t('menu.unsSpyInbox') },
  { to: '/uns/signal-view', label: t('unsHub.tabSignalView') },
  { to: '/analytics/sqdc', label: t('menu.sqdcBoard') },
])
</script>

<template>
  <div class="min-h-full">
    <div class="border-b border-slate-800 bg-slate-900/40 px-4 sm:px-6">
      <p class="pt-4 font-display text-lg font-semibold text-white">UNS</p>
      <p class="mt-0.5 pb-3 text-xs text-slate-500">
        {{ t('unsHub.subtitle') }}
      </p>
      <nav class="-mb-px flex flex-wrap gap-1" aria-label="UNS sections">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="rounded-t-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-400 hover:border-slate-700 hover:text-white"
          active-class="border-slate-700 border-b-slate-950 bg-slate-950 text-white"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>
    </div>
    <RouterView />
  </div>
</template>
