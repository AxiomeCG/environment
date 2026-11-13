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

/** The item kind and the plant kinds of other plugins, as their hosts register them. */
function withPlantKinds(run: () => void): void {
  const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
  const kind = (name: string, floorPlaced: unknown, label?: string) =>
    registerNode({
      kind: name,
      schemaVersion: 1,
      schema: ItemNode,
      category: 'utility',
      defaults: () => ({}) as never,
      capabilities: { floorPlaced },
      ...(label ? { presentation: { label } } : {}),
    } as unknown as AnyNodeDefinition)
  /** plugin-trees: a trunk-sized footprint that does not collide (tree, flower and grass alike). */
  const trunk = (share: number) => ({
    collides: false,
    footprint: (node: { height: number; rotation: [number, number, number] }) => ({
      dimensions: [node.height * share, node.height, node.height * share],
      rotation: node.rotation,
    }),
  })
  /** A plugin kind that collides over the box of its whole crown. */
  const crown = {
    collides: true,
    footprint: (node: { size: [number, number, number]; rotation: [number, number, number] }) => ({
      dimensions: node.size,
      rotation: node.rotation,
    }),
  }
  try {
    kind('item', {
      collides: true,
      footprint: (node: ItemNode) => ({
        position: node.position,
        dimensions: node.asset.dimensions,
        rotation: node.rotation,
      }),
    })
    kind('trees:tree', trunk(0.07), 'Tree')
    kind('trees:flower', trunk(0.25), 'Flower')
    kind('trees:grass', trunk(0.3), 'Grass')
    kind('garden:palm', crown, 'Palm')
    kind('garden:specimen', crown, 'Ornamental tree')
    kind('garden:shed', crown, 'Shed')
    run()
  } finally {
    nodeRegistry._reset()
    for (const definition of registryDefinitions) registerNode(definition)
  }
}

type Ring = [number, number][]
type Band = { y0: number; y1: number; polygons: { outer: Ring; holes?: Ring[] }[] }

const square = (half: number): Ring => [[-half, -half], [half, -half], [half, half], [-half, half]]
const TRUNK: Ring = [[-0.1, -0.2], [0.1, -0.2], [0.1, 0.2], [-0.1, 0.2]]
/** A trunk under a crown that starts a metre up. */
const TREE_BANDS: Band[] = [
  { y0: 0, y1: 1, polygons: [{ outer: TRUNK }] },
  { y0: 1, y1: 5, polygons: [{ outer: square(2) }] },
]
/** A clipped ball: a foot, the swell of the ball inside the grass, the ball above it. */
const BALL_BANDS: Band[] = [
  { y0: 0, y1: 0.25, polygons: [{ outer: square(0.15) }] },
  { y0: 0.25, y1: 0.75, polygons: [{ outer: square(0.4) }] },
  { y0: 0.75, y1: 1, polygons: [{ outer: square(0.5) }] },
]

function expectShape(actual: unknown, expected: unknown, path = 'shape'): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number')
    expect(actual as number, path).toBeCloseTo(expected, 9)
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true)
    expect((actual as unknown[]).length, path).toBe(expected.length)
    expected.forEach((value, index) => expectShape((actual as unknown[])[index], value, `${path}[${index}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort())
    for (const [key, value] of Object.entries(expected)) {
      expectShape((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
    }
    return
  }
  expect(actual, path).toEqual(expected)
}

describe('what a plant clears in the grass', () => {
  const site = SiteNode.parse({ id: 'site_plants' })
  const at: [number, number, number] = [2, 0, 3]
  // Everything here stands in the lawn: it takes the blades, never the lawn's ground under it.
  const disc = (radius: number) => ({ kind: 'capsule', keepsGround: true, start: [2, 3], end: [2, 3], radius })
  const box = (halfX: number, halfZ: number) => ({
    kind: 'box', keepsGround: true, center: [2, 3], halfSize: [halfX, halfZ], rotation: 0,
  })
  const polygon = (points: Ring) => ({ kind: 'polygon', keepsGround: true, points, holes: [] })

  type ItemOptions = {
    category?: string
    tags?: string[]
    bands?: Band[]
    rotation?: [number, number, number]
    scale?: [number, number, number]
    asset?: Record<string, unknown>
  }
  const item = (name: string, dimensions: [number, number, number], options: ItemOptions = {}) => {
    const node = ItemNode.parse({
      id: 'item_plant',
      parentId: site.id,
      position: at,
      rotation: options.rotation ?? [0, 0, 0],
      scale: options.scale ?? [1, 1, 1],
      asset: {
        id: 'asset_plant', category: options.category ?? 'outdoor', name, thumbnail: '',
        src: 'asset://test', dimensions,
        ...(options.tags ? { tags: options.tags } : {}),
        ...options.asset,
      },
    })
    return (
      options.bands ? { ...node, source: { manifest: { shape: { bands: options.bands } } } } : node
    ) as AnyNode
  }
  const plugin = (type: string, fields: Record<string, unknown>) =>
    ({
      id: 'plant_plugin', type, object: 'node', parentId: site.id, visible: true, metadata: {},
      position: at, rotation: [0, 0, 0], ...fields,
    }) as unknown as AnyNode

  const cases: [string, AnyNode, unknown[]][] = [
    // Other plugins' plants. plugin-trees declares a trunk footprint that does not collide:
    // a tree clears that trunk, a flower and a tuft stand in the lawn.
    ['a plugin-trees tree clears its trunk and a hand\'s width', plugin('trees:tree', { height: 7 }), [disc((7 * 0.07) / 2 + 0.05)]],
    ['a plugin-trees flower clears nothing', plugin('trees:flower', { height: 0.6 }), []],
    ['a plugin-trees grass tuft clears nothing', plugin('trees:grass', { height: 0.5 }), []],
    ['a colliding plant kind clears a trunk disc, by its kind',
      plugin('garden:palm', { size: [4, 6, 4] }), [disc(6 * 0.04)]],
    ['a colliding plant kind clears a trunk disc, by its label',
      plugin('garden:specimen', { size: [5, 10, 5] }), [disc(0.4)]],
    ['a low colliding plant kind keeps its box', plugin('garden:palm', { size: [1.2, 1, 1.2] }), [box(0.6, 0.6)]],
    ['a tall colliding kind that is no plant keeps its box',
      plugin('garden:shed', { size: [3, 2.5, 2] }), [box(1.5, 1)]],
    // Objects an agent scripts carry the outline of every height band: no name is read.
    ['a scripted "Coastal palm" clears its trunk',
      item('Coastal palm', [4, 5, 4], { bands: TREE_BANDS }), [polygon([[1.9, 2.8], [2.1, 2.8], [2.1, 3.2], [1.9, 3.2]])]],
    ['a scripted tree with no plant word in its name clears its trunk',
      item('Jacaranda', [4, 5, 4], { category: 'custom', bands: TREE_BANDS }),
      [polygon([[1.9, 2.8], [2.1, 2.8], [2.1, 3.2], [1.9, 3.2]])]],
    ['a scripted "Olive tree", scaled and turned a quarter, clears its trunk where it stands',
      item('Olive tree', [4, 5, 4], { bands: TREE_BANDS, scale: [2, 1, 2], rotation: [0, Math.PI / 2, 0] }),
      [polygon([[1.6, 3.2], [1.6, 2.8], [2.4, 2.8], [2.4, 3.2]])]],
    ['a scripted tree whose asset is corrected (scale, turn, offset) clears its trunk where it is drawn',
      item('Fig', [4, 5, 4], {
        bands: TREE_BANDS,
        asset: { scale: [0.5, 0.5, 0.5], rotation: [0, Math.PI, 0], offset: [1, 0, -1] },
      }),
      [polygon([[3.05, 2.1], [2.95, 2.1], [2.95, 1.9], [3.05, 1.9]])]],
    ['a scripted "Boxwood" ball clears what it has inside the grass, not its box',
      item('Boxwood', [1, 1, 1], { bands: BALL_BANDS }),
      [
        polygon([[1.85, 2.85], [2.15, 2.85], [2.15, 3.15], [1.85, 3.15]]),
        polygon([[1.6, 2.6], [2.4, 2.6], [2.4, 3.4], [1.6, 3.4]]),
      ]],
    ['a scripted object keeps the holes of its outline',
      item('Planter ring', [2, 2.4, 2], {
        category: 'custom',
        bands: [{ y0: 0, y1: 0.4, polygons: [{ outer: square(1), holes: [square(0.5)] }] }],
      }),
      [{
        kind: 'polygon',
        keepsGround: true,
        points: [[1, 2], [3, 2], [3, 4], [1, 4]],
        holes: [[[1.5, 2.5], [2.5, 2.5], [2.5, 3.5], [1.5, 3.5]]],
      }]],
    ['a leaning scripted palm has no plan outline to read: a trunk disc, by its name',
      item('Leaning palm', [4, 5, 4], { bands: TREE_BANDS, rotation: [0.3, 0, 0] }), [disc(0.2)]],
    ['a leaning scripted object that is no plant keeps its box',
      item('Mast', [1, 5, 1], { category: 'custom', bands: TREE_BANDS, rotation: [0.3, 0, 0] }), [box(0.5, 0.5)]],
    // Catalogue models have no outline here: the words core files foliage under, tags included.
    ['a tall catalogue plant known by its tags clears a trunk disc',
      item('Kentia', [3, 4, 3], { tags: ['indoor-plant'] }), [disc(0.16)]],
    ['a tall catalogue plant known by its category clears a trunk disc',
      item('Kentia', [3, 4, 3], { category: 'plants' }), [disc(0.16)]],
    ['a tall catalogue model that is no plant keeps its box', item('Wardrobe', [1.2, 2.2, 0.6]), [box(0.6, 0.3)]],
    ['a slender tall plant clears its own footprint and a hand\'s width',
      item('Bamboo plant', [0.2, 3, 0.24]), [disc(0.12 + 0.05)]],
  ]

  test.each(cases)('%s', (_name, node, expected) => {
    withPlantKinds(() => {
      const shapes = collectGrassObstacleShapes(site, scene(site, node))
      expect(shapes.length).toBe(expected.length)
      expected.forEach((shape, index) => expectShape(shapes[index], shape, `shapes[${index}]`))
    })
  })
})

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
      // Each stands in the lawn: no blade there, the lawn's ground kept under it.
      // The palm's box is its crown: a trunk from its height. The tree's box is already a trunk:
      // that trunk and a hand's width (R&D line; a11c385 took 4 % of the height for both).
      expect(shapes[0]).toEqual({ kind: 'capsule', keepsGround: true, start: [2, 3], end: [2, 3], radius: 5.62 * 0.04 })
      expect(shapes[1]).toEqual({ kind: 'capsule', keepsGround: true, start: [2, 3], end: [2, 3], radius: 0.525 / 2 + 0.05 })
      expect(shapes[2]?.kind).toBe('box')
      expect(shapes[3]?.kind).toBe('box')
      expect(shapes[4]).toEqual({
        kind: 'polygon', keepsGround: true, points: [[1.9, 2.8], [2.1, 2.8], [2.1, 3.2], [1.9, 3.2]], holes: [],
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
        keepsGround: true,
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
