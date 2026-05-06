<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useParkContextStore } from '@/stores/parkContext'

const router = useRouter()
const parkContext = useParkContextStore()

onMounted(() => {
  const id = parkContext.activeParkId
  if (id) void router.replace({ name: 'sqdc-park-board', params: { parkId: id } })
  else void router.replace({ path: '/' })
})
</script>

<template>
  <p class="px-4 py-8 text-sm text-slate-400">…</p>
</template>
