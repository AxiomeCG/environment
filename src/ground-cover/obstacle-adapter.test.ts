import {
  type AnyNodeDefinition,
  type AnyNode,
  BuildingNode,
  LevelNode,
  ItemNode,
  createTerrainField,
  encodeTerrainField,
  nodeRegistry,
  registerNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  changedGrassObstacleSiteIds,
  collectGrassObstacleShapes,
} from './obstacle-adapter'

function scene(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('Pascal plan obstacle adapter', () => {
  test('tall foliage clears a trunk disc while low foliage and furniture keep their boxes', () => {
    const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
    try {
      registerNode({
        kind: 'item',
        schemaVersion: 1,
        schema: ItemNode,
        category: 'utility',
        defaults: () => ({}) as never,
        capabilities: {
          floorPlaced: {
            collides: true,
            footprint: (node: ItemNode) => ({
              position: node.position,
              dimensions: node.asset.dimensions,
              rotation: node.rotation,
            }),
          },
        },
      } as AnyNodeDefinition)
      const site = SiteNode.parse({ id: 'site_trees' })
      const item = (id: string, name: string, dimensions: [number, number, number]) =>
        ItemNode.parse({
          id: `item_${id}`, parentId: site.id, position: [2, 0, 3],
          asset: { id: `asset_${id}`, category: 'outdoor', name, thumbnail: '', src: 'asset://test', dimensions },
        })
      const palm = item('palm', 'Palm', [4.05, 5.62, 4.05])
      const tree = item('tree', 'Tree', [0.525, 4.5, 0.496])
      const bush = item('bush', 'Bush shrub', [3, 1.04, 1.01])
      const chair = item('chair', 'Chair', [1, 3, 1])
      const scripted = {
        ...item('scripted', 'Palm', [4, 5, 4]),
        source: { manifest: { shape: { bands: [
          { y0: 0, y1: 1, polygons: [{ outer: [[-0.1, -0.2], [0.1, -0.2], [0.1, 0.2], [-0.1, 0.2]] }] },
          { y0: 1, y1: 5, polygons: [{ outer: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }] },
        ] } } },
      } as AnyNode
      const shapes = collectGrassObstacleShapes(site, scene(site, palm, tree, bush, chair, scripted))
      expect(shapes[0]).toEqual({ kind: 'capsule', start: [2, 3], end: [2, 3], radius: 5.62 * 0.04 })
      expect(shapes[1]).toEqual({ kind: 'capsule', start: [2, 3], end: [2, 3], radius: 4.5 * 0.04 })
      expect(shapes[2]?.kind).toBe('box')
      expect(shapes[3]?.kind).toBe('box')
      expect(shapes[4]).toEqual({
        kind: 'polygon', points: [[1.9, 2.8], [2.1, 2.8], [2.1, 3.2], [1.9, 3.2]], holes: [],
      })
    } finally {
      nodeRegistry._reset()
      for (const definition of registryDefinitions) registerNode(definition)
    }
  })

  test('projects ground-level slabs and walls from building-local into site-local space', () => {
    const site = SiteNode.parse({
      id: 'site_test',
      children: ['building_test'],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
      },
    })
    const building = BuildingNode.parse({
      id: 'building_test',
      parentId: site.id,
      children: ['level_test'],
      position: [10, 0, 5],
      rotation: [0, Math.PI / 2, 0],
    })
    const level = LevelNode.parse({
      id: 'level_test',
      parentId: building.id,
      children: ['slab_test', 'wall_test'],
      level: 0,
    })
    const slab = SlabNode.parse({
      id: 'slab_test',
      parentId: level.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
      thickness: 0.2,
    })

    const shapes = collectGrassObstacleShapes(
      site,
      scene(site, building, level, slab, wall),
    )
    const polygon = shapes.find((shape) => shape.kind === 'polygon')
    const capsule = shapes.find((shape) => shape.kind === 'capsule')

    expect(polygon?.kind).toBe('polygon')
    if (polygon?.kind === 'polygon') {
      expect(polygon.points[0]).toEqual([10, 5])
      expect(polygon.points[1]?.[0]).toBeCloseTo(10)
      expect(polygon.points[1]?.[1]).toBeCloseTo(3)
    }
    expect(capsule?.kind).toBe('capsule')
    if (capsule?.kind === 'capsule') expect(capsule.radius).toBeCloseTo(0.1)
  })

  test('uses the storey closest to the building datum instead of a basement', () => {
    const site = SiteNode.parse({
      id: 'site_test',
      children: ['building_test'],
      polygon: { type: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] },
    })
    const building = BuildingNode.parse({
      id: 'building_test',
      parentId: site.id,
      children: ['level_basement', 'level_grade'],
    })
    const basement = LevelNode.parse({
      id: 'level_basement',
      parentId: building.id,
      children: ['slab_basement'],
      level: -1,
      baseElevation: -3,
    })
    const grade = LevelNode.parse({
      id: 'level_grade',
      parentId: building.id,
      children: ['slab_grade'],
      level: 0,
    })
    const basementSlab = SlabNode.parse({
      id: 'slab_basement',
      parentId: basement.id,
      polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    })
    const gradeSlab = SlabNode.parse({
      id: 'slab_grade',
      parentId: grade.id,
      polygon: [[4, 4], [6, 4], [6, 6], [4, 6]],
    })

    const shapes = collectGrassObstacleShapes(
      site,
      scene(site, building, basement, grade, basementSlab, gradeSlab),
    )
    const polygons = shapes.filter((shape) => shape.kind === 'polygon')
    expect(polygons).toHaveLength(1)
    expect(polygons[0]?.kind === 'polygon' ? polygons[0].points[0] : null).toEqual([4, 4])
  })
  test('uses registered floorPlaced footprints for props', () => {
    const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
    try {
      registerNode({
        kind: 'item',
        schemaVersion: 1,
        schema: ItemNode,
        category: 'utility',
        defaults: () => ({}) as never,
        capabilities: {
          floorPlaced: {
            collides: true,
            footprint: () => ({
              position: [4, 0, -2],
              dimensions: [2, 1, 4],
              rotation: [0, Math.PI / 4, 0],
            }),
          },
        },
      } as AnyNodeDefinition)
      const site = SiteNode.parse({
        id: 'site_prop',
        children: ['building_prop'],
        polygon: {
          type: 'polygon',
          points: [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
          ],
        },
      })
      const building = BuildingNode.parse({
        id: 'building_prop',
        parentId: site.id,
        children: ['level_prop'],
      })
      const level = LevelNode.parse({
        id: 'level_prop',
        parentId: building.id,
        children: ['item_prop'],
      })
      const prop = ItemNode.parse({
        id: 'item_prop',
        parentId: level.id,
        position: [4, 0, -2],
        rotation: [0, Math.PI / 4, 0],
        asset: {
          id: 'asset_prop',
          category: 'test',
          name: 'Prop',
          thumbnail: '',
          src: 'asset://test',
          dimensions: [2, 1, 4],
          source: 'library',
        },
      })

      const shapes = collectGrassObstacleShapes(
        site,
        scene(site, building, level, prop),
      )

      expect(shapes).toContainEqual({
        kind: 'box',
        center: [4, -2],
        halfSize: [1, 2],
        rotation: Math.PI / 4,
      })
    } finally {
      nodeRegistry._reset()
      for (const definition of registryDefinitions) nodeRegistry._register(definition)
    }
  })


  test('invalidates on obstacle edits but not terrain-only site updates', () => {
    const site = SiteNode.parse({
      id: 'site_test',
      children: ['building_test'],
      polygon: { type: 'polygon', points: [[0, 0], [5, 0], [5, 5], [0, 5]] },
    })
    const building = BuildingNode.parse({
      id: 'building_test',
      parentId: site.id,
      children: ['level_test'],
    })
    const level = LevelNode.parse({
      id: 'level_test',
      parentId: building.id,
      children: ['wall_test'],
    })
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
    })
    const previous = scene(site, building, level, wall)
    const movedWall = WallNode.parse({ ...wall, end: [3, 0] })
    const current = scene(site, building, level, movedWall)
    expect(Array.from(changedGrassObstacleSiteIds(current, previous))).toEqual([site.id])

    const terrainOnlySite = SiteNode.parse({
      ...site,
      terrain: encodeTerrainField(
        createTerrainField({
          origin: [0, 0],
          spacing: 1,
          cols: 2,
          rows: 2,
          step: 0.01,
        }),
      ),
    })
    expect(
      changedGrassObstacleSiteIds(
        scene(terrainOnlySite, building, level, wall),
        previous,
      ).size,
    ).toBe(0)
  })
})
