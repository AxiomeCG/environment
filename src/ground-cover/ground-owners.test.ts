import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { layGround } from '../agent-operations/lay-ground'
import type { SceneChanges } from '../agent-operations/types'
import { resolveGroundCoverPaint } from '../paint-tiles/layers'
import { PondNode } from '../pond/schema'
import { resolveGroundCoverFields } from './field-context'
import { collectFlowerPlacements } from './flower-scatter'
import { buildGrassObstacleField, changedGrassObstacleSiteIds } from './obstacle-adapter'
import { createGrassObstacleTopology, isGrassAllowedAt, isLawnGroundAt } from './obstacle-field'
import { paintAt, siteBounds } from './paint-field'
import { GRASS_FIELD_KIND, GrassFieldNode } from './schema'

/**
 * Two things take ground from the lawn. Another surface owns it (paving, a pool, water, a ramp):
 * no paint, no ground, no blade, no flower. Something stands in it (a rock, steps, a planter, a
 * fixture, a plant): no blade or flower, but the lawn's paint and ground run on under it, so
 * there is never a bare patch round it. Each case is run both ways round: the thing is there
 * when the lawn is laid, and the lawn is there when the thing arrives.
 */

type Nodes = Record<string, AnyNode>
type Point = [number, number]

/** Kinds as their hosts register them: what each declares about the floor it stands on. */
function withGardenKinds(run: () => void): void {
  const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
  const kind = (name: string, floorPlaced?: unknown) =>
    registerNode({
      kind: name,
      schemaVersion: 1,
      schema: ItemNode,
      category: 'utility',
      defaults: () => ({}) as never,
      capabilities: floorPlaced ? { floorPlaced } : {},
    } as unknown as AnyNodeDefinition)
  type Boxed = { size: [number, number, number]; position: [number, number, number]; rotation: [number, number, number] }
  const box = { footprint: (node: Boxed) => ({ dimensions: node.size, rotation: node.rotation }) }
  type Pool = { polygon: Point[]; copingWidth: number; rotation: [number, number, number] }
  try {
    kind('item', {
      collides: true,
      footprint: (node: ItemNode) => ({ dimensions: node.asset.dimensions, rotation: node.rotation }),
    })
    // plugin-pool: the box of its outline and coping, and no word on collision.
    kind('pool:pool', {
      footprint: (node: Pool) => {
        const xs = node.polygon.map(([x]) => x)
        const zs = node.polygon.map(([, z]) => z)
        return {
          dimensions: [
            Math.max(...xs) - Math.min(...xs) + node.copingWidth * 2,
            1.5,
            Math.max(...zs) - Math.min(...zs) + node.copingWidth * 2,
          ],
          rotation: node.rotation,
        }
      },
    })
    kind('streetscape:mailbox', box)
    // plugin-trees: trunk-sized, and explicitly no collision.
    kind('trees:tree', { ...box, collides: false })
    kind('trees:flower', { ...box, collides: false })
    // Core: steps and a marker leave collision off; a block collides while it rests on the floor.
    kind('stair', box)
    kind('spawn', box)
    kind('block', { ...box, collides: (node: { onFloor?: boolean }) => node.onFloor === true })
    kind('rock')
    kind('ramp')
    run()
  } finally {
    nodeRegistry._reset()
    for (const definition of registryDefinitions) registerNode(definition)
  }
}

const LOT: Point[] = [[0, 0], [16, 0], [16, 16], [0, 16]]
/** The house's frame stands 2 m in from the lot's corner: level coordinates are site minus (2, 2). */
function garden(): Nodes {
  const site = SiteNode.parse({
    id: 'site_garden', children: ['building_garden'], polygon: { type: 'polygon', points: LOT },
  })
  const building = BuildingNode.parse({
    id: 'building_garden', parentId: site.id, children: ['level_garden'], position: [2, 0, 2],
  })
  const level = LevelNode.parse({ id: 'level_garden', parentId: building.id, children: [], level: 0 })
  return { [site.id]: site, [building.id]: building, [level.id]: level } as Nodes
}

/** The scene with `added` in it, each under its parent's children as a create leaves it. */
function withNodes(nodes: Nodes, added: readonly AnyNode[]): Nodes {
  const next = { ...nodes }
  for (const node of added) {
    next[node.id] = node
    const parent = node.parentId ? (next[node.parentId] as (AnyNode & { children?: string[] }) | undefined) : undefined
    if (parent?.children && !parent.children.includes(node.id)) {
      next[parent.id] = { ...parent, children: [...parent.children, node.id] } as AnyNode
    }
  }
  return next
}

function applyChanges(nodes: Nodes, changes: SceneChanges | undefined): Nodes {
  let next = withNodes(nodes, (changes?.create ?? []).map(({ node }) => node))
  for (const { id, data } of changes?.update ?? []) next = { ...next, [id]: { ...next[id], ...data } as AnyNode }
  for (const id of changes?.delete ?? []) delete next[id]
  return next
}

const layLawn = (nodes: Nodes): Nodes =>
  applyChanges(nodes, layGround(nodes, { areas: [{ site: true, ground: 'grass', featherM: 0 }] }, { activeLevelId: null }).changes)

const siteOf = (nodes: Nodes) => Object.values(nodes).find((node) => node.type === 'site') as SiteNode

function lawnOf(nodes: Nodes): GrassFieldNode {
  const lawn = Object.values(nodes).find((node) => String(node.type) === GRASS_FIELD_KIND)
  if (!lawn) throw new Error('no lawn')
  return lawn as unknown as GrassFieldNode
}

/** Grass coverage the lawn's paint holds at a point. */
function paintedAt(nodes: Nodes, [x, z]: Point): number {
  const site = siteOf(nodes)
  const paint = resolveGroundCoverPaint(lawnOf(nodes), Object.values(nodes), siteBounds(site.polygon.points))
  return paintAt(paint, x, z).a
}

function maskOf(nodes: Nodes) {
  const site = siteOf(nodes)
  return buildGrassObstacleField(site, nodes, createGrassObstacleTopology(siteBounds(site.polygon.points)))
}

/** Where the lawn puts flowers, at full flower density, as the renderer and the bake do. */
function flowersOf(nodes: Nodes): Point[] {
  const site = siteOf(nodes)
  const context: GeometryContext = {
    parent: site,
    children: [],
    siblings: [],
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
  }
  const lawn = { ...lawnOf(nodes), flowerDensity: 100, density: 100 }
  const fields = resolveGroundCoverFields(lawn, context)
  if (!fields) throw new Error('no fields')
  return collectFlowerPlacements(lawn, fields).map(({ position }) => [position[0], position[2]])
}

const near = (points: readonly Point[], [x, z]: Point, radius: number) =>
  points.some(([px, pz]) => Math.hypot(px - x, pz - z) <= radius)

const levelNode = (type: string, id: string, fields: Record<string, unknown>) =>
  ({
    id, type, object: 'node', parentId: 'level_garden', visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...fields,
  }) as unknown as AnyNode
const siteNode = (type: string, id: string, fields: Record<string, unknown>) =>
  ({ id, type, object: 'node', parentId: 'site_garden', visible: true, metadata: {}, ...fields }) as unknown as AnyNode

type Case = {
  name: string
  /** Whether it stands in the lawn (the lawn's ground kept) or is another surface (taken). */
  stands?: boolean
  nodes: AnyNode[]
  /** Site points the thing takes: no blade, no flower; no paint or ground unless it only stands. */
  owned: Point[]
  /** Site points beside it that stay lawn. */
  lawn: Point[]
}

/**
 * An L-shaped pool turned a quarter, at level (8, 6), which is site (10, 8). A local point (x, z)
 * stands at site (10 + z, 8 - x). Its box would also take the corner the L leaves out.
 */
const pool = levelNode('pool:pool', 'pool_garden', {
  position: [8, 0, 6],
  rotation: [0, Math.PI / 2, 0],
  polygon: [[-3, -1.5], [3, -1.5], [3, 0], [0, 0], [0, 1.5], [-3, 1.5]],
  copingWidth: 0.3,
})

const cases: Case[] = [
  {
    name: 'a plugin pool: its water and its coping, not the box round them',
    nodes: [pool],
    owned: [[9.25, 6.5], [10.75, 9.5], [8.35, 8], [11.65, 9.5], [9.25, 4.85]],
    lawn: [[10.9, 6.2], [10, 12], [7.5, 8], [12.5, 9.5]],
  },
  {
    name: 'a paved site surface (add_site_surface)',
    nodes: [SlabNode.parse({
      id: 'slab_patio', parentId: 'level_garden', elevation: 0.05, metadata: { flatwork: 'patio' },
      polygon: [[4, 8], [8, 8], [8, 11], [4, 11]],
    }) as AnyNode],
    owned: [[8, 11.5], [6.2, 10.2], [9.8, 12.8]],
    lawn: [[8, 14], [5, 11.5]],
  },
  {
    name: 'a terrace (add_terrace)',
    nodes: [SlabNode.parse({
      id: 'slab_terrace', parentId: 'level_garden', elevation: 0.02, metadata: { terrace: true },
      polygon: [[1, 1], [5, 1], [5, 3], [1, 3]],
    }) as AnyNode],
    owned: [[5, 4], [3.2, 3.2], [6.8, 4.8]],
    lawn: [[5, 6], [8, 4]],
  },
  {
    name: 'a rock on the site ground (add_rock)',
    stands: true,
    nodes: [siteNode('rock', 'rock_boulder', {
      polygon: [[3, 12], [4.6, 11.5], [5.4, 12.7], [4.4, 13.8], [3.1, 13.5]], height: 0.9,
    })],
    owned: [[4.2, 12.7], [3.4, 12.4]],
    lawn: [[2.3, 11.2], [6.2, 12.7]],
  },
  {
    name: 'garden steps (add_steps)',
    stands: true,
    nodes: [levelNode('stair', 'stair_steps', { position: [5, 0, 3], size: [1.2, 0.6, 1.5] })],
    owned: [[7, 5], [6.5, 4.4], [7.5, 5.6]],
    lawn: [[7, 6.5], [8.3, 5]],
  },
  {
    name: 'a ramp graded into the site (add_ramp)',
    nodes: [siteNode('ramp', 'ramp_entry', {
      start: [12, 2], segments: [{ type: 'line', end: [12, 6] }], width: 2,
    })],
    owned: [[12, 4], [12.8, 3], [11.2, 5.5]],
    lawn: [[13.6, 4], [10.4, 4], [12, 7.6]],
  },
  {
    name: 'a planter standing on the ground (add_mass)',
    stands: true,
    nodes: [levelNode('block', 'block_planter', { position: [10, 0, 1], size: [2, 0.5, 0.8], onFloor: true })],
    owned: [[12, 3], [11.2, 2.8], [12.8, 3.2]],
    lawn: [[12, 4.2], [10.4, 3]],
  },
  {
    name: 'a small plugin fixture with a footprint (a mailbox)',
    stands: true,
    nodes: [levelNode('streetscape:mailbox', 'mailbox_garden', { position: [1, 0, 12], size: [0.5, 1.2, 0.5] })],
    owned: [[3, 14]],
    lawn: [[3, 14.8], [3.8, 14]],
  },
]

describe('what owns the ground keeps the lawn off it', () => {
  test.each(cases)('$name, there before the lawn is laid', ({ nodes, owned, lawn, stands }) => {
    withGardenKinds(() => {
      const laid = layLawn(withNodes(garden(), nodes))
      for (const point of owned) expect(paintedAt(laid, point), `paint at ${point}`).toBe(stands ? 1 : 0)
      for (const point of lawn) expect(paintedAt(laid, point), `paint at ${point}`).toBe(1)
      const mask = maskOf(laid)
      for (const point of owned) {
        expect(isGrassAllowedAt(mask, ...point), `blade at ${point}`).toBe(false)
        expect(isLawnGroundAt(mask, ...point), `ground at ${point}`).toBe(stands === true)
      }
      for (const point of lawn) expect(isGrassAllowedAt(mask, ...point), `blade at ${point}`).toBe(true)
    })
  })

  test.each(cases)('$name, arriving on a lawn already laid', ({ nodes, owned, lawn, stands }) => {
    withGardenKinds(() => {
      const before = layLawn(garden())
      for (const point of owned) expect(paintedAt(before, point)).toBe(1)
      const after = withNodes(before, nodes)
      // The lawn is told: its mask is redrawn without a repaint.
      expect(changedGrassObstacleSiteIds(after, before)).toEqual(new Set(['site_garden']))
      const mask = maskOf(after)
      for (const point of owned) {
        expect(isGrassAllowedAt(mask, ...point), `blade at ${point}`).toBe(false)
        // Either way round the same ground: laid before or after, under a rock it is the lawn's.
        expect(isLawnGroundAt(mask, ...point), `ground at ${point}`).toBe(stands === true)
      }
      for (const point of lawn) expect(isGrassAllowedAt(mask, ...point), `blade at ${point}`).toBe(true)
      const flowers = flowersOf(after)
      for (const point of owned) expect(near(flowers, point, 0.12), `flower at ${point}`).toBe(false)
      for (const point of lawn) expect(near(flowers, point, 0.6), `flowers by ${point}`).toBe(true)
      // And taking the thing away gives the ground back.
      expect(changedGrassObstacleSiteIds(before, after)).toEqual(new Set(['site_garden']))
    })
  })

  const standsInTheLawn: [string, AnyNode, Point][] = [
    ['a flower of another plugin', levelNode('trees:flower', 'flower_garden', { position: [6, 0, 6], size: [0.3, 0.6, 0.3] }), [8, 8]],
    ['a marker with a footprint that is nothing built', levelNode('spawn', 'spawn_garden', { position: [6, 0, 6], size: [0.6, 1.8, 0.6] }), [8, 8]],
    ['a block that hangs over the ground (a soffit)', levelNode('block', 'block_soffit', { position: [6, 2.6, 6], size: [3, 0.2, 3], onFloor: false }), [8, 8]],
  ]
  test.each(standsInTheLawn)('%s leaves the lawn under it', (_name, node, point) => {
    withGardenKinds(() => {
      const nodes = layLawn(withNodes(garden(), [node]))
      expect(paintedAt(nodes, point)).toBe(1)
      expect(isGrassAllowedAt(maskOf(nodes), ...point)).toBe(true)
    })
  })

  test('a tree of another plugin clears its trunk, keeps the ground, and nothing of its crown', () => {
    withGardenKinds(() => {
      const tree = levelNode('trees:tree', 'tree_garden', { position: [6, 0, 6], size: [0.5, 7, 0.5] })
      const laid = layLawn(withNodes(garden(), [tree]))
      const mask = maskOf(laid)
      expect(isGrassAllowedAt(mask, 8, 8)).toBe(false)
      expect(isLawnGroundAt(mask, 8, 8)).toBe(true)
      expect(paintedAt(laid, [8, 8])).toBe(1)
      expect(isGrassAllowedAt(mask, 8.5, 8)).toBe(true)
      expect(isGrassAllowedAt(mask, 8, 8.5)).toBe(true)
    })
  })

  test('a low hedge clears its own footprint and keeps the green ground under it', () => {
    withGardenKinds(() => {
      const hedge = ItemNode.parse({
        id: 'item_hedge', parentId: 'level_garden', position: [6, 0, 6],
        asset: { id: 'asset_hedge', category: 'outdoor', name: 'Hedge', thumbnail: '', src: 'asset://hedge', dimensions: [3, 1.2, 0.8] },
      }) as AnyNode
      for (const nodes of [layLawn(withNodes(garden(), [hedge])), withNodes(layLawn(garden()), [hedge])]) {
        const mask = maskOf(nodes)
        // Site (8, 8): 3 m along x, 0.8 m across.
        for (const point of [[8, 8], [6.7, 8], [9.3, 8.3]] as Point[]) {
          expect(isGrassAllowedAt(mask, ...point), `blade at ${point}`).toBe(false)
          expect(isLawnGroundAt(mask, ...point), `ground at ${point}`).toBe(true)
          expect(paintedAt(nodes, point), `paint at ${point}`).toBe(1)
        }
        expect(isGrassAllowedAt(mask, 8, 8.7)).toBe(true)
        expect(isGrassAllowedAt(mask, 10, 8)).toBe(true)
      }
    })
  })
})

describe('an Environment pond keeps the lawn out of its water', () => {
  function hollowSite(): Nodes {
    const terrain = createTerrainField({ origin: [0, 0], spacing: 1, cols: 7, rows: 7, step: 1 })
    terrain.heights.set([
      5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0,
      0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5,
    ])
    const site = SiteNode.parse({
      id: 'site_garden', children: [],
      polygon: { type: 'polygon', points: [[0, 0], [6, 0], [6, 6], [0, 6]] },
      terrain: encodeTerrainField(terrain),
    })
    return { [site.id]: site as AnyNode }
  }
  const pond = PondNode.parse({ id: 'pond_garden', parentId: 'site_garden', seed: [3, 3], waterLevel: 2 }) as unknown as AnyNode

  test('there before the lawn is laid', () => {
    const laid = layLawn(withNodes(hollowSite(), [pond]))
    expect(paintedAt(laid, [3, 3])).toBe(0)
    expect(isGrassAllowedAt(maskOf(laid), 3, 3)).toBe(false)
  })

  test('filled on a lawn already laid', () => {
    const before = layLawn(hollowSite())
    expect(paintedAt(before, [3, 3])).toBe(1)
    const after = withNodes(before, [pond])
    expect(changedGrassObstacleSiteIds(after, before)).toEqual(new Set(['site_garden']))
    expect(isGrassAllowedAt(maskOf(after), 3, 3)).toBe(false)
    expect(isLawnGroundAt(maskOf(after), 3, 3)).toBe(false)
    expect(near(flowersOf(after), [3, 3], 0.6)).toBe(false)
  })
})

describe('the lawn meets a pond at the water you can see, on a smooth line', () => {
  // A bowl 0.9 m deep and 4 m in radius in level ground, filled to the brim: the wet outline is
  // the terrain cells that touch the bowl, a stepped ring of water a hair deep.
  const bowl = (x: number, z: number) => {
    const t = Math.max(0, 1 - Math.hypot(x - 8, z - 8) / 4)
    return -0.9 * t * t * (3 - 2 * t)
  }
  function brimful(): Nodes {
    const terrain = createTerrainField({ origin: [0, 0], spacing: 0.5, cols: 33, rows: 33, step: 0.01 })
    for (let row = 0; row < 33; row += 1) {
      for (let col = 0; col < 33; col += 1) terrain.heights[row * 33 + col] = Math.round(bowl(col * 0.5, row * 0.5) * 100)
    }
    const site = SiteNode.parse({
      id: 'site_garden', children: ['pond_brim'],
      polygon: { type: 'polygon', points: [[0, 0], [16, 0], [16, 16], [0, 16]] },
      terrain: encodeTerrainField(terrain),
    })
    const pond = PondNode.parse({ id: 'pond_brim', parentId: site.id, seed: [8, 8], waterLevel: 0 })
    return { [site.id]: site as AnyNode, [pond.id]: pond as unknown as AnyNode }
  }

  test('blades stop where the water is 3 cm deep, at the same distance all round', () => {
    const mask = maskOf(brimful())
    // The bowl is 3 cm deep 3.5 m from its centre (0.9 * smoothstep(1 - r / 4) = 0.03).
    const edges: number[] = []
    for (let step = 0; step < 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2
      let radius = 0
      while (radius < 6 && !isGrassAllowedAt(mask, 8 + Math.cos(angle) * radius, 8 + Math.sin(angle) * radius)) radius += 0.02
      edges.push(radius)
    }
    const nearest = Math.min(...edges)
    const farthest = Math.max(...edges)
    expect(nearest).toBeGreaterThan(3.2)
    expect(farthest).toBeLessThan(3.8)
    // A stepped outline of half-metre cells would swing by most of a cell.
    expect(farthest - nearest).toBeLessThan(0.3)
    expect(isGrassAllowedAt(mask, 8, 8)).toBe(false)
    expect(isLawnGroundAt(mask, 8, 8)).toBe(false)
    // On the rim the film of water is the lawn's: blades and ground right up to the visible water.
    expect(isGrassAllowedAt(mask, 8 + 3.9, 8)).toBe(true)
    expect(isLawnGroundAt(mask, 8 + 3.9, 8)).toBe(true)
  })
})
