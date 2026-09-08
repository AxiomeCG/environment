import { type AnyNode, createTerrainField, encodeTerrainField, SiteNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { PondNode } from '../pond/schema'
import { RiverNode } from '../river/schema'
import { rebuildRiverTerrain } from '../river/terrain'
import { buildGrassObstacleField, changedGrassObstacleSiteIds } from './obstacle-adapter'
import { createGrassObstacleTopology, isGrassAllowedAt } from './obstacle-field'

function scene(...nodes: (AnyNode | PondNode | RiverNode)[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node as AnyNode]))
}

function pondSite() {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 1, cols: 7, rows: 7, step: 1 })
  terrain.heights.set([
    5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0,
    0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5,
  ])
  return SiteNode.parse({
    id: 'site_water',
    children: ['pond_water'],
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ],
    },
    terrain: encodeTerrainField(terrain),
  })
}

const pondTopology = createGrassObstacleTopology({ minX: 0, minZ: 0, maxX: 6, maxZ: 6 })

describe('water grass exclusions', () => {
  test('excludes only wet pond surfaces, preserving islands and restoring drained ground', () => {
    const site = pondSite()
    const pond = PondNode.parse({
      id: 'pond_water',
      parentId: site.id,
      seed: [1, 1],
      waterLevel: 2,
    })
    const mask = buildGrassObstacleField(site, scene(site, pond), pondTopology)
    expect(isGrassAllowedAt(mask, 1, 1)).toBe(false)
    expect(isGrassAllowedAt(mask, 3, 3)).toBe(true)
    expect(isGrassAllowedAt(mask, 0.2, 1)).toBe(true)
    expect(isGrassAllowedAt(mask, 0.5, 1)).toBe(true)

    const filled = { ...pond, waterLevel: 4 }
    expect(
      isGrassAllowedAt(buildGrassObstacleField(site, scene(site, filled), pondTopology), 0.5, 1),
    ).toBe(false)
    const drained = { ...pond, waterLevel: 0 }
    expect(
      isGrassAllowedAt(buildGrassObstacleField(site, scene(site, drained), pondTopology), 1, 1),
    ).toBe(true)
    const elsewhere = { ...pond, parentId: 'site_elsewhere' }
    expect(
      isGrassAllowedAt(buildGrassObstacleField(site, scene(site, elsewhere), pondTopology), 1, 1),
    ).toBe(true)
  })

  test('follows a curved carved river without excluding the land inside its bend', () => {
    const terrain = createTerrainField({
      origin: [-8, -8],
      spacing: 0.5,
      cols: 33,
      rows: 33,
      step: 0.01,
    })
    const original = SiteNode.parse({
      id: 'site_river',
      children: ['river_water'],
      polygon: {
        type: 'polygon',
        points: [
          [-8, -8],
          [8, -8],
          [8, 8],
          [-8, 8],
        ],
      },
      terrain: encodeTerrainField(terrain),
    })
    const river = RiverNode.parse({
      id: 'river_water',
      parentId: original.id,
      points: [
        [-6, 3],
        [0, -3],
        [6, 3],
      ],
      width: 2,
      depth: 1,
    })
    const carved = rebuildRiverTerrain(original, [river])
    const site = { ...original, terrain: carved.terrainData, metadata: carved.metadata }
    const topology = createGrassObstacleTopology({ minX: -8, minZ: -8, maxX: 8, maxZ: 8 })
    const mask = buildGrassObstacleField(site, scene(site, river), topology)
    expect(isGrassAllowedAt(mask, 0, -3)).toBe(false)
    expect(isGrassAllowedAt(mask, 0, 0)).toBe(true)
    expect(isGrassAllowedAt(mask, 0, -6)).toBe(true)
    expect(isGrassAllowedAt(buildGrassObstacleField(site, scene(site), topology), 0, -3)).toBe(true)
  })

  test('refreshes masks for water edits, removal, reparenting, and terrain-dependent shorelines', () => {
    const site = pondSite()
    const pond = PondNode.parse({
      id: 'pond_water',
      parentId: site.id,
      seed: [1, 1],
      waterLevel: 2,
    })
    const previous = scene(site, pond)
    expect(changedGrassObstacleSiteIds(scene(site, { ...pond, waterLevel: 4 }), previous)).toEqual(
      new Set([site.id]),
    )
    expect(changedGrassObstacleSiteIds(scene(site), previous)).toEqual(new Set([site.id]))
    const elsewhere = SiteNode.parse({ ...site, id: 'site_elsewhere', children: [] })
    expect(
      changedGrassObstacleSiteIds(
        scene(site, elsewhere, { ...pond, parentId: elsewhere.id }),
        scene(site, elsewhere, pond),
      ),
    ).toEqual(new Set([site.id, elsewhere.id]))

    const raisedTerrain = createTerrainField({
      origin: [0, 0],
      spacing: 1,
      cols: 7,
      rows: 7,
      step: 1,
    })
    raisedTerrain.heights.fill(5)
    const raised = { ...site, terrain: encodeTerrainField(raisedTerrain) }
    expect(changedGrassObstacleSiteIds(scene(raised, pond), previous)).toEqual(new Set([site.id]))
    expect(
      isGrassAllowedAt(buildGrassObstacleField(raised, scene(raised, pond), pondTopology), 1, 1),
    ).toBe(true)
    const clipped = {
      ...site,
      polygon: {
        type: 'polygon' as const,
        points: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ] as [number, number][],
      },
    }
    expect(changedGrassObstacleSiteIds(scene(clipped, pond), previous)).toEqual(new Set([site.id]))

    const river = RiverNode.parse({
      id: 'river_water',
      parentId: site.id,
      points: [
        [1, 1],
        [5, 5],
      ],
    })
    expect(
      changedGrassObstacleSiteIds(scene(site, { ...river, width: 8 }), scene(site, river)),
    ).toEqual(new Set([site.id]))
    expect(changedGrassObstacleSiteIds(scene(raised), scene(site)).size).toBe(0)
  })
})
