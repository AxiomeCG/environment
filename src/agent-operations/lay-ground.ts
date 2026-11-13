import {
  segmentsIntersect,
  type AnyNode,
  type AnyNodeId,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { createGroundCoverNode } from '../ground-cover/create-node'
import { encodeLocalHeightScale } from '../ground-cover/height-field'
import { buildGrassObstacleField } from '../ground-cover/obstacle-adapter'
import {
  createGrassObstacleTopology,
  isGrassAllowedAt,
  type GrassObstacleField,
} from '../ground-cover/obstacle-field'
import {
  hexToRgb,
  rgbToHex,
  siteBounds,
  type GrassPaintField,
  type RgbBytes,
} from '../ground-cover/paint-field'
import { blendPaintCell, type PaintCellBlend } from '../ground-cover/paint-stroke'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { paintTilesOf } from '../paint-tiles/compose'
import {
  resolveGroundCoverHeight,
  resolveGroundCoverPaint,
  resolveSurfacePaint,
} from '../paint-tiles/layers'
import {
  GROUND_SURFACE,
  grassPaintBlend,
  heightPaintBlend,
  paintBeyondLot,
  surfacePaintBlend,
} from '../paint-tiles/lot-ground'
import type { LotGround, LotGroundKind } from '../paint-tiles/lot-ground-schema'
import {
  mergePaintTileChanges,
  planPaintTileChanges,
  type PaintTileChanges,
} from '../paint-tiles/plan'
import { PAINT_TILE_KIND, type PaintTileMap } from '../paint-tiles/schema'
import { PLANTING_MAX_SLOPE_DEG, samplePlantingTerrain } from '../planting-terrain'
import { createSurfaceMaterialNode } from '../surface-material/create-node'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
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
  siteTerrainOf,
} from './scene'
import {
  createTerrainSamples,
  includeTerrainSample,
  terrainSampleFacts,
  type TerrainSamples,
} from './terrain-facts'
import type { AgentOperation, PlanPoint, SceneNodes } from './types'

export type LayGroundKind = LotGroundKind

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
/** The most corners the record of a lot's ground keeps (`LotGround`). */
const MAX_LOT_POINTS = 256
const DEFAULT_FEATHER_M = 0.3
/** The collaboration layer's per-operation cap, stated next to the largest tile change as a fact. */
const COLLABORATION_CAP_BYTES = 65_536

type SignedDistance = (x: number, z: number) => number

type ResolvedShape = {
  signedDistance: SignedDistance
  /** Shape vertices and edges, for the off-lot check the paint lattice cannot make. */
  outline: PlanPoint[]
  closed: boolean
}

type ResolvedArea = ResolvedShape & {
  index: number
  /** The whole lot: its ground is the lot's ground (`lotGroundOf`). */
  site: boolean
  ground: LayGroundKind
  featherM: number
  grassHeight: number | null
  tint: RgbBytes | null
}

/** One painted map: as the scene has it, and the copy this call paints. */
type PaintedMap = {
  targetId: string
  map: PaintTileMap
  before: GrassPaintField
  after: GrassPaintField
}

/** The site's two paint layers as this call finds (or creates) them, and the maps it paints. */
type GroundLayers = {
  grassNode: GrassFieldNode
  grassCreated: boolean
  surfaceNode: SurfaceMaterialNode
  surfaceCreated: boolean
  paint: PaintedMap
  height: PaintedMap | null
  surface: PaintedMap
  obstacles: GrassObstacleField
}

type AreaFacts = {
  areaM2: number
  grassM2: number
  blockedM2: number
  paintedCells: number
  shapeCells: number
  excludedSteepM2: number
  nonSteepCells: number
  terrain: TerrainSamples
}

function resolveShape(
  area: LayGroundAreaInput,
  index: number,
  sitePolygon: PlanPoint[],
): ResolvedShape {
  const shapes = [area.polygon !== undefined, area.path !== undefined, area.site === true].filter(
    Boolean,
  ).length
  if (shapes !== 1) {
    refuse('invalid_polygon', `Area ${index} needs exactly one of polygon, path or site.`, {
      index,
    })
  }
  if (area.site === true) {
    return {
      signedDistance: (x, z) => signedDistanceToPolygon(x, z, sitePolygon),
      outline: sitePolygon,
      closed: true,
    }
  }
  if (area.path !== undefined) return resolvePathShape(area.path, index)
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

function resolvePathShape(
  path: NonNullable<LayGroundAreaInput['path']>,
  index: number,
): ResolvedShape {
  const points = asPolygon(path.points)
  if (!points || points.length < 2 || !(path.widthM > 0)) {
    refuse('invalid_polygon', `Area ${index} has a malformed path.`, { index })
  }
  if (polylineLength(points) <= 1e-9) {
    refuse('path_too_short', `Area ${index}'s path has no length.`, { index })
  }
  const halfWidth = path.widthM / 2
  return {
    signedDistance: (x, z) => halfWidth - distanceToPolyline(x, z, points),
    outline: points,
    closed: false,
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

function resolveTint(area: LayGroundAreaInput, index: number): RgbBytes | null {
  if (area.tint === undefined) return null
  try {
    return hexToRgb(area.tint)
  } catch {
    refuse('invalid_tint', `Area ${index}'s tint is not a hex colour.`, { index })
  }
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
    return {
      index,
      site: area.site === true,
      ground: area.ground,
      // The whole lot has nothing outside it to blend into: a soft edge would fade its own border.
      featherM: Math.min(
        3,
        Math.max(0, area.featherM ?? (area.site === true ? 0 : DEFAULT_FEATHER_M)),
      ),
      grassHeight:
        area.grassHeight === undefined ? null : Math.min(2, Math.max(0.5, area.grassHeight)),
      tint: resolveTint(area, index),
      ...resolveShape(area, index, sitePolygon),
    }
  })
}

/** The site's own Ground cover and Surface, created as the panel creates them when missing. */
function resolveGroundLayers(
  nodes: SceneNodes,
  site: SiteNode,
  areas: readonly ResolvedArea[],
  terrain: TerrainField | null,
): GroundLayers {
  const bounds = siteBounds(site.polygon.points)
  const existingGrass = siteChildOfKind<GrassFieldNode>(nodes, String(site.id), GRASS_FIELD_KIND)
  const existingSurface = siteChildOfKind<SurfaceMaterialNode>(
    nodes,
    String(site.id),
    SURFACE_MATERIAL_KIND,
  )
  const grassNode = existingGrass ?? createGroundCoverNode(site)
  const surfaceNode = existingSurface ?? createSurfaceMaterialNode(site)
  const sceneNodes = Object.values(nodes)
  const painted = (targetId: string, map: PaintTileMap, before: GrassPaintField): PaintedMap => ({
    targetId,
    map,
    before,
    after: { ...before, values: new Uint8Array(before.values) },
  })
  return {
    grassNode,
    grassCreated: existingGrass === null,
    surfaceNode,
    surfaceCreated: existingSurface === null,
    paint: painted(
      grassNode.id,
      'paintMap',
      resolveGroundCoverPaint(grassNode, sceneNodes, bounds),
    ),
    height: areas.some((area) => area.grassHeight !== null)
      ? painted(grassNode.id, 'heightMap', resolveGroundCoverHeight(grassNode, sceneNodes, bounds))
      : null,
    surface: painted(
      surfaceNode.id,
      'paintMap',
      resolveSurfacePaint(surfaceNode, sceneNodes, bounds),
    ),
    // Water stands on the snapshot's ground, not on whatever scene is live where this runs.
    obstacles: buildGrassObstacleField(site, nodes, createGrassObstacleTopology(bounds), terrain),
  }
}

function strengthAt(area: ResolvedArea, x: number, z: number): number {
  const distance = area.signedDistance(x, z)
  if (area.featherM <= 0) return distance >= 0 ? 1 : 0
  return Math.min(1, Math.max(0, 0.5 + distance / area.featherM))
}

/**
 * Blend every lattice cell of `field` on the lot toward `blend`, by the area's strength there.
 * `allowed` skips cells the brush would skip (grass under buildings or water).
 */
function paintLayer(
  field: GrassPaintField,
  area: ResolvedArea,
  sitePolygon: PlanPoint[],
  blend: PaintCellBlend,
  allowed: (x: number, z: number) => boolean = () => true,
): void {
  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      if (!pointInPolygon(x, z, sitePolygon)) continue
      const amount = strengthAt(area, x, z)
      if (amount <= 0 || !allowed(x, z)) continue
      blendPaintCell(field.values, field.values, (row * field.cols + col) * 4, amount, blend)
    }
  }
}

/** The area's footprint facts, measured on the grass lattice. */
function measureArea(
  area: ResolvedArea,
  sitePolygon: PlanPoint[],
  lattice: GrassPaintField,
  obstacles: GrassObstacleField,
  terrain: TerrainField | null,
): AreaFacts {
  const cellM2 = lattice.spacing * lattice.spacing
  const facts: AreaFacts = {
    areaM2: 0, grassM2: 0, blockedM2: 0, paintedCells: 0, shapeCells: 0,
    excludedSteepM2: 0, nonSteepCells: 0, terrain: createTerrainSamples(),
  }
  for (let row = 0; row < lattice.rows; row += 1) {
    const z = lattice.origin[1] + row * lattice.spacing
    for (let col = 0; col < lattice.cols; col += 1) {
      const x = lattice.origin[0] + col * lattice.spacing
      const inside = area.signedDistance(x, z) >= 0
      if (inside) facts.shapeCells += 1
      if (!pointInPolygon(x, z, sitePolygon)) continue
      const allowed = isGrassAllowedAt(obstacles, x, z)
      if (inside) facts.areaM2 += cellM2
      if (inside && !allowed) facts.blockedM2 += cellM2
      const strength = strengthAt(area, x, z)
      if (strength <= 0) continue
      facts.paintedCells += 1
      const sample = samplePlantingTerrain(terrain, x, z)
      includeTerrainSample(facts.terrain, sample)
      const steep = area.ground === 'grass' && sample.slopeDeg >= PLANTING_MAX_SLOPE_DEG.grass
      if (steep) facts.excludedSteepM2 += strength * cellM2
      else facts.nonSteepCells += 1
      if (area.ground === 'grass' && allowed && !steep) facts.grassM2 += strength * cellM2
    }
  }
  return facts
}

function refuseUnpaintable(
  area: ResolvedArea,
  facts: AreaFacts,
  sitePolygon: PlanPoint[],
  cellM: number,
): void {
  if (facts.paintedCells > 0 && facts.nonSteepCells === 0) {
    refuse('slope_too_steep', `Area ${area.index} has no grass paint samples below the slope limit.`, {
      index: area.index,
      maxSlopeDeg: PLANTING_MAX_SLOPE_DEG.grass,
      excludedSteepM2: roundFact(facts.excludedSteepM2),
      terrain: terrainSampleFacts(facts.terrain, cellM, 'paint-lattice-points-in-brush'),
    })
  }
  if (facts.paintedCells > 0) return
  if (facts.shapeCells === 0 && !shapeOverlapsSite(area, sitePolygon)) {
    refuse('outside_property', `Area ${area.index} does not touch the lot.`, { index: area.index })
  }
  refuse('area_empty', `Area ${area.index} covers no paintable cell at this resolution.`, {
    index: area.index,
    cellM,
  })
}

/** Lay one area on every layer, in the order the brush tools would, and report its facts. */
function layArea(
  area: ResolvedArea,
  sitePolygon: PlanPoint[],
  layers: GroundLayers,
  terrain: TerrainField | null,
) {
  const facts = measureArea(area, sitePolygon, layers.paint.after, layers.obstacles, terrain)
  refuseUnpaintable(area, facts, sitePolygon, layers.paint.after.spacing)
  const slopeAllowed = (x: number, z: number) =>
    area.ground !== 'grass' ||
    samplePlantingTerrain(terrain, x, z).slopeDeg < PLANTING_MAX_SLOPE_DEG.grass
  paintLayer(layers.paint.after, area, sitePolygon, grassPaintBlend(area.ground, area.tint), (x, z) =>
    isGrassAllowedAt(layers.obstacles, x, z) && slopeAllowed(x, z),
  )
  paintLayer(layers.surface.after, area, sitePolygon, surfacePaintBlend(area.ground), slopeAllowed)
  if (layers.height && area.grassHeight !== null) {
    paintLayer(layers.height.after, area, sitePolygon, heightPaintBlend(area.grassHeight), slopeAllowed)
  }
  return {
    index: area.index,
    areaM2: roundFact(facts.areaM2),
    grassM2: roundFact(facts.grassM2),
    surface: GROUND_SURFACE[area.ground],
    blockedM2: roundFact(facts.blockedM2),
    excludedSteepM2: roundFact(facts.excludedSteepM2),
    terrain: terrainSampleFacts(facts.terrain, layers.paint.after.spacing, 'paint-lattice-points-in-brush'),
  }
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

/**
 * The painted layers as node changes: a missing Ground cover or Surface is created as the panel
 * creates it, only the tiles of each map that changed are written, and the lot's ground, when this
 * call laid the whole lot, goes on both nodes.
 */
function groundLayerChanges(
  nodes: SceneNodes,
  site: SiteNode,
  layers: GroundLayers,
  lotGround: LotGround | null,
): PaintTileChanges {
  const siteId = String(site.id)
  const sceneNodes = Object.values(nodes)
  const tileChanges = [layers.paint, layers.height, layers.surface]
    .filter((painted): painted is PaintedMap => painted !== null)
    .map((painted) =>
      planPaintTileChanges(
        { siteId, targetId: painted.targetId, map: painted.map },
        paintTilesOf(sceneNodes, painted.targetId, painted.map),
        painted.before,
        painted.after,
      ),
    )
  const withGround = <Node extends GrassFieldNode | SurfaceMaterialNode>(node: Node): Node =>
    lotGround ? { ...node, lotGround } : node
  const createdNodes = [
    ...(layers.grassCreated ? [withGround(layers.grassNode)] : []),
    ...(layers.surfaceCreated ? [withGround(layers.surfaceNode)] : []),
  ].map((node) => ({ node: node as unknown as AnyNode, parentId: site.id }))
  const groundedNodes = lotGround
    ? [
        ...(layers.grassCreated ? [] : [layers.grassNode]),
        ...(layers.surfaceCreated ? [] : [layers.surfaceNode]),
      ].map((node) => ({ id: node.id as AnyNodeId, data: { lotGround } as Partial<AnyNode> }))
    : []
  return mergePaintTileChanges(
    {
      ...(createdNodes.length > 0 ? { create: createdNodes } : {}),
      ...(groundedNodes.length > 0 ? { update: groundedNodes } : {}),
    },
    ...tileChanges,
  )
}

/**
 * The lot's ground, when this call laid the whole lot: the last whole-lot area's ground, over the
 * lot as it is now. Land the lot grows into later reads as it (`withLotGround`).
 */
function lotGroundOf(areas: readonly ResolvedArea[], sitePolygon: PlanPoint[]): LotGround | null {
  const whole = [...areas].reverse().find((area) => area.site)
  if (!whole || sitePolygon.length > MAX_LOT_POINTS) return null
  return {
    lot: sitePolygon.map(([x, z]) => [x, z]),
    ground: whole.ground,
    ...(whole.ground === 'grass' && whole.tint ? { tint: rgbToHex(whole.tint) } : {}),
    ...(whole.ground === 'grass' && whole.grassHeight !== null
      ? { grassHeight: whole.grassHeight }
      : {}),
  }
}

/** The lot's ground as the result states it: what land the lot grows into later reads as. */
function lotGroundFacts({ ground, tint, grassHeight }: LotGround) {
  return { ground, ...(tint ? { tint } : {}), ...(grassHeight !== undefined ? { grassHeight } : {}) }
}

/**
 * Each map as the lot's ground leaves it outside the lot: the cells at the old edge, which the
 * lot's own paint stops short of, hold the ground too, so no seam is left where the lot grows.
 */
function coverBeyondLot(layers: GroundLayers, lotGround: LotGround): void {
  paintBeyondLot(layers.paint.after, lotGround, 'paintMap')
  if (layers.height) paintBeyondLot(layers.height.after, lotGround, 'heightMap')
  paintBeyondLot(layers.surface.after, lotGround, 'surface')
}

/** How large the write is, tile by tile, next to the 64 KiB a shared operation may carry. */
function writeSizeFacts(nodes: SceneNodes, changes: PaintTileChanges) {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length
  const tileOf = (id: string) => (nodes[id] as { tile?: unknown } | undefined)?.tile
  const tileChanges = [
    ...(changes.create ?? [])
      .filter(({ node }) => String(node.type) === PAINT_TILE_KIND)
      .map(({ node }) => bytes(node)),
    ...(changes.update ?? []).map(({ id, data }) => bytes(tileOf(id)) + bytes(data)),
    ...(changes.delete ?? []).map((id) => bytes(nodes[id])),
  ]
  return {
    tilesChanged: tileChanges.length,
    largestTileChangeBytes: Math.max(0, ...tileChanges),
    changeBytes: bytes(changes),
    collaborationCapBytes: COLLABORATION_CAP_BYTES,
  }
}

export const layGround: AgentOperation<LayGroundInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const areas = resolveAreas(input, sitePolygon)
  const terrain = siteTerrainOf(site, nodes)
  const layers = resolveGroundLayers(nodes, site, areas, terrain)
  const areaFacts = areas.map((area) => layArea(area, sitePolygon, layers, terrain))
  const lotGround = lotGroundOf(areas, sitePolygon)
  if (lotGround) coverBeyondLot(layers, lotGround)
  const changes = groundLayerChanges(nodes, site, layers, lotGround)
  return {
    result: {
      areas: areaFacts,
      grassCoveragePct: roundFact(lotGrassCoveragePct(layers.paint.after, sitePolygon)),
      grassCellM: layers.paint.after.spacing,
      surfaceCellM: layers.surface.after.spacing,
      groundCoverCreated: layers.grassCreated,
      surfaceCreated: layers.surfaceCreated,
      ...(lotGround ? { lotGround: lotGroundFacts(lotGround) } : {}),
      ...writeSizeFacts(nodes, changes),
    },
    changes,
  }
}
