<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { Ride } from '@/types/api'

defineProps<{ ride: Ride | null }>()
const { t } = useI18n()
</script>

<template>
  <section class="space-y-4">
    <header>
      <h2 class="font-display text-base font-semibold text-white">{{ t('ride.diagnostics.title') }}</h2>
      <p class="mt-1 text-xs text-slate-400">{{ t('ride.diagnostics.description') }}</p>
    </header>
    <div class="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">
      {{ t('ride.diagnostics.engineeringNotice') }}
    </div>
    <div class="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
      <p>{{ t('ride.diagnostics.scaffoldNotice') }}</p>
      <RouterLink :to="{ name: 'realtime-topic-explorer' }" class="mt-3 mr-4 inline-block text-brand-400 hover:underline">
        → {{ t('ride.diagnostics.openTopics') }}
      </RouterLink>
      <RouterLink :to="{ name: 'devices-services' }" class="mt-3 inline-block text-brand-400 hover:underline">
        → {{ t('ride.diagnostics.openIntegrations') }}
      </RouterLink>
    </div>
  </section>
</template>
