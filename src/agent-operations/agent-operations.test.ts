import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type AnyNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { decodeGrassPaintField, paintAt } from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND } from '../ground-cover/schema'
import { POND_KIND, PondNode } from '../pond/schema'
import { decodeSurfaceMaterialField, surfaceMaterialWeightsAt } from '../surface-material/field'
import { SURFACE_MATERIAL_KIND } from '../surface-material/schema'
import { environmentAgentOperations } from './index'
import { refusalCode } from './refuse'

type Nodes = Record<string, AnyNode>

function flatLot(): { nodes: Nodes; siteId: string } {
  const site = SiteNode.parse({
    id: 'site_flat',
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [16, 0],
        [16, 16],
        [0, 16],
      ],
    },
    children: [],
  })
  return { nodes: { [site.id]: site as AnyNode }, siteId: site.id }
}

// The lab bowl: a 5x5 heightfield, bottom 0 m at [2,2], spilling at 4 m.
function bowlLot(): { nodes: Nodes; siteId: string } {
  const field = createTerrainField({ origin: [0, 0], spacing: 1, cols: 5, rows: 5, step: 0.01 })
  field.heights.set([
    600, 600, 400, 600, 600, 600, 300, 200, 300, 600, 600, 200, 0, 200, 600, 600, 300, 200, 300,
    600, 600, 600, 600, 600, 600,
  ])
  const site = SiteNode.parse({
    id: 'site_bowl',
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    },
    terrain: encodeTerrainField(field),
    children: [],
  })
  return { nodes: { [site.id]: site as AnyNode }, siteId: site.id }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return refusalCode(error) ?? 'not-a-refusal'
  }
  return 'did-not-refuse'
}

function runLayGround(nodes: Nodes, areas: unknown) {
  const operation = environmentAgentOperations.lay_ground
  if (!operation) throw new Error('lay_ground missing')
  return operation(nodes, { areas } as never, { activeLevelId: null })
}

describe('lay_ground', () => {
  test('lays grass over the whole site and creates both nodes under it', () => {
    const { nodes, siteId } = flatLot()
    const { result, changes } = runLayGround(nodes, [{ site: true, ground: 'grass' }])

    expect(changes?.create).toHaveLength(2)
    const kinds = (changes?.create ?? []).map((entry) => String(entry.node.type))
    expect(kinds).toContain(GRASS_FIELD_KIND)
    expect(kinds).toContain(SURFACE_MATERIAL_KIND)
    for (const entry of changes?.create ?? []) expect(entry.parentId).toBe(siteId)
    expect(result.grassCoveragePct).toBeGreaterThan(95)
    expect(result.updateBytes).toBeGreaterThan(0)
  })

  test('a path laid after a lawn cuts through it, and only the paint maps change', () => {
    const { nodes } = flatLot()
    const { changes } = runLayGround(nodes, [
      { site: true, ground: 'grass' },
      { path: { points: [[8, 0], [8, 16]], widthM: 1.2 }, ground: 'path', featherM: 0 },
    ])
    const made = new Map(
      (changes?.create ?? []).map((entry) => [String(entry.node.type), entry.node] as const),
    )

    const grass = made.get(GRASS_FIELD_KIND) as { paintMap?: unknown } | undefined
    const paint = decodeGrassPaintField(grass?.paintMap)
    expect(paint).not.toBeNull()
    if (!paint) return
    expect(paintAt(paint, 8, 8).a).toBeLessThan(0.05)
    expect(paintAt(paint, 2, 8).a).toBeGreaterThan(0.95)

    const surface = made.get(SURFACE_MATERIAL_KIND) as { paintMap?: unknown } | undefined
    const field = decodeSurfaceMaterialField(surface?.paintMap)
    expect(field).not.toBeNull()
    if (!field) return
    const road = surfaceMaterialWeightsAt(field, 8, 8)
    expect(road[1]).toBeGreaterThan(0.9)
  })

  test('featherM blends the edge instead of a hard cut', () => {
    const { nodes } = flatLot()
    const hard = runLayGround(nodes, [
      { polygon: [[0, 0], [8, 0], [8, 16], [0, 16]], ground: 'grass', featherM: 0 },
    ])
    const soft = runLayGround(nodes, [
      { polygon: [[0, 0], [8, 0], [8, 16], [0, 16]], ground: 'earth', featherM: 2 },
    ])
    const hardGrass = (hard.changes?.create ?? []).find(
      (entry) => String(entry.node.type) === GRASS_FIELD_KIND,
    )?.node as { paintMap?: unknown } | undefined
    const softGrass = (soft.changes?.create ?? []).find(
      (entry) => String(entry.node.type) === GRASS_FIELD_KIND,
    )?.node as { paintMap?: unknown } | undefined
    const hardField = decodeGrassPaintField(hardGrass?.paintMap)
    const softField = decodeGrassPaintField(softGrass?.paintMap)
    expect(hardField).not.toBeNull()
    expect(softField).not.toBeNull()
    if (!hardField || !softField) return
    // Just inside the edge, the feathered earth keeps some of the default grass.
    expect(paintAt(hardField, 9, 8).a).toBeGreaterThan(0.95)
    expect(paintAt(softField, 8.6, 8).a).toBeGreaterThan(0.2)
    expect(paintAt(softField, 8.6, 8).a).toBeLessThan(0.9)
  })

  test('refuses a degenerate polygon, naming its index', () => {
    const { nodes } = flatLot()
    expect(codeOf(() => runLayGround(nodes, [{ polygon: [[0, 0], [1, 1]], ground: 'grass' }]))).toBe(
      'invalid_polygon',
    )
  })

  test('refuses an area that misses the lot entirely', () => {
    const { nodes } = flatLot()
    expect(
      codeOf(() =>
        runLayGround(nodes, [
          { polygon: [[100, 100], [110, 100], [110, 110], [100, 110]], ground: 'grass' },
        ]),
      ),
    ).toBe('outside_property')
  })

  test('refuses more than twenty areas', () => {
    const { nodes } = flatLot()
    const areas = Array.from({ length: 21 }, () => ({ site: true, ground: 'grass' }))
    expect(codeOf(() => runLayGround(nodes, areas))).toBe('too_many_areas')
  })

  test('refuses a scene with no site', () => {
    expect(codeOf(() => runLayGround({}, [{ site: true, ground: 'grass' }]))).toBe('no_site')
  })
})

describe('read_environment', () => {
  test('reports an empty lot honestly', () => {
    const { nodes } = flatLot()
    const operation = environmentAgentOperations.read_environment
    if (!operation) throw new Error('read_environment missing')
    const { result } = operation(nodes, {} as never, { activeLevelId: null })
    const groundCover = result.groundCover as { present: boolean }
    const surface = result.surface as { present: boolean }
    expect(groundCover.present).toBe(false)
    expect(surface.present).toBe(false)
    expect(result.ponds).toEqual([])
    expect(result.hollows).toEqual([])
    expect(result.presentation).toBe('browser')
  })

  test('finds the bowl as a hollow with its spill level', () => {
    const { nodes } = bowlLot()
    const operation = environmentAgentOperations.read_environment
    if (!operation) throw new Error('read_environment missing')
    const { result } = operation(nodes, {} as never, { activeLevelId: null })
    const hollows = result.hollows as { bottomM: number; spillLevelM: number }[]
    expect(hollows.length).toBe(1)
    expect(hollows[0]?.bottomM).toBeCloseTo(0, 6)
    expect(hollows[0]?.spillLevelM).toBeCloseTo(4, 6)
  })
})

describe('fill_pond', () => {
  const run = (nodes: Nodes, input: unknown) => {
    const operation = environmentAgentOperations.fill_pond
    if (!operation) throw new Error('fill_pond missing')
    return operation(nodes, input as never, { activeLevelId: null })
  }

  test('fills the bowl to its spill level and stocks it', () => {
    const { nodes } = bowlLot()
    const { result, changes } = run(nodes, { at: [2, 2], koi: 3, lilies: 2, bank: 'rocky' })
    expect(result.created).toBe(true)
    expect(result.levelM).toBeCloseTo(4, 6)
    expect(result.spillLevelM).toBeCloseTo(4, 6)
    expect(result.maxDepthM).toBeCloseTo(4, 6)
    expect(result.koi).toBe(3)
    expect(result.lilies).toBe(2)
    const pond = (changes?.create ?? [])[0]?.node as { type: string; shoreline: string } | undefined
    expect(pond?.type).toBe(POND_KIND)
    expect(pond?.shoreline).toBe('rocky')
  })

  test('quantises a numeric level and refuses one above the spill', () => {
    const { nodes } = bowlLot()
    const { result } = run(nodes, { at: [2, 2], level: 2.1 })
    const applied = result.levelM as number
    expect(applied).toBeLessThanOrEqual(2.1 + 0.26)
    expect(codeOf(() => run(nodes, { at: [2, 2], level: 5 }))).toBe('level_above_spill')
    expect(codeOf(() => run(nodes, { at: [2, 2], level: -1 }))).toBe('level_below_bottom')
  })

  test('refuses koi the water is too shallow for', () => {
    const { nodes } = bowlLot()
    expect(codeOf(() => run(nodes, { at: [2, 2], level: 0.1, koi: 1 }))).toBe('too_shallow_for_koi')
  })

  test('refuses flat ground and a ramp that holds no water', () => {
    const flat = flatLot()
    expect(codeOf(() => run(flat.nodes, { at: [8, 8] }))).toBe('no_terrain')

    const bowl = bowlLot()
    expect(codeOf(() => run(bowl.nodes, { at: [40, 40] }))).toBe('outside_property')

    // A ramp: every point drains off the low edge, so no hollow exists.
    const field = createTerrainField({ origin: [0, 0], spacing: 1, cols: 5, rows: 5, step: 0.01 })
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) field.heights[row * 5 + col] = col * 100
    }
    const site = SiteNode.parse({
      id: 'site_ramp',
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
      terrain: encodeTerrainField(field),
      children: [],
    })
    const ramp: Nodes = { [site.id]: site as AnyNode }
    expect(codeOf(() => run(ramp, { at: [2, 2] }))).toBe('no_hollow')
  })

  test('merges a second pond that the new level connects', () => {
    const { nodes, siteId } = bowlLot()
    const existing = PondNode.parse({
      id: 'pond_existing',
      parentId: siteId,
      seed: [2, 2],
      waterLevel: 1,
      props: [],
    })
    const neighbour = PondNode.parse({
      id: 'pond_neighbour',
      parentId: siteId,
      seed: [2.3, 2.3],
      waterLevel: 1,
      props: [],
    })
    const scene: Nodes = {
      ...nodes,
      [existing.id]: existing as unknown as AnyNode,
      [neighbour.id]: neighbour as unknown as AnyNode,
    }
    const { result, changes } = run(scene, { at: [2, 2], level: 'spill' })
    expect(result.created).toBe(false)
    expect(result.mergedPondIds).toContain('pond_neighbour')
    expect(changes?.delete).toContain('pond_neighbour')
    expect(changes?.update).toHaveLength(1)
  })
})
