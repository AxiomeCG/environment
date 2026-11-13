import {
  createTerrainField,
  decodeTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  quantize,
  SiteNode,
  type AnyNode,
  type TerrainField,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { paintAt, siteBounds } from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { resolveGroundCoverPaint } from '../paint-tiles/layers'
import { fillPond } from './fill-pond'
import { environmentAgentOperations, refusalCode } from './index'
import { layGround } from './lay-ground'
import { readEnvironment } from './read-environment'
import type { SiteTerrainRead } from './scene'
import type { AgentOperationOutcome, SceneChanges, SceneNodes } from './types'

/**
 * The host keeps authored ground in nodes under the site (32 m terrain tiles of 65 x 65 samples
 * at 0.5 m; `shape_site_terrain` and the other terrain tools write nothing else), and its
 * `persistedTerrainFieldOf(site, nodes)` reads them only from the node snapshot it is given.
 * The core this package installs for its own tests predates tiles, so `hostRead` stands in for
 * that one read: a site's tile, decoded as the host decodes it, from the snapshot. It is handed
 * to each operation as its ground read, the argument the operations take for it: no module is
 * mocked and nothing global is touched, so this file reads the same alone or after any other.
 */
const TILE_SIZE_M = 32
const TILE_SAMPLES = 65
const TILE_SPACING_M = 0.5

type Tile = { id: string; type: 'terrain-tile'; parentId: string; ix: number; iz: number; step: number; heights: string }

const tileFields = new WeakMap<object, TerrainField | null>()

const hostRead: SiteTerrainRead = (site, nodes) => {
  const tiles = (Object.values(nodes) as unknown as Tile[]).filter(
    (node) => node.type === 'terrain-tile' && node.parentId === site.id,
  )
  const tile = tiles[0]
  if (!tile) return persistedTerrainFieldOf(site)
  if (tiles.length > 1) throw new Error('The stand-in reads one tile.')
  if (!tileFields.has(tile)) {
    tileFields.set(tile, decodeTerrainField({
      type: 'heightfield',
      origin: [tile.ix * TILE_SIZE_M, tile.iz * TILE_SIZE_M],
      spacing: TILE_SPACING_M,
      cols: TILE_SAMPLES,
      rows: TILE_SAMPLES,
      step: tile.step,
      heights: tile.heights,
    }))
  }
  return tileFields.get(tile) ?? null
}

/** The operations as a host with tiled terrain runs them: its ground read in place of core's. */
const onTiledHost = {
  read_environment: readEnvironment,
  lay_ground: layGround,
  fill_pond: fillPond,
} as const

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }

/** A site whose only ground is a terrain tile under it: `site.terrain` stays absent. */
function tiledSite(lot: [number, number][], height: (x: number, z: number) => number): Nodes {
  const field = createTerrainField({
    origin: [0, 0], spacing: TILE_SPACING_M, cols: TILE_SAMPLES, rows: TILE_SAMPLES, step: 0.01,
  })
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      field.heights[row * field.cols + col] = quantize(
        field, height(col * TILE_SPACING_M, row * TILE_SPACING_M),
      )
    }
  }
  const tile: Tile = {
    id: 'terrain-tile_0_0', type: 'terrain-tile', parentId: 'site_tiled', ix: 0, iz: 0,
    step: field.step, heights: encodeTerrainField(field).heights,
  }
  const site = SiteNode.parse({
    id: 'site_tiled',
    polygon: { type: 'polygon', points: lot },
    children: [tile.id],
  })
  expect(site.terrain).toBeUndefined()
  return { [site.id]: site as AnyNode, [tile.id]: tile as unknown as AnyNode }
}

const square = (min: number, max: number): [number, number][] => [[min, min], [max, min], [max, max], [min, max]]

function run(name: keyof typeof onTiledHost, nodes: Nodes, input: unknown): AgentOperationOutcome {
  return onTiledHost[name](nodes, input as never, context, hostRead)
}

function applyChanges(nodes: Nodes, changes: SceneChanges | undefined): Nodes {
  const next = { ...nodes }
  for (const { node, parentId } of changes?.create ?? []) {
    next[node.id] = node
    const parent = parentId ? (next[parentId] as SiteNode | undefined) : undefined
    if (parent) next[parent.id] = { ...parent, children: [...parent.children, node.id] } as AnyNode
  }
  for (const { id, data } of changes?.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes?.delete ?? []) delete next[id]
  return next
}

type TerrainFacts = { sampleCount: number; heightRangeM: [number, number] | null; slopeRangeDeg: [number, number] | null }
type AreaFacts = { grassM2: number; excludedSteepM2: number; terrain: TerrainFacts }
type Hollow = { atM: [number, number]; bottomM: number; spillLevelM: number; maxDepthM: number; areaM2: number }

describe('ground the host keeps in nodes', () => {
  // Falls 2 m over the lot's 8 m, front to back: 14.04 degrees everywhere.
  const slopedLot = () => tiledSite(square(4, 12), (_x, z) => (z - 8) / 4)

  test('lay_ground reports the height range and slope of a sloped lot', () => {
    const nodes = slopedLot()
    const { result } = run('lay_ground', nodes, { areas: [{ site: true, ground: 'grass', featherM: 0 }] })
    const area = (result.areas as AreaFacts[])[0]
    expect(area?.terrain.heightRangeM?.[0]).toBeCloseTo(-1, 1)
    expect(area?.terrain.heightRangeM?.[1]).toBeCloseTo(1, 1)
    expect(area?.terrain.slopeRangeDeg?.[0]).toBeCloseTo(14.04, 1)
    expect(area?.terrain.slopeRangeDeg?.[1]).toBeCloseTo(14.04, 1)
    expect(area?.excludedSteepM2).toBe(0)
    // The lot's 64 m2, counted on the paint lattice.
    expect(area?.grassM2).toBeGreaterThan(63)
    expect(area?.grassM2).toBeLessThan(66)
  })

  test('read_environment measures laid grass on the same sloped ground', () => {
    const nodes = slopedLot()
    const laid = run('lay_ground', nodes, { areas: [{ site: true, ground: 'grass', featherM: 0 }] })
    const { result } = run('read_environment', applyChanges(nodes, laid.changes), { hollowsLimit: 0 })
    const terrain = (result.groundCover as { terrain: TerrainFacts }).terrain
    expect(terrain.sampleCount).toBeGreaterThan(0)
    expect(terrain.heightRangeM?.[0]).toBeCloseTo(-1, 1)
    expect(terrain.heightRangeM?.[1]).toBeCloseTo(1, 1)
    expect(terrain.slopeRangeDeg?.[1]).toBeCloseTo(14.04, 1)
  })

  test('lay_ground keeps grass off a retaining step: the paint tiles follow the relief', () => {
    // 3 m up between x = 8 and x = 8.5: steeper than the 70 degree grass limit.
    const nodes = tiledSite(square(4, 12), (x) => (x <= 8 ? 0 : 3))
    const laid = run('lay_ground', nodes, { areas: [{ site: true, ground: 'grass', featherM: 0 }] })
    const area = (laid.result.areas as AreaFacts[])[0]
    expect(area?.terrain.heightRangeM).toEqual([0, 3])
    expect(area?.terrain.slopeRangeDeg?.[1]).toBeGreaterThan(70)
    // The step is 8 m long and half a metre wide in plan.
    expect(area?.excludedSteepM2).toBeGreaterThan(3)
    expect(area?.excludedSteepM2).toBeLessThan(5)

    const after = applyChanges(nodes, laid.changes)
    const grass = Object.values(after).find((node) => String(node.type) === GRASS_FIELD_KIND)
    if (!grass) throw new Error('no ground cover laid')
    const site = after.site_tiled as SiteNode
    const paint = resolveGroundCoverPaint(
      grass as unknown as GrassFieldNode, Object.values(after), siteBounds(site.polygon.points),
    )
    expect(paintAt(paint, 6, 8).a).toBe(1)
    expect(paintAt(paint, 8.25, 8).a).toBe(0)
    expect(paintAt(paint, 10, 8).a).toBe(1)
  })

  // A bowl 0.9 m deep and 4 m in radius in the middle of a flat 16 m lot.
  const bowl = (x: number, z: number) => {
    const t = Math.max(0, 1 - Math.hypot(x - 12, z - 12) / 4)
    return -0.9 * t * t * (3 - 2 * t)
  }
  const basinLot = () => tiledSite(square(4, 20), bowl)

  test('read_environment lists the basin as a hollow', () => {
    const { result } = run('read_environment', basinLot(), { hollowsLimit: 5 })
    const hollows = result.hollows as Hollow[]
    expect(hollows.length).toBe(1)
    expect(hollows[0]?.atM).toEqual([12, 12])
    expect(hollows[0]?.bottomM).toBeCloseTo(-0.9, 2)
    expect(hollows[0]?.spillLevelM).toBeCloseTo(0, 2)
    expect(hollows[0]?.areaM2).toBeGreaterThan(30)
    // The bowl's 50.3 m2, as the half-metre lattice bounds it.
    expect(hollows[0]?.areaM2).toBeLessThan(56)
  })

  test('fill_pond finds the basin and fills it to a level, and the pond reads back', () => {
    const nodes = basinLot()
    const filled = run('fill_pond', nodes, { at: [12, 12], level: -0.4 })
    expect(filled.result.created).toBe(true)
    expect(filled.result.levelM as number).toBeCloseTo(-0.4, 6)
    expect(filled.result.bottomM as number).toBeCloseTo(-0.9, 2)
    expect(filled.result.spillLevelM as number).toBeCloseTo(0, 2)
    expect(filled.result.maxDepthM as number).toBeCloseTo(0.5, 2)
    expect(filled.result.areaM2 as number).toBeGreaterThan(5)

    const { result } = run('read_environment', applyChanges(nodes, filled.changes), { hollowsLimit: 0 })
    const ponds = result.ponds as { id: string; levelM: number; maxDepthM: number; areaM2: number }[]
    expect(ponds.length).toBe(1)
    expect(ponds[0]?.id).toBe(filled.result.pondId as string)
    expect(ponds[0]?.levelM).toBeCloseTo(-0.4, 6)
    expect(ponds[0]?.areaM2).toBeCloseTo(filled.result.areaM2 as number, 6)
  })

  test('fill_pond fills the basin to its spill level', () => {
    const filled = run('fill_pond', basinLot(), { at: [12, 12], level: 'spill' })
    expect(filled.result.levelM as number).toBeCloseTo(0, 2)
    expect(filled.result.maxDepthM as number).toBeCloseTo(0.9, 2)
  })

  test('lay_ground keeps grass out of the pond filled in the basin', () => {
    const nodes = basinLot()
    const filled = run('fill_pond', nodes, { at: [12, 12], level: 'spill' })
    const pondM2 = filled.result.areaM2 as number
    const laid = run('lay_ground', applyChanges(nodes, filled.changes), {
      areas: [{ site: true, ground: 'grass', featherM: 0 }],
    })
    const area = (laid.result.areas as (AreaFacts & { blockedM2: number })[])[0]
    // The lawn stops where the water is deep enough to see (3 cm), inside the wet outline: the
    // bowl is 50.3 m2 at its rim and the film on the rim is the lawn's.
    expect(area?.blockedM2).toBeGreaterThan(40)
    expect(area?.blockedM2).toBeLessThan(pondM2)
    expect(area?.grassM2).toBeGreaterThan(16 * 16 - pondM2)
  })

  test('called as a host calls them, with three arguments, they read through core', () => {
    // The installed core predates tiles: through it this lot has no ground to read. On a tiled
    // host the same three-argument call reads the tiles (run against its core, see the report).
    const nodes = basinLot()
    let code: string | null = null
    try {
      environmentAgentOperations.fill_pond(nodes, { at: [12, 12] }, context)
    } catch (error) {
      code = refusalCode(error)
    }
    expect(code).toBe('no_terrain')
    expect(environmentAgentOperations.read_environment(nodes, { hollowsLimit: 5 }, context).result.hollows).toEqual([])
    // And the same operations, handed the tiled read, find the basin.
    expect((run('read_environment', nodes, { hollowsLimit: 5 }).result.hollows as unknown[]).length).toBe(1)
  })

  test('a tile of level ground still holds no water', () => {
    let code: string | null = null
    try {
      run('fill_pond', tiledSite(square(4, 20), () => 0.25), { at: [12, 12] })
    } catch (error) {
      code = refusalCode(error)
    }
    expect(code).toBe('no_terrain')
  })
})
