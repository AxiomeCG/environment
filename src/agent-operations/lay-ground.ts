import { segmentsIntersect, type AnyNode } from '@pascal-app/core'
import {
  encodeLocalHeightScale,
  localGrassHeightScaleAt,
  resolveGrassHeightField,
} from '../ground-cover/height-field'
import { buildGrassObstacleField } from '../ground-cover/obstacle-adapter'
import { isGrassAllowedAt, type GrassObstacleField } from '../ground-cover/obstacle-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  encodeGrassPaintField,
  hexToRgb,
  resolveGrassPaintField,
  paintAt,
  siteBounds,
  type GrassPaintField,
} from '../ground-cover/paint-field'
import { GrassFieldNode, GRASS_FIELD_KIND } from '../ground-cover/schema'
import {
  encodeSurfaceMaterialField,
  resolveSurfaceMaterialField,
  type SurfaceMaterialField,
} from '../surface-material/field'
import {
  SURFACE_MATERIAL_PAINT_COLOR,
  type SurfaceMaterialId,
} from '../surface-material/material-types'
import { SurfaceMaterialNode, SURFACE_MATERIAL_KIND } from '../surface-material/schema'
import { refuse } from './refuse'
import {
  asPolygon,
  distanceToPolyline,
  isValidPolygon,
  pointInPolygon,
  polylineLength,
  requireSite,
  requireSitePolygon,
  roundFact,
  signedDistanceToPolygon,
  siteChildOfKind,
} from './scene'
import type { AgentOperation, PlanPoint, SceneChanges } from './types'

export type LayGroundKind = 'grass' | 'earth' | 'path' | 'paving' | 'none'

export type LayGroundAreaInput = {
  polygon?: ReadonlyArray<readonly number[]>
  path?: { points: ReadonlyArray<readonly number[]>; widthM: number }
  site?: boolean
  ground: LayGroundKind
  featherM?: number
  grassHeight?: number
  tint?: string
}

export type LayGroundInput = { areas: LayGroundAreaInput[] }

const MAX_AREAS = 20
const DEFAULT_FEATHER_M = 0.3
/** The collaboration layer's per-operation cap, stated next to `updateBytes` as a fact. */
const COLLABORATION_CAP_BYTES = 65_536

const GROUND_SURFACE: Record<LayGroundKind, SurfaceMaterialId | null> = {
  grass: 'flowered-grass',
  earth: 'desert-ground',
  path: 'road-path',
  paving: 'paved-road',
  none: null,
}

type SignedDistance = (x: number, z: number) => number

type ResolvedShape = {
  signedDistance: SignedDistance
  /** Shape vertices and edges, for the off-lot check the paint lattice cannot make. */
  outline: PlanPoint[]
  closed: boolean
}

type ResolvedArea = {
  index: number
  ground: LayGroundKind
  featherM: number
  grassHeight: number | null
  tint: { r: number; g: number; b: number } | null
  signedDistance: SignedDistance
  outline: PlanPoint[]
  closed: boolean
}

function resolveShape(area: LayGroundAreaInput, index: number, sitePolygon: PlanPoint[]): ResolvedShape {
  const shapes = [area.polygon !== undefined, area.path !== undefined, area.site === true].filter(
    Boolean,
  ).length
  if (shapes !== 1) {
    refuse('invalid_polygon', `Area ${index} needs exactly one of polygon, path or site.`, { index })
  }
  if (area.site === true) {
    return {
      signedDistance: (x, z) => signedDistanceToPolygon(x, z, sitePolygon),
      outline: sitePolygon,
      closed: true,
    }
  }
  if (area.path !== undefined) {
    const points = asPolygon(area.path.points)
    if (!points || points.length < 2 || !(area.path.widthM > 0)) {
      refuse('invalid_polygon', `Area ${index} has a malformed path.`, { index })
    }
    if (polylineLength(points) <= 1e-9) {
      refuse('path_too_short', `Area ${index}'s path has no length.`, { index })
    }
    const halfWidth = area.path.widthM / 2
    return {
      signedDistance: (x, z) => halfWidth - distanceToPolyline(x, z, points),
      outline: points,
      closed: false,
    }
  }
  const polygon = asPolygon(area.polygon)
  if (!polygon || !isValidPolygon(polygon)) {
    refuse('invalid_polygon', `Area ${index} is not a usable polygon (3+ points, some area).`, {
      index,
    })
  }
  return {
    signedDistance: (x, z) => signedDistanceToPolygon(x, z, polygon),
    outline: polygon,
    closed: true,
  }
}

/** Whether the shape touches the lot at all: a vertex in, a lot corner in, or edges crossing. */
function shapeOverlapsSite(area: ResolvedArea, sitePolygon: PlanPoint[]): boolean {
  if (area.outline.some((point) => pointInPolygon(point[0], point[1], sitePolygon))) return true
  if (sitePolygon.some((point) => area.signedDistance(point[0], point[1]) >= 0)) return true
  const shapeEdges = area.closed ? area.outline.length : area.outline.length - 1
  for (let index = 0; index < shapeEdges; index += 1) {
    const first = area.outline[index]
    const second = area.outline[(index + 1) % area.outline.length]
    if (!first || !second) continue
    for (let edge = 0; edge < sitePolygon.length; edge += 1) {
      const siteFirst = sitePolygon[edge]
      const siteSecond = sitePolygon[(edge + 1) % sitePolygon.length]
      if (!siteFirst || !siteSecond) continue
      if (
        segmentsIntersect(
          [first[0], first[1]],
          [second[0], second[1]],
          [siteFirst[0], siteFirst[1]],
          [siteSecond[0], siteSecond[1]],
        )
      ) {
        return true
      }
    }
  }
  return false
}

function resolveAreas(input: LayGroundInput, sitePolygon: PlanPoint[]): ResolvedArea[] {
  const areas = input.areas ?? []
  if (areas.length === 0) refuse('area_empty', 'lay_ground needs at least one area.')
  if (areas.length > MAX_AREAS) {
    refuse('too_many_areas', `lay_ground lays at most ${MAX_AREAS} areas per call.`, {
      count: areas.length,
      max: MAX_AREAS,
    })
  }
  return areas.map((area, index) => {
    if (!Object.hasOwn(GROUND_SURFACE, area.ground)) {
      refuse('invalid_ground', `Area ${index} has an unknown ground kind.`, { index })
    }
    let tint: ResolvedArea['tint'] = null
    if (area.tint !== undefined) {
      try {
        tint = hexToRgb(area.tint)
      } catch {
        refuse('invalid_tint', `Area ${index}'s tint is not a hex colour.`, { index })
      }
    }
    return {
      index,
      ground: area.ground,
      featherM: Math.min(3, Math.max(0, area.featherM ?? DEFAULT_FEATHER_M)),
      grassHeight:
        area.grassHeight === undefined ? null : Math.min(2, Math.max(0.5, area.grassHeight)),
      tint,
      ...resolveShape(area, index, sitePolygon),
    }
  })
}

function strengthAt(area: ResolvedArea, x: number, z: number): number {
  const distance = area.signedDistance(x, z)
  if (area.featherM <= 0) return distance >= 0 ? 1 : 0
  return Math.min(1, Math.max(0, 0.5 + distance / area.featherM))
}

function lerpByte(current: number, target: number, amount: number): number {
  return Math.round(current + (target - current) * amount)
}

type AreaFacts = { areaM2: number; grassM2: number; blockedM2: number; paintedCells: number; shapeCells: number }

/** One pass over a paint lattice: blend every cell of `field` toward the area's targets. */
function paintArea(
  area: ResolvedArea,
  sitePolygon: PlanPoint[],
  paint: GrassPaintField,
  height: GrassPaintField | null,
  surface: SurfaceMaterialField,
  obstacles: GrassObstacleField,
): AreaFacts {
  const material = GROUND_SURFACE[area.ground]
  const targetCoverage = area.ground === 'grass' ? 255 : 0
  const surfaceColor = material ? SURFACE_MATERIAL_PAINT_COLOR[material] : null
  const heightTarget = area.grassHeight === null ? null : encodeLocalHeightScale(area.grassHeight)
  const cellM2 = paint.spacing * paint.spacing
  const facts: AreaFacts = { areaM2: 0, grassM2: 0, blockedM2: 0, paintedCells: 0, shapeCells: 0 }

  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      const distance = area.signedDistance(x, z)
      if (distance >= 0) facts.shapeCells += 1
      if (!pointInPolygon(x, z, sitePolygon)) continue
      const strength = strengthAt(area, x, z)
      if (distance >= 0) {
        facts.areaM2 += cellM2
        if (!isGrassAllowedAt(obstacles, x, z)) facts.blockedM2 += cellM2
      }
      if (strength <= 0) continue
      facts.paintedCells += 1
      if (area.ground === 'grass') facts.grassM2 += strength * cellM2

      const offset = (row * paint.cols + col) * 4
      if (area.tint) {
        paint.values[offset] = lerpByte(paint.values[offset] ?? 0, area.tint.r, strength)
        paint.values[offset + 1] = lerpByte(paint.values[offset + 1] ?? 0, area.tint.g, strength)
        paint.values[offset + 2] = lerpByte(paint.values[offset + 2] ?? 0, area.tint.b, strength)
      }
      paint.values[offset + 3] = lerpByte(paint.values[offset + 3] ?? 0, targetCoverage, strength)
      if (height !== null && heightTarget !== null) {
        // Both fields resolve over the same bounds, so they share a lattice.
        const channel = lerpByte(height.values[offset] ?? 0, heightTarget, strength)
        height.values[offset] = channel
        height.values[offset + 1] = channel
        height.values[offset + 2] = channel
        height.values[offset + 3] = 255
      }
      if (surfaceColor) {
        surface.values[offset] = lerpByte(surface.values[offset] ?? 0, surfaceColor.r, strength)
        surface.values[offset + 1] = lerpByte(surface.values[offset + 1] ?? 0, surfaceColor.g, strength)
        surface.values[offset + 2] = lerpByte(surface.values[offset + 2] ?? 0, surfaceColor.b, strength)
        surface.values[offset + 3] = lerpByte(surface.values[offset + 3] ?? 0, 255, strength)
      } else {
        surface.values[offset + 3] = lerpByte(surface.values[offset + 3] ?? 0, 0, strength)
      }
    }
  }
  return facts
}

function sameLattice(first: GrassPaintField, second: GrassPaintField): boolean {
  return (
    first.cols === second.cols &&
    first.rows === second.rows &&
    first.spacing === second.spacing &&
    first.origin[0] === second.origin[0] &&
    first.origin[1] === second.origin[1]
  )
}

/** Resample a height field onto the paint lattice so one cell index addresses both. */
function alignHeightField(height: GrassPaintField, paint: GrassPaintField): GrassPaintField {
  if (sameLattice(height, paint)) return height
  const values = new Uint8Array(paint.cols * paint.rows * 4)
  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      const channel = encodeLocalHeightScale(localGrassHeightScaleAt(height, x, z))
      const offset = (row * paint.cols + col) * 4
      values[offset] = channel
      values[offset + 1] = channel
      values[offset + 2] = channel
      values[offset + 3] = 255
    }
  }
  return { origin: paint.origin, spacing: paint.spacing, cols: paint.cols, rows: paint.rows, values }
}

/** Resample a surface field onto the paint lattice, through its material weights. */
function alignSurfaceField(surface: SurfaceMaterialField, paint: GrassPaintField): SurfaceMaterialField {
  if (sameLattice(surface, paint)) return surface
  const values = new Uint8Array(paint.cols * paint.rows * 4)
  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      const sample = paintAt(surface, x, z)
      const offset = (row * paint.cols + col) * 4
      values[offset] = Math.round(sample.r * 255)
      values[offset + 1] = Math.round(sample.g * 255)
      values[offset + 2] = Math.round(sample.b * 255)
      values[offset + 3] = Math.round(sample.a * 255)
    }
  }
  return { origin: paint.origin, spacing: paint.spacing, cols: paint.cols, rows: paint.rows, values }
}

function lotGrassCoveragePct(paint: GrassPaintField, sitePolygon: PlanPoint[]): number {
  let cells = 0
  let covered = 0
  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      if (!pointInPolygon(x, z, sitePolygon)) continue
      cells += 1
      covered += (paint.values[(row * paint.cols + col) * 4 + 3] ?? 0) / 255
    }
  }
  return cells === 0 ? 0 : (covered / cells) * 100
}

export const layGround: AgentOperation<LayGroundInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const areas = resolveAreas(input, sitePolygon)
  const bounds = siteBounds(sitePolygon)

  const grassNode = siteChildOfKind<GrassFieldNode>(nodes, String(site.id), GRASS_FIELD_KIND)
  const surfaceNode = siteChildOfKind<SurfaceMaterialNode>(
    nodes,
    String(site.id),
    SURFACE_MATERIAL_KIND,
  )
  const paint = resolveGrassPaintField(grassNode?.paintMap, bounds, DEFAULT_GRASS_PAINT_COLOR)
  const surface = alignSurfaceField(
    resolveSurfaceMaterialField(surfaceNode?.paintMap, bounds),
    paint,
  )
  const resolvedHeight =
    areas.some((area) => area.grassHeight !== null) || grassNode?.heightMap !== undefined
      ? resolveGrassHeightField(grassNode?.heightMap, bounds)
      : null
  const height = resolvedHeight === null ? null : alignHeightField(resolvedHeight, paint)
  const obstacles = buildGrassObstacleField(site, nodes, {
    origin: paint.origin,
    spacing: paint.spacing,
    cols: paint.cols,
    rows: paint.rows,
  })

  const areaFacts = areas.map((area) => {
    const facts = paintArea(area, sitePolygon, paint, height, surface, obstacles)
    if (facts.paintedCells === 0) {
      if (facts.shapeCells === 0 && !shapeOverlapsSite(area, sitePolygon)) {
        refuse('outside_property', `Area ${area.index} does not touch the lot.`, {
          index: area.index,
        })
      }
      refuse('area_empty', `Area ${area.index} covers no paintable cell at this resolution.`, {
        index: area.index,
        cellM: paint.spacing,
      })
    }
    return {
      index: area.index,
      areaM2: roundFact(facts.areaM2),
      grassM2: roundFact(facts.grassM2),
      surface: GROUND_SURFACE[area.ground],
      blockedM2: roundFact(facts.blockedM2),
    }
  })

  const paintMap = encodeGrassPaintField(paint)
  const surfaceMap = encodeSurfaceMaterialField(surface)
  const heightMap = height === null ? undefined : encodeGrassPaintField(height)
  const changes: SceneChanges = { create: [], update: [] }
  if (grassNode) {
    changes.update?.push({
      id: String(grassNode.id),
      data: { paintMap, ...(heightMap ? { heightMap } : {}) } as Partial<AnyNode>,
    })
  } else {
    const node = GrassFieldNode.parse({
      parentId: site.id,
      paintMap,
      ...(heightMap ? { heightMap } : {}),
    })
    changes.create?.push({ node: node as unknown as AnyNode, parentId: String(site.id) })
  }
  if (surfaceNode) {
    changes.update?.push({
      id: String(surfaceNode.id),
      data: { paintMap: surfaceMap } as Partial<AnyNode>,
    })
  } else {
    const node = SurfaceMaterialNode.parse({ parentId: site.id, paintMap: surfaceMap })
    changes.create?.push({ node: node as unknown as AnyNode, parentId: String(site.id) })
  }
  if (changes.create?.length === 0) delete changes.create
  if (changes.update?.length === 0) delete changes.update

  return {
    result: {
      areas: areaFacts,
      grassCoveragePct: roundFact(lotGrassCoveragePct(paint, sitePolygon)),
      grassCellM: paint.spacing,
      surfaceCellM: surface.spacing,
      groundCoverCreated: grassNode === null,
      surfaceCreated: surfaceNode === null,
      updateBytes: new TextEncoder().encode(JSON.stringify(changes)).length,
      collaborationCapBytes: COLLABORATION_CAP_BYTES,
    },
    changes,
  }
}
