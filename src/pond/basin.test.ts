import { createTerrainField, type TerrainField } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  analyzePondBasin,
  buildPondContourPositions,
  buildPondSurface,
  nextPondLevel,
  pondSurfaceDepthAt,
} from './basin'
import { POND_KIND, POND_LEVEL_STEP, PondNode, type PondProp } from './schema'

const SQUARE_5 = [[0, 0], [4, 0], [4, 4], [0, 4]] as const

function terrainFromRows(rows: readonly (readonly number[])[], step = 1): TerrainField {
  const rowCount = rows.length
  const columnCount = rows[0]?.length ?? 0
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 1,
    cols: columnCount,
    rows: rowCount,
    step,
  })
  const quantized = rows.flatMap((row) => row.map((height) => Math.round(height / step)))
  terrain.heights.set(quantized)
  return terrain
}

function pointInPolygon(x: number, z: number, polygon: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const first = polygon[current]
    const second = polygon[previous]
    if (!first || !second) continue
    const edgeCross = (x - first[0]) * (second[1] - first[1]) - (z - first[1]) * (second[0] - first[0])
    const edgeDot = (x - first[0]) * (x - second[0]) + (z - first[1]) * (z - second[1])
    if (Math.abs(edgeCross) <= 1e-6 && edgeDot <= 1e-6) return true
    if (
      (first[1] > z) !== (second[1] > z) &&
      x < ((second[0] - first[0]) * (z - first[1])) / (second[1] - first[1]) + first[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

describe('PondNode', () => {
  test('rejects persisted ponds above the prop cap', () => {
    const prop = (index: number): PondProp => ({
      id: `lily_${index}`,
      kind: 'water-lily',
      position: [index, 0],
      yaw: 0,
      scale: 1,
    })
    const props = Array.from({ length: 129 }, (_, index) => prop(index))

    expect(PondNode.safeParse({ id: 'pond_capped', type: POND_KIND, props }).success).toBe(false)
  })
})

describe('pond basin analysis', () => {
  test('finds the non-flat lowest boundary spill and emits flat water with bathymetry', () => {
    const terrain = terrainFromRows([
      [6, 6, 4, 6, 6],
      [6, 3, 2, 3, 6],
      [6, 2, 0, 2, 6],
      [6, 3, 2, 3, 6],
      [6, 6, 6, 6, 6],
    ])
    const basin = analyzePondBasin(terrain, SQUARE_5, [2, 2])
    expect(basin).not.toBeNull()
    if (!basin) return

    expect(basin.bottomLevel).toBe(0)
    expect(basin.spillLevel).toBe(4)
    const shallow = buildPondSurface(basin, 1)
    const shallowCoordinates = Array.from(shallow.positions).filter((_, index) => index % 3 !== 1)
    expect(shallow.area).toBeGreaterThan(0)
    expect(shallow.area).toBeLessThan(1)
    expect(shallowCoordinates.some((value) => Math.abs(value - Math.round(value)) > 1e-6)).toBe(true)
    const surface = buildPondSurface(basin, basin.spillLevel)
    expect(surface.level).toBe(4)
    expect(surface.area).toBeGreaterThan(0)
    expect(pondSurfaceDepthAt(surface, 2, 2)).toBeCloseTo(4, 6)
    for (let offset = 1; offset < surface.positions.length; offset += 3) {
      expect(surface.positions[offset]).toBe(4)
    }
  })

  test('keeps low-saddle minima isolated below the saddle and joins them through the outer spill', () => {
    const terrain = terrainFromRows([
      [6, 6, 6, 6, 6, 6, 6],
      [6, 2, 1.25, 4, 2, 2, 6],
      [6, 1, 0, 4, 1.5, 7, 6],
      [6, 1.5, 0.5, 3, 1.25, 0.25, 5],
      [6, 2, 1.25, 4, 1.5, 0.75, 6],
      [6, 3, 2, 4.5, 2.5, 2, 6],
      [6, 6, 6, 6, 6, 6, 6],
    ], 0.25)
    const boundary = [[0, 0], [6, 0], [6, 6], [0, 6]] as const
    const left = analyzePondBasin(terrain, boundary, [1.6, 2])
    const right = analyzePondBasin(terrain, boundary, [4.6, 3.6])
    expect(left?.bottomLevel).toBe(0)
    expect(right?.bottomLevel).toBe(0.25)
    expect(left?.spillLevel).toBe(5)
    expect(right?.spillLevel).toBe(5)
    if (!left || !right) return

    const leftBelowSaddle = buildPondSurface(left, 2.5)
    const rightBelowSaddle = buildPondSurface(right, 2.5)
    expect(pondSurfaceDepthAt(leftBelowSaddle, 2, 2)).toBeCloseTo(2.5, 6)
    expect(pondSurfaceDepthAt(leftBelowSaddle, 5, 3)).toBe(0)
    expect(pondSurfaceDepthAt(leftBelowSaddle, 3, 3)).toBe(0)
    expect(pondSurfaceDepthAt(rightBelowSaddle, 5, 3)).toBeCloseTo(2.25, 6)
    expect(pondSurfaceDepthAt(rightBelowSaddle, 2, 2)).toBe(0)
    expect(pondSurfaceDepthAt(rightBelowSaddle, 4, 3)).toBeCloseTo(1.25, 6)

    const leftFilled = buildPondSurface(left, left.spillLevel)
    const rightFilled = buildPondSurface(right, right.spillLevel)
    for (const filled of [leftFilled, rightFilled]) {
      expect(pondSurfaceDepthAt(filled, 2, 2)).toBeCloseTo(5, 6)
      expect(pondSurfaceDepthAt(filled, 5, 3)).toBeCloseTo(4.75, 6)
      expect(pondSurfaceDepthAt(filled, 3, 3)).toBeCloseTo(2, 6)
      expect(pondSurfaceDepthAt(filled, 5, 2)).toBe(0)
      expect(pondSurfaceDepthAt(filled, 6.1, 3)).toBe(0)
    }
  })

  test('clips a rotated concave property exactly rather than flooding its bounding box', () => {
    const terrain = terrainFromRows([
      [5, 5, 5, 5, 5],
      [5, 3, 2, 3, 5],
      [5, 2, 0, 2, 5],
      [5, 3, 2, 3, 5],
      [5, 5, 5, 5, 5],
    ])
    const boundary = [[2, 0.1], [3.9, 2], [2.8, 2.25], [2, 3.9], [0.1, 2]] as const
    const basin = analyzePondBasin(terrain, boundary, [2, 2])
    expect(basin).not.toBeNull()
    if (!basin) return

    const surface = buildPondSurface(basin, basin.spillLevel)
    for (let offset = 0; offset < surface.positions.length; offset += 3) {
      const x = surface.positions[offset]
      const z = surface.positions[offset + 2]
      if (x === undefined || z === undefined) continue
      expect(pointInPolygon(x, z, boundary)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(4)
      expect(z).toBeGreaterThanOrEqual(0)
      expect(z).toBeLessThanOrEqual(4)
    }
  })

  test('leaves high terrain as an island inside the connected wet polygon', () => {
    const terrain = terrainFromRows([
      [5, 5, 5, 5, 5],
      [5, 1, 1, 1, 5],
      [5, 1, 4, 1, 5],
      [5, 1, 1, 1, 5],
      [5, 5, 5, 5, 5],
    ])
    const basin = analyzePondBasin(terrain, SQUARE_5, [1, 2])
    expect(basin).not.toBeNull()
    if (!basin) return

    const surface = buildPondSurface(basin, 3)
    expect(pondSurfaceDepthAt(surface, 1, 2)).toBeCloseTo(2, 6)
    expect(pondSurfaceDepthAt(surface, 2, 2)).toBe(0)
    expect(pondSurfaceDepthAt(surface, -0.1, 2)).toBe(0)
  })

  test('round-trips stepped controls and preserves a non-aligned terminal spill', () => {
    const terrain = terrainFromRows([
      [0.6, 0.6, 0.6],
      [0.6, 0, 0.6],
      [0.6, 0.6, 0.6],
    ], 0.05)
    const basin = analyzePondBasin(terrain, [[0, 0], [2, 0], [2, 2], [0, 2]], [1, 1])
    expect(basin).not.toBeNull()
    if (!basin) return

    expect(basin.levelStep).toBe(POND_LEVEL_STEP)
    expect(basin.levels).toHaveLength(3)
    for (const [index, expected] of [0.25, 0.5, 0.6].entries()) {
      expect(basin.levels[index]).toBeCloseTo(expected, 9)
    }
    expect(nextPondLevel(basin, null, 'raise')).toBe(0.25)
    expect(nextPondLevel(basin, 0.25, 'raise')).toBe(0.5)
    expect(nextPondLevel(basin, 0.5, 'fill')).toBeCloseTo(0.6, 9)
    expect(nextPondLevel(basin, 0.6, 'lower')).toBe(0.5)
    expect(nextPondLevel(basin, 0.25, 'lower')).toBeNull()
    expect(nextPondLevel(basin, 0.6, 'empty')).toBeNull()
  })

  test('rejects terrain with an open downhill path to the boundary', () => {
    const openSlope = terrainFromRows([
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
    ])
    const boundary = [[0, 0], [4, 0], [4, 4], [0, 4]] as const

    expect(analyzePondBasin(openSlope, boundary, [2, 2])).toBeNull()
  })

  test('returns an explicit empty surface and re-analyzes after terrain edits', () => {
    const flat = terrainFromRows([
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
    ])
    const boundary = [[0, 0], [2, 0], [2, 2], [0, 2]] as const
    expect(analyzePondBasin(flat, boundary, [1, 1])).toBeNull()

    const depressed = terrainFromRows([
      [2, 2, 2],
      [2, 0, 2],
      [2, 2, 2],
    ])
    const basin = analyzePondBasin(depressed, boundary, [1, 1])
    expect(basin).not.toBeNull()
    if (!basin) return
    const empty = buildPondSurface(basin, null)
    expect(empty).toEqual({
      level: null,
      positions: new Float32Array(0),
      depths: new Float32Array(0),
      area: 0,
    })
  })
})

describe('pond terrain contours', () => {
  test('intersects the rendered terrain diagonal at exact step gradations', () => {
    const terrain = terrainFromRows([
      [0, 2],
      [2, 2],
    ])
    const contours = buildPondContourPositions(terrain, [[0, 0], [1, 0], [1, 1], [0, 1]], 1)
    let length = 0
    for (let offset = 0; offset < contours.length; offset += 6) {
      if (contours[offset + 1] !== 1) continue
      expect(contours[offset]! + contours[offset + 2]!).toBeCloseTo(0.5, 7)
      expect(contours[offset + 3]! + contours[offset + 5]!).toBeCloseTo(0.5, 7)
      length += Math.hypot(contours[offset + 3]! - contours[offset]!, contours[offset + 5]! - contours[offset + 2]!)
    }
    expect(length).toBeCloseTo(Math.SQRT1_2, 7)
  })
})
