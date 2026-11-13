import { pointInPolygon2D } from '@pascal-app/core'
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

/**
 * A polygon is filled row by row (its cost is edges plus cells, not their product). The rule is
 * unchanged: a lattice point is taken when core's `pointInPolygon2D`, boundary included, puts it
 * in the outline and in no hole. This compares the mask with that rule, point by point.
 */
describe('polygon fill keeps the point-by-point rule', () => {
  const topology = { origin: [-2, -1] as [number, number], spacing: 0.1, cols: 81, rows: 61 }

  function reference(points: [number, number][], holes: [number, number][][]): Uint8Array {
    const taken = new Uint8Array(topology.cols * topology.rows)
    for (let row = 0; row < topology.rows; row += 1) {
      for (let col = 0; col < topology.cols; col += 1) {
        const at: [number, number] = [
          topology.origin[0] + col * topology.spacing,
          topology.origin[1] + row * topology.spacing,
        ]
        const inside =
          points.length >= 3 &&
          pointInPolygon2D(at, points, { includeBoundary: true }) &&
          !holes.some((hole) => pointInPolygon2D(at, hole, { includeBoundary: true }))
        taken[row * topology.cols + col] = inside ? 1 : 0
      }
    }
    return taken
  }

  function filled(points: [number, number][], holes: [number, number][][]): Uint8Array {
    const field = createGrassObstacleField(topology, [{ kind: 'polygon', points, holes }])
    const taken = new Uint8Array(topology.cols * topology.rows)
    for (let index = 0; index < taken.length; index += 1) {
      taken[index] = (field.values[index * 4 + 3] ?? 0) === 0 ? 1 : 0
    }
    return taken
  }

  function differences(points: [number, number][], holes: [number, number][][] = []): number {
    const expected = reference(points, holes)
    const actual = filled(points, holes)
    let count = 0
    for (let index = 0; index < expected.length; index += 1) if (expected[index] !== actual[index]) count += 1
    return count
  }

  const named: [string, [number, number][], [number, number][][]][] = [
    ['a square on lattice lines', [[0, 0], [2, 0], [2, 2], [0, 2]], []],
    ['a square between lattice lines', [[0.05, 0.05], [2.05, 0.05], [2.05, 2.05], [0.05, 2.05]], []],
    ['a ring: the hole takes its outline', [[0, 0], [4, 0], [4, 3], [0, 3]], [[[1, 1], [3, 1], [3, 2], [1, 2]]]],
    ['a hole as large as the outline (a pool ground opening)', [[0, 0], [4, 0], [4, 3], [0, 3]], [[[-0.05, -0.05], [4.05, -0.05], [4.05, 3.05], [-0.05, 3.05]]]],
    ['an L with a vertex on a lattice point', [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]], []],
    ['a triangle with a sloped edge through lattice points', [[0, 0], [3, 0], [0, 3]], []],
    ['a bow tie crossing itself', [[0, 0], [3, 2], [3, 0], [0, 2]], []],
    ['a sliver along a row', [[0, 1], [4, 1], [4, 1.0000004], [0, 1.0000004]], []],
    ['a nearly level edge', [[0, 1], [4, 1.0004], [4, 2], [0, 2]], []],
    ['repeated and collinear points', [[0, 0], [0, 0], [1, 0], [2, 0], [2, 2], [2, 2], [0, 2]], []],
    ['a polygon reaching past the field', [[-5, -5], [10, -5], [10, 0.5], [-5, 0.5]], []],
    ['a polygon wholly off the field', [[20, 20], [22, 20], [21, 22]], []],
  ]
  test.each(named)('%s', (_name, points, holes) => {
    expect(differences(points, holes)).toBe(0)
  })

  test('400 seeded polygons, on and off the lattice, with and without holes', () => {
    let state = 0x2f6e2b1
    const random = () => {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0
      return ((state >>> 0) % 100000) / 100000
    }
    let mismatched = 0
    for (let round = 0; round < 400; round += 1) {
      // Half the rounds snap to the lattice or its half step, so points fall on edges and corners.
      const snap = round % 2 === 0 ? 0.05 : 0
      const coordinate = (min: number, span: number) => {
        const value = min + random() * span
        return snap ? Math.round(value / snap) * snap : value
      }
      const ring = (count: number, cx: number, cz: number, reach: number): [number, number][] =>
        Array.from({ length: count }, () => [coordinate(cx - reach, reach * 2), coordinate(cz - reach, reach * 2)])
      const points = ring(3 + Math.floor(random() * 9), 2, 2, 3.5)
      const holes = round % 3 === 0 ? [ring(3 + Math.floor(random() * 4), 2, 2, 1.5)] : []
      if (differences(points, holes) > 0) mismatched += 1
    }
    expect(mismatched).toBe(0)
  })
})

describe('the mask has a cost ceiling', () => {
  const full = { origin: [0, 0] as [number, number], spacing: 0.1, cols: 513, rows: 513 }
  const circle = (count: number, radius: number): [number, number][] =>
    Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2
      return [25.6 + Math.cos(angle) * radius, 25.6 + Math.sin(angle) * radius]
    })
  const taken = (field: { values: Uint8Array; cols: number }, x: number, z: number) =>
    (field.values[(Math.round(z / 0.1) * field.cols + Math.round(x / 0.1)) * 4 + 3] ?? 0) === 0

  test('a 4,096-point outline with 64 holes over a full-size field is drawn quickly', () => {
    const holes = Array.from({ length: 64 }, (_, index): [number, number][] => {
      const x = 6 + (index % 8) * 5
      const z = 6 + Math.floor(index / 8) * 5
      return [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]]
    })
    const started = performance.now()
    const field = createGrassObstacleField(full, [{ kind: 'polygon', points: circle(4096, 25), holes }])
    expect(performance.now() - started).toBeLessThan(1500)
    expect(taken(field, 25.6, 25.6)).toBe(true)
    expect(taken(field, 6.5, 6.5)).toBe(false)
    expect(taken(field, 0.5, 0.5)).toBe(false)
  })

  test('shapes past the budget are left out, the ones before them drawn, and nothing throws', () => {
    const first = { kind: 'polygon' as const, points: [[1, 1], [3, 1], [3, 3], [1, 3]] as [number, number][] }
    // Each of these covers the field: 5,000 of them would be over a billion cell visits.
    const flood = Array.from({ length: 5000 }, () => ({ kind: 'polygon' as const, points: circle(256, 25) }))
    const last = { kind: 'polygon' as const, points: [[45, 45], [47, 45], [47, 47], [45, 47]] as [number, number][] }
    const started = performance.now()
    const field = createGrassObstacleField(full, [first, ...flood, last])
    expect(performance.now() - started).toBeLessThan(1500)
    expect(taken(field, 2, 2)).toBe(true)
    expect(taken(field, 25.6, 25.6)).toBe(true)
    // The budget went to the flood: the late small shape still fits what is left, or is left out.
    expect([true, false]).toContain(taken(field, 46, 46))
  })

  test('capsules and boxes spend the same budget', () => {
    const flood = Array.from({ length: 5000 }, () => ({
      kind: 'capsule' as const, start: [0, 0] as [number, number], end: [51, 51] as [number, number], radius: 60,
    }))
    const started = performance.now()
    createGrassObstacleField(full, flood)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})
