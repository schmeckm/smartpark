import { computed, ref, watch, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { IntegrationFlowJson, IntegrationNodeRegistryEntryDto } from '@/api/client'

export type NodeConfigFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json-object'
  | 'json-array'
  | 'unsupported'

export type NodeConfigFormField = {
  key: string
  kind: NodeConfigFieldKind
  required: boolean
  nullable: boolean
  description?: string
  minimum?: number
  maximum?: number
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function normalizeJsonSchemaType(
  sub: unknown,
): { kind: NodeConfigFieldKind; nullable: boolean; minimum?: number; maximum?: number } {
  if (!isPlainRecord(sub)) return { kind: 'unsupported', nullable: false }
  let nullable = false
  let t: unknown = sub.type
  if (Array.isArray(t)) {
    const types = t.map((x) => String(x))
    nullable = types.includes('null')
    const nonNull = types.filter((x) => x !== 'null')
    if (nonNull.length !== 1) return { kind: 'unsupported', nullable }
    t = nonNull[0]
  }
  const minimum = typeof sub.minimum === 'number' ? sub.minimum : undefined
  const maximum = typeof sub.maximum === 'number' ? sub.maximum : undefined

  if (t === 'integer' || t === 'number') return { kind: 'number', nullable, minimum, maximum }
  if (t === 'boolean') return { kind: 'boolean', nullable }
  if (t === 'object') return { kind: 'json-object', nullable }
  if (t === 'array') return { kind: 'json-array', nullable }
  if (t === 'string') return { kind: 'string', nullable }
  return { kind: 'unsupported', nullable }
}

function extractFormFieldsFromConfigSchema(raw: unknown): NodeConfigFormField[] {
  if (!isPlainRecord(raw) || raw.type !== 'object') return []
  const props = raw.properties
  if (!isPlainRecord(props)) return []
  const required = Array.isArray(raw.required) ? raw.required.map(String) : []

  const out: NodeConfigFormField[] = []
  for (const key of Object.keys(props).sort()) {
    const sub = props[key]
    const desc = isPlainRecord(sub) && typeof sub.description === 'string' ? sub.description : undefined
    const { kind, nullable, minimum, maximum } = normalizeJsonSchemaType(sub)
    out.push({
      key,
      kind,
      required: required.includes(key),
      nullable,
      description: desc,
      minimum,
      maximum,
    })
  }
  return out
}

export function useIntegrationFlowNodeConfigForm(opts: {
  editorFlowJsonText: Ref<string>
  nodes: Ref<IntegrationNodeRegistryEntryDto[]>
  selectedFlowId: Ref<string | null>
  flowJsonError: Ref<string | null>
  detailLoading: Ref<boolean>
  canRead: Ref<boolean>
  t: ComposerTranslation
}) {
  const { editorFlowJsonText, nodes, selectedFlowId, flowJsonError, detailLoading, canRead, t } = opts

  const selectedNodeIdForConfig = ref('')
  const nodeConfigPanelErrors = ref<string[]>([])
  const jsonDrafts = ref<Record<string, string>>({})

  const registryByKey = computed(() => {
    const m = new Map<string, IntegrationNodeRegistryEntryDto>()
    for (const r of nodes.value) {
      if (r.nodeKey) m.set(r.nodeKey, r)
    }
    return m
  })

  const parsedFlowForConfig = computed((): IntegrationFlowJson | null => {
    try {
      const parsed = JSON.parse(editorFlowJsonText.value) as unknown
      if (!isPlainRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null
      return parsed as IntegrationFlowJson
    } catch {
      return null
    }
  })

  const flowNodesFromJson = computed(() => {
    const p = parsedFlowForConfig.value
    if (!p?.nodes?.length) return []
    return p.nodes.filter((n) => n && typeof n.id === 'string' && typeof n.type === 'string')
  })

  const selectedNodeInFlow = computed(() => {
    const id = selectedNodeIdForConfig.value
    if (!id) return null
    return flowNodesFromJson.value.find((n) => n.id === id) ?? null
  })

  const registryEntryForSelected = computed(() => {
    const n = selectedNodeInFlow.value
    if (!n?.type) return null
    return registryByKey.value.get(n.type) ?? null
  })

  const schemaFields = computed(() => {
    const entry = registryEntryForSelected.value
    return extractFormFieldsFromConfigSchema(entry?.configSchema ?? null)
  })

  const unknownNodeTypeWarning = computed(() => {
    const n = selectedNodeInFlow.value
    if (!n?.type) return null
    if (registryByKey.value.has(n.type)) return null
    return t('integrationFlowStudio.nodeConfigUnknownType', { type: n.type })
  })

  const missingConfigSchemaWarning = computed(() => {
    const entry = registryEntryForSelected.value
    if (!entry || unknownNodeTypeWarning.value) return null
    const cs = entry.configSchema
    if (cs == null || !isPlainRecord(cs) || cs.type !== 'object') {
      return t('integrationFlowStudio.nodeConfigMissingSchema')
    }
    return null
  })

  const noConfigurableFieldsHint = computed(() => {
    if (unknownNodeTypeWarning.value || missingConfigSchemaWarning.value) return null
    if (!registryEntryForSelected.value) return null
    if (schemaFields.value.length > 0) return null
    return t('integrationFlowStudio.nodeConfigNoSchemaFields')
  })

  const hasUnsupportedSchemaFields = computed(() => schemaFields.value.some((f) => f.kind === 'unsupported'))

  function draftKey(nodeId: string, propKey: string) {
    return `${nodeId}::${propKey}`
  }

  function syncJsonDraftsFromSelectedNode() {
    const node = selectedNodeInFlow.value
    if (!node) return

    const cfg = isPlainRecord(node.config) ? node.config : {}
    for (const f of schemaFields.value) {
      if (f.kind !== 'json-object' && f.kind !== 'json-array') continue
      const k = draftKey(node.id, f.key)
      const cur = cfg[f.key]
      try {
        if (f.kind === 'json-array') {
          jsonDrafts.value[k] = JSON.stringify(Array.isArray(cur) ? cur : [], null, 2)
        } else {
          jsonDrafts.value[k] = JSON.stringify(isPlainRecord(cur) ? cur : {}, null, 2)
        }
      } catch {
        jsonDrafts.value[k] = f.kind === 'json-array' ? '[]' : '{}'
      }
    }
  }

  watch([selectedNodeIdForConfig, schemaFields, selectedFlowId], () => {
    syncJsonDraftsFromSelectedNode()
  })

  watch(
    () => editorFlowJsonText.value,
    () => {
      syncJsonDraftsFromSelectedNode()
    },
  )

  watch(
    [flowNodesFromJson, selectedFlowId],
    () => {
      const list = flowNodesFromJson.value
      if (!list.length) {
        selectedNodeIdForConfig.value = ''
        return
      }
      if (!selectedNodeIdForConfig.value || !list.some((n) => n.id === selectedNodeIdForConfig.value)) {
        selectedNodeIdForConfig.value = list[0]!.id
      }
    },
    { immediate: true },
  )

  function patchSelectedNodeConfig(updater: (cfg: Record<string, unknown>) => void) {
    nodeConfigPanelErrors.value = []
    const p = parsedFlowForConfig.value
    if (!p) {
      nodeConfigPanelErrors.value = [t('integrationFlowStudio.nodeConfigInvalidFlowJson')]
      return
    }
    const nodeId = selectedNodeIdForConfig.value
    const node = p.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const next: IntegrationFlowJson = JSON.parse(JSON.stringify(p)) as IntegrationFlowJson
    const target = next.nodes.find((n) => n.id === nodeId)
    if (!target) return
    if (!isPlainRecord(target.config) || Array.isArray(target.config)) {
      target.config = {}
    }
    updater(target.config as Record<string, unknown>)
    editorFlowJsonText.value = JSON.stringify(next, null, 2)
    flowJsonError.value = null
  }

  function setStringField(key: string, raw: string, nullable: boolean) {
    patchSelectedNodeConfig((cfg) => {
      const v = raw.trim()
      if (v === '' && nullable) cfg[key] = null
      else cfg[key] = v
    })
  }

  function setNumberField(key: string, raw: string, min?: number, max?: number) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      patchSelectedNodeConfig((cfg) => {
        delete cfg[key]
      })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) {
      nodeConfigPanelErrors.value = [t('integrationFlowStudio.nodeConfigInvalidNumber', { key })]
      return
    }
    let x = n
    if (min != null && x < min) x = min
    if (max != null && x > max) x = max
    patchSelectedNodeConfig((cfg) => {
      cfg[key] = Number.isInteger(n) ? Math.trunc(x) : x
    })
  }

  function setBooleanField(key: string, value: boolean) {
    patchSelectedNodeConfig((cfg) => {
      cfg[key] = value
    })
  }

  function commitJsonField(field: NodeConfigFormField) {
    nodeConfigPanelErrors.value = []
    const node = selectedNodeInFlow.value
    if (!node) return
    const k = draftKey(node.id, field.key)
    const text = jsonDrafts.value[k] ?? ''
    let parsed: unknown
    try {
      parsed = JSON.parse(text || (field.kind === 'json-array' ? '[]' : '{}'))
    } catch {
      nodeConfigPanelErrors.value = [t('integrationFlowStudio.nodeConfigInvalidJsonField', { key: field.key })]
      return
    }
    if (field.kind === 'json-array' && !Array.isArray(parsed)) {
      nodeConfigPanelErrors.value = [t('integrationFlowStudio.nodeConfigExpectArray', { key: field.key })]
      return
    }
    if (field.kind === 'json-object' && (!isPlainRecord(parsed) || Array.isArray(parsed))) {
      nodeConfigPanelErrors.value = [t('integrationFlowStudio.nodeConfigExpectObject', { key: field.key })]
      return
    }
    patchSelectedNodeConfig((cfg) => {
      cfg[field.key] = parsed
    })
  }

  function validatePanel(): void {
    nodeConfigPanelErrors.value = []
    const errs: string[] = []
    const node = selectedNodeInFlow.value
    if (!node || !parsedFlowForConfig.value) {
      if (!parsedFlowForConfig.value) errs.push(t('integrationFlowStudio.nodeConfigInvalidFlowJson'))
      nodeConfigPanelErrors.value = errs
      return
    }
    const cfg = isPlainRecord(node.config) ? node.config : {}

    for (const f of schemaFields.value) {
      if (!f.required) continue
      const v = cfg[f.key]
      const missing =
        v === undefined ||
        v === null ||
        (f.kind === 'string' && String(v).trim() === '') ||
        (f.kind === 'json-object' && !isPlainRecord(v)) ||
        (f.kind === 'json-array' && !Array.isArray(v))
      if (missing) errs.push(t('integrationFlowStudio.nodeConfigRequiredField', { key: f.key }))
    }

    for (const f of schemaFields.value) {
      if (f.kind !== 'json-object' && f.kind !== 'json-array') continue
      const k = draftKey(node.id, f.key)
      try {
        JSON.parse(jsonDrafts.value[k] ?? '')
      } catch {
        errs.push(t('integrationFlowStudio.nodeConfigInvalidJsonField', { key: f.key }))
      }
    }

    nodeConfigPanelErrors.value = errs
  }

  const panelVisible = computed(
    () =>
      Boolean(selectedFlowId.value) && !detailLoading.value && canRead.value && flowNodesFromJson.value.length > 0,
  )

  function getConfigValue(key: string): unknown {
    const node = selectedNodeInFlow.value
    if (!node || !isPlainRecord(node.config)) return undefined
    return node.config[key]
  }

  function nodeConfigStringValue(key: string): string {
    const v = getConfigValue(key)
    if (v == null || v === undefined) return ''
    return String(v)
  }

  function nodeConfigNumberDisplay(key: string): string {
    const v = getConfigValue(key)
    if (v === undefined || v === null || v === '') return ''
    if (typeof v === 'number') return String(v)
    return String(v)
  }

  return {
    selectedNodeIdForConfig,
    flowNodesFromJson,
    selectedNodeInFlow,
    registryEntryForSelected,
    schemaFields,
    unknownNodeTypeWarning,
    missingConfigSchemaWarning,
    noConfigurableFieldsHint,
    hasUnsupportedSchemaFields,
    jsonDrafts,
    nodeConfigPanelErrors,
    panelVisible,
    draftKey,
    patchSelectedNodeConfig,
    setStringField,
    setNumberField,
    setBooleanField,
    commitJsonField,
    validatePanel,
    getConfigValue,
    nodeConfigStringValue,
    nodeConfigNumberDisplay,
    syncJsonDraftsFromSelectedNode,
  }
}
