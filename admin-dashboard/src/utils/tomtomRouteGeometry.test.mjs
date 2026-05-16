import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractTomTomRouteLatLngs,
  tomTomRawJsonMayExposeApiKey,
} from './tomtomRouteGeometry.mjs'

describe('extractTomTomRouteLatLngs', () => {
  it('extracts points from routes[0].legs[].points[]', () => {
    const raw = {
      routes: [
        {
          legs: [
            {
              points: [
                { latitude: 48.4, longitude: 7.9 },
                { latitude: 48.41, longitude: 7.91 },
              ],
            },
          ],
        },
      ],
    }
    const ll = extractTomTomRouteLatLngs(raw)
    assert.deepEqual(ll, [
      [48.4, 7.9],
      [48.41, 7.91],
    ])
  })

  it('concatenates multiple legs', () => {
    const raw = {
      routes: [
        {
          legs: [
            { points: [{ latitude: 1, longitude: 2 }] },
            { points: [{ lat: 3, lng: 4 }] },
          ],
        },
      ],
    }
    assert.deepEqual(extractTomTomRouteLatLngs(raw), [
      [1, 2],
      [3, 4],
    ])
  })

  it('returns empty array when points missing or invalid', () => {
    assert.deepEqual(extractTomTomRouteLatLngs(null), [])
    assert.deepEqual(extractTomTomRouteLatLngs({}), [])
    assert.deepEqual(extractTomTomRouteLatLngs({ routes: [] }), [])
    assert.deepEqual(extractTomTomRouteLatLngs({ routes: [{ legs: [{ points: [{}] }] }] }), [])
    assert.deepEqual(extractTomTomRouteLatLngs({ routes: [{ legs: null }] }), [])
  })

  it('skips consecutive duplicate coordinates', () => {
    const raw = {
      routes: [{ legs: [{ points: [{ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 }] }] }],
    }
    assert.deepEqual(extractTomTomRouteLatLngs(raw), [[1, 2]])
  })
})

describe('tomTomRawJsonMayExposeApiKey', () => {
  it('flags bare key strings', () => {
    assert.equal(tomTomRawJsonMayExposeApiKey({ key: 'secret123' }), true)
    assert.equal(tomTomRawJsonMayExposeApiKey({ nested: { key: 'x' } }), true)
  })

  it('allows redacted key placeholder', () => {
    assert.equal(tomTomRawJsonMayExposeApiKey({ key: '***' }), false)
    assert.equal(
      tomTomRawJsonMayExposeApiKey({
        routes: [{ legs: [{ points: [{ latitude: 1, longitude: 2 }] }] }],
      }),
      false
    )
    const sanitizedTypical = {
      routes: [{ legs: [{ points: [{ latitude: 48.4, longitude: 7.9 }] }] }],
      key: '***',
    }
    assert.equal(tomTomRawJsonMayExposeApiKey(sanitizedTypical), false)
    assert.equal(
      tomTomRawJsonMayExposeApiKey(JSON.parse(JSON.stringify({ ...sanitizedTypical, key: 'sk_live_not_redacted' }))),
      true
    )
  })
})
