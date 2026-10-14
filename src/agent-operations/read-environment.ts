import { persistedTerrainFieldOf, type SiteNode, type TerrainField } from '@pascal-app/core'
import { localGrassHeightScaleAt } from '../ground-cover/height-field'
import {
  paintAt,
  siteBounds,
  type GrassPaintField,
  type SiteBounds,
} from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import {
  resolveGroundCoverHeight,
  resolveGroundCoverPaint,
  resolveSurfacePaint,
} from '../paint-tiles/layers'
import { PLANTING_MAX_SLOPE_DEG, samplePlantingTerrain } from '../planting-terrain'
import { analyzePondBasin, buildPondSurface } from '../pond/basin'
import { renderablePondProps } from '../pond/prop-fit'
import { POND_KIND, type PondNode } from '../pond/schema'
import { surfaceMaterialWeightsAt } from '../surface-material/field'
import { SURFACE_MATERIAL_IDS } from '../surface-material/material-types'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { scanHollows } from './hollows'
import { refuse } from './refuse'
import { riverFacts } from './river-facts'
import {
  asPolygon,
  pointInPolygon,
  polygonArea,
  polygonIntersectionArea,
  requireSite,
  requireSitePolygon,
  roundFact,
  siteChildOfKind,
  siteChildrenOfKind,
} from './scene'
import { createTerrainSamples, includeTerrainSample, terrainSampleFacts } from './terrain-facts'
import type { AgentOperation, PlanPoint, SceneNodes } from './types'

export type ReadEnvironmentInput = {
  area?: ReadonlyArray<readonly number[]>
  hollowsLimit?: number
}

/** The ground a read samples: inside both the requested area and the lot. */
type Region = (x: number, z: number) => boolean

/**
 * The cells of `field`'s lattice whose centres lie in the region, each by its centre: a cell
 * counts once, and ground that only touches the region counts for nothing.
 */
function* regionCells(
  field: Pick<GrassPaintField, 'origin' | 'spacing' | 'cols' | 'rows'>,
  region: Region,
) {
  for (let row = 0; row + 1 < field.rows; row += 1) {
    const z = field.origin[1] + (row + 0.5) * field.spacing
    for (let col = 0; col + 1 < field.cols; col += 1) {
      const x = field.origin[0] + (col + 0.5) * field.spacing
      if (region(x, z)) yield { x, z }
    }
  }
}

function samplePaint(
  paint: GrassPaintField,
  height: GrassPaintField,
  region: Region,
  terrain: TerrainField | null,
) {
  const cellM2 = paint.spacing * paint.spacing
  const samples = createTerrainSamples()
  let cells = 0
  let coveredM2 = 0
  let heightSum = 0
  let heightWeight = 0
  let steepPaintM2 = 0
  let flowerSteepPaintM2 = 0
  for (const { x, z } of regionCells(paint, region)) {
    cells += 1
    const coverage = paintAt(paint, x, z).a
    coveredM2 += coverage * cellM2
    if (coverage > 0) {
      heightSum += localGrassHeightScaleAt(height, x, z) * coverage
      heightWeight += coverage
      const sample = samplePlantingTerrain(terrain, x, z)
      includeTerrainSample(samples, sample)
      if (sample.slopeDeg >= PLANTING_MAX_SLOPE_DEG.grass) steepPaintM2 += coverage * cellM2
      if (sample.slopeDeg >= PLANTING_MAX_SLOPE_DEG.flower) flowerSteepPaintM2 += coverage * cellM2
    }
  }
  return {
    coveredM2,
    coveragePct: cells === 0 ? 0 : (coveredM2 / (cells * cellM2)) * 100,
    meanHeightScale: heightWeight === 0 ? 1 : heightSum / heightWeight,
    steepPaintM2: roundFact(steepPaintM2),
    flowerSteepPaintM2: roundFact(flowerSteepPaintM2),
    terrain: terrainSampleFacts(samples, paint.spacing, 'paint-cell-centres-with-coverage'),
  }
}

function groundCoverFacts(
  nodes: SceneNodes,
  site: SiteNode,
  bounds: SiteBounds,
  region: Region,
  terrain: TerrainField | null,
) {
  const node = siteChildOfKind<GrassFieldNode>(nodes, String(site.id), GRASS_FIELD_KIND)
  const coverageMeaning = 'sampled_paint_coverage_not_actual_plants'
  const renderingSlopeLimitsDeg = {
    grass: PLANTING_MAX_SLOPE_DEG.grass,
    flower: PLANTING_MAX_SLOPE_DEG.flower,
  }
  if (!node) {
    return {
      present: false,
      coveredM2: 0,
      coverageOfAreaPct: 0,
      meanHeightScale: 1,
      flowerDensity: 0,
      cellM: null,
      coverageMeaning,
      steepPaintM2: 0,
      flowerSteepPaintM2: 0,
      renderingSlopeLimitsDeg,
      terrain: terrainSampleFacts(createTerrainSamples(), null, 'paint-cell-centres-with-coverage'),
    }
  }
  const paint = resolveGroundCoverPaint(node, Object.values(nodes), bounds)
  const height = resolveGroundCoverHeight(node, Object.values(nodes), bounds)
  const stats = samplePaint(paint, height, region, terrain)
  return {
    present: true,
    coveredM2: roundFact(stats.coveredM2),
    coverageOfAreaPct: roundFact(stats.coveragePct),
    meanHeightScale: roundFact(stats.meanHeightScale),
    flowerDensity: node.flowerDensity,
    cellM: paint.spacing,
    coverageMeaning,
    steepPaintM2: stats.steepPaintM2,
    flowerSteepPaintM2: stats.flowerSteepPaintM2,
    renderingSlopeLimitsDeg,
    terrain: stats.terrain,
  }
}

function surfaceFacts(nodes: SceneNodes, site: SiteNode, bounds: SiteBounds, region: Region) {
  const node = siteChildOfKind<SurfaceMaterialNode>(nodes, String(site.id), SURFACE_MATERIAL_KIND)
  const byMaterialM2: Record<string, number> = {}
  for (const id of SURFACE_MATERIAL_IDS) byMaterialM2[id] = 0
  if (!node) return { present: false, byMaterialM2, cellM: null }

  const field = resolveSurfacePaint(node, Object.values(nodes), bounds)
  const cellM2 = field.spacing * field.spacing
  for (const { x, z } of regionCells(field, region)) {
    const weights = surfaceMaterialWeightsAt(field, x, z)
    SURFACE_MATERIAL_IDS.forEach((id, channel) => {
      byMaterialM2[id] = (byMaterialM2[id] ?? 0) + (weights[channel] ?? 0) * cellM2
    })
  }
  for (const id of SURFACE_MATERIAL_IDS) byMaterialM2[id] = roundFact(byMaterialM2[id] ?? 0)
  return { present: true, byMaterialM2, cellM: field.spacing }
}

function pondFacts(
  nodes: SceneNodes,
  site: SiteNode,
  sitePolygon: PlanPoint[],
  terrain: TerrainField | null,
): Record<string, unknown>[] {
  return siteChildrenOfKind<PondNode>(nodes, String(site.id), POND_KIND).map((pond) => {
    const basin = terrain ? analyzePondBasin(terrain, sitePolygon, pond.seed) : null
    const surface = basin ? buildPondSurface(basin, pond.waterLevel) : null
    const shown = surface ? renderablePondProps(pond.props, surface) : []
    const shownKoi = shown.filter((prop) => prop.kind === 'koi').length
    return {
      id: String(pond.id),
      atM: [pond.seed[0], pond.seed[1]],
      levelM: pond.waterLevel,
      spillLevelM: basin ? roundFact(basin.spillLevel) : null,
      bottomM: basin ? roundFact(basin.bottomLevel) : null,
      maxDepthM:
        basin && pond.waterLevel !== null
          ? roundFact(Math.max(0, pond.waterLevel - basin.bottomLevel))
          : 0,
      areaM2: surface ? roundFact(surface.area) : 0,
      quality: pond.quality,
      bank: pond.shoreline,
      koi: shownKoi,
      lilies: shown.length - shownKoi,
      hiddenProps: pond.props.length - shown.length,
    }
  })
}

/** Less shared ground than this is contact, not overlap: an area touching the lot's edge. */
const MIN_SHARED_AREA_M2 = 1e-6

/**
 * The requested area (the lot by default) and the ground it shares with the lot, exactly;
 * refused when it shares none.
 */
function requireArea(
  input: ReadEnvironmentInput,
  sitePolygon: PlanPoint[],
): { area: PlanPoint[]; onLotM2: number } {
  const area = input.area === undefined ? sitePolygon : asPolygon(input.area)
  if (!area || area.length < 3)
    refuse('invalid_polygon', '`area` is not a usable polygon (3+ points).')
  if (Math.abs(polygonArea(area)) <= 1e-9) refuse('footprint_empty', '`area` covers no ground.')
  const onLotM2 = polygonIntersectionArea(area, sitePolygon)
  if (onLotM2 <= MIN_SHARED_AREA_M2) {
    refuse('outside_property', '`area` shares no ground with the lot; only the lot is read.')
  }
  return { area, onLotM2 }
}

export const readEnvironment: AgentOperation<ReadEnvironmentInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const { area, onLotM2 } = requireArea(input, sitePolygon)
  const region: Region = (x, z) => pointInPolygon(x, z, area) && pointInPolygon(x, z, sitePolygon)
  const bounds = siteBounds(sitePolygon)
  const terrain = persistedTerrainFieldOf(site)
  const hollowsLimit = Math.min(20, Math.max(0, Math.floor(input.hollowsLimit ?? 5)))
  const hollowScan = scanHollows(terrain, sitePolygon, region, hollowsLimit)
  return {
    result: {
      siteId: String(site.id),
      areaM2: roundFact(Math.abs(polygonArea(area))),
      onLotM2: roundFact(onLotM2),
      groundCover: groundCoverFacts(nodes, site, bounds, region, terrain),
      surface: surfaceFacts(nodes, site, bounds, region),
      ponds: pondFacts(nodes, site, sitePolygon, terrain),
      rivers: riverFacts(nodes, site, area),
      hollows: hollowScan.hollows,
      hollowsTruncated: hollowScan.truncated,
      presentation: 'browser',
    },
  }
}
