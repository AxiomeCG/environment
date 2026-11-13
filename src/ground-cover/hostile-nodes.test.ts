import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { buildGrassObstacleField, collectGrassObstacleShapes } from './obstacle-adapter'
import { createGrassObstacleTopology, isGrassAllowedAt, type GrassObstacleShape } from './obstacle-field'

/**
 * A scene is data: stored, pasted, or written by an agent. No value a node holds may make the
 * lawn's mask loop or allocate without limit, or throw, where the scene is drawn. A bad node is
 * skipped (the lawn grows there) and the good ones beside it still clear their ground.
 */

const BAD = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e12, -1e12, -3] as const
const MANY = 200_000

function withKinds(run: () => void): void {
  const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
  const kind = (name: string, floorPlaced?: unknown) =>
    registerNode({
      kind: name, schemaVersion: 1, schema: ItemNode, category: 'utility',
      defaults: () => ({}) as never, capabilities: floorPlaced ? { floorPlaced } : {},
    } as unknown as AnyNodeDefinition)
  type Boxed = { size: [number, number, number]; rotation: [number, number, number] }
  try {
    kind('item', {
      collides: true,
      footprint: (node: ItemNode) => ({ dimensions: node.asset.dimensions, rotation: node.rotation }),
    })
    kind('pool:pool', { footprint: (node: Boxed) => ({ dimensions: node.size, rotation: node.rotation }) })
    kind('pool:broken', { footprint: () => { throw new Error('a plugin footprint that throws') } })
    kind('pool:flood', {
      footprints: () => Array.from({ length: MANY }, () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] })),
    })
    kind('rock')
    kind('ramp')
    run()
  } finally {
    nodeRegistry._reset()
    for (const definition of registryDefinitions) registerNode(definition)
  }
}

const site = SiteNode.parse({
  id: 'site_hostile', children: ['building_hostile'],
  polygon: { type: 'polygon', points: [[0, 0], [16, 0], [16, 16], [0, 16]] },
})
const building = BuildingNode.parse({ id: 'building_hostile', parentId: site.id, children: ['level_hostile'] })
const level = LevelNode.parse({ id: 'level_hostile', parentId: building.id, children: [], level: 0 })
/** A sound node beside the bad one: it must still clear its ground. */
const patio = SlabNode.parse({
  id: 'slab_sound', parentId: level.id, polygon: [[1, 1], [3, 1], [3, 3], [1, 3]],
}) as AnyNode

const onSite = (type: string, fields: Record<string, unknown>) =>
  ({ id: 'bad_node', type, object: 'node', parentId: site.id, visible: true, metadata: {}, ...fields }) as unknown as AnyNode
const onLevel = (type: string, fields: Record<string, unknown>) =>
  ({
    id: 'bad_node', type, object: 'node', parentId: level.id, visible: true, metadata: {},
    position: [8, 0, 8], rotation: [0, 0, 0], ...fields,
  }) as unknown as AnyNode

const ramp = (fields: Record<string, unknown>) =>
  onSite('ramp', { start: [8, 4], segments: [{ type: 'line', end: [8, 8] }], width: 2, ...fields })
const arc = (sweep: number) => ramp({ segments: [{ type: 'arc', center: [10, 4], sweep }] })
const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const pool = (fields: Record<string, unknown>) =>
  onLevel('pool:pool', { polygon: square, size: [2.6, 1.5, 2.6], ...fields })
const scripted = (bands: unknown) =>
  ({
    ...ItemNode.parse({
      id: 'item_bad', parentId: level.id, position: [8, 0, 8],
      asset: { id: 'asset_bad', category: 'custom', name: 'Object', thumbnail: '', src: 'asset://bad', dimensions: [2, 3, 2] },
    }),
    source: { manifest: { shape: { bands } } },
  }) as unknown as AnyNode
const ring = (count: number): [number, number][] =>
  Array.from({ length: count }, (_, index) => [Math.cos(index), Math.sin(index)])

const cases: [string, AnyNode][] = [
  ...BAD.map((value): [string, AnyNode] => [`a ramp arc sweeping ${value}`, arc(value)]),
  ...BAD.map((value): [string, AnyNode] => [`a ramp ${value} wide`, ramp({ width: value })]),
  ...BAD.map((value): [string, AnyNode] => [`a ramp starting at ${value}`, ramp({ start: [value, 4] })]),
  ...BAD.map((value): [string, AnyNode] => [`a ramp running to ${value}`, ramp({ segments: [{ type: 'line', end: [8, value] }] })]),
  ...BAD.map((value): [string, AnyNode] => [`a ramp arc centred at ${value}`, ramp({ segments: [{ type: 'arc', center: [value, 4], sweep: 1 }] })]),
  [`a ramp of ${MANY} arcs`, ramp({ segments: Array.from({ length: MANY }, () => ({ type: 'arc', center: [10, 4], sweep: 6 })) })],
  ['a ramp whose segments are no list', ramp({ segments: 'everywhere' })],
  ...BAD.map((value): [string, AnyNode] => [`a rock with a corner at ${value}`, onSite('rock', { polygon: [[4, 4], [value, 4], [5, 5]] })]),
  [`a rock of ${MANY} corners`, onSite('rock', { polygon: ring(MANY) })],
  ['a rock whose outline is no list', onSite('rock', { polygon: { length: 1e9 } })],
  ...BAD.map((value): [string, AnyNode] => [`a pool with a corner at ${value}`, pool({ polygon: [[-1, -1], [value, -1], [1, 1]] })]),
  ...BAD.map((value): [string, AnyNode] => [`a pool whose footprint is ${value} wide`, pool({ size: [value, 1.5, 2.6] })]),
  ...BAD.map((value): [string, AnyNode] => [`a pool placed at ${value}`, pool({ position: [value, 0, 8] })]),
  ...BAD.map((value): [string, AnyNode] => [`a pool turned by ${value}`, pool({ rotation: [0, value, 0] })]),
  [`a pool of ${MANY} corners`, pool({ polygon: ring(MANY) })],
  ['a plugin kind whose footprint throws', onLevel('pool:broken', {})],
  [`a plugin kind returning ${MANY} footprints`, onLevel('pool:flood', {})],
  ...BAD.map((value): [string, AnyNode] => [`a scripted object with an outline corner at ${value}`, scripted([{ y0: 0, y1: 1, polygons: [{ outer: [[-1, -1], [value, -1], [1, 1]] }] }])]),
  ...BAD.map((value): [string, AnyNode] => [`a scripted object with a band at ${value}`, scripted([{ y0: value, y1: 1, polygons: [{ outer: square }] }])]),
  [`a scripted object of ${MANY} bands`, scripted(Array.from({ length: MANY }, () => ({ y0: 0, y1: 1, polygons: [{ outer: square }] })))],
  [`a scripted object with ${MANY} outlines in a band`, scripted([{ y0: 0, y1: 1, polygons: Array.from({ length: MANY }, () => ({ outer: square })) }])],
  [`a scripted object with an outline of ${MANY} corners`, scripted([{ y0: 0, y1: 1, polygons: [{ outer: ring(MANY) }] }])],
  ['a scripted object whose bands are no list', scripted({ length: 1e9 })],
]

const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e6
const pointsOf = (shape: GrassObstacleShape): (readonly [number, number])[] =>
  shape.kind === 'polygon'
    ? [...shape.points, ...(shape.holes ?? []).flat()]
    : shape.kind === 'capsule'
      ? [shape.start, shape.end]
      : shape.kind === 'box'
        ? [shape.center, shape.halfSize]
        : []

describe('a node holding bad numbers cannot stall or break the lawn', () => {
  test.each(cases)('%s', (_name, node) => {
    withKinds(() => {
      const nodes = Object.fromEntries(
        [site, building, { ...level, children: [patio.id, node.id] }, patio, node].map((entry) => [entry.id, entry]),
      ) as Record<string, AnyNode>
      const started = performance.now()
      const shapes = collectGrassObstacleShapes(site, nodes)
      const mask = buildGrassObstacleField(site, nodes, createGrassObstacleTopology({ minX: 0, maxX: 16, minZ: 0, maxZ: 16 }))
      const elapsedMs = performance.now() - started

      // Bounded work: at most a node's capped shapes, each with finite, bounded numbers.
      expect(shapes.length).toBeLessThanOrEqual(257)
      for (const shape of shapes) {
        expect(pointsOf(shape).length).toBeLessThanOrEqual(4096)
        expect(pointsOf(shape).every(([x, z]) => finite(x) && finite(z))).toBe(true)
        if (shape.kind === 'capsule') expect(shape.radius >= 0 && shape.radius <= 100).toBe(true)
        if (shape.kind === 'box') expect(Number.isFinite(shape.rotation)).toBe(true)
      }
      expect(elapsedMs).toBeLessThan(1500)
      // The sound slab beside it still clears its ground, and the far lawn is still lawn.
      expect(isGrassAllowedAt(mask, 2, 2)).toBe(false)
      expect(isGrassAllowedAt(mask, 14, 14)).toBe(true)
    })
  })
})

/** What a shape costs the mask: the points of its outline and holes; a capsule two, a box four. */
const verticesOf = (shapes: readonly GrassObstacleShape[]) =>
  shapes.reduce(
    (total, shape) =>
      total +
      (shape.kind === 'polygon'
        ? shape.points.length + (shape.holes ?? []).reduce((sum, hole) => sum + hole.length, 0)
        : shape.kind === 'capsule'
          ? 2
          : shape.kind === 'box'
            ? 4
            : 0),
    0,
  )

describe('the mask is bounded as a whole, not only ring by ring', () => {
  // A lot the size of a full mask: 513 x 513 cells at 0.1 m.
  const bigSite = SiteNode.parse({
    id: 'site_hostile', children: ['building_hostile'],
    polygon: { type: 'polygon', points: [[0, 0], [51.2, 0], [51.2, 51.2], [0, 51.2]] },
  })
  const topology = createGrassObstacleTopology({ minX: 0, maxX: 51.2, minZ: 0, maxZ: 51.2 })
  const over = (count: number, radius: number): [number, number][] =>
    Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2
      return [25.6 + Math.cos(angle) * radius, 25.6 + Math.sin(angle) * radius]
    })
  const scene = (...nodes: AnyNode[]) =>
    Object.fromEntries(
      [bigSite, building, { ...level, children: nodes.filter((node) => node.parentId === level.id).map((node) => node.id) }, ...nodes]
        .map((entry) => [entry.id, entry]),
    ) as Record<string, AnyNode>
  const rock = (id: string, polygon: [number, number][]) =>
    ({ id, type: 'rock', object: 'node', parentId: bigSite.id, visible: true, metadata: {}, polygon }) as unknown as AnyNode

  test('a scene at every cap is masked within a small time budget', () => {
    withKinds(() => {
      // 400 rocks of 512 points, each as wide as the lot: 204,800 vertices asked, 131,072 kept.
      const rocks = Array.from({ length: 400 }, (_, index) => rock(`rock_${index}`, over(512, 25)))
      const nodes = scene(patio, ...rocks)
      const started = performance.now()
      const shapes = collectGrassObstacleShapes(bigSite, nodes)
      const mask = buildGrassObstacleField(bigSite, nodes, topology)
      const elapsedMs = performance.now() - started
      expect(topology.cols * topology.rows).toBe(513 * 513)
      expect(shapes.length).toBeLessThanOrEqual(16_384)
      expect(verticesOf(shapes)).toBeLessThanOrEqual(131_072)
      expect(verticesOf(shapes)).toBeGreaterThan(120_000)
      expect(elapsedMs).toBeLessThan(3000)
      expect(isGrassAllowedAt(mask, 2, 2)).toBe(false)
      expect(isGrassAllowedAt(mask, 25.6, 25.6)).toBe(false)
      expect(isGrassAllowedAt(mask, 0.5, 50.5)).toBe(true)
    })
  })

  test('more nodes than a mask holds: the rest are left out', () => {
    withKinds(() => {
      const posts = Array.from({ length: 17_000 }, (_, index) =>
        ({
          ...onLevel('pool:pool', { polygon: undefined, size: [0.2, 1, 0.2], position: [1 + (index % 500) * 0.1, 0, 10 + Math.floor(index / 500)] }),
          id: `post_${index}`,
        }) as unknown as AnyNode,
      )
      const started = performance.now()
      const shapes = collectGrassObstacleShapes(bigSite, scene(patio, ...posts))
      expect(performance.now() - started).toBeLessThan(3000)
      expect(shapes.length).toBe(16_384)
    })
  })

  const justOver: [string, AnyNode, number][] = [
    ['a rock of 513 points is no outline', rock('rock_over', over(513, 5)), 0],
    ['a rock of 512 points is one', rock('rock_at', over(512, 5)), 512],
    ['a slab of 2,049 points is no outline',
      { ...SlabNode.parse({ id: 'slab_over', parentId: level.id, polygon: [[0, 0], [1, 0], [1, 1]] }), polygon: over(2049, 5) } as AnyNode, 0],
    ['a slab of 2,048 points is one',
      { ...SlabNode.parse({ id: 'slab_at', parentId: level.id, polygon: [[0, 0], [1, 0], [1, 1]] }), polygon: over(2048, 5) } as AnyNode, 2048],
    ['a slab with a hole of 513 points is left out whole: a dropped hole would bare the lawn in it',
      { ...SlabNode.parse({ id: 'slab_hole', parentId: level.id, polygon: [[0, 0], [1, 0], [1, 1]] }), polygon: over(64, 10), holes: [over(513, 5)] } as AnyNode, 0],
    ['a slab with 65 holes is left out whole',
      { ...SlabNode.parse({ id: 'slab_holes', parentId: level.id, polygon: [[0, 0], [1, 0], [1, 1]] }), polygon: over(64, 10), holes: Array.from({ length: 65 }, () => over(8, 1)) } as AnyNode, 0],
    ['a scripted object of 320 outlines keeps 256',
      scripted(Array.from({ length: 64 }, () => ({ y0: 0, y1: 0.2, polygons: Array.from({ length: 5 }, () => ({ outer: square })) }))), 256 * 4],
    ['a scripted object of 9 outlines of 512 points keeps the 8 that fit a node',
      scripted([{ y0: 0, y1: 0.2, polygons: Array.from({ length: 9 }, () => ({ outer: over(512, 3) })) }]), 4096],
  ]
  test.each(justOver)('%s', (_name, node, vertices) => {
    withKinds(() => {
      const shapes = collectGrassObstacleShapes(bigSite, scene(node))
      expect(verticesOf(shapes)).toBe(vertices)
    })
  })
})
