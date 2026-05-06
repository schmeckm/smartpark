/**
 * Mirrors `theme-parks-entity-domain.service.js` for UNS Topics / Explorer display.
 */
function slugish(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const ENUM_TO_DOMAIN: Record<string, string> = {
  DESTINATION: 'destinations',
  PARK: 'parks',
  ATTRACTION: 'rides',
  RIDE: 'rides',
  PLAYGROUND: 'playgrounds',
  RESTAURANT: 'restaurants',
  SHOW: 'shows',
  SHOP: 'shops',
  HOTEL: 'hotels',
  TRANSPORT: 'transport',
  SERVICE: 'services',
}

const SLUG_TO_DOMAIN: Record<string, string> = {
  restaurant: 'restaurants',
  ride: 'rides',
  attraction: 'rides',
  hotel: 'hotels',
  shop: 'shops',
  service: 'services',
  destination: 'destinations',
  park: 'parks',
  playground: 'playgrounds',
  playgrounds: 'playgrounds',
}

export function normalizeThemeParksEntityType(entityType: string | null | undefined): string {
  const raw = String(entityType ?? '').trim()
  if (!raw) return 'entities'
  const t = raw.toUpperCase()
  if (ENUM_TO_DOMAIN[t]) return ENUM_TO_DOMAIN[t]
  const slug = slugish(raw)
  const canonical = new Set([...Object.values(ENUM_TO_DOMAIN), 'playgrounds', 'entities'])
  if (canonical.has(slug)) return slug
  if (SLUG_TO_DOMAIN[slug]) return SLUG_TO_DOMAIN[slug]
  return 'entities'
}
