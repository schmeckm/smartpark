import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIntegrationFlowEmitPayload,
  flowJsonHasNoPresentationKeys,
} from './integrationFlowVisualEmit.ts'

describe('buildIntegrationFlowEmitPayload', () => {
  it('persists position only for nodes in positionPersistIds', () => {
    const out = buildIntegrationFlowEmitPayload(
      [
        { id: 'a', type: 'MANUAL_TRIGGER', config: {} },
        { id: 'b', type: 'CANONICAL_MAPPING', config: { x: 1 } },
      ],
      [{ source: 'a', target: 'b' }],
      new Map([
        ['a', { x: 10, y: 20 }],
        ['b', { x: 300, y: 40 }],
      ]),
      new Set(['b'])
    )
    assert.equal(out.nodes[0].position, undefined)
    assert.deepEqual(out.nodes[1].position, { x: 300, y: 40 })
    assert.deepEqual(out.edges, [{ source: 'a', target: 'b' }])
    assert.equal(flowJsonHasNoPresentationKeys(out), true)
  })

  it('never includes timeline or status fields on nodes', () => {
    const out = buildIntegrationFlowEmitPayload(
      [{ id: 'n1', type: 'T', config: { mappings: {} } }],
      [],
      new Map([['n1', { x: 1, y: 2 }]]),
      new Set(['n1'])
    )
    assert.equal(JSON.stringify(out).includes('failed'), false)
    assert.equal(JSON.stringify(out).includes('errorMessage'), false)
    assert.equal(flowJsonHasNoPresentationKeys(out), true)
  })
})
