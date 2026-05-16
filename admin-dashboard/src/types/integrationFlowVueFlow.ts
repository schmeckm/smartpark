/**
 * Shallow Vue Flow DTOs for Integration Flow Studio.
 * Keeps vue-tsc away from @vue-flow/core deep Node/Edge generics.
 */

/** Run/validation overlay — presentation only; never persisted to flow_json. */
export type IntegrationFlowNodePresentation = {
  nodeType: string
  nodeId: string
  displayName: string
  category: string
  status: string
  errorMessage: string
  validationHighlight: boolean
  durationMs: number | null
  hasPreview: boolean
}

export type IntegrationFlowVfPosition = { x: number; y: number }

export type IntegrationFlowVfNode = {
  id: string
  type: string
  position: IntegrationFlowVfPosition
  data: IntegrationFlowNodePresentation
  connectable?: boolean
  draggable?: boolean
  deletable?: boolean
  selected?: boolean
}

export type IntegrationFlowVfEdge = {
  id: string
  source: string
  target: string
  deletable?: boolean
}
