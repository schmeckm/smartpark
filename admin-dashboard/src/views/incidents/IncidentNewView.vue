<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { createIncident, getPlatformAssets } from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'

const GROUP_KEYS = ['RIDE', 'RESTAURANT', 'SHOW', 'SHOP', 'OTHER'] as const

const { t } = useI18n()
const router = useRouter()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const title = ref('')
const description = ref('')
const severity = ref('MEDIUM')
const selectedParkAssetId = ref('')
const saving = ref(false)

const assets = ref<PlatformAsset[]>([])
const assetsLoading = ref(false)
const assetsError = ref('')

function assetUuid(a: PlatformAsset): string {
  return String(a.assetId ?? a.id ?? '')
}

function assetTypeCode(a: PlatformAsset): string {
  const at = a.assetType as { code?: string } | undefined
  return String(at?.code || '').toUpperCase()
}

function assetLabel(a: PlatformAsset): string {
  const name = a.name != null ? String(a.name).trim() : ''
  if (name) return name
  const slug = a.slug != null ? String(a.slug).trim() : ''
  if (slug) return slug
  return assetUuid(a) || '—'
}

function bucketForType(code: string): (typeof GROUP_KEYS)[number] {
  const u = code.toUpperCase()
  if (u === 'RIDE' || u === 'RESTAURANT' || u === 'SHOW' || u === 'SHOP') return u
  return 'OTHER'
}

const assetGroups = computed(() => {
  const map = new Map<string, PlatformAsset[]>()
  for (const k of GROUP_KEYS) map.set(k, [])
  for (const a of assets.value) {
    const b = bucketForType(assetTypeCode(a))
    map.get(b)!.push(a)
  }
  for (const k of GROUP_KEYS) {
    map.get(k)!.sort((x, y) => assetLabel(x).localeCompare(assetLabel(y), undefined, { sensitivity: 'base' }))
  }
  return GROUP_KEYS.map((code) => ({
    code,
    label: t(`incidents.assetGroup.${code}`),
    items: map.get(code)!,
  })).filter((g) => g.items.length > 0)
})

async function loadAssets() {
  const pid = parkCtx.activeParkId
  if (!pid) {
    assets.value = []
    assetsError.value = ''
    return
  }
  assetsLoading.value = true
  assetsError.value = ''
  try {
    assets.value = await getPlatformAssets({ parkId: pid, limit: 500 })
  } catch (e) {
    assets.value = []
    assetsError.value = e instanceof Error ? e.message : 'Error'
  } finally {
    assetsLoading.value = false
  }
}

watch(
  () => parkCtx.activeParkId,
  () => {
    selectedParkAssetId.value = ''
    void loadAssets()
  },
  { immediate: true }
)

watch(assets, (list) => {
  if (selectedParkAssetId.value && !list.some((a) => assetUuid(a) === selectedParkAssetId.value)) {
    selectedParkAssetId.value = ''
  }
})

async function submit() {
  if (!parkCtx.activeParkId) return
  const tit = title.value.trim()
  if (!tit) {
    push(t('incidents.titleRequired'), 'error')
    return
  }
  saving.value = true
  try {
    const pick = selectedParkAssetId.value.trim()
    const linkType = pick ? 'PARK_ASSET' : null
    const lid = pick || null
    const row = await createIncident({
      title: tit,
      description: description.value.trim() || null,
      severity: severity.value,
      linkedEntityType: linkType,
      linkedEntityId: lid,
    })
    await router.replace({ name: 'incident-detail', params: { id: row.id } })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
    <div>
      <h1 :class="ui.title">{{ t('incidents.newTitle') }}</h1>
      <p :class="ui.subtitle">{{ t('incidents.newHint') }}</p>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.infoBox">{{ t('incidents.noPark') }}</div>

    <form v-else :class="ui.card" class="space-y-4" @submit.prevent="submit">
      <div>
        <label :class="ui.label" for="inc-title">{{ t('incidents.fieldTitle') }}</label>
        <input id="inc-title" v-model="title" type="text" :class="ui.control" maxlength="200" required />
      </div>
      <div>
        <label :class="ui.label" for="inc-desc">{{ t('incidents.fieldDescription') }}</label>
        <textarea id="inc-desc" v-model="description" rows="4" :class="ui.control" />
      </div>
      <div>
        <label :class="ui.label" for="inc-sev">{{ t('incidents.fieldSeverity') }}</label>
        <select id="inc-sev" v-model="severity" :class="ui.control">
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </div>

      <div>
        <label :class="ui.label" for="inc-asset">{{ t('incidents.fieldLinkedAsset') }}</label>
        <p v-if="assetsLoading" :class="ui.muted">{{ t('incidents.assetsLoading') }}</p>
        <p v-else-if="assetsError" :class="ui.muted">{{ t('incidents.assetsLoadHint') }} ({{ assetsError }})</p>
        <select
          v-else
          id="inc-asset"
          v-model="selectedParkAssetId"
          :class="ui.control"
          :disabled="!assetGroups.length"
        >
          <option value="">{{ t('incidents.linkedNone') }}</option>
          <optgroup v-for="g in assetGroups" :key="g.code" :label="g.label">
            <option v-for="a in g.items" :key="assetUuid(a)" :value="assetUuid(a)">
              {{ assetLabel(a) }}
            </option>
          </optgroup>
        </select>
        <p :class="ui.muted">{{ t('incidents.linkedAssetHint') }}</p>
      </div>

      <div :class="ui.footerRule">
        <button
          type="button"
          class="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          @click="router.back()"
        >
          {{ t('btn.cancel') }}
        </button>
        <button
          type="submit"
          class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="saving"
        >
          {{ t('incidents.create') }}
        </button>
      </div>
    </form>
  </div>
</template>
