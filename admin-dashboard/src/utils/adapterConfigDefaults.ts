/**
 * Starter values from adapter manifest `configSchema.properties.*.default` (JSON Schema subset).
 */
export function defaultsFromConfigSchema(configSchema: unknown): Record<string, unknown> {
  if (!configSchema || typeof configSchema !== 'object') return {}
  const props = (configSchema as { properties?: Record<string, unknown> }).properties
  if (!props || typeof props !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(props)) {
    if (!spec || typeof spec !== 'object') continue
    if (!Object.prototype.hasOwnProperty.call(spec, 'default')) continue
    out[key] = (spec as { default?: unknown }).default
  }
  return out
}

/**
 * For each key in `defaults`, set on `saved` only if missing (undefined / absent).
 * Saved values always win; partial installs keep user overrides.
 */
export function fillMissingConfigDefaults(
  defaults: Record<string, unknown>,
  saved: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const s = saved && typeof saved === 'object' ? { ...saved } : {}
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in s)) s[k] = v
  }
  return s
}
