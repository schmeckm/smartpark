/** Studio palette section order (n8n / Node-RED style). */
export const PALETTE_CATEGORY_ORDER = [
  'Trigger',
  'Adapter',
  'Transform',
  'Canonical',
  'Output',
  'AI',
  'Utility',
] as const

export type PaletteCategory = (typeof PALETTE_CATEGORY_ORDER)[number] | 'Other'

const CATEGORY_ALIASES: Record<string, PaletteCategory> = {
  trigger: 'Trigger',
  adapter: 'Adapter',
  transform: 'Transform',
  canonical: 'Canonical',
  output: 'Output',
  ai: 'AI',
  utility: 'Utility',
}

export function resolvePaletteCategory(category: string | null | undefined, nodeType: string | null | undefined): PaletteCategory {
  const raw = (category || nodeType || '').trim()
  if (!raw) return 'Other'
  if ((PALETTE_CATEGORY_ORDER as readonly string[]).includes(raw)) {
    return raw as (typeof PALETTE_CATEGORY_ORDER)[number]
  }
  const alias = CATEGORY_ALIASES[raw.toLowerCase()]
  if (alias) return alias
  return 'Other'
}

export function categorySortIndex(category: PaletteCategory): number {
  if (category === 'Other') return PALETTE_CATEGORY_ORDER.length
  const i = (PALETTE_CATEGORY_ORDER as readonly string[]).indexOf(category)
  return i >= 0 ? i : PALETTE_CATEGORY_ORDER.length
}
