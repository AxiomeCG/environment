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
      expect(shapes.length).toBeLessThanOrEqual(1025)
      for (const shape of shapes) {
        expect(pointsOf(shape).length).toBeLessThanOrEqual(4096 * 257)
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
