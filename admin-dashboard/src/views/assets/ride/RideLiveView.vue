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
      <h2 class="font-display text-base font-semibold text-white">{{ t('ride.live.title') }}</h2>
      <p class="mt-1 text-xs text-slate-400">{{ t('ride.live.description') }}</p>
    </header>

    <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
      {{ t('ride.live.scaffoldNotice') }}
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
      <p>{{ t('ride.live.openLegacyPrompt') }}</p>
      <RouterLink :to="{ name: 'realtime-live-signals' }" class="mt-3 inline-block text-brand-400 hover:underline">
        → {{ t('ride.live.openLegacyLink') }}
      </RouterLink>
    </div>
  </section>
</template>
