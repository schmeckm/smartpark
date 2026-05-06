import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import {
  type RegionalPrefs,
  resolveRegionalPrefs,
  formatDateInPrefs,
  formatTimeInPrefs,
  formatDateTimeInPrefs,
  formatRelativeTimeInPrefs,
  toUtcIsoFromUserLocal,
  getTimezoneLabel,
  chartFootnoteLine,
  browserDefaultTimeZone,
} from '@/utils/dateTime'

/**
 * Vue-facing API: reads regional prefs from auth user with browser/UTC fallbacks.
 */
export function useRegionalDateTime() {
  const auth = useAuthStore()
  const { user } = storeToRefs(auth)

  const prefs = computed<RegionalPrefs>(() =>
    resolveRegionalPrefs({
      timezone: user.value?.timezone,
      dateFormat: user.value?.dateFormat,
      timeFormat: user.value?.timeFormat,
      locale: user.value?.locale,
      languageCode: user.value?.languageCode,
    })
  )

  function formatDate(value: string | number | Date | null | undefined) {
    return formatDateInPrefs(value, prefs.value)
  }
  function formatTime(value: string | number | Date | null | undefined) {
    return formatTimeInPrefs(value, prefs.value)
  }
  function formatDateTime(value: string | number | Date | null | undefined) {
    return formatDateTimeInPrefs(value, prefs.value)
  }
  function formatRelativeTime(value: string | number | Date | null | undefined) {
    return formatRelativeTimeInPrefs(value, prefs.value)
  }
  function toUtcIsoFromUserLocalWrapped(wallDate: string, wallTime?: string) {
    return toUtcIsoFromUserLocal(wallDate, prefs.value, wallTime)
  }
  function getCurrentUserTimezone() {
    return prefs.value.timeZone
  }
  function getTimezoneLabelWrapped() {
    return getTimezoneLabel(prefs.value.timeZone, prefs.value.locale)
  }
  function chartFootnote() {
    return chartFootnoteLine(prefs.value)
  }

  return {
    prefs,
    formatDate,
    formatTime,
    formatDateTime,
    formatRelativeTime,
    toUtcIsoFromUserLocal: toUtcIsoFromUserLocalWrapped,
    getCurrentUserTimezone,
    getTimezoneLabel: getTimezoneLabelWrapped,
    chartFootnote,
    browserDefaultTimeZone,
  }
}
