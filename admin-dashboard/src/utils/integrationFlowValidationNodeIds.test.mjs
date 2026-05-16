import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseValidationNodeIds } from './integrationFlowValidationNodeIds.mjs'

describe('parseValidationNodeIds', () => {
  it('extracts node ids from known validation messages', () => {
    const ids = parseValidationNodeIds([
      'node trigger_1 must have object config',
      'edge source not found: missing_src',
      'duplicate node id: map_1',
    ])
    assert.equal(ids.has('trigger_1'), true)
    assert.equal(ids.has('missing_src'), true)
    assert.equal(ids.has('map_1'), true)
  })

  it('returns empty set for nullish input', () => {
    assert.equal(parseValidationNodeIds(null).size, 0)
    assert.equal(parseValidationNodeIds(undefined).size, 0)
  })
})
