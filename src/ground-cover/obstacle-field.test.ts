import { describe, expect, test } from 'bun:test'
import {
  createGrassObstacleField,
  createGrassObstacleTopology,
  isGrassAllowedAt,
  MAX_GRASS_OBSTACLE_FIELD_SIDE,
} from './obstacle-field'

function channelsAt(
  field: ReturnType<typeof createGrassObstacleField>,
  x: number,
  z: number,
): [number, number, number, number] {
  const col = Math.round((x - field.origin[0]) / field.spacing)
  const row = Math.round((z - field.origin[1]) / field.spacing)
  const offset = (row * field.cols + col) * 4
  return [
    field.values[offset] ?? 0,
    field.values[offset + 1] ?? 0,
    field.values[offset + 2] ?? 0,
    field.values[offset + 3] ?? 0,
  ]
}

describe('grass obstacle bitmap', () => {
  test('encodes hard exclusion, exterior distance, and outward direction', () => {
    const field = createGrassObstacleField(
      { origin: [-4, -4], spacing: 1, cols: 9, rows: 9 },
      [{ kind: 'box', center: [0, 0], halfSize: [1, 1], rotation: 0 }],
    )

    expect(isGrassAllowedAt(field, 0, 0)).toBe(false)
    expect(channelsAt(field, 0, 0)[3]).toBe(0)

    const right = channelsAt(field, 3, 0)
    expect(right[0]).toBeGreaterThan(0)
    expect(right[1]).toBeGreaterThan(128)
    expect(right[2]).toBeCloseTo(128, 0)
    expect(right[3]).toBe(255)
  })

  test('keeps polygon holes legal while excluding the surrounding slab', () => {
    const field = createGrassObstacleField(
      { origin: [0, 0], spacing: 0.5, cols: 9, rows: 9 },
      [
        {
          kind: 'polygon',
          points: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
          holes: [
            [
              [1.5, 1.5],
              [2.5, 1.5],
              [2.5, 2.5],
              [1.5, 2.5],
            ],
          ],
        },
      ],
    )

    expect(isGrassAllowedAt(field, 1, 1)).toBe(false)
    expect(isGrassAllowedAt(field, 2, 2)).toBe(true)
  })

  test('conservatively captures walls thinner than one texel', () => {
    const field = createGrassObstacleField(
      { origin: [0, 0], spacing: 0.25, cols: 17, rows: 17 },
      [{ kind: 'capsule', start: [0.12, 0], end: [0.12, 4], radius: 0.05 }],
    )

    expect(isGrassAllowedAt(field, 0, 2)).toBe(false)
  })

  test('uses a separate high-resolution topology with a bounded side length', () => {
    expect(
      createGrassObstacleTopology({ minX: 0, maxX: 30, minZ: 0, maxZ: 20 }),
    ).toEqual({ origin: [0, 0], spacing: 0.1, cols: 301, rows: 201 })

    const large = createGrassObstacleTopology({ minX: -50, maxX: 50, minZ: -5, maxZ: 5 })
    expect(large.cols).toBe(MAX_GRASS_OBSTACLE_FIELD_SIDE)
    expect(large.rows).toBeLessThan(MAX_GRASS_OBSTACLE_FIELD_SIDE)
    expect(large.spacing).toBeCloseTo(100 / 512)
  })
})
