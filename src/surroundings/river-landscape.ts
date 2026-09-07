import { terrainFieldOf, type SiteNode } from '@pascal-app/core'
import { ShapeUtils, Vector2 } from 'three'
import { POND_WATER_APPEARANCE } from '../pond/appearance'
import type { WaterQuality } from '../pond/schema'
import type { RiverNode } from '../river/schema'
import {
  riverCrossSection,
  riverSurfaceInset,
  riverTerrainBaseline,
  sampleRiverPath,
  type SampledRiverPath,
} from '../river/terrain'
import type { ExteriorTerrainSectionAddress, ExteriorTerrainSampler } from './exterior-terrain'
import {
  EXTERIOR_TERRAIN_SECTION_SIZE,
  exteriorTerrainSectionKey,
  polygonCentroid,
  terrainSectionSegments,
} from './exterior-terrain'
import type { Point2 } from './frontages'
import type { LandscapeRegion } from './landscape-region'
import { regionPoint } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'
import { seededRange } from './seeded-random'
import { buildMeshGeometryBuffers, type MeshGeometryBuffers } from './mesh-geometry'

const WATER_CLEARANCE = 0.012
const MINIMUM_RENDERED_WATER_DEPTH = 0.08
const SITE_EPSILON = 1e-7
const CHANNEL_BUCKET_SIZE = 32
const CONNECTOR_SAMPLE_SPACING = 2.4
const MAX_CONNECTOR_SEGMENTS = 192
const ADAPTIVE_TERRAIN_SEGMENTS = 40
const RENDERED_TERRAIN_CELL_SIZE = EXTERIOR_TERRAIN_SECTION_SIZE / ADAPTIVE_TERRAIN_SEGMENTS
const RENDERED_TERRAIN_CELL_DIAGONAL = RENDERED_TERRAIN_CELL_SIZE * Math.SQRT2
const LATERAL_FRACTIONS = [-1, -0.65, 0, 0.65, 1] as const

type ChannelPoint = Readonly<{
  x: number
  z: number
  waterY: number
  bedReferenceY: number
  halfWidth: number
  profileHalfWidth: number
  profileSupport: number
  submergedHalfWidth: number
  incisionHalfWidth: number
  samplingSafety: number
  depth: number
  flowX: number
  flowZ: number
  course: number
  bankConform: number
}>

type ChannelSegment = Readonly<{
  start: ChannelPoint
  end: ChannelPoint
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}>

type WaterVertex = {
  x: number
  y: number
  z: number
  depth: number
  flowX: number
  flowZ: number
  courseX: number
  courseY: number
  shoreDistance: number
}

export type RiverLandscapeWaterGeometry = MeshGeometryBuffers &
  Readonly<{
    waterDepths: Float32Array
    waterFlows: Float32Array
    waterCourses: Float32Array
    shoreDistances: Float32Array
  }>

export type RiverLandscapeWaterBatch = Readonly<{
  key: string
  quality: WaterQuality
  flowSpeed: number
  flowDirection: 1 | -1
  geometry: RiverLandscapeWaterGeometry
}>

export type RiverLandscape = Readonly<{
  sampler: ExteriorTerrainSampler
  exclusions: readonly (readonly Point2[])[]
  waterLevelAt: (x: number, z: number) => number | null
  intersectsFootprint: (footprint: readonly Point2[], padding?: number) => boolean
  waters: readonly RiverLandscapeWaterBatch[]
  channelCount: number
  centerlineSegments: number
  triangleCount: number
  adaptiveSectionSegments: number
}>

type PendingChannel = Readonly<{
  river: RiverNode
  points: readonly ChannelPoint[]
}>

type WaterBatchBuilder = {
  quality: WaterQuality
  flowSpeed: number
  flowDirection: 1 | -1
  positions: number[]
  indices: number[]
  depths: number[]
  flows: number[]
  courses: number[]
  shoreDistances: number[]
}

/**
 * Adds presentation-only river reaches outside the authored Site. Native river
 * geometry and its persisted TerrainField remain untouched.
 */
export function createRiverLandscape(
  site: SiteNode,
  rivers: readonly RiverNode[],
  terrain: ExteriorTerrainSampler,
  region: LandscapeRegion,
): RiverLandscape {
  const boundary = site.polygon.points as readonly Point2[]
  const baseline = riverTerrainBaseline(site) ?? terrainFieldOf(site)
  if (!baseline || boundary.length < 3) return emptyLandscape(terrain)

  const center = polygonCentroid(boundary)
  const protectedRadius = Math.max(
    1,
    ...boundary.map(([x, z]) => Math.hypot(x - center[0], z - center[1])),
  )
  const pending: PendingChannel[] = []
  const orderedRivers = [...rivers]
    .filter((river) => river.parentId === site.id)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))

  for (const river of orderedRivers) {
    const path = sampleRiverPath(baseline, river, boundary)
    if (!path) continue
    if (river.source === 'mountain') {
      const channel = buildMountainChannel(
        river,
        path,
        terrain,
        baseline.spacing * Math.SQRT2,
        boundary,
        center,
        protectedRadius,
        region,
      )
      if (channel) pending.push(channel)
    }
    if (river.outlet === 'sea' && region.coast) {
      const channel = buildSeaChannel(
        river,
        path,
        terrain,
        baseline.spacing * Math.SQRT2,
        boundary,
        center,
        protectedRadius,
        region,
      )
      if (channel) pending.push(channel)
    }
  }
  if (!pending.length) return emptyLandscape(terrain)

  const segments = pending.flatMap((channel) => channelSegments(channel.points))
  const buckets = bucketSegments(segments)
  const adaptiveSections = new Set<string>()
  for (const segment of segments) {
    const minX = Math.floor(segment.minX / EXTERIOR_TERRAIN_SECTION_SIZE)
    const maxX = Math.floor(segment.maxX / EXTERIOR_TERRAIN_SECTION_SIZE)
    const minZ = Math.floor(segment.minZ / EXTERIOR_TERRAIN_SECTION_SIZE)
    const maxZ = Math.floor(segment.maxZ / EXTERIOR_TERRAIN_SECTION_SIZE)
    for (let sectionZ = minZ; sectionZ <= maxZ; sectionZ += 1) {
      for (let sectionX = minX; sectionX <= maxX; sectionX += 1) {
        adaptiveSections.add(exteriorTerrainSectionKey(sectionX, sectionZ))
      }
    }
  }
  const waterLevelAt = (x: number, z: number): number | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || pointInPolygonInterior(boundary, x, z)) {
      return null
    }
    let level: number | null = null
    for (const segment of nearbySegments(buckets, x, z, 0)) {
      const projection = projectToSegment(segment, x, z)
      const halfWidth = mix(segment.start.halfWidth, segment.end.halfWidth, projection.amount)
      if (projection.distanceSquared > halfWidth * halfWidth) continue
      const candidate = mix(segment.start.waterY, segment.end.waterY, projection.amount)
      level = level === null ? candidate : Math.max(level, candidate)
    }
    return level
  }
  const heightAt = (x: number, z: number): number => {
    const original = terrain.heightAt(x, z)
    if (!Number.isFinite(x) || !Number.isFinite(z) || pointInPolygonInterior(boundary, x, z)) {
      return original
    }
    let height = original
    for (const segment of nearbySegments(buckets, x, z, 0)) {
      const projection = projectToSegment(segment, x, z)
      const distance = Math.sqrt(projection.distanceSquared)
      const incisionHalfWidth = mix(
        segment.start.incisionHalfWidth,
        segment.end.incisionHalfWidth,
        projection.amount,
      )
      if (distance >= incisionHalfWidth) continue
      const profileHalfWidth = mix(
        segment.start.profileHalfWidth,
        segment.end.profileHalfWidth,
        projection.amount,
      )
      const profileSupport = mix(
        segment.start.profileSupport,
        segment.end.profileSupport,
        projection.amount,
      )
      const crossSection = riverCrossSection(
        Math.max(0, distance - profileSupport) / profileHalfWidth,
      )
      const bedReferenceY = mix(
        segment.start.bedReferenceY,
        segment.end.bedReferenceY,
        projection.amount,
      )
      const depth = mix(segment.start.depth, segment.end.depth, projection.amount)
      const profileTarget = bedReferenceY - depth * crossSection
      const submergedHalfWidth = mix(
        segment.start.submergedHalfWidth,
        segment.end.submergedHalfWidth,
        projection.amount,
      )
      const samplingSafety = mix(
        segment.start.samplingSafety,
        segment.end.samplingSafety,
        projection.amount,
      )
      const safety =
        samplingSafety *
        (incisionHalfWidth > submergedHalfWidth + SITE_EPSILON
          ? 1 - smoothstep(submergedHalfWidth, incisionHalfWidth, distance)
          : distance < submergedHalfWidth
            ? 1
            : 0)
      const segmentLength = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.z - segment.start.z,
      )
      const waterSlope =
        segmentLength > SITE_EPSILON
          ? Math.abs(segment.end.waterY - segment.start.waterY) / segmentLength
          : 0
      const waterY = mix(segment.start.waterY, segment.end.waterY, projection.amount)
      const samplingSafeTarget =
        waterY - MINIMUM_RENDERED_WATER_DEPTH - waterSlope * RENDERED_TERRAIN_CELL_DIAGONAL
      height = Math.min(height, profileTarget, mix(profileTarget, samplingSafeTarget, safety))
    }
    return height
  }
  const normalAt = (x: number, z: number): readonly [number, number, number] => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || pointInPolygonInterior(boundary, x, z)) {
      return terrain.normalAt(x, z)
    }
    const distance = 0.45
    const dx = heightAt(x - distance, z) - heightAt(x + distance, z)
    const dz = heightAt(x, z - distance) - heightAt(x, z + distance)
    const dy = distance * 2
    const length = Math.hypot(dx, dy, dz)
    return length > SITE_EPSILON && Number.isFinite(length)
      ? [dx / length, dy / length, dz / length]
      : terrain.normalAt(x, z)
  }
  const sectionSegments = (address: ExteriorTerrainSectionAddress): number => {
    const sourceSegments = terrainSectionSegments(terrain, address)
    const resolvesChannel = adaptiveSections.has(address.key)
    return Math.max(sourceSegments, resolvesChannel ? ADAPTIVE_TERRAIN_SEGMENTS : 0)
  }
  const sampler: ExteriorTerrainSampler = { ...terrain, heightAt, normalAt, sectionSegments }
  const waters = buildWaterBatches(pending, sampler, terrain, boundary)
  const exclusions = segments.map(bankCorridorQuad)
  const intersectsFootprint = (footprint: readonly Point2[], padding = 0): boolean => {
    if (footprint.length < 3 || !footprint.every(finitePoint)) return false
    const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0
    const bounds = polygonBounds(footprint)
    const candidates = segmentsInBounds(buckets, {
      minX: bounds.minX - safePadding,
      minZ: bounds.minZ - safePadding,
      maxX: bounds.maxX + safePadding,
      maxZ: bounds.maxZ + safePadding,
    })
    for (const segment of candidates) {
      const radius = Math.max(segment.start.halfWidth, segment.end.halfWidth) + safePadding
      if (capsuleIntersectsPolygon(segment.start, segment.end, radius, footprint)) return true
    }
    return false
  }
  const triangleCount = waters.reduce((sum, batch) => sum + batch.geometry.indices.length / 3, 0)
  return {
    sampler,
    exclusions,
    waterLevelAt,
    intersectsFootprint,
    waters,
    channelCount: pending.length,
    centerlineSegments: segments.length,
    triangleCount,
    adaptiveSectionSegments: ADAPTIVE_TERRAIN_SEGMENTS,
  }
}

function emptyLandscape(terrain: ExteriorTerrainSampler): RiverLandscape {
  return {
    sampler: terrain,
    exclusions: [],
    waterLevelAt: () => null,
    intersectsFootprint: () => false,
    waters: [],
    channelCount: 0,
    centerlineSegments: 0,
    triangleCount: 0,
    adaptiveSectionSegments: 0,
  }
}

function buildMountainChannel(
  river: RiverNode,
  path: SampledRiverPath,
  terrain: ExteriorTerrainSampler,
  nativeTerrainSupport: number,
  boundary: readonly Point2[],
  center: Point2,
  protectedRadius: number,
  region: LandscapeRegion,
): PendingChannel | null {
  const seam = path.points[0]
  const next = path.points[1]
  if (!seam || !next || distanceToBoundary(boundary, seam[0], seam[2]) > 0.08) return null
  const outward = normalized(seam[0] - next[0], seam[2] - next[2])
  const target = mountainTarget(terrain, center, protectedRadius, outward, region)
  if (!target) return null
  const radial = normalized(target[0] - center[0], target[1] - center[1])
  const route = meanderingRouteOutside(
    [seam[0], seam[2]],
    outward,
    target,
    radial,
    boundary,
    riverRouteSeed(river, region, 'mountain'),
  )
  if (route.length < 2) return null
  const seamWater = seam[1] - riverSurfaceInset(river.depth) + WATER_CLEARANCE
  const inset = riverSurfaceInset(river.depth)
  const routeDistances = cumulativeRouteDistances(route)
  const points: ChannelPoint[] = route.map((point, index) => {
    const amount = index / (route.length - 1)
    const sourceFade = 1 - smoothstep(0.72, 1, amount)
    const base = terrain.heightAt(point[0], point[1])
    const waterY = index === 0 ? seamWater : base - inset * sourceFade + WATER_CLEARANCE
    const tangent = index === 0 ? outward : routeTangent(route, index)
    const halfWidth = river.width * 0.5 * mix(1, 0.18, smoothstep(0.72, 1, amount))
    const seamResolution = smoothstep(0, RENDERED_TERRAIN_CELL_SIZE * 2, routeDistances[index]!)
    const profileSupport = mix(nativeTerrainSupport, RENDERED_TERRAIN_CELL_DIAGONAL, seamResolution)
    return {
      x: point[0],
      z: point[1],
      waterY,
      bedReferenceY: index === 0 ? seam[1] : base,
      halfWidth,
      profileHalfWidth: halfWidth,
      profileSupport,
      submergedHalfWidth: halfWidth + RENDERED_TERRAIN_CELL_DIAGONAL,
      incisionHalfWidth: Math.max(
        halfWidth + profileSupport,
        mix(
          halfWidth + nativeTerrainSupport,
          halfWidth + RENDERED_TERRAIN_CELL_DIAGONAL * 2,
          seamResolution,
        ),
      ),
      samplingSafety: seamResolution,
      depth: river.depth * mix(1, 0.08, smoothstep(0.72, 1, amount)),
      // Native first-to-last flow points from the mountain into the Site.
      flowX: -tangent[0],
      flowZ: -tangent[1],
      course: -routeDistances[index]!,
      bankConform: 1 - smoothstep(0, 0.08, amount),
    }
  })
  return { river, points }
}

function buildSeaChannel(
  river: RiverNode,
  path: SampledRiverPath,
  terrain: ExteriorTerrainSampler,
  nativeTerrainSupport: number,
  boundary: readonly Point2[],
  center: Point2,
  protectedRadius: number,
  region: LandscapeRegion,
): PendingChannel | null {
  const coast = region.coast
  const seam = path.points.at(-1)
  const previous = path.points.at(-2)
  if (!coast || !seam || !previous || distanceToBoundary(boundary, seam[0], seam[2]) > 0.08)
    return null
  const outward = normalized(seam[0] - previous[0], seam[2] - previous[2])
  const coastDirection: Point2 = [Math.cos(coast.angle), Math.sin(coast.angle)]
  const relativeX = seam[0] - center[0]
  const relativeZ = seam[2] - center[1]
  const across = -relativeX * coastDirection[1] + relativeZ * coastDirection[0]
  const guaranteedOffshore = protectedRadius + coast.distance + coast.bays + 24 + 65
  const offshore = regionPoint(center, coast.angle, guaranteedOffshore, across)
  const completeRoute = meanderingRouteOutside(
    [seam[0], seam[2]],
    outward,
    offshore,
    coastDirection,
    boundary,
    riverRouteSeed(river, region, 'sea'),
  )
  if (completeRoute.length < 2) return null
  const mouthIndex = firstOffshorePoint(completeRoute, terrain, river.depth)
  if (mouthIndex === null) return null
  const route = completeRoute.slice(0, mouthIndex + 1)
  if (route.length < 2) return null
  const seamWater = seam[1] - riverSurfaceInset(river.depth) + WATER_CLEARANCE
  const inset = riverSurfaceInset(river.depth)
  const routeDistances = cumulativeRouteDistances(route)
  const estuaryHalfWidth = Math.min(28, Math.max(river.width * 1.35, river.width * 0.5 + 5))
  const points: ChannelPoint[] = route.map((point, index) => {
    const amount = index / (route.length - 1)
    const descent = smoothstep(0, 1, amount)
    const waterY = index === route.length - 1 ? SEA_LEVEL : mix(seamWater, SEA_LEVEL, descent)
    const tangent = index === 0 ? outward : routeTangent(route, index)
    const widthMix = smoothstep(0.18, 1, amount)
    const halfWidth = mix(river.width * 0.5, estuaryHalfWidth, widthMix)
    const seamResolution = smoothstep(0, RENDERED_TERRAIN_CELL_SIZE * 2, routeDistances[index]!)
    const profileSupport = mix(nativeTerrainSupport, RENDERED_TERRAIN_CELL_DIAGONAL, seamResolution)
    return {
      x: point[0],
      z: point[1],
      waterY,
      bedReferenceY: waterY - WATER_CLEARANCE + inset,
      halfWidth,
      profileHalfWidth: halfWidth,
      profileSupport,
      submergedHalfWidth: halfWidth + RENDERED_TERRAIN_CELL_DIAGONAL,
      incisionHalfWidth: Math.max(
        halfWidth + profileSupport,
        mix(
          halfWidth + nativeTerrainSupport,
          halfWidth + RENDERED_TERRAIN_CELL_DIAGONAL * 2,
          seamResolution,
        ),
      ),
      samplingSafety: seamResolution,
      depth: Math.max(river.depth, mix(river.depth, 1.6, descent)),
      flowX: tangent[0],
      flowZ: tangent[1],
      course: path.length + routeDistances[index]!,
      bankConform: 1 - smoothstep(0, 0.08, amount),
    }
  })
  return { river, points }
}

function mountainTarget(
  terrain: ExteriorTerrainSampler,
  center: Point2,
  protectedRadius: number,
  outward: Point2,
  region: LandscapeRegion,
): Point2 | null {
  let best: Point2 | null = null
  let bestScore = -Infinity
  for (const peak of region.peaks) {
    const radial: Point2 = [Math.cos(peak.angle), Math.sin(peak.angle)]
    const nearSlopeDistance = protectedRadius + Math.max(125, peak.distance - peak.depth * 0.48)
    for (const acrossFraction of [-0.16, 0, 0.16]) {
      const candidate = regionPoint(
        center,
        peak.angle,
        nearSlopeDistance,
        peak.width * acrossFraction,
      )
      const height = terrain.heightAt(candidate[0], candidate[1])
      const alignment = outward[0] * radial[0] + outward[1] * radial[1]
      const citySeparation = angularDistance(peak.angle, region.cityAngle)
      const cityPenalty = citySeparation < 0.42 ? (0.42 - citySeparation) * 180 : 0
      const score = height + alignment * 24 - cityPenalty - Math.abs(acrossFraction) * 2
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
  }
  return best
}

function riverRouteSeed(
  river: RiverNode,
  region: LandscapeRegion,
  reach: 'mountain' | 'sea',
): string {
  const coast = region.coast
    ? [
        region.coast.angle,
        region.coast.distance,
        region.coast.bays,
        region.coast.wavelength,
        region.coast.phase,
      ]
    : ['inland']
  const peaks = region.peaks.flatMap((peak) => [
    peak.angle,
    peak.distance,
    peak.width,
    peak.depth,
    peak.height,
  ])
  return [String(river.id), reach, region.kind, ...coast, ...peaks].join(':')
}

function meanderingRouteOutside(
  start: Point2,
  startDirection: Point2,
  end: Point2,
  endDirection: Point2,
  boundary: readonly Point2[],
  seed: string,
): Point2[] {
  const directDistance = Math.hypot(end[0] - start[0], end[1] - start[1])
  const firstHandle = Math.min(72, Math.max(16, directDistance * 0.22))
  const finalHandle = Math.min(110, Math.max(24, directDistance * 0.28))
  const first: Point2 = [
    start[0] + startDirection[0] * firstHandle,
    start[1] + startDirection[1] * firstHandle,
  ]
  const second: Point2 = [
    end[0] - endDirection[0] * finalHandle,
    end[1] - endDirection[1] * finalHandle,
  ]
  const segments = Math.max(
    8,
    Math.min(MAX_CONNECTOR_SEGMENTS, Math.ceil(directDistance / CONNECTOR_SAMPLE_SPACING)),
  )
  const broadAmplitude = Math.min(18, Math.max(5, directDistance * 0.075))
  const middleAmplitude = Math.min(5, Math.max(1.8, directDistance * 0.02))
  const fineAmplitude = Math.min(2.4, Math.max(0.8, directDistance * 0.008))
  const broadSide = seededRange(seed, 'broad:side', 0, 1) < 0.5 ? -1 : 1
  const broadKnots = [
    seededRange(seed, 'broad:0', -1, 1),
    broadSide * seededRange(seed, 'broad:1', 0.8, 1),
    -broadSide * seededRange(seed, 'broad:2', 0.65, 0.95),
    seededRange(seed, 'broad:3', -1, 1),
  ]
  const endRamp = Math.min(0.24, Math.max(0.1, 20 / Math.max(20, directDistance)))
  const buildRoute = (amplitudeScale: number): Point2[] => {
    const route: Point2[] = []
    for (let index = 0; index <= segments; index += 1) {
      const amount = index / segments
      const base = cubicPoint(start, first, second, end, amount)
      const tangent = cubicTangent(start, first, second, end, amount)
      const envelope = smoothstep(0, endRamp, amount) * smoothstep(0, endRamp, 1 - amount)
      const broadPosition = amount * 3
      const broadIndex = Math.min(2, Math.floor(broadPosition))
      const broadBlend = smoothstep(0, 1, broadPosition - broadIndex)
      const broad = mix(broadKnots[broadIndex]!, broadKnots[broadIndex + 1]!, broadBlend)
      const offset =
        amplitudeScale *
        envelope *
        (broadAmplitude * broad +
          middleAmplitude * seededSmoothNoise(seed, 'middle', amount, 6) +
          fineAmplitude * seededSmoothNoise(seed, 'fine', amount, 11))
      const point: Point2 =
        index === 0
          ? start
          : index === segments
            ? end
            : [base[0] - tangent[1] * offset, base[1] + tangent[0] * offset]
      const previous = route.at(-1)
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-5) {
        route.push(point)
      }
    }
    return route
  }
  for (const amplitudeScale of [1, 0.78, 0.56, 0.36, 0.18, 0]) {
    const route = buildRoute(amplitudeScale)
    const staysExterior = route.every((point, index) => {
      if (index === 0 || pointInPolygonInterior(boundary, point[0], point[1])) return index === 0
      const previous = route[index - 1]!
      return [0.25, 0.5, 0.75].every(
        (amount) =>
          !pointInPolygonInterior(
            boundary,
            mix(previous[0], point[0], amount),
            mix(previous[1], point[1], amount),
          ),
      )
    })
    if (staysExterior && !routeSelfIntersects(route)) return route
  }
  return buildRoute(0).map((point, index) =>
    index > 0 && pointInPolygonInterior(boundary, point[0], point[1])
      ? nearestExteriorPoint(boundary, point)
      : point,
  )
}

function cubicPoint(
  start: Point2,
  first: Point2,
  second: Point2,
  end: Point2,
  amount: number,
): Point2 {
  const inverse = 1 - amount
  return [
    inverse ** 3 * start[0] +
      3 * inverse ** 2 * amount * first[0] +
      3 * inverse * amount ** 2 * second[0] +
      amount ** 3 * end[0],
    inverse ** 3 * start[1] +
      3 * inverse ** 2 * amount * first[1] +
      3 * inverse * amount ** 2 * second[1] +
      amount ** 3 * end[1],
  ]
}

function cubicTangent(
  start: Point2,
  first: Point2,
  second: Point2,
  end: Point2,
  amount: number,
): Point2 {
  const inverse = 1 - amount
  return normalized(
    3 * inverse ** 2 * (first[0] - start[0]) +
      6 * inverse * amount * (second[0] - first[0]) +
      3 * amount ** 2 * (end[0] - second[0]),
    3 * inverse ** 2 * (first[1] - start[1]) +
      6 * inverse * amount * (second[1] - first[1]) +
      3 * amount ** 2 * (end[1] - second[1]),
  )
}

function seededSmoothNoise(seed: string, octave: string, amount: number, spans: number): number {
  const position = clamp01(amount) * spans
  const first = Math.min(spans - 1, Math.floor(position))
  const blend = smoothstep(0, 1, position - first)
  return mix(
    seededRange(seed, `${octave}:${first}`, -1, 1),
    seededRange(seed, `${octave}:${first + 1}`, -1, 1),
    blend,
  )
}

function routeSelfIntersects(route: readonly Point2[]): boolean {
  for (let first = 1; first < route.length; first += 1) {
    for (let second = first + 2; second < route.length; second += 1) {
      if (segmentsIntersect(route[first - 1]!, route[first]!, route[second - 1]!, route[second]!))
        return true
    }
  }
  return false
}

function firstOffshorePoint(
  route: readonly Point2[],
  terrain: ExteriorTerrainSampler,
  depth: number,
): number | null {
  const ownershipDepth = Math.max(0.08, Math.min(0.5, depth * 0.22))
  const threshold = SEA_LEVEL - ownershipDepth
  for (let index = 1; index < route.length; index += 1) {
    const point = route[index]!
    if (terrain.heightAt(point[0], point[1]) <= threshold) return index
  }
  return null
}

function channelSegments(points: readonly ChannelPoint[]): ChannelSegment[] {
  const segments: ChannelSegment[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    const radius = Math.max(start.incisionHalfWidth, end.incisionHalfWidth)
    segments.push({
      start,
      end,
      minX: Math.min(start.x, end.x) - radius,
      minZ: Math.min(start.z, end.z) - radius,
      maxX: Math.max(start.x, end.x) + radius,
      maxZ: Math.max(start.z, end.z) + radius,
    })
  }
  return segments
}

function bucketSegments(segments: readonly ChannelSegment[]): Map<string, ChannelSegment[]> {
  const buckets = new Map<string, ChannelSegment[]>()
  for (const segment of segments) {
    const minX = Math.floor(segment.minX / CHANNEL_BUCKET_SIZE)
    const minZ = Math.floor(segment.minZ / CHANNEL_BUCKET_SIZE)
    const maxX = Math.floor(segment.maxX / CHANNEL_BUCKET_SIZE)
    const maxZ = Math.floor(segment.maxZ / CHANNEL_BUCKET_SIZE)
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x}:${z}`
        const bucket = buckets.get(key)
        if (bucket) bucket.push(segment)
        else buckets.set(key, [segment])
      }
    }
  }
  return buckets
}

function nearbySegments(
  buckets: ReadonlyMap<string, readonly ChannelSegment[]>,
  x: number,
  z: number,
  radius: number,
): readonly ChannelSegment[] {
  return segmentsInBounds(buckets, {
    minX: x - radius,
    minZ: z - radius,
    maxX: x + radius,
    maxZ: z + radius,
  })
}

function segmentsInBounds(
  buckets: ReadonlyMap<string, readonly ChannelSegment[]>,
  bounds: Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }>,
): ChannelSegment[] {
  const result: ChannelSegment[] = []
  const seen = new Set<ChannelSegment>()
  const minX = Math.floor(bounds.minX / CHANNEL_BUCKET_SIZE)
  const minZ = Math.floor(bounds.minZ / CHANNEL_BUCKET_SIZE)
  const maxX = Math.floor(bounds.maxX / CHANNEL_BUCKET_SIZE)
  const maxZ = Math.floor(bounds.maxZ / CHANNEL_BUCKET_SIZE)
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (const segment of buckets.get(`${x}:${z}`) ?? []) {
        if (seen.has(segment)) continue
        seen.add(segment)
        result.push(segment)
      }
    }
  }
  return result
}

function buildWaterBatches(
  channels: readonly PendingChannel[],
  sampler: ExteriorTerrainSampler,
  sourceTerrain: ExteriorTerrainSampler,
  boundary: readonly Point2[],
): RiverLandscapeWaterBatch[] {
  const builders = new Map<string, WaterBatchBuilder>()
  const outside = exteriorClipTriangles(boundary, channels)
  for (const channel of channels) {
    const quality = waterQuality(channel.river.quality)
    const direction = channel.river.flowDirection === 'reverse' ? -1 : 1
    const speed = channel.river.flowSpeed
    const key = `${quality}:${speed}:${direction}`
    let builder = builders.get(key)
    if (!builder) {
      builder = {
        quality,
        flowSpeed: speed,
        flowDirection: direction,
        positions: [],
        indices: [],
        depths: [],
        flows: [],
        courses: [],
        shoreDistances: [],
      }
      builders.set(key, builder)
    }
    const rows = channel.points.map((point) => waterRow(point, sampler, sourceTerrain))
    for (let row = 1; row < rows.length; row += 1) {
      const previous = rows[row - 1]!
      const current = rows[row]!
      for (let column = 1; column < current.length; column += 1) {
        appendExteriorWaterTriangle(
          [previous[column - 1]!, current[column - 1]!, previous[column]!],
          outside,
          builder,
        )
        appendExteriorWaterTriangle(
          [current[column - 1]!, current[column]!, previous[column]!],
          outside,
          builder,
        )
      }
    }
  }
  return [...builders.entries()].map(([key, builder]) => ({
    key,
    quality: builder.quality,
    flowSpeed: builder.flowSpeed,
    flowDirection: builder.flowDirection,
    geometry: {
      ...buildMeshGeometryBuffers(builder.positions, builder.indices),
      waterDepths: new Float32Array(builder.depths),
      waterFlows: new Float32Array(builder.flows),
      waterCourses: new Float32Array(builder.courses),
      shoreDistances: new Float32Array(builder.shoreDistances),
    },
  }))
}

function waterRow(
  point: ChannelPoint,
  sampler: ExteriorTerrainSampler,
  sourceTerrain: ExteriorTerrainSampler,
): WaterVertex[] {
  const normalX = -point.flowZ
  const normalZ = point.flowX
  return LATERAL_FRACTIONS.map((fraction): WaterVertex => {
    const x = point.x + normalX * point.halfWidth * fraction
    const z = point.z + normalZ * point.halfWidth * fraction
    const bankSurface =
      Math.min(point.waterY - WATER_CLEARANCE, sourceTerrain.heightAt(x, z) - 0.018) +
      WATER_CLEARANCE
    const y = mix(point.waterY, bankSurface, point.bankConform)
    return {
      x,
      y,
      z,
      depth: Math.max(0, y - sampler.heightAt(x, z)),
      flowX: point.flowX,
      flowZ: point.flowZ,
      courseX: point.course,
      courseY: point.halfWidth * fraction,
      shoreDistance: point.halfWidth * (1 - Math.abs(fraction)),
    }
  })
}

type ClipTriangle = readonly [Vector2, Vector2, Vector2]

function exteriorClipTriangles(
  boundary: readonly Point2[],
  channels: readonly PendingChannel[],
): ClipTriangle[] {
  const points = channels.flatMap((channel) => channel.points)
  let minX = Math.min(...boundary.map((point) => point[0]))
  let minZ = Math.min(...boundary.map((point) => point[1]))
  let maxX = Math.max(...boundary.map((point) => point[0]))
  let maxZ = Math.max(...boundary.map((point) => point[1]))
  for (const point of points) {
    minX = Math.min(minX, point.x - point.halfWidth - 1)
    minZ = Math.min(minZ, point.z - point.halfWidth - 1)
    maxX = Math.max(maxX, point.x + point.halfWidth + 1)
    maxZ = Math.max(maxZ, point.z + point.halfWidth + 1)
  }
  const contour = [
    new Vector2(minX - 1, minZ - 1),
    new Vector2(maxX + 1, minZ - 1),
    new Vector2(maxX + 1, maxZ + 1),
    new Vector2(minX - 1, maxZ + 1),
  ]
  const hole = boundary.map(([x, z]) => new Vector2(x, z))
  const vertices = [...contour, ...hole]
  return ShapeUtils.triangulateShape(contour, [hole]).map((face) => [
    vertices[face[0]!]!,
    vertices[face[1]!]!,
    vertices[face[2]!]!,
  ])
}

function appendExteriorWaterTriangle(
  triangle: readonly [WaterVertex, WaterVertex, WaterVertex],
  outside: readonly ClipTriangle[],
  builder: WaterBatchBuilder,
): void {
  const bounds = polygonBounds(triangle.map((vertex): Point2 => [vertex.x, vertex.z]))
  for (const clip of outside) {
    if (!boundsOverlap(bounds, triangleBounds(clip))) continue
    const polygon = clipWaterPolygonToTriangle(triangle, clip)
    if (polygon.length < 3) continue
    for (let index = 1; index + 1 < polygon.length; index += 1) {
      const a = polygon[0]!
      const b = polygon[index]!
      const c = polygon[index + 1]!
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
      if (Math.abs(cross) <= SITE_EPSILON) continue
      appendWaterVertex(a, builder)
      appendWaterVertex(cross < 0 ? b : c, builder)
      appendWaterVertex(cross < 0 ? c : b, builder)
    }
  }
}

function clipWaterPolygonToTriangle(
  polygon: readonly WaterVertex[],
  triangle: ClipTriangle,
): WaterVertex[] {
  let output = [...polygon]
  const orientation = Math.sign(cross2Vector(triangle[0], triangle[1], triangle[2])) || 1
  for (let edge = 0; edge < 3 && output.length; edge += 1) {
    const start = triangle[edge]!
    const end = triangle[(edge + 1) % 3]!
    const input = output
    output = []
    let previous = input.at(-1)!
    let previousDistance = orientation * cross2Point(start, end, previous.x, previous.z)
    for (const current of input) {
      const currentDistance = orientation * cross2Point(start, end, current.x, current.z)
      const previousInside = previousDistance >= -SITE_EPSILON
      const currentInside = currentDistance >= -SITE_EPSILON
      if (currentInside !== previousInside) {
        const amount = previousDistance / (previousDistance - currentDistance)
        output.push(interpolateWaterVertex(previous, current, amount))
      }
      if (currentInside) output.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }
  return output
}

function appendWaterVertex(vertex: WaterVertex, builder: WaterBatchBuilder): void {
  builder.indices.push(builder.positions.length / 3)
  builder.positions.push(vertex.x, vertex.y, vertex.z)
  builder.depths.push(vertex.depth)
  builder.flows.push(vertex.flowX, vertex.flowZ)
  builder.courses.push(vertex.courseX, vertex.courseY)
  builder.shoreDistances.push(vertex.shoreDistance)
}

function interpolateWaterVertex(start: WaterVertex, end: WaterVertex, amount: number): WaterVertex {
  const flow = normalized(mix(start.flowX, end.flowX, amount), mix(start.flowZ, end.flowZ, amount))
  return {
    x: mix(start.x, end.x, amount),
    y: mix(start.y, end.y, amount),
    z: mix(start.z, end.z, amount),
    depth: mix(start.depth, end.depth, amount),
    flowX: flow[0],
    flowZ: flow[1],
    courseX: mix(start.courseX, end.courseX, amount),
    courseY: mix(start.courseY, end.courseY, amount),
    shoreDistance: mix(start.shoreDistance, end.shoreDistance, amount),
  }
}

function projectToSegment(segment: ChannelSegment, x: number, z: number) {
  const dx = segment.end.x - segment.start.x
  const dz = segment.end.z - segment.start.z
  const lengthSquared = dx * dx + dz * dz
  const amount =
    lengthSquared > SITE_EPSILON
      ? clamp01(((x - segment.start.x) * dx + (z - segment.start.z) * dz) / lengthSquared)
      : 0
  const nearestX = mix(segment.start.x, segment.end.x, amount)
  const nearestZ = mix(segment.start.z, segment.end.z, amount)
  return {
    amount,
    distanceSquared: (x - nearestX) ** 2 + (z - nearestZ) ** 2,
  }
}

function capsuleIntersectsPolygon(
  start: ChannelPoint,
  end: ChannelPoint,
  radius: number,
  polygon: readonly Point2[],
): boolean {
  if (pointInPolygon(polygon, start.x, start.z) || pointInPolygon(polygon, end.x, end.z))
    return true
  for (const point of polygon) {
    if (pointSegmentDistanceSquared(point, [start.x, start.z], [end.x, end.z]) <= radius * radius) {
      return true
    }
  }
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    if (segmentsIntersect([start.x, start.z], [end.x, end.z], a, b)) return true
    if (segmentDistanceSquared([start.x, start.z], [end.x, end.z], a, b) <= radius * radius)
      return true
  }
  return false
}

function segmentDistanceSquared(a: Point2, b: Point2, c: Point2, d: Point2): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  )
}

function pointSegmentDistanceSquared(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  const amount =
    lengthSquared > SITE_EPSILON
      ? clamp01(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared)
      : 0
  return (
    (point[0] - mix(start[0], end[0], amount)) ** 2 +
    (point[1] - mix(start[1], end[1], amount)) ** 2
  )
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = cross2(a, b, c)
  const abD = cross2(a, b, d)
  const cdA = cross2(c, d, a)
  const cdB = cross2(c, d, b)
  if (
    ((abC > SITE_EPSILON && abD < -SITE_EPSILON) || (abC < -SITE_EPSILON && abD > SITE_EPSILON)) &&
    ((cdA > SITE_EPSILON && cdB < -SITE_EPSILON) || (cdA < -SITE_EPSILON && cdB > SITE_EPSILON))
  )
    return true
  return (
    (Math.abs(abC) <= SITE_EPSILON && pointSegmentDistanceSquared(c, a, b) <= SITE_EPSILON) ||
    (Math.abs(abD) <= SITE_EPSILON && pointSegmentDistanceSquared(d, a, b) <= SITE_EPSILON) ||
    (Math.abs(cdA) <= SITE_EPSILON && pointSegmentDistanceSquared(a, c, d) <= SITE_EPSILON) ||
    (Math.abs(cdB) <= SITE_EPSILON && pointSegmentDistanceSquared(b, c, d) <= SITE_EPSILON)
  )
}

function nearestExteriorPoint(boundary: readonly Point2[], point: Point2): Point2 {
  let nearest: Point2 = boundary[0] ?? point
  let nearestDistance = Infinity
  let nearestStart: Point2 = boundary[0] ?? point
  let nearestEnd: Point2 = boundary[1] ?? point
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!
    const end = boundary[(index + 1) % boundary.length]!
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const lengthSquared = dx * dx + dz * dz
    const amount =
      lengthSquared > SITE_EPSILON
        ? clamp01(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared)
        : 0
    const candidate: Point2 = [mix(start[0], end[0], amount), mix(start[1], end[1], amount)]
    const distance = (point[0] - candidate[0]) ** 2 + (point[1] - candidate[1]) ** 2
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = candidate
      nearestStart = start
      nearestEnd = end
    }
  }
  const edge = normalized(nearestEnd[0] - nearestStart[0], nearestEnd[1] - nearestStart[1])
  const first: Point2 = [nearest[0] - edge[1] * 0.03, nearest[1] + edge[0] * 0.03]
  if (!pointInPolygonInterior(boundary, first[0], first[1])) return first
  return [nearest[0] + edge[1] * 0.03, nearest[1] - edge[0] * 0.03]
}

function routeTangent(route: readonly Point2[], index: number): Point2 {
  const before = route[Math.max(0, index - 1)]!
  const after = route[Math.min(route.length - 1, index + 1)]!
  return normalized(after[0] - before[0], after[1] - before[1])
}

function cumulativeRouteDistances(route: readonly Point2[]): number[] {
  const distances = [0]
  for (let index = 1; index < route.length; index += 1) {
    distances.push(
      distances[index - 1]! +
        Math.hypot(
          route[index]![0] - route[index - 1]![0],
          route[index]![1] - route[index - 1]![1],
        ),
    )
  }
  return distances
}

function distanceToBoundary(boundary: readonly Point2[], x: number, z: number): number {
  let distanceSquared = Infinity
  for (let index = 0; index < boundary.length; index += 1) {
    distanceSquared = Math.min(
      distanceSquared,
      pointSegmentDistanceSquared(
        [x, z],
        boundary[index]!,
        boundary[(index + 1) % boundary.length]!,
      ),
    )
  }
  return Math.sqrt(distanceSquared)
}

function pointInPolygonInterior(boundary: readonly Point2[], x: number, z: number): boolean {
  if (!pointInPolygon(boundary, x, z)) return false
  return distanceToBoundary(boundary, x, z) > SITE_EPSILON
}

function pointInPolygon(boundary: readonly Point2[], x: number, z: number): boolean {
  let inside = false
  for (
    let current = 0, previous = boundary.length - 1;
    current < boundary.length;
    previous = current, current += 1
  ) {
    const a = boundary[current]!
    const b = boundary[previous]!
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

function polygonBounds(points: readonly Point2[]) {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ }
}

function bankCorridorQuad(segment: ChannelSegment): readonly Point2[] {
  const tangent = normalized(segment.end.x - segment.start.x, segment.end.z - segment.start.z)
  const normalX = -tangent[1]
  const normalZ = tangent[0]
  const clearance = Math.max(segment.start.incisionHalfWidth, segment.end.incisionHalfWidth) + 1.5
  return [
    [segment.start.x + normalX * clearance, segment.start.z + normalZ * clearance],
    [segment.end.x + normalX * clearance, segment.end.z + normalZ * clearance],
    [segment.end.x - normalX * clearance, segment.end.z - normalZ * clearance],
    [segment.start.x - normalX * clearance, segment.start.z - normalZ * clearance],
  ]
}

function triangleBounds(triangle: ClipTriangle) {
  return polygonBounds(triangle.map((point): Point2 => [point.x, point.y]))
}

function boundsOverlap(
  first: Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }>,
  second: Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }>,
): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minZ <= second.maxZ &&
    first.maxZ >= second.minZ
  )
}

function cross2(start: Point2, end: Point2, point: Point2): number {
  return (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
}

function cross2Vector(start: Vector2, end: Vector2, point: Vector2): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
}

function cross2Point(start: Vector2, end: Vector2, x: number, z: number): number {
  return (end.x - start.x) * (z - start.y) - (end.y - start.y) * (x - start.x)
}

function normalized(x: number, z: number): Point2 {
  const length = Math.hypot(x, z)
  return length > SITE_EPSILON ? [x / length, z / length] : [1, 0]
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = clamp01((value - start) / (end - start))
  return amount * amount * (3 - 2 * amount)
}

function angularDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)))
}

function finitePoint(point: Point2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1])
}

function waterQuality(value: string): WaterQuality {
  return value in POND_WATER_APPEARANCE ? (value as WaterQuality) : 'clear'
}
