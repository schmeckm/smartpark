<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useRideContext } from '@/composables/useRideContext'
import RideHeader from '@/components/shell/RideHeader.vue'
import RideTabStrip from '@/components/shell/RideTabStrip.vue'

const route = useRoute()
const rideId = computed(() => String(route.params.rideId ?? ''))
const { ride, loading, error } = useRideContext(rideId)

const tabs = [
  { name: 'mvp-ride-overview',    labelKey: 'ride.tab.overview' },
  { name: 'mvp-ride-live',        labelKey: 'ride.tab.live' },
  { name: 'mvp-ride-queue',       labelKey: 'ride.tab.queue' },
  { name: 'mvp-ride-oee',         labelKey: 'ride.tab.oee' },
  { name: 'mvp-ride-maintenance', labelKey: 'ride.tab.maintenance' },
  { name: 'mvp-ride-ai',          labelKey: 'ride.tab.ai',          permission: { resource: 'ai', action: 'read' } },
  { name: 'mvp-ride-diagnostics', labelKey: 'ride.tab.diagnostics', permission: { resource: 'iotOt', action: 'settings.read' } },
]
</script>

<template>
  <div class="flex h-full flex-col">
    <RideHeader :ride="ride" :loading="loading" :error="error" />
    <RideTabStrip :tabs="tabs" :ride-id="rideId" />
    <main class="flex-1 overflow-auto px-6 py-4">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :ride="ride" />
      </RouterView>
    </main>
  </div>
</template>
