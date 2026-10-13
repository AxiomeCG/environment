import {
  persistedTerrainFieldOf,
  surfaceHeightAt,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { localGrassHeightScaleAt, resolveGrassHeightField } from '../ground-cover/height-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  paintAt,
  resolveGrassPaintField,
  siteBounds,
  type GrassPaintField,
} from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { analyzePondBasin, buildPondSurface, type PondBasin } from '../pond/basin'
import { POND_KIND, type PondNode } from '../pond/schema'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import {
  resolveSurfaceMaterialField,
  surfaceMaterialWeightsAt,
} from '../surface-material/field'
import { SURFACE_MATERIAL_IDS } from '../surface-material/material-types'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { refuse } from './refuse'
import {
  asPolygon,
  pointInPolygon,
  polygonArea,
  polylineLength,
  requireSite,
  requireSitePolygon,
  roundFact,
  siteChildOfKind,
  siteChildrenOfKind,
} from './scene'
import type { AgentOperation, PlanPoint, SceneNodes } from './types'

export type ReadEnvironmentInput = {
  area?: ReadonlyArray<readonly number[]>
  hollowsLimit?: number
}

const MAX_TERRAIN_CELLS = 1_000_000
const MAX_BASIN_TRIES = 32

function groundCoverFacts(
  nodes: SceneNodes,
  siteId: string,
  bounds: ReturnType<typeof siteBounds>,
  area: PlanPoint[],
): Record<string, unknown> {
  const node = siteChildOfKind<GrassFieldNode>(nodes, siteId, GRASS_FIELD_KIND)
  if (!node) {
    return {
      present: false,
      coveredM2: 0,
      coverageOfAreaPct: 0,
      meanHeightScale: 1,
      flowerDensity: 0,
      cellM: null,
    }
  }
  const paint = resolveGrassPaintField(node.paintMap, bounds, DEFAULT_GRASS_PAINT_COLOR)
  const height = resolveGrassHeightField(node.heightMap, bounds)
  const stats = samplePaint(paint, height, area)
  return {
    present: true,
    coveredM2: roundFact(stats.coveredM2),
    coverageOfAreaPct: roundFact(stats.coveragePct),
    meanHeightScale: roundFact(stats.meanHeightScale),
    flowerDensity: node.flowerDensity,
    cellM: paint.spacing,
  }
}

function samplePaint(paint: GrassPaintField, height: GrassPaintField, area: PlanPoint[]) {
  const cellM2 = paint.spacing * paint.spacing
  let cells = 0
  let coveredM2 = 0
  let heightSum = 0
  let heightWeight = 0
  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      if (!pointInPolygon(x, z, area)) continue
      cells += 1
      const coverage = paintAt(paint, x, z).a
      coveredM2 += coverage * cellM2
      if (coverage > 0) {
        heightSum += localGrassHeightScaleAt(height, x, z) * coverage
        heightWeight += coverage
      }
    }
  }
  return {
    coveredM2,
    coveragePct: cells === 0 ? 0 : (coveredM2 / (cells * cellM2)) * 100,
    meanHeightScale: heightWeight === 0 ? 1 : heightSum / heightWeight,
  }
}

function surfaceFacts(
  nodes: SceneNodes,
  siteId: string,
  bounds: ReturnType<typeof siteBounds>,
  area: PlanPoint[],
): Record<string, unknown> {
  const node = siteChildOfKind<SurfaceMaterialNode>(nodes, siteId, SURFACE_MATERIAL_KIND)
  const byMaterialM2: Record<string, number> = {}
  for (const id of SURFACE_MATERIAL_IDS) byMaterialM2[id] = 0
  if (!node) return { present: false, byMaterialM2, cellM: null }

  const field = resolveSurfaceMaterialField(node.paintMap, bounds)
  const cellM2 = field.spacing * field.spacing
  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      if (!pointInPolygon(x, z, area)) continue
      const weights = surfaceMaterialWeightsAt(field, x, z)
      SURFACE_MATERIAL_IDS.forEach((id, channel) => {
        byMaterialM2[id] = (byMaterialM2[id] ?? 0) + (weights[channel] ?? 0) * cellM2
      })
    }
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
    const levelM = pond.waterLevel
    return {
      id: String(pond.id),
      atM: [pond.seed[0], pond.seed[1]],
      levelM,
      spillLevelM: basin ? roundFact(basin.spillLevel) : null,
      bottomM: basin ? roundFact(basin.bottomLevel) : null,
      maxDepthM:
        basin && levelM !== null ? roundFact(Math.max(0, levelM - basin.bottomLevel)) : 0,
      areaM2: surface ? roundFact(surface.area) : 0,
      quality: pond.quality,
      bank: pond.shoreline,
      koi: pond.props.filter((prop) => prop.kind === 'koi').length,
      lilies: pond.props.filter((prop) => prop.kind === 'water-lily').length,
    }
  })
}

function riverFacts(
  nodes: SceneNodes,
  siteId: string,
  terrain: TerrainField | null,
): Record<string, unknown>[] {
  return siteChildrenOfKind<RiverNode>(nodes, siteId, RIVER_KIND).map((river) => {
    const ordered =
      river.flowDirection === 'reverse' ? [...river.points].reverse() : [...river.points]
    const heightAtM = (x: number, z: number) => (terrain ? surfaceHeightAt(terrain, x, z) : 0)
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    let risesM = 0
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const from = ordered[index]
      const to = ordered[index + 1]
      if (!from || !to) continue
      const segment = Math.hypot(to[0] - from[0], to[1] - from[1])
      const steps = Math.max(1, Math.ceil(segment / 1))
      let previousHeight = heightAtM(from[0], from[1])
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const height = heightAtM(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t)
        if (height > previousHeight + 1e-9) risesM += segment / steps
        previousHeight = height
      }
    }
    const startY = first ? heightAtM(first[0], first[1]) : 0
    const endY = last ? heightAtM(last[0], last[1]) : 0
    return {
      id: String(river.id),
      lengthM: roundFact(polylineLength(river.points)),
      widthM: river.width,
      depthM: river.depth,
      startM: first ? [first[0], first[1], roundFact(startY)] : null,
      endM: last ? [last[0], last[1], roundFact(endY)] : null,
      dropM: roundFact(startY - endY),
      risesM: roundFact(risesM),
      flow: river.flowDirection,
    }
  })
}

/** Terrain local minima inside `area`, lowest first: the seeds worth a basin analysis. */
function localMinima(terrain: TerrainField, area: PlanPoint[]): PlanPoint[] {
  const minima: { point: PlanPoint; height: number }[] = []
  const heightAtCell = (col: number, row: number) =>
    (terrain.heights[row * terrain.cols + col] ?? 0) * terrain.step
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const height = heightAtCell(col, row)
      let isMinimum = true
      let hasHigherNeighbour = false
      for (let dr = -1; dr <= 1 && isMinimum; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue
          const ncol = col + dc
          const nrow = row + dr
          if (ncol < 0 || nrow < 0 || ncol >= terrain.cols || nrow >= terrain.rows) continue
          const neighbour = heightAtCell(ncol, nrow)
          if (neighbour < height) isMinimum = false
          if (neighbour > height) hasHigherNeighbour = true
        }
      }
      if (!isMinimum || !hasHigherNeighbour) continue
      const x = terrain.origin[0] + col * terrain.spacing
      const z = terrain.origin[1] + row * terrain.spacing
      if (pointInPolygon(x, z, area)) minima.push({ point: [x, z], height })
    }
  }
  return minima.sort((a, b) => a.height - b.height).map((entry) => entry.point)
}

function hollowFacts(
  terrain: TerrainField | null,
  sitePolygon: PlanPoint[],
  area: PlanPoint[],
  limit: number,
): Record<string, unknown>[] {
  if (!terrain || limit === 0) return []
  if (terrain.cols * terrain.rows > MAX_TERRAIN_CELLS) {
    refuse('sampling_limit', 'The terrain field is too large to scan for hollows.', {
      cells: terrain.cols * terrain.rows,
      maxCells: MAX_TERRAIN_CELLS,
    })
  }
  const hollows: Record<string, unknown>[] = []
  const seenBasins = new Set<string>()
  let tries = 0
  for (const seed of localMinima(terrain, area)) {
    if (hollows.length >= limit || tries >= MAX_BASIN_TRIES) break
    tries += 1
    const basin: PondBasin | null = analyzePondBasin(terrain, sitePolygon, seed)
    if (!basin) continue
    const key = `${roundFact(basin.seed[0])}:${roundFact(basin.seed[1])}`
    if (seenBasins.has(key)) continue
    seenBasins.add(key)
    hollows.push({
      atM: [roundFact(basin.seed[0]), roundFact(basin.seed[1])],
      bottomM: roundFact(basin.bottomLevel),
      spillLevelM: roundFact(basin.spillLevel),
      maxDepthM: roundFact(basin.spillLevel - basin.bottomLevel),
      areaM2: roundFact(buildPondSurface(basin, basin.spillLevel).area),
      approximate: true,
    })
  }
  return hollows
}

export const readEnvironment: AgentOperation<ReadEnvironmentInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const area = input.area === undefined ? sitePolygon : asPolygon(input.area)
  if (!area || area.length < 3) {
    refuse('invalid_polygon', '`area` is not a usable polygon (3+ points).')
  }
  if (Math.abs(polygonArea(area)) <= 1e-9) refuse('footprint_empty', '`area` covers no ground.')
  const hollowsLimit = Math.min(20, Math.max(0, Math.floor(input.hollowsLimit ?? 5)))
  const bounds = siteBounds(sitePolygon)
  const terrain = persistedTerrainFieldOf(site)

  return {
    result: {
      siteId: String(site.id),
      areaM2: roundFact(Math.abs(polygonArea(area))),
      groundCover: groundCoverFacts(nodes, String(site.id), bounds, area),
      surface: surfaceFacts(nodes, String(site.id), bounds, area),
      ponds: pondFacts(nodes, site, sitePolygon, terrain),
      rivers: riverFacts(nodes, String(site.id), terrain),
      hollows: hollowFacts(terrain, sitePolygon, area, hollowsLimit),
      presentation: 'browser',
    },
  }
}
