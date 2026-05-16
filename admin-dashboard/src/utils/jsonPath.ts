/** Simple JSON path: "$.a.b" from object root (leading "$" required). */
export function getByDollarPath(obj: unknown, pathStr: string): unknown {
  if (pathStr == null || typeof pathStr !== 'string') return undefined
  const p = pathStr.trim()
  if (!p.startsWith('$')) return undefined
  const parts = p
    .slice(1)
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function applyPayloadTransformMappings(
  mappings: Record<string, string>,
  root: unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, tpl] of Object.entries(mappings)) {
    if (typeof tpl === 'string' && tpl.trim().startsWith('$')) {
      out[key] = getByDollarPath(root, tpl.trim())
    } else {
      out[key] = tpl
    }
  }
  return out
}
