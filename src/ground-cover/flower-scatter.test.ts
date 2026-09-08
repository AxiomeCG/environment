import { createTerrainField, SiteNode, surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import type { GroundCoverFields } from './field-context'
import { collectFlowerPlacements, FLOWER_KINDS } from './flower-scatter'
import { resolveGrassHeightField } from './height-field'
import {
  createGrassObstacleField,
  createGrassObstacleTopology,
  sampleGrassObstacle,
} from './obstacle-field'
import { createGrassPaintField, type SiteBounds } from './paint-field'
import { GrassFieldNode } from './schema'

const BOUNDS: SiteBounds = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 }
const BOUNDARY = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
] as const

describe('flower scatter', () => {
  test('defaults to no flowers and preserves legacy ground cover', () => {
    const node = GrassFieldNode.parse({ id: 'grass-field_legacy' })

    expect(node.flowerDensity).toBe(0)
    expect(collectFlowerPlacements(node, fields())).toEqual([])
  })

  test('is spatially deterministic and produces the complete original family', () => {
    const node = GrassFieldNode.parse({
      id: 'grass-field_flowers',
      flowerDensity: 100,
    })
    const first = collectFlowerPlacements(node, fields())
    const reversedBoundary = [...BOUNDARY].reverse()
    const second = collectFlowerPlacements(node, {
      ...fields(),
      boundary: reversedBoundary,
    })

    expect(second).toEqual(first)
    expect(new Set(first.map(({ kind }) => kind))).toEqual(new Set(FLOWER_KINDS))
    expect(
      first.every(
        ({ rotationY, scale }) =>
          rotationY >= 0 && rotationY < Math.PI * 2 && scale >= 0.78 && scale <= 1.22,
      ),
    ).toBe(true)
  })

  test('shares paint density, obstacle exclusion, and terrain root sampling', () => {
    const terrain = slopedTerrain()
    const groundFields = fields(terrain)
    groundFields.obstacles = createGrassObstacleField(createGrassObstacleTopology(BOUNDS), [
      {
        kind: 'polygon',
        points: [
          [0, 0],
          [2, 0],
          [2, 4],
          [0, 4],
        ],
      },
    ])
    const node = GrassFieldNode.parse({
      id: 'grass-field_masked-flowers',
      flowerDensity: 100,
    })
    const placements = collectFlowerPlacements(node, groundFields)

    expect(placements.length).toBeGreaterThan(0)
    for (const placement of placements) {
      const [x, y, z] = placement.position
      expect(sampleGrassObstacle(groundFields.obstacles, x, z).allowed).toBeGreaterThanOrEqual(0.5)
      expect(y).toBeCloseTo(surfaceHeightAt(terrain, x, z), 6)
    }

    expect(
      collectFlowerPlacements(node, {
        ...groundFields,
        paint: createGrassPaintField(BOUNDS, '#204060', 0),
      }),
    ).toEqual([])
  })
})

function fields(terrain: TerrainField | null = null): GroundCoverFields {
  const site = SiteNode.parse({
    id: 'site_flowers',
    children: [],
    polygon: { type: 'polygon', points: BOUNDARY },
  })
  return {
    site,
    boundary: BOUNDARY,
    bounds: BOUNDS,
    terrain,
    paint: createGrassPaintField(BOUNDS, '#204060'),
    height: resolveGrassHeightField(undefined, BOUNDS),
    obstacles: createGrassObstacleField(createGrassObstacleTopology(BOUNDS), []),
  }
}

function slopedTerrain(): TerrainField {
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 1,
    cols: 5,
    rows: 5,
    step: 0.01,
  })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let column = 0; column < terrain.cols; column += 1) {
      terrain.heights[row * terrain.cols + column] = row * 5 + column * 3
    }
  }
  return terrain
}
