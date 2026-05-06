<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { patchMyUserSettings } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { DEFAULT_PARK_MAP_FREQ_THRESHOLDS, parseParkMapFreqThresholds } from '@/utils/parkMapFreqThresholds'
import { useToast } from '@/composables/useToast'
import { setI18nLocale, type AppLocale } from '@/i18n'
import { persistThemePreference, themePreference } from '@/composables/useUiTheme'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import type { UserDateFormat, UserTimeFormat } from '@/types/auth'
import { resolveRegionalPrefs, formatDateTimeInPrefs } from '@/utils/dateTime'

const { surfaces: ui } = usePageSurfaces()

const { t } = useI18n()
const auth = useAuthStore()
const { push } = useToast()

const NOTIFY_KEY = 'sp_notify_pref'

const displayName = ref('')
const languageCode = ref<AppLocale>('en')
const theme = ref<'dark' | 'light'>('dark')
const notifyEnabled = ref(false)
const saving = ref(false)

const timezone = ref('')
const dateFormat = ref<UserDateFormat>('YYYY-MM-DD')
const timeFormat = ref<UserTimeFormat>('24h')
const localeUi = ref('en-US')

const freqVeryHighMin = ref(DEFAULT_PARK_MAP_FREQ_THRESHOLDS.veryHighMin)
const freqMediumMin = ref(DEFAULT_PARK_MAP_FREQ_THRESHOLDS.mediumMin)
const freqLowMin = ref(DEFAULT_PARK_MAP_FREQ_THRESHOLDS.lowMin)

const locales: { code: AppLocale; labelKey: string }[] = [
  { code: 'en', labelKey: 'locale.en' },
  { code: 'de', labelKey: 'locale.de' },
  { code: 'fr', labelKey: 'locale.fr' },
  { code: 'es', labelKey: 'locale.es' },
]

const localeChoices = [
  { value: 'en-US', labelKey: 'settings.regional.localeEnUs' },
  { value: 'de-DE', labelKey: 'settings.regional.localeDeDe' },
  { value: 'fr-FR', labelKey: 'settings.regional.localeFrFr' },
  { value: 'es-ES', labelKey: 'settings.regional.localeEsEs' },
] as const

const dateFormatChoices: { value: UserDateFormat; labelKey: string }[] = [
  { value: 'YYYY-MM-DD', labelKey: 'settings.regional.dfIso' },
  { value: 'DD.MM.YYYY', labelKey: 'settings.regional.dfDe' },
  { value: 'MM/DD/YYYY', labelKey: 'settings.regional.dfUs' },
]

const timeFormatChoices: { value: UserTimeFormat; labelKey: string }[] = [
  { value: '24h', labelKey: 'settings.regional.tf24' },
  { value: '12h', labelKey: 'settings.regional.tf12' },
]

const commonTimezones = [
  'UTC',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Asia/Tokyo',
  'Australia/Sydney',
]

const previewPrefs = computed(() =>
  resolveRegionalPrefs({
    timezone: timezone.value.trim() || null,
    dateFormat: dateFormat.value,
    timeFormat: timeFormat.value,
    locale: localeUi.value,
    languageCode: languageCode.value,
  })
)

const previewExample = computed(() => {
  const sample = new Date('2026-04-29T16:30:19.000Z')
  const formatted = formatDateTimeInPrefs(sample, previewPrefs.value)
  return `${formatted} · ${previewPrefs.value.timeZone}`
})

function loadLocalPrefs() {
  theme.value = themePreference.value
  notifyEnabled.value = localStorage.getItem(NOTIFY_KEY) === '1'
}

function syncFromUser() {
  const u = auth.user
  displayName.value = u?.displayName ?? ''
  languageCode.value = (u?.languageCode as AppLocale) || 'en'
  timezone.value = u?.timezone ?? ''
  dateFormat.value = (u?.dateFormat as UserDateFormat) || 'YYYY-MM-DD'
  timeFormat.value = u?.timeFormat === '12h' ? '12h' : '24h'
  localeUi.value =
    u?.locale && ['en-US', 'de-DE', 'fr-FR', 'es-ES'].includes(u.locale)
      ? u.locale
      : u?.languageCode === 'de'
        ? 'de-DE'
        : u?.languageCode === 'fr'
          ? 'fr-FR'
          : u?.languageCode === 'es'
            ? 'es-ES'
            : 'en-US'
  const prefs = u?.uiPreferences && typeof u.uiPreferences === 'object' ? u.uiPreferences : {}
  const th = parseParkMapFreqThresholds((prefs as Record<string, unknown>).parkMapFreqThresholds)
  freqVeryHighMin.value = th.veryHighMin
  freqMediumMin.value = th.mediumMin
  freqLowMin.value = th.lowMin
}

function restoreFreqDefaults() {
  freqVeryHighMin.value = DEFAULT_PARK_MAP_FREQ_THRESHOLDS.veryHighMin
  freqMediumMin.value = DEFAULT_PARK_MAP_FREQ_THRESHOLDS.mediumMin
  freqLowMin.value = DEFAULT_PARK_MAP_FREQ_THRESHOLDS.lowMin
}

onMounted(() => {
  loadLocalPrefs()
  syncFromUser()
})

const headerName = computed(() => {
  const u = auth.user
  if (!u) return ''
  const d = displayName.value.trim()
  if (d) return d
  return `${u.firstName} ${u.lastName}`.trim()
})

async function saveAll() {
  const vh = Number(freqVeryHighMin.value)
  const vm = Number(freqMediumMin.value)
  const vl = Number(freqLowMin.value)
  if (![vh, vm, vl].every((n) => Number.isFinite(n) && n >= 1 && n <= 50000)) {
    push(t('settings.parkMapFreq.invalidNumbers'), 'error')
    return
  }
  if (!(vh > vm && vm > vl)) {
    push(t('settings.parkMapFreq.invalidOrder'), 'error')
    return
  }
  saving.value = true
  try {
    const u = await patchMyUserSettings({
      displayName: displayName.value.trim() || null,
      languageCode: languageCode.value,
      timezone: timezone.value.trim() || null,
      dateFormat: dateFormat.value,
      timeFormat: timeFormat.value,
      locale: localeUi.value,
      uiPreferences: {
        parkMapFreqThresholds: {
          veryHighMin: Math.round(vh),
          mediumMin: Math.round(vm),
          lowMin: Math.round(vl),
        },
      },
    })
    auth.user = u
    setI18nLocale(languageCode.value)
    persistThemePreference(theme.value)
    localStorage.setItem(NOTIFY_KEY, notifyEnabled.value ? '1' : '0')
    push(t('settings.saved'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
    <div>
      <h1 :class="ui.title">{{ t('settings.title') }}</h1>
      <p :class="ui.subtitle">{{ auth.user?.email }}</p>
    </div>

    <div
      v-if="auth.can('SYSTEM_ADMIN')"
      class="rounded-lg border border-brand-600/35 bg-brand-950/25 px-4 py-3 text-sm text-slate-300"
    >
      <RouterLink to="/admin/platform-settings" class="font-medium text-brand-400 hover:text-brand-300">
        Platform settings
      </RouterLink>
      <p class="mt-1 text-slate-500">
        AI, weather, adapter cron runner, external-poll master switch — DB with ENV fallback. Polling interval and provider:
        Integrations.
      </p>
    </div>

    <div :class="ui.card">
      <section :class="ui.sectionBorder">
        <h2 :class="ui.h2">{{ t('settings.profile') }}</h2>
        <p :class="ui.muted">{{ t('settings.displayNameHint') }}</p>
        <label :class="ui.label">{{ t('settings.profileDisplayName') }}</label>
        <input
          v-model="displayName"
          type="text"
          :class="ui.control"
          :placeholder="headerName"
        />
      </section>

      <section :class="ui.sectionBorderMid">
        <h2 :class="ui.h2">{{ t('settings.regional.title') }}</h2>
        <p :class="ui.muted">{{ t('settings.regional.hint') }}</p>

        <label :class="ui.label" class="!mt-4">{{ t('settings.regional.timezone') }}</label>
        <input
          v-model="timezone"
          type="text"
          :class="ui.control"
          class="!mt-1 font-mono text-sm"
          list="tz-common"
          :placeholder="t('settings.regional.timezonePh')"
          autocomplete="off"
        />
        <datalist id="tz-common">
          <option v-for="z in commonTimezones" :key="z" :value="z" />
        </datalist>

        <label :class="ui.label" class="!mt-3">{{ t('settings.regional.localeUi') }}</label>
        <select v-model="localeUi" :class="ui.control" class="!mt-1">
          <option v-for="o in localeChoices" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
        </select>

        <label :class="ui.label" class="!mt-3">{{ t('settings.regional.dateFormat') }}</label>
        <select v-model="dateFormat" :class="ui.control" class="!mt-1">
          <option v-for="o in dateFormatChoices" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
        </select>

        <label :class="ui.label" class="!mt-3">{{ t('settings.regional.timeFormat') }}</label>
        <select v-model="timeFormat" :class="ui.control" class="!mt-1">
          <option v-for="o in timeFormatChoices" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
        </select>

        <p class="mt-4 rounded-md border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
          <span class="text-slate-500">{{ t('settings.regional.previewLabel') }}</span>
          {{ previewExample }}
        </p>
      </section>

      <section :class="ui.sectionBorderMid">
        <h2 :class="ui.h2">{{ t('settings.parkMapFreq.title') }}</h2>
        <p :class="ui.muted">{{ t('settings.parkMapFreq.hint') }}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label :class="ui.label">{{ t('settings.parkMapFreq.veryHigh') }}</label>
            <input v-model.number="freqVeryHighMin" type="number" min="1" max="50000" :class="ui.control" class="!mt-1" />
          </div>
          <div>
            <label :class="ui.label">{{ t('settings.parkMapFreq.medium') }}</label>
            <input v-model.number="freqMediumMin" type="number" min="1" max="50000" :class="ui.control" class="!mt-1" />
          </div>
          <div>
            <label :class="ui.label">{{ t('settings.parkMapFreq.low') }}</label>
            <input v-model.number="freqLowMin" type="number" min="1" max="50000" :class="ui.control" class="!mt-1" />
          </div>
        </div>
        <p :class="ui.muted" class="!mt-2">{{ t('settings.parkMapFreq.weakHint') }}</p>
        <button
          type="button"
          class="mt-2 rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          @click="restoreFreqDefaults"
        >
          {{ t('settings.parkMapFreq.restoreDefaults') }}
        </button>
      </section>

      <section :class="ui.sectionBorderMid">
        <h2 :class="ui.h2">{{ t('settings.language') }}</h2>
        <label :class="ui.label">{{ t('locale.label') }}</label>
        <select v-model="languageCode" :class="ui.control">
          <option v-for="l in locales" :key="l.code" :value="l.code">{{ t(l.labelKey) }}</option>
        </select>
      </section>

      <section :class="ui.sectionBorderMid">
        <h2 :class="ui.h2">{{ t('settings.theme') }}</h2>
        <p :class="ui.muted">{{ t('settings.themeHint') }}</p>
        <div class="mt-3 flex flex-wrap gap-3 text-sm">
          <label :class="ui.choice">
            <input v-model="theme" type="radio" value="dark" class="border-slate-600" />
            {{ t('settings.themeDark') }}
          </label>
          <label :class="ui.choice">
            <input v-model="theme" type="radio" value="light" class="border-slate-600" />
            {{ t('settings.themeLight') }}
          </label>
        </div>
      </section>

      <section class="pt-5">
        <h2 :class="ui.h2">{{ t('settings.notifications') }}</h2>
        <p :class="ui.muted">{{ t('settings.notificationsHint') }}</p>
        <label :class="ui.checkboxRow">
          <input v-model="notifyEnabled" type="checkbox" class="rounded border-slate-600" />
          {{ t('settings.notifications') }}
        </label>
      </section>
    </div>

    <div :class="ui.infoBox">
      {{ t('settings.contentI18nHint') }}
    </div>

    <div :class="ui.footerRule">
      <button
        type="button"
        class="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        :disabled="saving"
        @click="saveAll"
      >
        {{ t('settings.saveAll') }}
      </button>
    </div>
  </div>
</template>
