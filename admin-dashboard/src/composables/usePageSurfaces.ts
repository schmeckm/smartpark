import { computed } from 'vue'
import { themePreference } from '@/composables/useUiTheme'

/**
 * Theme-aware Tailwind class bundles for page content (cards, typography).
 * Use in views so light mode stays WCAG-safe alongside `MainLayout` shell.
 */
export function usePageSurfaces() {
  const isLight = computed(() => themePreference.value === 'light')

  const surfaces = computed(() => {
    const L = isLight.value
    return {
      title: L ? 'font-display text-xl font-semibold text-slate-900' : 'font-display text-xl font-semibold text-white',
      subtitle: L ? 'mt-1 text-sm text-slate-600' : 'mt-1 text-sm text-slate-500',
      card: L
        ? 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
        : 'rounded-xl border border-slate-800 bg-slate-900/60 p-5',
      sectionBorder: L ? 'border-b border-slate-200/90 pb-5' : 'border-b border-slate-800/80 pb-5',
      sectionBorderMid: L ? 'border-b border-slate-200/90 py-5' : 'border-b border-slate-800/80 py-5',
      h2: L ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-white',
      muted: L ? 'mt-1 text-xs text-slate-600' : 'mt-1 text-xs text-slate-500',
      label: L ? 'mt-3 block text-xs text-slate-600' : 'mt-3 block text-xs text-slate-500',
      /** Inline filter labels / micro-hints — follows app theme (not OS prefers-color-scheme). */
      filterLabel: L ? 'text-xs font-medium text-slate-600' : 'text-xs font-medium text-slate-300',
      filterHint: L ? 'text-[11px] leading-snug text-slate-600' : 'text-[11px] leading-snug text-slate-300',
      control: L
        ? 'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 [color-scheme:light]'
        : 'mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]',
      choice: L ? 'flex cursor-pointer items-center gap-2 text-slate-800' : 'flex cursor-pointer items-center gap-2 text-slate-300',
      checkboxRow: L
        ? 'mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-800'
        : 'mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-300',
      infoBox: L
        ? 'rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700'
        : 'rounded-lg border border-slate-700/80 bg-slate-950/40 p-4 text-xs leading-relaxed text-slate-300',
      /** Nested KPI / metric tiles (health strip, small stat grids) — avoids washed-out gray panels on dark shell */
      metricTile: L
        ? 'rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm'
        : 'rounded-lg border border-slate-700/90 bg-slate-950/90 p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.035)]',
      chartLoadingPane: L
        ? 'flex min-h-[13rem] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500'
        : 'flex min-h-[13rem] items-center justify-center rounded-lg border border-slate-800 bg-slate-950/90 text-sm text-slate-400',
      chartEmptyPane: L
        ? 'flex min-h-[13rem] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/90 px-4 text-center text-sm text-slate-600'
        : 'flex min-h-[13rem] items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/75 px-4 text-center text-sm text-slate-400',
      chartCanvasPane: L
        ? 'h-52 w-full min-h-[13rem] rounded-lg border border-slate-200 bg-white'
        : 'h-52 w-full min-h-[13rem] rounded-lg border border-slate-800 bg-slate-950/90',
      calloutSm: L
        ? 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-700'
        : 'rounded-lg border border-brand-800/35 bg-slate-950/75 px-3 py-2 text-xs leading-snug text-brand-400',
      tableShell: L
        ? 'overflow-x-auto rounded-lg border border-slate-200 bg-white'
        : 'overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80',
      footerRule: L
        ? 'flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4'
        : 'flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4',
      statLabel: L ? 'text-xs uppercase tracking-wide text-slate-600' : 'text-xs uppercase tracking-wide text-slate-500',
      statValue: L ? 'mt-1 text-2xl font-semibold text-slate-900' : 'mt-1 text-2xl font-semibold text-white',
      tableHead: L ? 'border-b border-slate-200 text-xs uppercase text-slate-600' : 'border-b border-slate-700 text-xs uppercase text-slate-500',
      tableRow: L ? 'border-b border-slate-200/90' : 'border-b border-slate-800/80',
      tableCell: L ? 'py-2 text-slate-800' : 'py-2 text-slate-200',
      tableCellMuted: L ? 'py-2 text-slate-600' : 'py-2 text-slate-400',
      barTrack: L ? 'h-2 w-full overflow-hidden rounded bg-slate-200' : 'h-2 w-full overflow-hidden rounded bg-slate-800',
      barFill: 'h-full rounded bg-gradient-to-r from-brand-600 to-indigo-500',
    }
  })

  return { isLight, surfaces }
}
