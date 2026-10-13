import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  SiteNode,
  type AnyNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { layGroundTool } from '../agent-tools'
import { createGroundCoverNode } from '../ground-cover/create-node'
import { paintAt, siteBounds, type GrassPaintField } from '../ground-cover/paint-field'
import { advancePaintStroke, beginPaintStroke, currentPaintField } from '../ground-cover/paint-stroke'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { inspectPondTarget, targetPondAtSeed } from '../pond/actions'
import { analyzePondBasin, buildPondSurface } from '../pond/basin'
import { resolveRenderablePondProps } from '../pond/props'
import { POND_KIND, PondNode, type PondNode as PondNodeValue } from '../pond/schema'
import { RiverNode, type RiverNode as RiverNodeValue } from '../river/schema'
import { rebuildRiverTerrain, riverTerrainBaseline, sampleRiverPath } from '../river/terrain'
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

// The pond actions' two-basin terrain (`pond/actions.test.ts`): a left hollow at [2, 2] and a
// right one around [5, 3], joined once the water passes the ridge between them.
const TWO_BASIN_ROWS = [
  [6, 6, 6, 6, 6, 6, 6],
  [6, 2, 1, 4, 2, 2, 6],
  [6, 1, 0, 4, 2, 7, 6],
  [6, 2, 1, 3, 2, 1, 5],
  [6, 2, 1, 4, 2, 1, 6],
  [6, 3, 2, 4, 3, 2, 6],
  [6, 6, 6, 6, 6, 6, 6],
]

function twoBasinLot(ponds: PondNodeValue[] = []): { nodes: Nodes; site: SiteNode } {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 1, cols: 7, rows: 7, step: 1 })
  terrain.heights.set(TWO_BASIN_ROWS.flat())
  const site = SiteNode.parse({
    id: 'site_two_basins',
    polygon: { type: 'polygon', points: [[0, 0], [6, 0], [6, 6], [0, 6]] },
    terrain: encodeTerrainField(terrain),
    children: ponds.map((pond) => pond.id),
  })
  const nodes: Nodes = { [site.id]: site as AnyNode }
  for (const pond of ponds) nodes[pond.id] = pond as unknown as AnyNode
  return { nodes, site }
}

/** What the pond renderer shows of a pond: its props that pass the renderer's own checks. */
function renderedProps(site: SiteNode, pond: PondNodeValue) {
  const terrain = persistedTerrainFieldOf(site)
  const basin = terrain ? analyzePondBasin(terrain, site.polygon.points, pond.seed) : null
  if (!basin) return { koi: 0, lilies: 0 }
  const shown = resolveRenderablePondProps(pond.props, buildPondSurface(basin, pond.waterLevel))
  const koi = shown.filter(({ prop }) => prop.kind === 'koi').length
  return { koi, lilies: shown.length - koi }
}

function runRead(nodes: Nodes, input: unknown) {
  const operation = environmentAgentOperations.read_environment
  if (!operation) throw new Error('read_environment missing')
  return operation(nodes, input as never, { activeLevelId: null })
}

/** The flat 16 m lot with rivers, carved into its terrain as the river system carves them. */
function withRivers(rivers: RiverNodeValue[]): Nodes {
  const { nodes, siteId } = flatLot()
  const site = nodes[siteId] as SiteNode
  const carved = rebuildRiverTerrain(site, rivers)
  const nextSite = {
    ...site,
    terrain: carved.terrainData,
    metadata: carved.metadata,
    children: rivers.map((river) => river.id),
  } as SiteNode
  const next: Nodes = { [siteId]: nextSite as AnyNode }
  for (const river of rivers) next[river.id] = river as unknown as AnyNode
  return next
}

/** A rectangular lot over a 1 m terrain grid of `cols` x `rows` heights (0.01 m steps). */
function terrainLot(cols: number, rows: number, shape: (heights: Int16Array) => void): Nodes {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 1, cols, rows, step: 0.01 })
  shape(terrain.heights)
  const site = SiteNode.parse({
    id: 'site_terrain',
    polygon: { type: 'polygon', points: [[0, 0], [cols - 1, 0], [cols - 1, rows - 1], [0, rows - 1]] },
    terrain: encodeTerrainField(terrain),
    children: [],
  })
  return { [site.id]: site as AnyNode }
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

  test('reads only the lot: an area off it is refused, one straddling its edge is clipped', () => {
    const { nodes } = flatLot()
    const grassed = applyChanges(nodes, runLayGround(nodes, [{ site: true, ground: 'grass', featherM: 0 }]).changes)
    expect(codeOf(() => runRead(grassed, { area: [[20, 20], [21, 20], [21, 21], [20, 21]] }))).toBe(
      'outside_property',
    )
    const { result } = runRead(grassed, { area: [[14, 14], [18, 14], [18, 18], [14, 18]] })
    const groundCover = result.groundCover as { coveredM2: number; coverageOfAreaPct: number }
    expect(result.areaM2).toBe(16)
    // 2x2 m of the area is on the lot, give or take one lattice row along each cut.
    expect(result.onLotM2 as number).toBeGreaterThan(4)
    expect(result.onLotM2 as number).toBeLessThan(4.3)
    expect(groundCover.coveredM2).toBeCloseTo(result.onLotM2 as number, 2)
    expect(groundCover.coverageOfAreaPct).toBe(100)
  })

  test('reports a river along its whole course, water and bed apart', () => {
    const river = RiverNode.parse({
      id: 'river_across',
      parentId: 'site_flat',
      points: [[4, 8], [12, 8]],
      width: 2,
      source: 'mountain',
      outlet: 'sea',
    })
    const { result } = runRead(withRivers([river]), {})
    const [facts] = result.rivers as {
      lengthM: number
      start: { atM: number[]; waterM: number; bedM: number }
      end: { atM: number[] }
      drawn: boolean
    }[]
    // A mountain source and a sea outlet run the course on to the lot's edges.
    expect(facts?.drawn).toBe(true)
    expect(facts?.lengthM).toBeCloseTo(16, 6)
    expect(facts?.start.atM).toEqual([0, 8])
    expect(facts?.end.atM).toEqual([16, 8])
    expect(facts?.start.waterM).toBeGreaterThan(facts?.start.bedM ?? 0)
  })

  test('measures a curved river on the course the renderer draws, not its authored segments', () => {
    const river = RiverNode.parse({
      id: 'river_bend',
      parentId: 'site_flat',
      points: [[2, 4], [8, 12], [14, 4]],
      width: 2,
    })
    const nodes = withRivers([river])
    const site = nodes.site_flat as SiteNode
    const baseline = riverTerrainBaseline(site)
    const course = baseline ? sampleRiverPath(baseline, river, site.polygon.points) : null
    const [facts] = runRead(nodes, {}).result.rivers as { lengthM: number }[]
    expect(facts?.lengthM).toBeCloseTo(course?.length ?? 0, 3)
    expect(facts?.lengthM).not.toBeCloseTo(20, 1)
  })

  test('takes a flat bottom of many cells as one hollow, so a second hollow is still found', () => {
    // Sol's fixture: a 40 x 5 m flat bottom, and a single-cell pit beyond it.
    const nodes = terrainLot(51, 7, (heights) => {
      heights.fill(600)
      for (let row = 1; row <= 5; row += 1) {
        for (let col = 1; col <= 40; col += 1) heights[row * 51 + col] = 0
      }
      heights[3 * 51 + 47] = 100
    })
    const { result } = runRead(nodes, { hollowsLimit: 5 })
    expect((result.hollows as { atM: number[] }[]).map((hollow) => hollow.atM)).toEqual([
      [1, 1],
      [47, 3],
    ])
    expect(result.hollowsTruncated).toBe(false)
  })

  test('says when the scan gave up before the hollow limit', () => {
    // Forty dips on the lot's edge drain off it; the pit inside is past the scan's budget.
    const nodes = terrainLot(90, 7, (heights) => {
      heights.fill(600)
      for (let dip = 0; dip < 40; dip += 1) heights[1 + dip * 2] = 100
      heights[3 * 90 + 85] = 300
    })
    const { result } = runRead(nodes, { hollowsLimit: 5 })
    expect(result.hollows).toEqual([])
    expect(result.hollowsTruncated).toBe(true)
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

  test('stocks only props the renderer shows, and reports what it shows', () => {
    for (const level of [2, 5]) {
      const { nodes, site } = twoBasinLot()
      const { result, changes } = run(nodes, { at: [2, 2], level, koi: 12, lilies: 40 })
      const pond = changes?.create?.[0]?.node as unknown as PondNodeValue
      const shown = renderedProps(site, pond)
      expect([level, result.koi, result.lilies]).toEqual([level, shown.koi, shown.lilies])
      expect(pond.props).toHaveLength(shown.koi + shown.lilies)
    }
  })

  test('joins ponds as the panel does, at each pond\'s own water level', () => {
    const left = PondNode.parse({ id: 'pond_left', parentId: 'site_two_basins', seed: [2, 2], waterLevel: 1 })
    const right = PondNode.parse({ id: 'pond_right', parentId: 'site_two_basins', seed: [5, 3], waterLevel: 4 })
    const { nodes, site } = twoBasinLot([left, right])
    const { result, changes } = run(nodes, { at: [2, 2], level: 1 })

    // The panel's own targeting of the same hollow names the same records.
    const panelTarget = targetPondAtSeed(nodes as never, site, [2, 2])
    const panelWater = inspectPondTarget(nodes as never, panelTarget?.target ?? null)
    expect(result.pondId).toBe(panelTarget?.pond?.id)
    expect([result.pondId, ...(result.mergedPondIds as string[])].sort()).toEqual(
      (panelWater?.connectedPonds ?? []).map((pond) => pond.id).sort(),
    )
    expect(changes?.delete).toEqual(result.mergedPondIds as string[])
  })

  test('lowering and emptying keep the props, and say how many the water now hides', () => {
    const { nodes } = twoBasinLot()
    const stocked = applyChanges(nodes, run(nodes, { at: [2, 2], level: 5, koi: 6, lilies: 6 }).changes)
    const pondOf = (scene: Nodes) =>
      Object.values(scene).find((node) => String(node.type) === POND_KIND) as unknown as PondNodeValue
    const storedProps = pondOf(stocked).props.length

    const lowered = run(stocked, { at: [2, 2], level: 1 })
    const loweredPond = pondOf(applyChanges(stocked, lowered.changes))
    expect(loweredPond.props).toHaveLength(storedProps)
    expect((lowered.result.koi as number) + (lowered.result.lilies as number) + (lowered.result.hiddenProps as number)).toBe(storedProps)

    const emptied = run(stocked, { at: [2, 2], level: 'empty' })
    const emptiedPond = pondOf(applyChanges(stocked, emptied.changes))
    expect(emptiedPond.waterLevel).toBeNull()
    expect(emptiedPond.props).toHaveLength(storedProps)
    expect([emptied.result.koi, emptied.result.lilies, emptied.result.hiddenProps]).toEqual([0, 0, storedProps])
  })
})
