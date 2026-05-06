import type { UnsTopicRow } from '@/api/client'
import { normalizeThemeParksEntityType } from '@/lib/themeParksEntityDomain'

export type TopicParts = { park: string; version: string; domain: string; assetSlug: string; metric: string }

/** Known ThemeParks / Europa-Park style slugs → UNS domain (display + export). */
const SLUG_DISPLAY_DOMAIN: Record<string, string> = {
  adventure_food_station: 'restaurants',
  snow_angels: 'shows',
  adventure_playground: 'playgrounds',
}

export function parseTpunsTopic(path: string | null | undefined): TopicParts | null {
  if (!path) return null
  const parts = String(path).split('/').filter(Boolean)
  if (parts.length < 6 || parts[0].toLowerCase() !== 'tpuns') return null
  return {
    park: parts[1],
    version: parts[2],
    domain: parts[3],
    assetSlug: parts[4],
    metric: parts[5],
  }
}

export function displayDomainForSlug(
  assetSlug: string,
  topicDomain: string,
  entityType?: string | null
): string {
  if (entityType != null && String(entityType).trim() !== '') {
    return normalizeThemeParksEntityType(entityType)
  }
  return SLUG_DISPLAY_DOMAIN[assetSlug] ?? topicDomain
}

export type EntityMetric = {
  metric: string
  canonicalUnsTopic: string
  leafId: string
  leafName: string | null
}

export type AggregatedEntityRow = {
  key: string
  displayName: string
  domain: string
  topicDomain: string
  assetSlug: string
  metrics: EntityMetric[]
}

function stripMetricSuffix(leafName: string | null, metric: string): string {
  if (!leafName) return ''
  const m = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\s*-\\s*${m}\\s*$`, 'i')
  return leafName.replace(re, '').trim()
}

export function aggregateUnsLeavesToEntities(rows: UnsTopicRow[]): AggregatedEntityRow[] {
  const map = new Map<string, AggregatedEntityRow>()
  for (const r of rows) {
    const path = r.canonicalUnsTopic || r.topicPath
    const parts = parseTpunsTopic(path)
    if (!parts) continue
    const key = `${parts.domain}::${parts.assetSlug}`
    const displayDomain = displayDomainForSlug(parts.assetSlug, parts.domain)
    if (!map.has(key)) {
      map.set(key, {
        key,
        displayName: '',
        domain: displayDomain,
        topicDomain: parts.domain,
        assetSlug: parts.assetSlug,
        metrics: [],
      })
    }
    const ent = map.get(key)!
    ent.metrics.push({
      metric: parts.metric,
      canonicalUnsTopic: path || '',
      leafId: r.id,
      leafName: r.name,
    })
  }
  for (const ent of map.values()) {
    ent.metrics.sort((a, b) => a.metric.localeCompare(b.metric))
    const candidates = ent.metrics.map((m) => stripMetricSuffix(m.leafName, m.metric)).filter(Boolean)
    ent.displayName = candidates.length ? candidates.reduce((a, b) => (a.length <= b.length ? a : b)) : ent.assetSlug
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
}
