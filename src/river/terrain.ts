import {
  createTerrainField,
  decodeTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  quantize,
  sampleRangeOver,
  surfaceHeightAt,
  type HeightPatch,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import {
  sampleRoadAlignmentPoints,
  type RoadGeometryPoint,
} from '../surroundings/streetscape/road-network-geometry'
import type { RiverNode } from './schema'

const RIVER_TERRAIN_METADATA_KEY = 'environmentRiverTerrain'
const RIVER_TERRAIN_METADATA_VERSION = 1
const DEFAULT_SPACING = 0.5
const MAX_TERRAIN_SIDE = 257
export const RIVER_MAX_CENTERLINE_SEGMENTS = 384
const TERRAIN_TRIANGLE_REACH_FACTOR = Math.SQRT2
const EPSILON = 1e-9

type RiverTerrainMetadata = Readonly<{
  version: 1
  baseline: NonNullable<SiteNode['terrain']>
  applied: NonNullable<SiteNode['terrain']>
  riverIds: readonly string[] | null
  originalMetadata?: SiteNode['metadata']
}>

export type SampledRiverPoint = readonly [x: number, y: number, z: number]
export type SampledRiverPath = Readonly<{
  points: readonly SampledRiverPoint[]
  distances: readonly number[]
  length: number
  authoredStartDistance: number
  authoredEndDistance: number
}>

export type RiverTerrainResult = Readonly<{
  terrain: TerrainField
  terrainData: NonNullable<SiteNode['terrain']>
  metadata: SiteNode['metadata']
  patch: HeightPatch | null
}>

/**
 * Recover the river-free terrain represented by a Site. If the persisted field
 * changed since the last river pass, its quantized sample deltas are folded into
 * the baseline before it is returned. Live terrain overrides are deliberately
 * ignored so an authoring preview can never adopt its own excavation as source.
 */
export function riverTerrainBaseline(site: SiteNode): TerrainField | null {
  const current = persistedTerrainFieldOf(site)
  const tracked = readRiverTerrainMetadata(site.metadata)
  if (!tracked) return current

  const baseline = decodeTerrainField(tracked.baseline)
  const applied = decodeTerrainField(tracked.applied)
  if (!baseline || !applied) return current
  if (!current) return baseline
  if (!sameGrid(current, baseline) || !sameGrid(current, applied)) return current
  return reconcileExternalTerrainEdits(baseline, applied, current)
}

/** River ids represented by the Site's last applied excavation, when known. */
export function riverTerrainRiverIds(site: SiteNode): readonly string[] | null {
  return readRiverTerrainMetadata(site.metadata)?.riverIds ?? null
}

/**
 * Rebuild every river cut from one uncarved source. The returned Site metadata
 * records both that source and the exact applied result, allowing later sculpt
 * deltas to survive width/depth/path revisions without compounding excavation.
 */
export function rebuildRiverTerrain(
  site: SiteNode,
  rivers: readonly RiverNode[],
): RiverTerrainResult {
  const persisted = persistedTerrainFieldOf(site)
  const current = persisted ?? createSiteTerrainField(site)
  const tracked = readRiverTerrainMetadata(site.metadata)
  const baseline = recoverBaseline(current, tracked)
  const validRivers = [...rivers]
    .filter((river) => river.parentId === site.id && river.points.length >= 2)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))

  const terrain =
    validRivers.length === 0
      ? baseline
      : carveRiverTerrain(baseline, site.polygon.points, validRivers)
  const terrainData = encodeTerrainField(terrain)
  const siteMetadata = site.metadata
  const metadataIsObject =
    siteMetadata !== null && typeof siteMetadata === 'object' && !Array.isArray(siteMetadata)
  const metadata: Record<string, SiteNode['metadata']> = metadataIsObject ? { ...siteMetadata } : {}
  const originalMetadata =
    tracked?.originalMetadata !== undefined
      ? tracked.originalMetadata
      : metadataIsObject
        ? undefined
        : site.metadata
  if (validRivers.length === 0) {
    delete metadata[RIVER_TERRAIN_METADATA_KEY]
  } else {
    metadata[RIVER_TERRAIN_METADATA_KEY] = {
      version: RIVER_TERRAIN_METADATA_VERSION,
      baseline: encodeTerrainField(baseline),
      applied: terrainData,
      riverIds: validRivers.map((river) => String(river.id)),
      ...(originalMetadata === undefined ? {} : { originalMetadata }),
    } satisfies RiverTerrainMetadata
  }

  return {
    terrain,
    terrainData,
    metadata:
      validRivers.length === 0 &&
      Object.keys(metadata).length === 0 &&
      originalMetadata !== undefined
        ? originalMetadata
        : metadata,
    patch: diffHeightPatch(current, terrain),
  }
}

/** The exact spline samples shared by terrain excavation and every river representation. */
export function sampleRiverPath(
  terrain: TerrainField,
  river: RiverNode,
  boundary?: readonly (readonly [number, number])[],
): SampledRiverPath | null {
  const authored = sanitizePoints(river.points)
  if (authored.length < 2) return null
  const authoredLength = polylineLength(authored)
  if (authoredLength <= EPSILON) return null

  const halfWidth = river.width * 0.5
  const sourceExtension = endpointExtension(
    authored,
    true,
    river.source === 'mountain',
    halfWidth,
    boundary,
  )
  const outletExtension = endpointExtension(
    authored,
    false,
    river.outlet === 'sea',
    halfWidth,
    boundary,
  )
  const desiredSpacing = Math.max(0.35, terrain.spacing * 0.75)
  const sectionLengths = [sourceExtension.length, authoredLength, outletExtension.length] as const
  const minimumSegments = [
    sourceExtension.length > EPSILON ? (river.source === 'rounded' ? 3 : 1) : 0,
    authored.length - 1,
    outletExtension.length > EPSILON ? (river.outlet === 'rounded' ? 3 : 1) : 0,
  ] as const
  const effectiveLength = sectionLengths[0] + sectionLengths[1] + sectionLengths[2]
  const targetSegments = Math.min(
    RIVER_MAX_CENTERLINE_SEGMENTS,
    Math.max(
      8,
      minimumSegments[0] + minimumSegments[1] + minimumSegments[2],
      Math.ceil(effectiveLength / desiredSpacing),
    ),
  )
  const [sourceSegments, authoredSegments, outletSegments] = allocateSectionSegments(
    sectionLengths,
    minimumSegments,
    targetSegments,
  )
  const roadPoints = authored.map(
    ([x, z]): RoadGeometryPoint => [x, surfaceHeightAt(terrain, x, z), z],
  )
  const spanCount = authored.length - 1
  const cappedCurveSegments = Math.max(
    spanCount,
    Math.floor(authoredSegments / spanCount) * spanCount,
  )
  const alignmentSamples = sampleRoadAlignmentPoints(
    roadPoints[0]!,
    roadPoints.slice(1, -1),
    roadPoints.at(-1)!,
    cappedCurveSegments,
  )
  const authoredSamples =
    alignmentSamples.length === 2
      ? subdivideStraightAlignment(alignmentSamples[0]!, alignmentSamples[1]!, authoredSegments)
      : alignmentSamples
  const sourceSamples =
    sourceSegments > 0
      ? subdivideStraightAlignment(
          [
            sourceExtension.point[0],
            surfaceHeightAt(terrain, sourceExtension.point[0], sourceExtension.point[1]),
            sourceExtension.point[1],
          ],
          roadPoints[0]!,
          sourceSegments,
        )
      : []
  const outletSamples =
    outletSegments > 0
      ? subdivideStraightAlignment(
          roadPoints.at(-1)!,
          [
            outletExtension.point[0],
            surfaceHeightAt(terrain, outletExtension.point[0], outletExtension.point[1]),
            outletExtension.point[1],
          ],
          outletSegments,
        )
      : []
  const sourcePrefix = sourceSamples.slice(0, -1)
  const sampled = [...sourcePrefix, ...authoredSamples, ...outletSamples.slice(1)]
  const authoredStartIndex = sourcePrefix.length
  const authoredEndIndex = authoredStartIndex + authoredSamples.length - 1
  const points: SampledRiverPoint[] = []
  let normalizedAuthoredStartIndex = 0
  let normalizedAuthoredEndIndex = 0
  for (let index = 0; index < sampled.length; index += 1) {
    const point = sampled[index]!
    const candidate = [point[0], surfaceHeightAt(terrain, point[0], point[2]), point[2]] as const
    const previous = points.at(-1)
    if (!previous || Math.hypot(candidate[0] - previous[0], candidate[2] - previous[2]) > 1e-6) {
      points.push(candidate)
    }
    if (index === authoredStartIndex) normalizedAuthoredStartIndex = points.length - 1
    if (index === authoredEndIndex) normalizedAuthoredEndIndex = points.length - 1
  }
  if (points.length < 2) return null

  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    distances.push(
      distances[index - 1]! + Math.hypot(point[0] - previous[0], point[2] - previous[2]),
    )
  }
  const length = distances.at(-1) ?? 0
  return length > EPSILON
    ? {
        points,
        distances,
        length,
        authoredStartDistance: distances[normalizedAuthoredStartIndex] ?? 0,
        authoredEndDistance: distances[normalizedAuthoredEndIndex] ?? length,
      }
    : null
}

/** Shared longitudinal width profile: compact semicircle caps, full-width connected ends. */
export function riverPathWidthScale(
  path: SampledRiverPath,
  river: RiverNode,
  distance: number,
): number {
  if (distance < path.authoredStartDistance && river.source === 'rounded') {
    return roundedCapScale(path.authoredStartDistance - distance, path.authoredStartDistance)
  }
  if (distance > path.authoredEndDistance && river.outlet === 'rounded') {
    return roundedCapScale(
      distance - path.authoredEndDistance,
      path.length - path.authoredEndDistance,
    )
  }
  return 1
}

/** Keeps river water consistently below its uncarved centerline. */
export function riverSurfaceInset(depth: number): number {
  return Math.min(0.14, Math.max(0.025, depth * 0.12))
}

function roundedCapScale(distanceFromAuthoredEnd: number, capLength: number): number {
  if (capLength <= EPSILON) return 1
  const normalized = clamp01(distanceFromAuthoredEnd / capLength)
  return Math.sqrt(Math.max(0, 1 - normalized * normalized))
}

function allocateSectionSegments(
  lengths: readonly [number, number, number],
  minimums: readonly [number, number, number],
  target: number,
): [number, number, number] {
  const counts: [number, number, number] = [...minimums]
  for (let remaining = target - counts[0] - counts[1] - counts[2]; remaining > 0; remaining -= 1) {
    let best = 0
    for (let index = 1; index < lengths.length; index += 1) {
      if (lengths[index]! / (counts[index]! + 1) > lengths[best]! / (counts[best]! + 1)) {
        best = index
      }
    }
    counts[best] = (counts[best] ?? 0) + 1
  }
  return counts
}

function endpointExtension(
  authored: readonly (readonly [number, number])[],
  start: boolean,
  connected: boolean,
  roundedLength: number,
  boundary?: readonly (readonly [number, number])[],
): Readonly<{ point: readonly [number, number]; length: number }> {
  const endpoint = start ? authored[0]! : authored.at(-1)!
  const neighbor = start ? authored[1]! : authored.at(-2)!
  let directionX = endpoint[0] - neighbor[0]
  let directionZ = endpoint[1] - neighbor[1]
  const directionLength = Math.hypot(directionX, directionZ)
  if (directionLength <= EPSILON) return { point: endpoint, length: 0 }
  directionX /= directionLength
  directionZ /= directionLength
  const length = connected
    ? firstBoundaryIntersectionDistance(endpoint, directionX, directionZ, boundary)
    : roundedLength
  if (length === null || length <= EPSILON) return { point: endpoint, length: 0 }
  return {
    point: [endpoint[0] + directionX * length, endpoint[1] + directionZ * length],
    length,
  }
}

function firstBoundaryIntersectionDistance(
  origin: readonly [number, number],
  directionX: number,
  directionZ: number,
  boundary?: readonly (readonly [number, number])[],
): number | null {
  if (!boundary || boundary.length < 3) return null
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!
    const end = boundary[(index + 1) % boundary.length]!
    if (pointOnSegment(start, end, origin[0], origin[1])) return 0
  }
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!
    const end = boundary[(index + 1) % boundary.length]!
    const edgeX = end[0] - start[0]
    const edgeZ = end[1] - start[1]
    const denominator = directionX * edgeZ - directionZ * edgeX
    if (Math.abs(denominator) <= EPSILON) continue
    const offsetX = start[0] - origin[0]
    const offsetZ = start[1] - origin[1]
    const distance = (offsetX * edgeZ - offsetZ * edgeX) / denominator
    const edgeAmount = (offsetX * directionZ - offsetZ * directionX) / denominator
    if (
      distance >= -EPSILON &&
      edgeAmount >= -EPSILON &&
      edgeAmount <= 1 + EPSILON &&
      distance < nearest
    ) {
      nearest = Math.max(0, distance)
    }
  }
  return Number.isFinite(nearest) ? nearest : null
}

function subdivideStraightAlignment(
  start: RoadGeometryPoint,
  end: RoadGeometryPoint,
  segments: number,
): RoadGeometryPoint[] {
  const points: RoadGeometryPoint[] = []
  for (let index = 0; index <= segments; index += 1) {
    const amount = index / segments
    points.push([
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ])
  }
  return points
}
function carveRiverTerrain(
  baseline: TerrainField,
  boundary: readonly (readonly [number, number])[],
  rivers: readonly RiverNode[],
): TerrainField {
  const paths = rivers
    .map((river) => ({ river, path: sampleRiverPath(baseline, river, boundary) }))
    .filter((entry): entry is { river: RiverNode; path: SampledRiverPath } => entry.path !== null)
  if (paths.length === 0 || boundary.length < 3) return baseline

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const { river, path } of paths) {
    // A rendered terrain triangle can cross the water even when none of its
    // vertices lies inside the analytic ribbon. Include every grid vertex that
    // can support a triangle beneath the river; the water itself keeps the
    // authored bank and cap outline.
    const margin = river.width * 0.5 + baseline.spacing * TERRAIN_TRIANGLE_REACH_FACTOR
    for (const point of path.points) {
      minX = Math.min(minX, point[0] - margin)
      minZ = Math.min(minZ, point[2] - margin)
      maxX = Math.max(maxX, point[0] + margin)
      maxZ = Math.max(maxZ, point[2] + margin)
    }
  }
  const range = sampleRangeOver(baseline, minX, minZ, maxX, maxZ)
  if (!range) return baseline

  let heights: Int16Array | null = null
  for (let row = range.row0; row <= range.row1; row += 1) {
    const z = baseline.origin[1] + row * baseline.spacing
    for (let col = range.col0; col <= range.col1; col += 1) {
      const x = baseline.origin[0] + col * baseline.spacing
      if (!pointInPolygon(boundary, x, z)) continue
      const sampleIndex = row * baseline.cols + col
      const original = baseline.heights[sampleIndex] ?? 0
      let target = original
      for (const { river, path } of paths) {
        target = Math.min(target, riverTargetHeight(baseline, path, river, x, z))
      }
      if (target !== original) {
        heights ??= new Int16Array(baseline.heights)
        heights[sampleIndex] = target
      }
    }
  }
  return heights ? { ...baseline, heights } : baseline
}

function riverTargetHeight(
  terrain: TerrainField,
  path: SampledRiverPath,
  river: RiverNode,
  x: number,
  z: number,
): number {
  const halfWidth = river.width * 0.5
  const vertexReach = terrain.spacing * TERRAIN_TRIANGLE_REACH_FACTOR
  let best = Number.POSITIVE_INFINITY

  for (let index = 1; index < path.points.length; index += 1) {
    const start = path.points[index - 1]!
    const end = path.points[index]!
    const dx = end[0] - start[0]
    const dz = end[2] - start[2]
    const segmentLengthSquared = dx * dx + dz * dz
    if (segmentLengthSquared <= EPSILON) continue
    const projected = ((x - start[0]) * dx + (z - start[2]) * dz) / segmentLengthSquared
    const amount = clamp01(projected)
    const nearestX = start[0] + dx * amount
    const nearestZ = start[2] + dz * amount
    const segmentLength = Math.sqrt(segmentLengthSquared)
    const along = path.distances[index - 1]! + segmentLength * amount
    const capCenter =
      river.source === 'rounded' && along < path.authoredStartDistance
        ? river.points[0]
        : river.outlet === 'rounded' && along > path.authoredEndDistance
          ? river.points.at(-1)
          : undefined
    if (capCenter && Math.hypot(x - capCenter[0], z - capCenter[1]) > halfWidth + vertexReach) {
      continue
    }
    // At a rounded tip the analytic width reaches zero. Move no farther than
    // one terrain-triangle reach toward the authored path so the vertices of
    // the final triangle are still excavated beneath the compact cap.
    const supportedAlong =
      along < path.authoredStartDistance
        ? Math.min(path.authoredStartDistance, along + vertexReach)
        : along > path.authoredEndDistance
          ? Math.max(path.authoredEndDistance, along - vertexReach)
          : along
    const localHalfWidth = halfWidth * riverPathWidthScale(path, river, supportedAlong)
    if (localHalfWidth <= EPSILON) continue
    const lateralDistance = Math.hypot(x - nearestX, z - nearestZ)
    // A point on a native terrain triangle can be up to √2 grid spacings from
    // any of its vertices. Eroding that distance here guarantees every vertex
    // influencing the visible ribbon receives at least the point's intended
    // cross-section cut, instead of leaving a raised corner to form a spike.
    const representedLateralDistance = Math.max(0, lateralDistance - vertexReach)
    if (representedLateralDistance >= localHalfWidth) continue
    const normalizedLateral = representedLateralDistance / localHalfWidth
    const crossSection = riverCrossSection(normalizedLateral)
    if (crossSection <= 0) continue
    const centerHeight = start[1] + (end[1] - start[1]) * amount
    const targetMetres = centerHeight - river.depth * crossSection
    best = Math.min(best, quantize(terrain, targetMetres))
  }
  return best
}

/** Rounded flat bed through 42% of the half-width, then smooth graded banks. */
export function riverCrossSection(normalizedLateralDistance: number): number {
  const distance = Math.abs(normalizedLateralDistance)
  if (distance >= 1) return 0
  if (distance <= 0.42) {
    const normalizedBed = distance / 0.42
    return 1 - 0.06 * normalizedBed * normalizedBed
  }
  return 0.94 * (1 - smoothstep(0.42, 1, distance))
}

function recoverBaseline(
  current: TerrainField,
  tracked: RiverTerrainMetadata | null,
): TerrainField {
  if (!tracked) return current
  const baseline = decodeTerrainField(tracked.baseline)
  const applied = decodeTerrainField(tracked.applied)
  if (!baseline || !applied) return current
  if (!sameGrid(current, baseline) || !sameGrid(current, applied)) return current
  return reconcileExternalTerrainEdits(baseline, applied, current)
}

function reconcileExternalTerrainEdits(
  baseline: TerrainField,
  applied: TerrainField,
  current: TerrainField,
): TerrainField {
  let heights: Int16Array | null = null
  for (let index = 0; index < current.heights.length; index += 1) {
    const delta = (current.heights[index] ?? 0) - (applied.heights[index] ?? 0)
    if (delta === 0) continue
    heights ??= new Int16Array(baseline.heights)
    heights[index] = clampInt16((baseline.heights[index] ?? 0) + delta)
  }
  return heights ? { ...baseline, heights } : baseline
}

function readRiverTerrainMetadata(metadata: SiteNode['metadata']): RiverTerrainMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = metadata[RIVER_TERRAIN_METADATA_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value
  if (record.version !== RIVER_TERRAIN_METADATA_VERSION) return null
  const baseline = decodeTerrainField(record.baseline)
  const applied = decodeTerrainField(record.applied)
  if (!baseline || !applied) return null
  const riverIds =
    Array.isArray(record.riverIds) &&
    record.riverIds.every((id): id is string => typeof id === 'string')
      ? [...new Set(record.riverIds)].sort()
      : null
  return {
    version: RIVER_TERRAIN_METADATA_VERSION,
    baseline: encodeTerrainField(baseline),
    applied: encodeTerrainField(applied),
    riverIds,
    ...(record.originalMetadata === undefined ? {} : { originalMetadata: record.originalMetadata }),
  }
}

function createSiteTerrainField(site: SiteNode): TerrainField {
  const finite = site.polygon.points.filter(
    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
  )
  if (finite.length === 0) return createTerrainField()
  const minX = Math.min(...finite.map((point) => point[0]))
  const minZ = Math.min(...finite.map((point) => point[1]))
  const maxX = Math.max(...finite.map((point) => point[0]))
  const maxZ = Math.max(...finite.map((point) => point[1]))
  const width = Math.max(DEFAULT_SPACING, maxX - minX)
  const depth = Math.max(DEFAULT_SPACING, maxZ - minZ)
  const spacing = Math.max(
    DEFAULT_SPACING,
    width / (MAX_TERRAIN_SIDE - 1),
    depth / (MAX_TERRAIN_SIDE - 1),
  )
  return createTerrainField({
    origin: [minX, minZ],
    spacing,
    cols: Math.max(2, Math.min(MAX_TERRAIN_SIDE, Math.ceil(width / spacing) + 1)),
    rows: Math.max(2, Math.min(MAX_TERRAIN_SIDE, Math.ceil(depth / spacing) + 1)),
  })
}

function diffHeightPatch(before: TerrainField, after: TerrainField): HeightPatch | null {
  if (!sameGrid(before, after)) {
    return {
      col0: 0,
      row0: 0,
      cols: after.cols,
      rows: after.rows,
      heights: new Int16Array(after.heights),
    }
  }
  let col0 = after.cols
  let row0 = after.rows
  let col1 = -1
  let row1 = -1
  for (let row = 0; row < after.rows; row += 1) {
    const base = row * after.cols
    for (let col = 0; col < after.cols; col += 1) {
      const index = base + col
      if (before.heights[index] === after.heights[index]) continue
      col0 = Math.min(col0, col)
      row0 = Math.min(row0, row)
      col1 = Math.max(col1, col)
      row1 = Math.max(row1, row)
    }
  }
  if (col1 < col0 || row1 < row0) return null
  const cols = col1 - col0 + 1
  const rows = row1 - row0 + 1
  const heights = new Int16Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    const sourceOffset = (row0 + row) * after.cols + col0
    heights.set(after.heights.subarray(sourceOffset, sourceOffset + cols), row * cols)
  }
  return { col0, row0, cols, rows, heights }
}

function sameGrid(left: TerrainField, right: TerrainField): boolean {
  return (
    left.cols === right.cols &&
    left.rows === right.rows &&
    left.spacing === right.spacing &&
    left.step === right.step &&
    left.origin[0] === right.origin[0] &&
    left.origin[1] === right.origin[1]
  )
}

function sanitizePoints(
  points: readonly (readonly [number, number])[],
): Array<readonly [number, number]> {
  const sanitized: Array<readonly [number, number]> = []
  for (const point of points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    const previous = sanitized.at(-1)
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6) {
      sanitized.push([point[0], point[1]])
    }
  }
  return sanitized
}

function polylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index]![0] - points[index - 1]![0],
      points[index]![1] - points[index - 1]![1],
    )
  }
  return length
}

function pointInPolygon(
  boundary: readonly (readonly [number, number])[],
  x: number,
  z: number,
): boolean {
  let inside = false
  for (
    let index = 0, previousIndex = boundary.length - 1;
    index < boundary.length;
    previousIndex = index, index += 1
  ) {
    const start = boundary[previousIndex]!
    const end = boundary[index]!
    if (pointOnSegment(start, end, x, z)) return true
    if (end[1] > z !== start[1] > z) {
      const crossingX = end[0] + ((z - end[1]) * (start[0] - end[0])) / (start[1] - end[1])
      if (x < crossingX) inside = !inside
    }
  }
  return inside
}

function pointOnSegment(
  start: readonly [number, number],
  end: readonly [number, number],
  x: number,
  z: number,
): boolean {
  const cross = (x - start[0]) * (end[1] - start[1]) - (z - start[1]) * (end[0] - start[0])
  if (Math.abs(cross) > 1e-7) return false
  return (
    x >= Math.min(start[0], end[0]) - 1e-7 &&
    x <= Math.max(start[0], end[0]) + 1e-7 &&
    z >= Math.min(start[1], end[1]) - 1e-7 &&
    z <= Math.max(start[1], end[1]) + 1e-7
  )
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = clamp01((value - start) / (end - start))
  return amount * amount * (3 - 2 * amount)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value))
}
