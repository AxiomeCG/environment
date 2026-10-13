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
import {
  asDrawnProfile,
  resolvePointValues,
  riverSectionDepthM,
  riverSectionShape,
  riverSectionTargetHeight,
  riverSurfaceInset,
  solveDownhillProfile,
  type RiverFacts,
  type RiverProfileStation,
} from './planner'
import type { RiverNode } from './schema'
import { channelSelfOverlapGapM } from './self-overlap'

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
  /** Hash of every grading-relevant river field, so reconciliation can tell an already-applied carve from a stale one without rebuilding. */
  fingerprint?: string
  originalMetadata?: SiteNode['metadata']
}>

export { riverSurfaceInset } from './planner'
export type { RiverFacts } from './planner'

export type SampledRiverPoint = readonly [x: number, y: number, z: number]
export type SampledRiverPath = Readonly<{
  points: readonly SampledRiverPoint[]
  distances: readonly number[]
  length: number
  authoredStartDistance: number
  authoredEndDistance: number
  /** Indexes of the samples at the first and last authored points. */
  authoredStartIndex: number
  authoredEndIndex: number
  /**
   * Station of each sample along the authored polyline, taken from the spline
   * span it was sampled on (caps clamp to the nearest authored end). Per-point
   * sizes interpolate on these stations, so a reach keeps its own width and
   * depth where the path crosses itself or closes into a loop.
   */
  authoredStations: readonly number[]
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

/** The river-free terrain a carve of this Site starts from; flat when the Site has none yet. */
export function riverSourceTerrain(site: SiteNode): TerrainField {
  return riverTerrainBaseline(site) ?? createSiteTerrainField(site)
}

/** River ids represented by the Site's last applied excavation, when known. */
export function riverTerrainRiverIds(site: SiteNode): readonly string[] | null {
  return readRiverTerrainMetadata(site.metadata)?.riverIds ?? null
}

export type RiverTerrainGrid = Readonly<{
  cols: number
  rows: number
  spacing: number
  step: number
  origin: readonly [number, number]
}>

/**
 * Revision of the planner and carver, hashed into every applied-carve
 * fingerprint. A stamp written by an earlier revision therefore never passes
 * as applied: on load the Site is re-carved from the baseline that stamp
 * tracks, keeping later sculpts. Bump it whenever a change alters what any
 * river carves. Stamps written before revisions existed hashed none, so they
 * never match either.
 */
const RIVER_CARVE_REVISION = 2

/**
 * Stable hash of everything that changes a river's excavation: the carver
 * revision, the rivers' grading fields, the Site boundary, and the terrain
 * grid. The terrain stamp records it at apply time; RiverSystem compares it
 * against the live scene and skips its write entirely when the Site already
 * carries exactly this carve (an apply and a reconcile must be one history
 * entry, not two).
 */
export function riverTerrainFingerprint(
  rivers: readonly RiverNode[],
  boundary?: readonly (readonly [number, number])[],
  grid?: RiverTerrainGrid | null,
): string {
  const grading = [...rivers]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((river) => ({
      id: String(river.id),
      points: river.points,
      width: river.width,
      depth: river.depth,
      pointWidths: river.pointWidths,
      pointDepths: river.pointDepths,
      source: river.source,
      outlet: river.outlet,
      flow: river.flow,
      maxSlopePct: river.maxSlopePct,
      section: river.section,
      ends: river.ends,
    }))
  const gridKey = grid
    ? { cols: grid.cols, rows: grid.rows, spacing: grid.spacing, step: grid.step, origin: grid.origin }
    : null
  return hashString(
    JSON.stringify({
      revision: RIVER_CARVE_REVISION,
      grading,
      boundary: boundary ?? null,
      grid: gridKey,
    }),
  )
}

/**
 * True when the Site's terrain already carries the carve for exactly these
 * rivers, boundary, and grid — i.e. an apply already wrote it and a
 * reconciliation pass must not write (or record history) again. The persisted
 * terrain must still be the applied one: a sculpt since the apply leaves the
 * fingerprint intact but needs the river re-carved from the sculpted ground.
 */
export function riverTerrainIsApplied(site: SiteNode, rivers: readonly RiverNode[]): boolean {
  const tracked = readRiverTerrainMetadata(site.metadata)
  if (!tracked?.fingerprint || rivers.length === 0) return false
  const persisted = persistedTerrainFieldOf(site)
  const applied = decodeTerrainField(tracked.applied)
  if (!persisted || !applied || !sameHeights(persisted, applied)) return false
  return tracked.fingerprint === riverTerrainFingerprint(rivers, site.polygon.points, persisted)
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
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
  const metadata: Record<string, unknown> = metadataIsObject ? { ...siteMetadata } : {}
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
      fingerprint: riverTerrainFingerprint(validRivers, site.polygon.points, current),
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

/**
 * Size of the Site update one river apply writes, in UTF-8 bytes: the carved
 * terrain field plus the metadata stamp (which itself carries the baseline
 * and applied fields, so the terrain payload is stored roughly three times).
 * Kept as a measurable function until the terrain write moves to a delta codec.
 */
export function riverTerrainPayloadBytes(result: RiverTerrainResult): number {
  const payload = JSON.stringify({ terrain: result.terrainData, metadata: result.metadata })
  return new TextEncoder().encode(payload).length
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
  const { source, outlet } = riverExtensions(river, authored, boundary)
  const [sourceSegments, authoredSegments, outletSegments] = sectionSegmentCounts(
    terrain,
    river,
    authored.length - 1,
    [source.length, authoredLength, outlet.length],
  )
  const roadPoints = authored.map((point) => groundPoint(terrain, point))
  const first = roadPoints[0]
  const last = roadPoints.at(-1)
  if (!first || !last) return null
  const authoredSamples = authoredAlignmentSamples(roadPoints, first, last, authoredSegments)
  const sourcePrefix = straightSamples(groundPoint(terrain, source.point), first, sourceSegments)
    .slice(0, -1)
  const outletSuffix = straightSamples(last, groundPoint(terrain, outlet.point), outletSegments)
    .slice(1)
  return assembleSampledPath(terrain, {
    samples: [...sourcePrefix, ...authoredSamples, ...outletSuffix],
    stations: [
      ...sourcePrefix.map(() => 0),
      ...authoredSpanStations(authored, authoredSamples.length),
      ...outletSuffix.map(() => authoredLength),
    ],
    authoredStartIndex: sourcePrefix.length,
    authoredEndIndex: sourcePrefix.length + authoredSamples.length - 1,
  })
}

type RiverExtension = Readonly<{ point: readonly [number, number]; length: number }>

/**
 * How far each end runs past its authored point: to the Site boundary for a
 * connected end, half the end width for a cap (twice that for a fan).
 */
function riverExtensions(
  river: RiverNode,
  authored: readonly (readonly [number, number])[],
  boundary?: readonly (readonly [number, number])[],
): Readonly<{ source: RiverExtension; outlet: RiverExtension }> {
  const widths = sanitizedPointValues(river, river.pointWidths, river.width)
  return {
    source: endpointExtension(
      authored,
      true,
      river.source === 'mountain',
      (widths[0] ?? river.width) * 0.5,
      boundary,
    ),
    outlet: endpointExtension(
      authored,
      false,
      river.outlet === 'sea',
      // A fan gets a longer run-out so the widening, shallowing mouth can form.
      (widths.at(-1) ?? river.width) * 0.5 * (river.ends.end === 'fan' ? 2 : 1),
      boundary,
    ),
  }
}

/** Centreline segments for the source extension, the authored path and the outlet extension. */
function sectionSegmentCounts(
  terrain: TerrainField,
  river: RiverNode,
  spanCount: number,
  sectionLengths: readonly [number, number, number],
): [number, number, number] {
  const desiredSpacing = Math.max(0.35, terrain.spacing * 0.75)
  const minimumSegments = [
    sectionLengths[0] > EPSILON ? (river.source === 'rounded' ? 3 : 1) : 0,
    spanCount,
    sectionLengths[2] > EPSILON ? (river.outlet === 'rounded' ? 3 : 1) : 0,
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
  return allocateSectionSegments(sectionLengths, minimumSegments, targetSegments)
}

/** The spline through the authored points, or a uniform line for a two-point path. */
function authoredAlignmentSamples(
  roadPoints: readonly RoadGeometryPoint[],
  first: RoadGeometryPoint,
  last: RoadGeometryPoint,
  authoredSegments: number,
): RoadGeometryPoint[] {
  const spanCount = roadPoints.length - 1
  const cappedCurveSegments = Math.max(
    spanCount,
    Math.floor(authoredSegments / spanCount) * spanCount,
  )
  const alignmentSamples = sampleRoadAlignmentPoints(
    first,
    roadPoints.slice(1, -1),
    last,
    cappedCurveSegments,
  )
  const [alignmentStart, alignmentEnd] = alignmentSamples
  return alignmentSamples.length === 2 && alignmentStart && alignmentEnd
    ? subdivideStraightAlignment(alignmentStart, alignmentEnd, authoredSegments)
    : alignmentSamples
}

function straightSamples(
  start: RoadGeometryPoint,
  end: RoadGeometryPoint,
  segments: number,
): RoadGeometryPoint[] {
  return segments > 0 ? subdivideStraightAlignment(start, end, segments) : []
}

function groundPoint(terrain: TerrainField, point: readonly [number, number]): RoadGeometryPoint {
  return [point[0], surfaceHeightAt(terrain, point[0], point[1]), point[1]]
}

/**
 * Drop coincident samples, set each on the terrain, and measure the path,
 * keeping the authored ends and every sample's authored station.
 */
function assembleSampledPath(
  terrain: TerrainField,
  sampled: Readonly<{
    samples: readonly RoadGeometryPoint[]
    stations: readonly number[]
    authoredStartIndex: number
    authoredEndIndex: number
  }>,
): SampledRiverPath | null {
  const points: SampledRiverPoint[] = []
  const authoredStations: number[] = []
  let authoredStartIndex = 0
  let authoredEndIndex = 0
  sampled.samples.forEach((point, index) => {
    const candidate = [point[0], surfaceHeightAt(terrain, point[0], point[2]), point[2]] as const
    const previous = points.at(-1)
    if (!previous || Math.hypot(candidate[0] - previous[0], candidate[2] - previous[2]) > 1e-6) {
      points.push(candidate)
      authoredStations.push(sampled.stations[index] ?? 0)
    }
    if (index === sampled.authoredStartIndex) authoredStartIndex = points.length - 1
    if (index === sampled.authoredEndIndex) authoredEndIndex = points.length - 1
  })
  if (points.length < 2) return null
  const distances = cumulativeLengths(points.map((point) => [point[0], point[2]] as const))
  const length = distances.at(-1) ?? 0
  if (length <= EPSILON) return null
  return {
    points,
    distances,
    length,
    authoredStartDistance: distances[authoredStartIndex] ?? 0,
    authoredEndDistance: distances[authoredEndIndex] ?? length,
    authoredStartIndex,
    authoredEndIndex,
    authoredStations,
  }
}

/**
 * Authored-polyline station of each spline sample. The alignment sampler is
 * uniform in the span parameter and gives every authored span the same number
 * of segments (a two-point path is subdivided uniformly), so a sample's span
 * and in-span fraction follow from its index alone.
 */
function authoredSpanStations(
  authored: readonly (readonly [number, number])[],
  sampleCount: number,
): number[] {
  const cumulative = cumulativeLengths(authored)
  const spanCount = authored.length - 1
  const segmentCount = Math.max(1, sampleCount - 1)
  return Array.from({ length: sampleCount }, (_, index) => {
    const spanPosition = (index / segmentCount) * spanCount
    const span = Math.min(spanCount - 1, Math.floor(spanPosition))
    const spanStart = cumulative[span] ?? 0
    const spanEnd = cumulative[span + 1] ?? spanStart
    return lerp(spanStart, spanEnd, spanPosition - span)
  })
}

/**
 * Shared longitudinal width profile at the caps: each end kind scales the
 * width through its extension (`rounded` is the original semicircle, `taper`
 * a narrower cone, `spring` emerges narrow, `fan` widens); connected ends
 * stay full-width to the boundary.
 */
export function riverPathWidthScale(
  path: SampledRiverPath,
  river: RiverNode,
  distance: number,
): number {
  if (distance < path.authoredStartDistance && river.source === 'rounded') {
    return capWidthScale(
      river.ends.start,
      path.authoredStartDistance - distance,
      path.authoredStartDistance,
    )
  }
  if (distance > path.authoredEndDistance && river.outlet === 'rounded') {
    return capWidthScale(
      river.ends.end,
      distance - path.authoredEndDistance,
      path.length - path.authoredEndDistance,
    )
  }
  return 1
}

/** Longitudinal depth profile at the caps: springs and fans shallow toward their tip. */
export function riverPathDepthScale(
  path: SampledRiverPath,
  river: RiverNode,
  distance: number,
): number {
  if (distance < path.authoredStartDistance && river.source === 'rounded') {
    const normalized = capAmount(path.authoredStartDistance - distance, path.authoredStartDistance)
    return river.ends.start === 'spring' ? 1 - 0.75 * normalized : 1
  }
  if (distance > path.authoredEndDistance && river.outlet === 'rounded') {
    const normalized = capAmount(
      distance - path.authoredEndDistance,
      path.length - path.authoredEndDistance,
    )
    return river.ends.end === 'fan' ? 1 - 0.75 * normalized : 1
  }
  return 1
}

function capAmount(distanceFromAuthoredEnd: number, capLength: number): number {
  return capLength <= EPSILON ? 0 : clamp01(distanceFromAuthoredEnd / capLength)
}

function capWidthScale(
  end: RiverNode['ends']['start'] | RiverNode['ends']['end'],
  distanceFromAuthoredEnd: number,
  capLength: number,
): number {
  const normalized = capAmount(distanceFromAuthoredEnd, capLength)
  switch (end) {
    case 'taper':
      return Math.cos(normalized * Math.PI * 0.5)
    case 'spring':
      return (1 - normalized) * 0.6
    case 'fan':
      return 1 + normalized * 1.2
    default:
      return Math.sqrt(Math.max(0, 1 - normalized * normalized))
  }
}

/** Per-point values resolved against the authored points, thinned exactly like `sanitizePoints`. */
function sanitizedPointValues(
  river: RiverNode,
  overrides: readonly (number | null)[],
  fallback: number,
): number[] {
  const resolved = resolvePointValues(river.points.length, overrides, fallback)
  const values: number[] = []
  let previous: readonly [number, number] | undefined
  for (let index = 0; index < river.points.length; index += 1) {
    const point = river.points[index]!
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6) {
      values.push(resolved[index] ?? fallback)
      previous = point
    }
  }
  return values
}

/** Per-point sizes resolved at their stations along the authored polyline. */
export type RiverAuthoredSizes = Readonly<{
  stationsM: readonly number[]
  widthsM: readonly number[]
  depthsM: readonly number[]
}>

function authoredSizesOf(river: RiverNode): RiverAuthoredSizes {
  return {
    stationsM: cumulativeLengths(sanitizePoints(river.points)),
    widthsM: sanitizedPointValues(river, river.pointWidths, river.width),
    depthsM: sanitizedPointValues(river, river.pointDepths, river.depth),
  }
}

/** Per-point values interpolated linearly at one authored station. */
function valueAtStation(
  stations: readonly number[],
  values: readonly number[],
  stationM: number,
): number {
  const first = values[0] ?? 0
  if (stationM <= 0) return first
  for (let index = 1; index < stations.length; index += 1) {
    const spanEnd = stations[index] ?? 0
    if (stationM > spanEnd) continue
    const spanStart = stations[index - 1] ?? 0
    const amount = spanEnd - spanStart <= EPSILON ? 0 : (stationM - spanStart) / (spanEnd - spanStart)
    const startValue = values[index - 1] ?? first
    return lerp(startValue, values[index] ?? startValue, amount)
  }
  return values.at(-1) ?? first
}

export type RiverPlanSample = Readonly<{
  distanceM: number
  groundY: number
  waterY: number
  /** Bank-top height (water level plus surface inset) the section is built from. */
  channelTopY: number
  widthM: number
  /** Depth the section reaches at its deepest line; the water is inset from this. */
  depthM: number
  /** How much shallower than authored the section had to be (a too-narrow trapezoid). */
  depthShortfallM: number
  slopePct: number
  embankmentM: number
  rapid: boolean
  /** Lateral shift of the deepest line toward the outside of a bend, metres. */
  bendShiftM: number
}>

/** Why a planned river is not built. */
export type RiverPlanRefusal = Readonly<{
  code: 'self_crossing'
  /** Water-level difference where the channel meets itself, metres. */
  levelGapM: number
  message: string
}>

export type RiverPlan = Readonly<{
  path: SampledRiverPath
  samples: readonly RiverPlanSample[]
  facts: RiverFacts
  /** True when the higher (upstream) end is the first authored point. */
  upstreamAtStart: boolean
  /** Greatest lateral distance from the centerline the earthworks can reach. */
  maxReachM: number
  /** Full (uncapped) widths at the authored ends, used to bound the cap discs. */
  authoredStartWidthM: number
  authoredEndWidthM: number
  /** Per-point sizes, so the carve can evaluate width and depth between samples exactly. */
  sizes: RiverAuthoredSizes
  /** Set when the river cannot be built as planned: it is then neither carved nor watered. */
  refusal: RiverPlanRefusal | null
}>

/**
 * The one river planner: sample the spline on the uncarved terrain, resolve
 * width/depth along it, solve the water profile, and measure the result.
 * The panel (facts), the terrain carve, and the water surface all consume
 * this plan, so what is reported is what gets built.
 */
export function planRiver(
  terrain: TerrainField,
  river: RiverNode,
  boundary?: readonly (readonly [number, number])[],
): RiverPlan | null {
  const path = sampleRiverPath(terrain, river, boundary)
  if (!path) return null
  const sizes = authoredSizesOf(river)
  const sections = path.distances.map((distance, index) =>
    plannedSection(river, path, sizes, distance, path.authoredStations[index] ?? 0),
  )
  const stations: RiverProfileStation[] = path.points.map((point, index) => ({
    distanceM: path.distances[index] ?? 0,
    groundY: point[1],
    depthM: sections[index]?.depthM ?? 0,
  }))
  const upstreamAtStart = upstreamIsAtStart(river, path, stations)
  const profile =
    river.flow === 'downhill'
      ? solveOrderedProfile(river, path, stations, upstreamAtStart)
      : asDrawnProfile(stations)
  const samples = profile.map((entry, index): RiverPlanSample => {
    const section = sections[index] ?? { widthM: 0, depthM: 0, depthShortfallM: 0 }
    return {
      ...entry,
      ...section,
      channelTopY: entry.waterY + riverSurfaceInset(section.depthM),
      bendShiftM: bendShiftAt(path, index, section.widthM * 0.5, river.section.bendAsymmetry),
    }
  })
  return {
    path,
    samples,
    facts: measureRiverFacts(terrain, river, path, samples),
    upstreamAtStart,
    maxReachM: Math.max(...samples.map((sample) => sectionReachM(river, sample))),
    authoredStartWidthM: samples[path.authoredStartIndex]?.widthM ?? river.width,
    authoredEndWidthM: samples[path.authoredEndIndex]?.widthM ?? river.width,
    sizes,
    refusal: river.flow === 'downhill' ? selfOverlapRefusal(path, samples) : null,
  }
}

type PlannedSection = Readonly<{ widthM: number; depthM: number; depthShortfallM: number }>

/**
 * Width and depth at one point of the path: per-point sizes at its authored
 * station, shaped by the cap profile, with the depth the section can reach.
 */
function plannedSection(
  river: RiverNode,
  path: SampledRiverPath,
  sizes: RiverAuthoredSizes,
  distanceM: number,
  stationM: number,
): PlannedSection {
  const widthM =
    valueAtStation(sizes.stationsM, sizes.widthsM, stationM) *
    riverPathWidthScale(path, river, distanceM)
  const authoredDepthM =
    valueAtStation(sizes.stationsM, sizes.depthsM, stationM) *
    riverPathDepthScale(path, river, distanceM)
  const depthM = riverSectionDepthM(river.section, widthM * 0.5, authoredDepthM)
  return { widthM, depthM, depthShortfallM: authoredDepthM - depthM }
}

/**
 * Connected ends pin the flow: a mountain source feeds the start and a sea
 * outlet drains the end, so both put upstream at the start. Otherwise the
 * higher authored end is upstream; cap tips beyond it never decide.
 */
function upstreamIsAtStart(
  river: RiverNode,
  path: SampledRiverPath,
  stations: readonly RiverProfileStation[],
): boolean {
  return (
    river.flow !== 'downhill' ||
    river.source === 'mountain' ||
    river.outlet === 'sea' ||
    (stations[path.authoredStartIndex]?.groundY ?? 0) >=
      (stations[path.authoredEndIndex]?.groundY ?? 0)
  )
}

/**
 * Solve from the upstream end, whichever way the path was drawn: the authored
 * end behind a cap, or the Site boundary where a mountain source enters.
 */
function solveOrderedProfile(
  river: RiverNode,
  path: SampledRiverPath,
  stations: readonly RiverProfileStation[],
  upstreamAtStart: boolean,
) {
  const { maxSlopePct } = river
  if (upstreamAtStart) {
    const sourceIndex = river.source === 'mountain' ? 0 : path.authoredStartIndex
    return solveDownhillProfile(stations, maxSlopePct, sourceIndex)
  }
  const total = stations.at(-1)?.distanceM ?? 0
  const reversed = [...stations].reverse().map((station) => ({
    ...station,
    distanceM: total - station.distanceM,
  }))
  return solveDownhillProfile(reversed, maxSlopePct, stations.length - 1 - path.authoredEndIndex)
    .reverse()
    .map((sample, index) => ({
      ...sample,
      distanceM: stations[index]?.distanceM ?? total - sample.distanceM,
      // Slope sign follows the authored direction, so report descent as negative here.
      slopePct: -sample.slopePct,
    }))
}

/**
 * Where a downhill river meets itself, both reaches must share one water
 * level; a larger difference than this would show as a step in the water.
 */
const SELF_OVERLAP_LEVEL_TOLERANCE_M = 0.05

/**
 * A downhill river whose channel meets itself at two water levels cannot be
 * one coherent surface. It is still planned, so its facts and refusal can be
 * shown, but it is not carved and has no water.
 */
function selfOverlapRefusal(
  path: SampledRiverPath,
  samples: readonly RiverPlanSample[],
): RiverPlanRefusal | null {
  const stations = samples.map((sample, index) => ({
    x: path.points[index]?.[0] ?? 0,
    z: path.points[index]?.[2] ?? 0,
    courseM: sample.distanceM,
    halfWidthM: sample.widthM * 0.5,
    waterY: sample.waterY,
  }))
  const levelGapM = channelSelfOverlapGapM(stations)
  if (levelGapM <= SELF_OVERLAP_LEVEL_TOLERANCE_M) return null
  return {
    code: 'self_crossing',
    levelGapM,
    message: `A downhill river cannot cross or touch itself at two water levels (${levelGapM.toFixed(2)} m apart). Move its reaches apart, or use the As drawn profile.`,
  }
}

function bendShiftAt(
  path: SampledRiverPath,
  index: number,
  halfWidthM: number,
  asymmetry: number,
): number {
  if (asymmetry <= 0 || index === 0 || index === path.points.length - 1) return 0
  const before = path.points[index - 1]
  const point = path.points[index]
  const after = path.points[index + 1]
  if (!before || !point || !after) return 0
  const inX = point[0] - before[0]
  const inZ = point[2] - before[2]
  const outX = after[0] - point[0]
  const outZ = after[2] - point[2]
  const inLength = Math.hypot(inX, inZ)
  const outLength = Math.hypot(outX, outZ)
  if (inLength <= EPSILON || outLength <= EPSILON) return 0
  // Signed curvature about +Y; positive bends the outside bank toward -normal.
  const sinTurn = (inZ * outX - inX * outZ) / (inLength * outLength)
  const curvature = sinTurn / Math.max(0.5, (inLength + outLength) * 0.5)
  const bendAmount = Math.max(-1, Math.min(1, curvature * halfWidthM))
  return bendAmount * asymmetry * 0.5 * halfWidthM
}

function sectionReachM(river: RiverNode, sample: RiverPlanSample): number {
  const channelReachM = sample.widthM * 0.5 + Math.abs(sample.bendShiftM)
  if (river.flow !== 'downhill') return channelReachM
  const { section } = river
  const bankRunM =
    section.bankSlope * Math.max(0, sample.groundY - sample.channelTopY + sample.depthM)
  return channelReachM + section.bermM + bankRunM + section.blendM
}

/**
 * Facts over the authored reach only. Its ends are samples of the path, so
 * every integrated segment lies wholly inside it; the caps are excluded.
 */
function measureRiverFacts(
  terrain: TerrainField,
  river: RiverNode,
  path: SampledRiverPath,
  samples: readonly RiverPlanSample[],
): RiverFacts {
  const authored = samples.slice(path.authoredStartIndex, path.authoredEndIndex + 1)
  const areas = authored.map((sample, offset) =>
    crossSectionAreas(terrain, river, path, path.authoredStartIndex + offset, sample),
  )
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let embankedLengthM = 0
  let rapidLengthM = 0
  for (let index = 1; index < authored.length; index += 1) {
    const start = authored[index - 1]
    const end = authored[index]
    const startArea = areas[index - 1]
    const endArea = areas[index]
    if (!start || !end || !startArea || !endArea) continue
    const segmentLengthM = end.distanceM - start.distanceM
    cutVolumeM3 += ((startArea.cutM2 + endArea.cutM2) / 2) * segmentLengthM
    fillVolumeM3 += ((startArea.fillM2 + endArea.fillM2) / 2) * segmentLengthM
    if (start.embankmentM > 0.05 || end.embankmentM > 0.05) embankedLengthM += segmentLengthM
    if (start.rapid || end.rapid) rapidLengthM += segmentLengthM
  }
  const first = authored[0]
  const last = authored.at(-1)
  const lengthM = Math.max(0, path.authoredEndDistance - path.authoredStartDistance)
  const dropM = first && last ? Math.abs(first.waterY - last.waterY) : 0
  return {
    lengthM,
    dropM,
    meanSlopePct: lengthM > EPSILON ? (dropM / lengthM) * 100 : 0,
    cutVolumeM3,
    fillVolumeM3,
    embankedLengthM,
    maxEmbankmentM: Math.max(0, ...authored.map((sample) => sample.embankmentM)),
    rapidLengthM,
    depthShortfallM: Math.max(0, ...authored.map((sample) => sample.depthShortfallM)),
  }
}


/** Cut/fill areas of one cross-section, sampled laterally across the uncarved ground. */
function crossSectionAreas(
  terrain: TerrainField,
  river: RiverNode,
  path: SampledRiverPath,
  index: number,
  sample: RiverPlanSample,
): { cutM2: number; fillM2: number } {
  const point = path.points[index]
  const before = path.points[Math.max(0, index - 1)]
  const after = path.points[Math.min(path.points.length - 1, index + 1)]
  if (!point || !before || !after) return { cutM2: 0, fillM2: 0 }
  let tangentX = after[0] - before[0]
  let tangentZ = after[2] - before[2]
  const tangentLength = Math.hypot(tangentX, tangentZ)
  if (tangentLength <= EPSILON) return { cutM2: 0, fillM2: 0 }
  tangentX /= tangentLength
  tangentZ /= tangentLength
  const reachM = sectionReachM(river, sample)
  const stepM = 0.5
  let cutM2 = 0
  let fillM2 = 0
  for (let lateralM = -reachM; lateralM <= reachM; lateralM += stepM) {
    const groundY = surfaceHeightAt(
      terrain,
      point[0] - tangentZ * lateralM,
      point[2] + tangentX * lateralM,
    )
    const target = plannedTargetAt(river, sample, lateralM, groundY)
    if (target === null) continue
    if (target < groundY) cutM2 += (groundY - target) * stepM
    else fillM2 += (target - groundY) * stepM
  }
  return { cutM2, fillM2 }
}

/** Target height the carve will impose at one lateral offset of a planned station. */
function plannedTargetAt(
  river: RiverNode,
  sample: RiverPlanSample,
  lateralM: number,
  groundY: number,
): number | null {
  const halfWidthM = sample.widthM * 0.5
  if (river.flow === 'downhill') {
    return riverSectionTargetHeight({
      lateralM,
      groundY,
      centerGroundY: sample.groundY,
      channelTopY: sample.channelTopY,
      depthM: sample.depthM,
      halfWidthM,
      bendShiftM: sample.bendShiftM,
      section: river.section,
    })
  }
  const shape = riverSectionShape(
    river.section.shape,
    lateralM - sample.bendShiftM,
    halfWidthM,
    sample.depthM,
    river.section.bankSlope,
  )
  if (shape <= 0) return null
  return Math.min(groundY, sample.groundY - sample.depthM * shape)
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
  const plans = rivers
    .map((river) => ({ river, plan: planRiver(baseline, river, boundary) }))
    .filter(
      (entry): entry is PlannedRiver => entry.plan !== null && entry.plan.refusal === null,
    )
  if (plans.length === 0 || boundary.length < 3) return baseline
  const range = carveRange(baseline, plans)
  if (!range) return baseline

  let heights: Int16Array | null = null
  for (let row = range.row0; row <= range.row1; row += 1) {
    const z = baseline.origin[1] + row * baseline.spacing
    for (let col = range.col0; col <= range.col1; col += 1) {
      const x = baseline.origin[0] + col * baseline.spacing
      if (!pointInPolygon(boundary, x, z)) continue
      const sampleIndex = row * baseline.cols + col
      const original = baseline.heights[sampleIndex] ?? 0
      const target = carvedHeight(baseline, plans, x, z, original)
      if (target !== original) {
        heights ??= new Int16Array(baseline.heights)
        heights[sampleIndex] = target
      }
    }
  }
  return heights ? { ...baseline, heights } : baseline
}

type PlannedRiver = Readonly<{ river: RiverNode; plan: RiverPlan }>

/** Grid samples the carve can touch: every river's reach around its path. */
function carveRange(baseline: TerrainField, plans: readonly PlannedRiver[]) {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const { plan } of plans) {
    // A rendered terrain triangle can cross the water even when none of its
    // vertices lies inside the analytic ribbon. Include every grid vertex that
    // can support a triangle beneath the river; the water itself keeps the
    // authored bank and cap outline.
    const margin = plan.maxReachM + baseline.spacing * TERRAIN_TRIANGLE_REACH_FACTOR
    for (const point of plan.path.points) {
      minX = Math.min(minX, point[0] - margin)
      minZ = Math.min(minZ, point[2] - margin)
      maxX = Math.max(maxX, point[0] + margin)
      maxZ = Math.max(maxZ, point[2] + margin)
    }
  }
  return sampleRangeOver(baseline, minX, minZ, maxX, maxZ)
}

/** Quantized height of one grid sample after every river's carve. */
function carvedHeight(
  baseline: TerrainField,
  plans: readonly PlannedRiver[],
  x: number,
  z: number,
  original: number,
): number {
  let target = original
  let downhillTarget: number | null = null
  let downhillLateral = Number.POSITIVE_INFINITY
  for (const { river, plan } of plans) {
    const candidate = plannedTargetHeight(baseline, plan, river, x, z, original * baseline.step)
    if (!candidate) continue
    if (river.flow === 'downhill') {
      // A downhill river sets its bed and banks outright (cut or fill), so
      // the nearest channel wins over any ground-following cut nearby.
      if (candidate.lateralM < downhillLateral) {
        downhillLateral = candidate.lateralM
        downhillTarget = candidate.height
      }
    } else {
      target = Math.min(target, candidate.height)
    }
  }
  return downhillTarget ?? target
}

type PlannedTarget = Readonly<{ height: number; lateralM: number }>

/**
 * One river's target for a grid sample: the nearest channel's bed or bank in
 * downhill mode, the deepest cut of any segment in as-drawn mode.
 */
function plannedTargetHeight(
  terrain: TerrainField,
  plan: RiverPlan,
  river: RiverNode,
  x: number,
  z: number,
  groundM: number,
): PlannedTarget | null {
  let bestCut = Number.POSITIVE_INFINITY
  let nearest: PlannedTarget | null = null
  for (let index = 1; index < plan.path.points.length; index += 1) {
    const station = carveStationAt(terrain, plan, river, index, x, z)
    if (!station) continue
    if (river.flow === 'downhill') {
      const candidate = downhillTarget(terrain, river, station, groundM)
      if (candidate && isNearer(candidate, nearest)) nearest = candidate
      continue
    }
    const cut = asDrawnCut(terrain, river, station)
    if (cut !== null) bestCut = Math.min(bestCut, cut)
  }
  if (river.flow === 'downhill') return nearest
  return Number.isFinite(bestCut) ? { height: bestCut, lateralM: 0 } : null
}

function isNearer(candidate: PlannedTarget, nearest: PlannedTarget | null): boolean {
  return (
    !nearest ||
    candidate.lateralM < nearest.lateralM ||
    (candidate.lateralM === nearest.lateralM && candidate.height < nearest.height)
  )
}

/** The channel cross-section a grid sample sees from one path segment. */
type CarveStation = Readonly<{
  /** Signed offset from the centreline, eroded by one terrain-triangle reach. */
  representedLateralM: number
  halfWidthM: number
  depthM: number
  bendShiftM: number
  channelTopY: number
  centerGroundY: number
}>

/**
 * Project a grid sample onto path segment `index` and resolve the section
 * there, or null where the segment does not reach it (beyond a rounded cap).
 */
function carveStationAt(
  terrain: TerrainField,
  plan: RiverPlan,
  river: RiverNode,
  index: number,
  x: number,
  z: number,
): CarveStation | null {
  const path = plan.path
  const vertexReach = terrain.spacing * TERRAIN_TRIANGLE_REACH_FACTOR
  const start = path.points[index - 1]
  const end = path.points[index]
  const startSample = plan.samples[index - 1]
  const endSample = plan.samples[index]
  if (!start || !end || !startSample || !endSample) return null
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const segmentLengthSquared = dx * dx + dz * dz
  if (segmentLengthSquared <= EPSILON) return null
  const amount = clamp01(((x - start[0]) * dx + (z - start[2]) * dz) / segmentLengthSquared)
  const nearestX = start[0] + dx * amount
  const nearestZ = start[2] + dz * amount
  const segmentLength = Math.sqrt(segmentLengthSquared)
  const segmentStart = path.distances[index - 1] ?? 0
  const along = segmentStart + segmentLength * amount
  if (beyondRoundedCap(plan, river, along, x, z, vertexReach)) return null
  // At a rounded tip the analytic width reaches zero. Move no farther than
  // one terrain-triangle reach toward the authored path so the vertices of
  // the final triangle are still excavated beneath the compact cap.
  const supportedAlong =
    along < path.authoredStartDistance
      ? Math.min(path.authoredStartDistance, along + vertexReach)
      : along > path.authoredEndDistance
        ? Math.max(path.authoredEndDistance, along - vertexReach)
        : along
  const supportedAmount = clamp01((supportedAlong - segmentStart) / segmentLength)
  const section = supportedSection(plan, river, index, supportedAlong, supportedAmount)
  if (section.halfWidthM <= EPSILON) return null
  const lateralDistance = Math.hypot(x - nearestX, z - nearestZ)
  const lateralSign = ((x - nearestX) * -dz + (z - nearestZ) * dx) / segmentLength >= 0 ? 1 : -1
  return {
    ...section,
    // A point on a native terrain triangle can be up to √2 grid spacings from
    // any of its vertices. Eroding that distance here guarantees every vertex
    // influencing the visible ribbon receives at least the point's intended
    // cross-section cut, instead of leaving a raised corner to form a spike.
    representedLateralM: lateralSign * Math.max(0, lateralDistance - vertexReach),
    bendShiftM: lerp(startSample.bendShiftM, endSample.bendShiftM, supportedAmount),
    channelTopY: lerp(startSample.channelTopY, endSample.channelTopY, supportedAmount),
    centerGroundY: lerp(startSample.groundY, endSample.groundY, amount),
  }
}

/** A grid sample past a rounded cap's disc, which the cap's segments must not cut. */
function beyondRoundedCap(
  plan: RiverPlan,
  river: RiverNode,
  along: number,
  x: number,
  z: number,
  vertexReach: number,
): boolean {
  const path = plan.path
  const capCenter =
    river.source === 'rounded' && along < path.authoredStartDistance
      ? { point: river.points[0], halfWidthM: plan.authoredStartWidthM * 0.5 }
      : river.outlet === 'rounded' && along > path.authoredEndDistance
        ? { point: river.points.at(-1), halfWidthM: plan.authoredEndWidthM * 0.5 }
        : undefined
  return Boolean(
    capCenter?.point &&
      Math.hypot(x - capCenter.point[0], z - capCenter.point[1]) > capCenter.halfWidthM + vertexReach,
  )
}

/**
 * Half-width and reached depth at a supported station. They are evaluated at
 * the station itself, never interpolated between samples: the cap profile is
 * a curve, and the pre-v3 carve (which migrated rivers must reproduce)
 * evaluated it there.
 */
function supportedSection(
  plan: RiverPlan,
  river: RiverNode,
  index: number,
  supportedAlong: number,
  supportedAmount: number,
): Readonly<{ halfWidthM: number; depthM: number }> {
  const { path, sizes } = plan
  const stationM = lerp(
    path.authoredStations[index - 1] ?? 0,
    path.authoredStations[index] ?? 0,
    supportedAmount,
  )
  const widthM =
    valueAtStation(sizes.stationsM, sizes.widthsM, stationM) *
    riverPathWidthScale(path, river, supportedAlong)
  const depthM = riverSectionDepthM(
    river.section,
    widthM * 0.5,
    valueAtStation(sizes.stationsM, sizes.depthsM, stationM) *
      riverPathDepthScale(path, river, supportedAlong),
  )
  return { halfWidthM: widthM * 0.5, depthM }
}

/** Downhill: the bed or bank height set outright from the solved profile. */
function downhillTarget(
  terrain: TerrainField,
  river: RiverNode,
  station: CarveStation,
  groundM: number,
): PlannedTarget | null {
  const targetMetres = riverSectionTargetHeight({
    lateralM: station.representedLateralM,
    groundY: groundM,
    centerGroundY: station.centerGroundY,
    channelTopY: station.channelTopY,
    depthM: station.depthM,
    halfWidthM: station.halfWidthM,
    bendShiftM: station.bendShiftM,
    section: river.section,
  })
  if (targetMetres === null) return null
  return {
    height: quantize(terrain, targetMetres),
    lateralM: Math.abs(station.representedLateralM),
  }
}

/** As drawn: the pre-v3 cut below the centreline ground, or null outside the channel. */
function asDrawnCut(terrain: TerrainField, river: RiverNode, station: CarveStation): number | null {
  const fromDeepLine = Math.abs(station.representedLateralM - station.bendShiftM)
  if (fromDeepLine >= station.halfWidthM) return null
  const crossSection = riverSectionShape(
    river.section.shape,
    fromDeepLine,
    station.halfWidthM,
    station.depthM,
    river.section.bankSlope,
  )
  if (crossSection <= 0) return null
  return quantize(terrain, station.centerGroundY - station.depthM * crossSection)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

/** Rounded flat bed through 42% of the half-width, then smooth graded banks. */
export function riverCrossSection(normalizedLateralDistance: number): number {
  return riverSectionShape('curved', normalizedLateralDistance, 1, 1, 2)
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
  const record = value as Partial<RiverTerrainMetadata>
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
    ...(typeof record.fingerprint === 'string' ? { fingerprint: record.fingerprint } : {}),
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

function sameHeights(left: TerrainField, right: TerrainField): boolean {
  if (!sameGrid(left, right) || left.heights.length !== right.heights.length) return false
  for (let index = 0; index < left.heights.length; index += 1) {
    if (left.heights[index] !== right.heights[index]) return false
  }
  return true
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

function cumulativeLengths(points: readonly (readonly [number, number])[]): number[] {
  const lengths: number[] = []
  let total = 0
  let previous: readonly [number, number] | undefined
  for (const point of points) {
    if (previous) total += Math.hypot(point[0] - previous[0], point[1] - previous[1])
    lengths.push(total)
    previous = point
  }
  return lengths
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
