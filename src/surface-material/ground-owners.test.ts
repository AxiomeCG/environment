import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
} from '@pascal-app/core'
import { expect, test } from 'bun:test'
import { isGrassAllowedAt } from '../ground-cover/obstacle-field'
import { disposeGrassObstacleTexture, getGrassObstacleRuntime } from '../ground-cover/obstacle-texture'
import { PondNode } from '../pond/schema'
import { createSurfaceOwnerMask, updateSurfaceMaterialObstacles } from './geometry'
import { SurfaceMaterialNode } from './schema'

/**
 * The Surface is a sheet draped 5 mm over the whole lot. Where another node owns the ground and
 * stands lower than it (a pool cut into the lot), the sheet would lie over it as a lid: it is
 * drawn only where the lawn's own mask leaves ground. Environment's water keeps its bed.
 */

type Nodes = Record<string, AnyNode>

function withPoolKind(run: () => void): void {
  const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
  try {
    registerNode({
      kind: 'pool:pool',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'utility',
      defaults: () => ({}) as never,
      capabilities: {
        floorPlaced: {
          footprint: (node: { rotation: [number, number, number] }) => ({
            dimensions: [4.6, 1.5, 2.6],
            rotation: node.rotation,
          }),
        },
      },
    } as unknown as AnyNodeDefinition)
    run()
  } finally {
    nodeRegistry._reset()
    for (const definition of registryDefinitions) registerNode(definition)
  }
}

const surface = SurfaceMaterialNode.parse({ id: 'surface-material_lot', parentId: 'site_lot' })
const pool = {
  id: 'pool_lot', type: 'pool:pool', object: 'node', parentId: 'level_lot', visible: true,
  metadata: {}, position: [6, 0, 4], rotation: [0, 0, 0], copingWidth: 0.3,
  polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]],
} as unknown as AnyNode

function lot(...extra: AnyNode[]): Nodes {
  const site = SiteNode.parse({
    id: 'site_lot', children: ['building_lot', surface.id],
    polygon: { type: 'polygon', points: [[0, 0], [12, 0], [12, 12], [0, 12]] },
  })
  const building = BuildingNode.parse({
    id: 'building_lot', parentId: site.id, children: ['level_lot'], position: [1, 0, 1],
  })
  const level = LevelNode.parse({
    id: 'level_lot', parentId: building.id, level: 0,
    children: extra.filter((node) => node.parentId === 'level_lot').map((node) => node.id),
  })
  const nodes = [site, building, level, surface as unknown as AnyNode, ...extra] as AnyNode[]
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

const maskOf = () => {
  const runtime = getGrassObstacleRuntime(surface.id)
  if (!runtime) throw new Error('the surface has no ground mask')
  return runtime.field
}

test('the surface is not drawn over a pool, whether the pool or the surface came first', () => {
  withPoolKind(() => {
    // Level (6, 4) is site (7, 5): water 5..9 x 4..6, coping 0.3 round it.
    const withPool = lot(pool)
    // The mask the surface's material samples, as its geometry builder mounts it.
    const mounted = createSurfaceOwnerMask(surface, withPool.site_lot as SiteNode, withPool)
    try {
      expect(isGrassAllowedAt(maskOf(), 7, 5)).toBe(false)
      expect(isGrassAllowedAt(maskOf(), 9.2, 5)).toBe(false)
      expect(isGrassAllowedAt(maskOf(), 10, 5)).toBe(true)
      expect(isGrassAllowedAt(maskOf(), 7, 8)).toBe(true)

      // The pool goes: the same sheet is drawn there again, without a rebuild.
      const without = lot()
      expect(updateSurfaceMaterialObstacles(surface, without.site_lot as SiteNode, without)).toBe(true)
      expect(isGrassAllowedAt(maskOf(), 7, 5)).toBe(true)
      // And comes back on a surface already drawn.
      expect(updateSurfaceMaterialObstacles(surface, withPool.site_lot as SiteNode, withPool)).toBe(true)
      expect(isGrassAllowedAt(maskOf(), 7, 5)).toBe(false)
    } finally {
      disposeGrassObstacleTexture(surface.id, mounted.texture)
    }
  })
})

test('the surface stays under an Environment pond: the water keeps its bed', () => {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 2, cols: 7, rows: 7, step: 1 })
  terrain.heights.set([
    5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0,
    0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5,
  ])
  const pond = PondNode.parse({ id: 'pond_lot', parentId: 'site_lot', seed: [6, 6], waterLevel: 2 }) as unknown as AnyNode
  const nodes = lot(pond)
  nodes.site_lot = {
    ...(nodes.site_lot as SiteNode),
    children: ['building_lot', surface.id, pond.id],
    terrain: encodeTerrainField(terrain),
  } as AnyNode
  const mounted = createSurfaceOwnerMask(surface, nodes.site_lot as SiteNode, nodes)
  try {
    expect(isGrassAllowedAt(maskOf(), 6, 6)).toBe(true)
  } finally {
    disposeGrassObstacleTexture(surface.id, mounted.texture)
  }
})
