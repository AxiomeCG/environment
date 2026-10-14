import { createTerrainField, encodeTerrainField, quantize, SiteNode, type AnyNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { localGrassHeightScaleAt } from '../ground-cover/height-field'
import { paintAt, siteBounds } from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { resolveGroundCoverHeight, resolveGroundCoverPaint, resolveSurfacePaint } from '../paint-tiles/layers'
import { surfaceMaterialWeightsAt } from '../surface-material/field'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { layGround, type LayGroundAreaInput } from './lay-ground'
import { readEnvironment } from './read-environment'
import { EnvironmentRefusal } from './refuse'
import type { SceneChanges } from './types'

type Nodes = Record<string, AnyNode>
type TerrainFacts = {
  sampleCount: number
  cellM: number | null
  sampleAt: string
  heightRangeM: [number, number] | null
  slopeRangeDeg: [number, number] | null
}
type GroundFacts = {
  coveredM2: number
  coverageOfAreaPct: number
  coverageMeaning: string
  steepPaintM2: number
  flowerSteepPaintM2: number
  renderingSlopeLimitsDeg: { grass: number; flower: number }
  terrain: TerrainFacts
}
type AreaFacts = { grassM2: number; excludedSteepM2: number; terrain: TerrainFacts }
const context = { activeLevelId: null }

function lot(height?: (x: number) => number): Nodes {
  const field = createTerrainField({ origin: [-2, -2], spacing: 1, cols: 13, rows: 13, step: 0.01 })
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      field.heights[row * field.cols + col] = quantize(field, height?.(col - 2) ?? 0)
    }
  }
  const site = SiteNode.parse({
    id: 'site_planting',
    polygon: { type: 'polygon', points: [[0, 0], [8, 0], [8, 8], [0, 8]] },
    children: [],
    ...(height ? { terrain: encodeTerrainField(field) } : {}),
  })
  return { [site.id]: site as AnyNode }
}

function applyChanges(nodes: Nodes, changes: SceneChanges | undefined): Nodes {
  const next = { ...nodes }
  for (const { node, parentId } of changes?.create ?? []) {
    next[node.id] = node
    const parent = parentId ? next[parentId] as SiteNode | undefined : undefined
    if (parent) next[parent.id] = { ...parent, children: [...parent.children, node.id] } as AnyNode
  }
  for (const { id, data } of changes?.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes?.delete ?? []) delete next[id]
  return next
}

function lay(nodes: Nodes, areas: LayGroundAreaInput[] = [{ site: true, ground: 'grass', featherM: 0 }]) {
  return layGround(nodes, { areas }, context)
}

function cover(nodes: Nodes, area?: number[][]): GroundFacts {
  return readEnvironment(nodes, { area, hollowsLimit: 0 }, context).result.groundCover as GroundFacts
}

function fields(nodes: Nodes) {
  const site = nodes.site_planting as SiteNode
  const grass = Object.values(nodes).find((node) => String(node.type) === GRASS_FIELD_KIND)
  const surface = Object.values(nodes).find((node) => String(node.type) === SURFACE_MATERIAL_KIND)
  if (!grass || !surface) throw new Error('missing ground layers')
  const bounds = siteBounds(site.polygon.points)
  return {
    paint: resolveGroundCoverPaint(grass as unknown as GrassFieldNode, Object.values(nodes), bounds),
    height: resolveGroundCoverHeight(grass as unknown as GrassFieldNode, Object.values(nodes), bounds),
    surface: resolveSurfacePaint(surface as unknown as SurfaceMaterialNode, Object.values(nodes), bounds),
  }
}

describe('terrain-aware ground operations', () => {
  test('flat paint facts stay additive, explicit about paint rather than actual plants', () => {
    const nodes = lot()
    const outcome = lay(nodes)
    const facts = cover(applyChanges(nodes, outcome.changes))
    expect(facts.coveredM2).toBeCloseTo(64, 2)
    expect(facts.coverageOfAreaPct).toBe(100)
    expect(facts.coverageMeaning).toBe('sampled_paint_coverage_not_actual_plants')
    expect(facts.steepPaintM2).toBe(0)
    expect(facts.flowerSteepPaintM2).toBe(0)
    expect(facts.renderingSlopeLimitsDeg).toEqual({ grass: 70, flower: 55 })
    expect(facts.terrain.sampleAt).toBe('paint-cell-centres-with-coverage')
    expect(facts.terrain.sampleCount).toBeGreaterThan(0)
    expect(facts.terrain.cellM).toBeGreaterThan(0)
    expect(facts.terrain.heightRangeM).toEqual([0, 0])
    expect(facts.terrain.slopeRangeDeg).toEqual([0, 0])
    const area = (outcome.result.areas as AreaFacts[])[0]
    expect(area?.excludedSteepM2).toBe(0)
    expect(area?.terrain.heightRangeM).toEqual([0, 0])
    expect(area?.terrain.slopeRangeDeg).toEqual([0, 0])
  })

  test('no painted samples gives null terrain ranges, not a claim of flat vegetation', () => {
    const nodes = lot((x) => x)
    const absent = cover(nodes)
    expect(absent.terrain.sampleCount).toBe(0)
    expect(absent.terrain.cellM).toBeNull()
    expect(absent.terrain.heightRangeM).toBeNull()
    expect(absent.terrain.slopeRangeDeg).toBeNull()
    expect(absent.steepPaintM2).toBe(0)
    expect(absent.flowerSteepPaintM2).toBe(0)
    expect(absent.renderingSlopeLimitsDeg).toEqual({ grass: 70, flower: 55 })
    const painted = applyChanges(nodes, lay(nodes, [{
      polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], ground: 'grass', featherM: 0,
    }]).changes)
    const emptyRegion = cover(painted, [[5, 5], [7, 5], [7, 7], [5, 7]])
    expect(emptyRegion.terrain.sampleCount).toBe(0)
    expect(emptyRegion.terrain.cellM).toBeGreaterThan(0)
    expect(emptyRegion.terrain.heightRangeM).toBeNull()
    expect(emptyRegion.terrain.slopeRangeDeg).toBeNull()
  })

  test('tilted painted ground reports persisted height and slope without terrain writes', () => {
    const nodes = lot((x) => 2 + x)
    const before = JSON.stringify(nodes)
    const outcome = lay(nodes)
    const area = (outcome.result.areas as AreaFacts[])[0]
    expect(area?.terrain.sampleAt).toBe('paint-lattice-points-in-brush')
    expect(area?.terrain.heightRangeM?.[0]).toBeCloseTo(2, 2)
    expect(area?.terrain.heightRangeM?.[1]).toBeGreaterThan(9.9)
    expect(area?.terrain.slopeRangeDeg).toEqual([45, 45])
    const facts = cover(applyChanges(nodes, outcome.changes))
    expect(facts.terrain.slopeRangeDeg).toEqual([45, 45])
    expect(facts.terrain.heightRangeM?.[0]).toBeGreaterThan(2)
    expect(facts.terrain.heightRangeM?.[1]).toBeLessThan(10)
    expect(JSON.stringify(nodes)).toBe(before)
    expect(outcome.changes?.update?.some(({ id }) => id === 'site_planting') ?? false).toBe(false)
  })

  test('all-steep grass refuses the complete transaction with a code and sampled facts', () => {
    const nodes = lot((x) => 4 * x)
    const before = JSON.stringify(nodes)
    let refusal: EnvironmentRefusal | undefined
    try {
      lay(nodes, [{ site: true, ground: 'earth' }, { site: true, ground: 'grass' }])
    } catch (error) {
      if (!(error instanceof EnvironmentRefusal)) throw error
      refusal = error
    }
    expect(refusal?.code).toBe('slope_too_steep')
    expect(refusal?.details.excludedSteepM2).toBeGreaterThan(0)
    expect((refusal?.details.terrain as TerrainFacts).slopeRangeDeg?.[0]).toBeGreaterThan(70)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('partially steep grass skips grass, height and surface writes there and reports the exclusion', () => {
    const initial = lot((x) => Math.max(0, x - 4) * 4)
    const nodes = applyChanges(initial, lay(initial, [{ site: true, ground: 'earth', featherM: 0 }]).changes)
    const previous = fields(nodes)
    const before = JSON.stringify(nodes)
    const outcome = lay(nodes, [{ site: true, ground: 'grass', featherM: 0, grassHeight: 1.8 }])
    const area = (outcome.result.areas as AreaFacts[])[0]
    expect(area?.excludedSteepM2).toBeGreaterThan(0)
    expect(area?.grassM2).toBeGreaterThan(0)
    expect(area?.terrain.slopeRangeDeg?.[0]).toBe(0)
    expect(area?.terrain.slopeRangeDeg?.[1]).toBeGreaterThan(70)
    const result = fields(applyChanges(nodes, outcome.changes))
    expect(paintAt(result.paint, 1, 4).a).toBe(1)
    expect(paintAt(result.paint, 7, 4).a).toBe(0)
    expect(surfaceMaterialWeightsAt(result.surface, 7, 4)).toEqual(
      surfaceMaterialWeightsAt(previous.surface, 7, 4),
    )
    expect(localGrassHeightScaleAt(result.height, 1, 4)).toBeCloseTo(1.8, 2)
    expect(localGrassHeightScaleAt(result.height, 7, 4)).toBe(1)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('existing steep paint is reported as paint, not filtered into a false plant census', () => {
    const flat = lot()
    const painted = applyChanges(flat, lay(flat).changes)
    const steepSite = lot((x) => 4 * x).site_planting as SiteNode
    const nodes = {
      ...painted,
      site_planting: { ...painted.site_planting, terrain: steepSite.terrain } as AnyNode,
    }
    const before = JSON.stringify(nodes)
    const facts = cover(nodes)
    expect(facts.coverageOfAreaPct).toBe(100)
    expect(facts.terrain.slopeRangeDeg?.[0]).toBeGreaterThan(70)
    expect(facts.coverageMeaning).toBe('sampled_paint_coverage_not_actual_plants')
    expect(facts.steepPaintM2).toBeCloseTo(facts.coveredM2, 3)
    expect(facts.flowerSteepPaintM2).toBeCloseTo(facts.coveredM2, 3)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('flower slope exclusion is reported separately from grass paint exclusion', () => {
    const nodes = lot((x) => 2 * x)
    const facts = cover(applyChanges(nodes, lay(nodes).changes))
    expect(facts.steepPaintM2).toBe(0)
    expect(facts.flowerSteepPaintM2).toBeCloseTo(facts.coveredM2, 3)
  })

  test('non-grass surface operations remain allowed on steep ground', () => {
    const nodes = lot((x) => 4 * x)
    const outcome = lay(nodes, [{ site: true, ground: 'path', featherM: 0 }])
    expect((outcome.result.areas as AreaFacts[])[0]?.excludedSteepM2).toBe(0)
    expect(surfaceMaterialWeightsAt(fields(applyChanges(nodes, outcome.changes)).surface, 4, 4)[1]).toBe(1)
  })
})
