<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { Ride } from '@/types/api'
import { PREDICTIVE_MAINTENANCE_ADAPTER_KEY, useInstalledAdaptersStore } from '@/stores/installedAdapters'

defineProps<{ ride: Ride | null }>()
const { t } = useI18n()
const installedAdapters = useInstalledAdaptersStore()
const showPdmLink = computed(() => installedAdapters.isInstalled(PREDICTIVE_MAINTENANCE_ADAPTER_KEY))
</script>

<template>
  <section class="space-y-4">
    <header>
      <h2 class="font-display text-base font-semibold text-white">{{ t('ride.maintenance.title') }}</h2>
      <p class="mt-1 text-xs text-slate-400">{{ t('ride.maintenance.description') }}</p>
    </header>
    <div class="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
      <p>{{ t('ride.maintenance.scaffoldNotice') }}</p>
      <RouterLink
        v-if="showPdmLink"
        :to="{ name: 'predictive-maintenance' }"
        class="mt-3 inline-block text-brand-400 hover:underline"
      >
        → {{ t('ride.maintenance.openLegacyLink') }}
      </RouterLink>
    </div>
  </section>
</template>
