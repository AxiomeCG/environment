import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type AnyNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { layGroundTool } from '../agent-tools'
import { createGroundCoverNode } from '../ground-cover/create-node'
import { paintAt, siteBounds, type GrassPaintField } from '../ground-cover/paint-field'
import { advancePaintStroke, beginPaintStroke, currentPaintField } from '../ground-cover/paint-stroke'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { POND_KIND, PondNode } from '../pond/schema'
import { resolveGroundCoverPaint, resolveSurfacePaint } from '../paint-tiles/layers'
import {
  surfaceMaterialWeightsAt,
  type SurfaceMaterialField,
} from '../surface-material/field'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { environmentAgentOperations } from './index'
import { refusalCode } from './refuse'
import type { SceneChanges } from './types'

type Nodes = Record<string, AnyNode>

function flatLot(side = 16): { nodes: Nodes; siteId: string } {
  const site = SiteNode.parse({
    id: 'site_flat',
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [side, 0],
        [side, side],
        [0, side],
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

/** The scene once `changes` are in, as a store would apply them (children lists included). */
function applyChanges(nodes: Nodes, changes: SceneChanges | undefined): Nodes {
  const next: Nodes = { ...nodes }
  for (const { node, parentId } of changes?.create ?? []) {
    next[String(node.id)] = node
    const parent = parentId ? (next[parentId] as AnyNode & { children?: string[] }) : undefined
    if (parent?.children) next[parent.id] = { ...parent, children: [...parent.children, String(node.id)] } as AnyNode
  }
  for (const { id, data } of changes?.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes?.delete ?? []) delete next[id]
  return next
}

/** The site's grass and surface fields as the renderer resolves them from the nodes. */
function groundFieldsOf(nodes: Nodes, siteId: string): { paint: GrassPaintField; surface: SurfaceMaterialField } {
  const site = nodes[siteId] as SiteNode
  const bounds = siteBounds(site.polygon.points)
  const ofKind = (kind: string) => Object.values(nodes).find((node) => String(node.type) === kind)
  const grass = ofKind(GRASS_FIELD_KIND) as unknown as GrassFieldNode | undefined
  const surface = ofKind(SURFACE_MATERIAL_KIND) as unknown as SurfaceMaterialNode | undefined
  if (!grass || !surface) throw new Error('the site has no Ground cover or Surface')
  return {
    paint: resolveGroundCoverPaint(grass, Object.values(nodes), bounds),
    surface: resolveSurfacePaint(surface, Object.values(nodes), bounds),
  }
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

    const kinds = (changes?.create ?? []).map((entry) => String(entry.node.type))
    expect(kinds).toContain(GRASS_FIELD_KIND)
    expect(kinds).toContain(SURFACE_MATERIAL_KIND)
    for (const entry of changes?.create ?? []) expect(entry.parentId).toBe(siteId)
    expect(result.grassCoveragePct).toBeGreaterThan(95)
  })

  test('writes only paint tiles, each change well under the 64 KiB a shared operation carries', () => {
    for (const side of [16, 100]) {
      const { nodes } = flatLot(side)
      const first = runLayGround(nodes, [{ site: true, ground: 'grass' }])
      const created = applyChanges(nodes, first.changes)
      const second = runLayGround(created, [
        { path: { points: [[side / 2, 0], [side / 2, side]], widthM: 1.2 }, ground: 'path' },
      ])
      for (const { result } of [first, second]) {
        expect(result.tilesChanged).toBeGreaterThan(0)
        expect(result.largestTileChangeBytes).toBeLessThan(result.collaborationCapBytes as number)
      }
      // The path rewrites the tiles it crosses: a column of them, not the lot.
      expect(second.changes?.create).toBeUndefined()
      expect((second.changes?.update ?? []).every((entry) => entry.id.startsWith('paint-tile_'))).toBe(true)
      expect(second.result.tilesChanged).toBeLessThan(first.result.tilesChanged as number)
    }
  })

  test('a path laid after a lawn cuts through it', () => {
    const { nodes, siteId } = flatLot()
    const { changes } = runLayGround(nodes, [
      { site: true, ground: 'grass' },
      { path: { points: [[8, 0], [8, 16]], widthM: 1.2 }, ground: 'path', featherM: 0 },
    ])
    const laid = groundFieldsOf(applyChanges(nodes, changes), siteId)
    expect(paintAt(laid.paint, 8, 8).a).toBe(0)
    expect(paintAt(laid.paint, 2, 8).a).toBe(1)
    expect(surfaceMaterialWeightsAt(laid.surface, 8, 8)[1]).toBe(1)
  })

  test('a small lawn on a fresh lot grows grass only inside it, as a panel stroke would', () => {
    const { nodes, siteId } = flatLot()
    const { result, changes } = runLayGround(nodes, [
      { polygon: [[1, 1], [3, 1], [3, 3], [1, 3]], ground: 'grass', featherM: 0 },
    ])
    const laid = groundFieldsOf(applyChanges(nodes, changes), siteId)
    expect(paintAt(laid.paint, 2, 2).a).toBe(1)
    expect(paintAt(laid.paint, 15, 15).a).toBe(0)
    // 2x2 m of a 16x16 m lot, give or take one lattice row at the hard edge.
    expect(result.grassCoveragePct).toBeGreaterThan(1.5)
    expect(result.grassCoveragePct).toBeLessThan(1.8)

    // The panel's own node, painted by the person's brush over the same spot.
    const site = nodes[siteId] as SiteNode
    const panelNode = createGroundCoverNode(site)
    const panelField = resolveGroundCoverPaint(panelNode, [], siteBounds(site.polygon.points))
    const stroke = beginPaintStroke({ field: panelField, boundary: site.polygon.points })
    advancePaintStroke(stroke, 2, 2)
    expect(paintAt(currentPaintField(stroke), 15, 15).a).toBe(0)
  })

  test('featherM blends the edge instead of a hard cut', () => {
    const { nodes, siteId } = flatLot()
    const { changes } = runLayGround(nodes, [
      { polygon: [[0, 0], [8, 0], [8, 16], [0, 16]], ground: 'grass', featherM: 2 },
    ])
    const laid = groundFieldsOf(applyChanges(nodes, changes), siteId)
    expect(paintAt(laid.paint, 4, 8).a).toBe(1)
    // At the outline the strength is one half; a metre outside, nothing.
    expect(paintAt(laid.paint, 8, 8).a).toBeCloseTo(0.5, 1)
    expect(paintAt(laid.paint, 9.05, 8).a).toBe(0)
  })

  test('clearing a surface clears every channel, so a feathered path reads as road alone', () => {
    const { nodes, siteId } = flatLot()
    let scene = nodes
    for (const area of [
      { site: true, ground: 'grass', featherM: 0 },
      { site: true, ground: 'none', featherM: 0 },
      { site: true, ground: 'path', featherM: 2 },
    ]) {
      scene = applyChanges(scene, runLayGround(scene, [area]).changes)
    }
    const { surface } = groundFieldsOf(scene, siteId)
    const [grass, road, desert, paved] = surfaceMaterialWeightsAt(surface, 0, 8)
    expect(road).toBeCloseTo(1, 6)
    expect(grass + desert + paved).toBeCloseTo(0, 6)
  })

  test('is declared not idempotent: a repeated feathered area keeps blending', () => {
    expect(layGroundTool.annotations.idempotentHint).toBe(false)
    const { nodes, siteId } = flatLot()
    const area = { site: true, ground: 'earth', featherM: 2 }
    const grassed = applyChanges(nodes, runLayGround(nodes, [{ site: true, ground: 'grass', featherM: 0 }]).changes)
    const once = applyChanges(grassed, runLayGround(grassed, [area]).changes)
    const twice = applyChanges(once, runLayGround(once, [area]).changes)
    expect(paintAt(groundFieldsOf(twice, siteId).paint, 0, 8).a).toBeLessThan(
      paintAt(groundFieldsOf(once, siteId).paint, 0, 8).a,
    )
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
