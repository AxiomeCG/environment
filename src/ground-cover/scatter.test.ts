import { describe, expect, test } from 'bun:test'
import { GrassFieldNode } from './schema'
import { grassCandidateCapacity, visitGrassCandidates } from './scatter'

const BOUNDARY: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0],
  [0.5, 0.5],
  [0, 0.5],
]
const BOUNDS = { minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.5 }

function collectCandidateRandomness(): Array<{
  densityThreshold: number
  tint: number
}> {
  const node = GrassFieldNode.parse({ id: 'grass-field_scatter' })
  const candidates: Array<{ densityThreshold: number; tint: number }> = []

  visitGrassCandidates(
    node,
    BOUNDARY,
    BOUNDS,
    null,
    (
      _x,
      _y,
      _z,
      _yaw,
      _widthFactor,
      _heightFactor,
      densityThreshold,
      tint,
    ) => candidates.push({ densityThreshold, tint }),
  )

  return candidates
}

describe('visitGrassCandidates', () => {
  test('uses a denser grid and keeps partial edge cells', () => {
    const bounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    const boundary: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    let emitted = 0

    visitGrassCandidates(
      GrassFieldNode.parse({ id: 'grass-field_density' }),
      boundary,
      bounds,
      null,
      () => {
        emitted += 1
      },
    )

    expect(grassCandidateCapacity(bounds)).toBe(169)
    expect(emitted).toBe(169)
  })

  test('emits deterministic, varied tint independently of density threshold', () => {
    const first = collectCandidateRandomness()
    const second = collectCandidateRandomness()
    const tints = first.map(({ tint }) => tint)
    const densityDerivedTints = first.map(
      ({ densityThreshold }) => densityThreshold * 2 - 1,
    )

    expect(first.length).toBeGreaterThan(1)
    expect(second).toEqual(first)
    expect(tints.every((tint) => tint >= -1 && tint <= 1)).toBe(true)
    expect(new Set(tints).size).toBeGreaterThan(1)
    expect(tints).not.toEqual(densityDerivedTints)
  })
})
