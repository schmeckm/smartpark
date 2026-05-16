import type { IntegrationFlowJson, IntegrationFlowJsonNode } from '@/api/client'

/**
 * Builds flow_json from canonical graph + canvas positions.
 * Only nodes in positionPersistIds receive nodes[].position; run/timeline/validation
 * data must never be included.
 */
export function buildIntegrationFlowEmitPayload(
  canonicalNodes: IntegrationFlowJsonNode[],
  canonicalEdges: IntegrationFlowJson['edges'],
  positionsById: ReadonlyMap<string, { x: number; y: number }>,
  positionPersistIds: ReadonlySet<string>
): IntegrationFlowJson {
  const nodes: IntegrationFlowJsonNode[] = canonicalNodes.map((n) => {
    const base: IntegrationFlowJsonNode = {
      id: n.id,
      type: n.type,
      config: { ...(n.config || {}) },
    }
    const pos = positionsById.get(n.id)
    if (positionPersistIds.has(n.id) && pos) {
      base.position = { x: pos.x, y: pos.y }
    }
    return base
  })
  return { nodes, edges: canonicalEdges.map((e) => ({ source: e.source, target: e.target })) }
}

/** Guards against accidental overlay keys in emitted flow_json (dev/test). */
export function flowJsonHasNoPresentationKeys(flow: IntegrationFlowJson): boolean {
  for (const n of flow.nodes) {
    const extra = Object.keys(n).filter((k) => !['id', 'type', 'config', 'position'].includes(k))
    if (extra.length) return false
    const cfg = n.config
    if (cfg && typeof cfg === 'object') {
      for (const k of ['status', 'errorMessage', 'timeline', 'validationHighlight']) {
        if (k in (cfg as object)) return false
      }
    }
  }
  return true
}
