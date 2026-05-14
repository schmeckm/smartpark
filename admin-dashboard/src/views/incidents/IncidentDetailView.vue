<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getIncident, getPlatformAssets, patchIncident } from '@/api/client'
import type { Incident, IncidentStatus, PlatformAsset } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const { formatDateTime } = useRegionalDateTime()

const row = ref<Incident | null>(null)
const loading = ref(true)
const saving = ref(false)

const title = ref('')
const description = ref('')
const severity = ref('MEDIUM')
const status = ref<IncidentStatus>('OPEN')

/** Park object UUID; persisted as linkedEntityType=PARK_ASSET + linkedEntityId. */
const selectedParkAssetId = ref('')
/** ZONE/RIDE/… rows until user picks a park object above. */
const legacyNonAssetLink = ref<{ type: string; id: string } | null>(null)

const GROUP_KEYS = ['RIDE', 'RESTAURANT', 'SHOW', 'SHOP', 'OTHER'] as const

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

const unknownParkAssetOption = computed(() => {
  const id = selectedParkAssetId.value.trim()
  if (!id) return null
  if (assets.value.some((a) => assetUuid(a) === id)) return null
  const shortId = id.length > 14 ? `${id.slice(0, 8)}…` : id
  return { id, label: t('incidents.unknownLinkedAsset', { shortId }) }
})

const resolvedParkAssetLabel = computed(() => {
  const id = selectedParkAssetId.value.trim()
  if (!id) return t('incidents.linkedNone')
  const a = assets.value.find((x) => assetUuid(x) === id)
  if (a) return assetLabel(a)
  const shortId = id.length > 14 ? `${id.slice(0, 8)}…` : id
  return t('incidents.unknownLinkedAsset', { shortId })
})

function applyIncidentLinkFields(data: Incident) {
  const lt = (data.linkedEntityType || '').trim()
  const lid = (data.linkedEntityId || '').trim()
  if (lt === 'PARK_ASSET') {
    selectedParkAssetId.value = lid
    legacyNonAssetLink.value = null
    return
  }
  if (lt && lid) {
    selectedParkAssetId.value = ''
    legacyNonAssetLink.value = { type: lt, id: lid }
    return
  }
  selectedParkAssetId.value = ''
  legacyNonAssetLink.value = null
}

function patchLinkPayload(): { linkedEntityType: string | null; linkedEntityId: string | null } {
  const pick = selectedParkAssetId.value.trim()
  if (pick) return { linkedEntityType: 'PARK_ASSET', linkedEntityId: pick }
  if (legacyNonAssetLink.value)
    return {
      linkedEntityType: legacyNonAssetLink.value.type,
      linkedEntityId: legacyNonAssetLink.value.id,
    }
  return { linkedEntityType: null, linkedEntityId: null }
}

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
    void loadAssets()
  },
  { immediate: true }
)

const canEdit = computed(() => auth.hasPermission('incidents', 'create') || auth.hasPermission('incidents', 'assign'))

const canOpenOeeForAsset = computed(
  () =>
    auth.hasPermission('rides', 'read') &&
    !!parkCtx.activeParkId &&
    !!selectedParkAssetId.value.trim()
)

const showAssignToMe = computed(() => {
  if (!canEdit.value || !auth.user || !row.value) return false
  return row.value.ownerUserId !== auth.user.id
})

async function load() {
  const id = String(route.params.id || '')
  if (!id || !parkCtx.activeParkId) {
    row.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    const data = await getIncident(id)
    row.value = data
    title.value = data.title
    description.value = data.description || ''
    severity.value = data.severity
    status.value = data.status
    applyIncidentLinkFields(data)
  } catch {
    row.value = null
    push(t('incidents.loadError'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(() => [route.params.id, parkCtx.activeParkId], () => void load())

async function save() {
  if (!row.value || !canEdit.value) return
  saving.value = true
  try {
    const link = patchLinkPayload()
    const patch: Record<string, unknown> = {
      title: title.value.trim(),
      description: description.value.trim() || null,
      severity: severity.value,
      status: status.value,
      linkedEntityType: link.linkedEntityType,
      linkedEntityId: link.linkedEntityId,
    }
    const updated = await patchIncident(row.value.id, patch)
    row.value = updated
    applyIncidentLinkFields(updated)
    push(t('incidents.saved'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    saving.value = false
  }
}

async function assignToMe() {
  if (!row.value || !auth.user) return
  saving.value = true
  try {
    const updated = await patchIncident(row.value.id, { ownerUserId: auth.user.id })
    row.value = updated
    applyIncidentLinkFields(updated)
    push(t('incidents.assignedSelf'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    saving.value = false
  }
}

function closeDetail() {
  router.push({ name: 'incidents' })
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        class="text-sm text-brand-400 hover:text-brand-300"
        @click="closeDetail"
      >
        ← {{ t('incidents.backList') }}
      </button>
      <button
        v-if="!loading && row"
        type="button"
        class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        @click="closeDetail"
      >
        {{ t('incidents.close') }}
      </button>
    </div>

    <div v-if="loading" :class="ui.muted">{{ t('incidents.loading') }}</div>

    <template v-else-if="row">
      <div>
        <h1 :class="ui.title">{{ t('incidents.detailTitle') }}</h1>
        <p :class="ui.subtitle">{{ row.id }}</p>
        <p :class="ui.muted" class="mt-2 text-xs">
          <span>{{ t('incidents.createdAtLabel') }}: {{ formatDateTime(row.createdAt) }}</span>
          <span v-if="row.updatedAt !== row.createdAt">
            · {{ t('incidents.updatedAtLabel') }}: {{ formatDateTime(row.updatedAt) }}</span>
        </p>
      </div>

      <form :class="ui.card" class="space-y-4" @submit.prevent="save">
        <div>
          <label :class="ui.label">{{ t('incidents.fieldTitle') }}</label>
          <input v-model="title" type="text" :class="ui.control" :disabled="!canEdit" maxlength="200" />
        </div>
        <div>
          <label :class="ui.label">{{ t('incidents.fieldDescription') }}</label>
          <textarea v-model="description" rows="5" :class="ui.control" :disabled="!canEdit" />
        </div>
        <div>
          <label :class="ui.label" for="inc-detail-asset">{{ t('incidents.fieldLinkedAsset') }}</label>
          <p v-if="legacyNonAssetLink && canEdit" class="mt-1 rounded-md border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
            {{ t('incidents.legacyLinkNotice', { type: legacyNonAssetLink.type }) }}
            <span class="ml-1 font-mono text-amber-200/80">{{ legacyNonAssetLink.id }}</span>
          </p>
          <p v-if="assetsLoading" :class="ui.muted">{{ t('incidents.assetsLoading') }}</p>
          <p v-else-if="assetsError" :class="ui.muted">{{ t('incidents.assetsLoadHint') }} ({{ assetsError }})</p>
          <p
            v-else-if="!canEdit"
            :class="ui.control"
            class="mt-1 border border-slate-700 bg-slate-950/80 py-2 text-slate-200"
          >
            <template v-if="selectedParkAssetId">{{ resolvedParkAssetLabel }}</template>
            <template v-else-if="legacyNonAssetLink">
              {{ legacyNonAssetLink.type }} — <span class="font-mono">{{ legacyNonAssetLink.id }}</span>
            </template>
            <template v-else>{{ t('incidents.linkedNone') }}</template>
          </p>
          <select
            v-else
            id="inc-detail-asset"
            v-model="selectedParkAssetId"
            :class="ui.control"
            class="mt-1 w-full"
            :disabled="!assetGroups.length && !unknownParkAssetOption"
          >
            <option value="">{{ t('incidents.linkedNone') }}</option>
            <optgroup v-for="g in assetGroups" :key="g.code" :label="g.label">
              <option v-for="a in g.items" :key="assetUuid(a)" :value="assetUuid(a)">
                {{ assetLabel(a) }}
              </option>
            </optgroup>
            <option v-if="unknownParkAssetOption" :value="unknownParkAssetOption.id">
              {{ unknownParkAssetOption.label }}
            </option>
          </select>
        </div>
        <p :class="ui.muted">{{ t('incidents.linkedAssetHint') }}</p>
        <RouterLink
          v-if="canOpenOeeForAsset"
          :to="{
            name: 'platform-oee',
            query: { parkId: parkCtx.activeParkId, assetId: selectedParkAssetId.trim() },
          }"
          class="inline-flex text-sm text-brand-400 hover:text-brand-300 hover:underline"
        >
          {{ t('incidents.linkToOee') }}
        </RouterLink>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label :class="ui.label">{{ t('incidents.fieldSeverity') }}</label>
            <select v-model="severity" :class="ui.control" :disabled="!canEdit">
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          <div>
            <label :class="ui.label">{{ t('incidents.fieldStatus') }}</label>
            <select v-model="status" :class="ui.control" :disabled="!canEdit">
              <option value="OPEN">{{ t('incidents.statusOpen') }}</option>
              <option value="IN_PROGRESS">{{ t('incidents.statusInProgress') }}</option>
              <option value="RESOLVED">{{ t('incidents.statusResolved') }}</option>
              <option value="CLOSED">{{ t('incidents.statusClosed') }}</option>
            </select>
          </div>
        </div>
        <div v-if="row.owner" class="text-xs text-slate-500">
          {{ t('incidents.owner') }}:
          {{ row.owner.displayName || `${row.owner.firstName} ${row.owner.lastName}` }}
        </div>
        <div v-if="row.creator" class="text-xs text-slate-500">
          {{ t('incidents.creator') }}:
          {{ row.creator.displayName || `${row.creator.firstName} ${row.creator.lastName}` }}
        </div>

        <div v-if="row" :class="[ui.footerRule, 'items-center !justify-between']">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="showAssignToMe && canEdit"
              type="button"
              class="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
              :disabled="saving"
              @click="assignToMe"
            >
              {{ t('incidents.assignToMe') }}
            </button>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              :disabled="saving"
              @click="closeDetail"
            >
              {{ t('incidents.close') }}
            </button>
            <button
              v-if="canEdit"
              type="submit"
              class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              :disabled="saving"
            >
              {{ t('btn.save') }}
            </button>
          </div>
        </div>
      </form>
    </template>

    <div v-else :class="ui.infoBox">{{ t('incidents.notFound') }}</div>
  </div>
</template>
