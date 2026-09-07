import type { ExteriorTerrainSampler } from './exterior-terrain'
import { buildRoadCrossSection } from './streetscape/road-cross-section'
import { sampleRoadEdgePoints } from './streetscape/road-network-geometry'
import type {
  RoadGraphEdge,
  RoadNetworkNode,
  RoadPoint3,
  RoadStylePreset,
} from './streetscape/schema'

export const RIVER_BRIDGE_CLEARANCE = 0.65
export const MAXIMUM_BRIDGE_WET_RUN = 48
export const MAXIMUM_BRIDGE_APPROACH = 24

const WATER_SAMPLE_SPACING = 0.5
const MAXIMUM_WATER_SAMPLES_PER_EDGE = 4096
const BANK_SETBACK = 1.5
const MINIMUM_APPROACH = 8
const MAXIMUM_APPROACH_GRADE = 0.1
const TRANSITION_REFINEMENTS = 12
const DECK_SAMPLE_SPACING = 4
const PLAN_EPSILON = 1e-6

export type BridgeSpan = Readonly<{
  id: string
  edgeId: string
  width: number
  waterLevel: number
  startStation: number
  endStation: number
  approachStartStation: number
  approachEndStation: number
  points: readonly RoadPoint3[]
  abutmentGroundHeights: readonly [number | null, number | null]
}>

export type RiverBridgesPlan = Readonly<{
  heightAt: (x: number, z: number) => number
  spans: readonly BridgeSpan[]
}>

type PathPoint = Readonly<{ x: number; z: number; station: number }>
type MeasuredPath = Readonly<{
  points: readonly PathPoint[]
  length: number
}>
type WetRun = Readonly<{
  start: number
  end: number
  waterLevel: number
}>
type BridgeProfile = Readonly<{
  span: BridgeSpan
  startDeckHeight: number
  endDeckHeight: number
  approachLength: number
  queryPoints: readonly PathPoint[]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}>

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function waterAt(
  sample: ((x: number, z: number) => number | null) | undefined,
  x: number,
  z: number,
): number | null {
  const value = sample?.(x, z)
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null
}

function measurePath(points: readonly RoadPoint3[]): MeasuredPath | null {
  if (points.length < 2) return null
  const measured: PathPoint[] = [{ x: points[0]![0], z: points[0]![2], station: 0 }]
  let station = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    const length = Math.hypot(point[0] - previous[0], point[2] - previous[2])
    if (length <= PLAN_EPSILON) continue
    station += length
    measured.push({ x: point[0], z: point[2], station })
  }
  return measured.length >= 2 ? { points: measured, length: station } : null
}

function pointAt(path: MeasuredPath, station: number): PathPoint {
  const target = Math.max(0, Math.min(path.length, station))
  for (let index = 1; index < path.points.length; index += 1) {
    const end = path.points[index]!
    if (target > end.station + PLAN_EPSILON) continue
    const start = path.points[index - 1]!
    const length = Math.max(PLAN_EPSILON, end.station - start.station)
    const mix = (target - start.station) / length
    return {
      x: start.x + (end.x - start.x) * mix,
      z: start.z + (end.z - start.z) * mix,
      station: target,
    }
  }
  return path.points.at(-1)!
}

function pathBetween(path: MeasuredPath, startStation: number, endStation: number): PathPoint[] {
  const result = [pointAt(path, startStation)]
  for (const point of path.points) {
    if (point.station > startStation + PLAN_EPSILON && point.station < endStation - PLAN_EPSILON) {
      result.push(point)
    }
  }
  const end = pointAt(path, endStation)
  if (end.station - result.at(-1)!.station > PLAN_EPSILON) result.push(end)
  return result
}

function wetRuns(
  path: MeasuredPath,
  width: number,
  sampleWater: (x: number, z: number) => number | null,
): WetRun[] {
  const waterAcrossRoad = (station: number): number | null => {
    const point = pointAt(path, station)
    const before = pointAt(path, station - 0.1)
    const after = pointAt(path, station + 0.1)
    const length = Math.max(PLAN_EPSILON, Math.hypot(after.x - before.x, after.z - before.z))
    const nx = -(after.z - before.z) / length
    const nz = (after.x - before.x) / length
    let level: number | null = null
    for (const fraction of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const sample = waterAt(
        sampleWater,
        point.x + nx * width * fraction,
        point.z + nz * width * fraction,
      )
      if (sample !== null) level = level === null ? sample : Math.max(level, sample)
    }
    return level
  }
  const sampleCount = Math.max(
    1,
    Math.min(MAXIMUM_WATER_SAMPLES_PER_EDGE, Math.ceil(path.length / WATER_SAMPLE_SPACING)),
  )
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const point = pointAt(path, (path.length * index) / sampleCount)
    return { point, water: waterAcrossRoad(point.station) }
  })
  const boundaryBetween = (leftIndex: number): number => {
    const left = samples[leftIndex]!
    const right = samples[leftIndex + 1]!
    const leftWet = left.water !== null
    let low = left.point.station
    let high = right.point.station
    for (let step = 0; step < TRANSITION_REFINEMENTS; step += 1) {
      const middle = (low + high) / 2
      if ((waterAcrossRoad(middle) !== null) === leftWet) low = middle
      else high = middle
    }
    return (low + high) / 2
  }

  const runs: WetRun[] = []
  let start: number | null = samples[0]!.water === null ? null : 0
  let highestWater = samples[0]!.water ?? -Infinity
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!
    const current = samples[index]!
    if (current.water !== null) highestWater = Math.max(highestWater, current.water)
    if ((previous.water === null) === (current.water === null)) continue
    const boundary = boundaryBetween(index - 1)
    if (current.water !== null) {
      start = boundary
      highestWater = current.water
    } else if (start !== null) {
      runs.push({ start, end: boundary, waterLevel: highestWater })
      start = null
      highestWater = -Infinity
    }
  }
  if (start !== null) runs.push({ start, end: path.length, waterLevel: highestWater })
  return runs
}

function styleFor(network: RoadNetworkNode, edge: RoadGraphEdge): RoadStylePreset | undefined {
  const styleId = network.applyStyleToAll ? network.activeStyleId : edge.styleId
  return network.stylePresets[styleId] ?? network.stylePresets[network.activeStyleId]
}

function bridgeProfile(
  edge: RoadGraphEdge,
  path: MeasuredPath,
  width: number,
  run: WetRun,
  terrain: ExteriorTerrainSampler,
  runIndex: number,
  connectedStart: boolean,
  connectedEnd: boolean,
): BridgeProfile | null {
  if (run.end - run.start > MAXIMUM_BRIDGE_WET_RUN) return null
  const dryStart = run.start > PLAN_EPSILON
  const dryEnd = run.end < path.length - PLAN_EPSILON
  // Continue over shared wet graph nodes, but never end a bridge in open water.
  if ((!dryStart && !connectedStart) || (!dryEnd && !connectedEnd)) return null
  const startStation = Math.max(0, run.start - BANK_SETBACK)
  const endStation = Math.min(path.length, run.end + BANK_SETBACK)
  const start = pointAt(path, startStation)
  const end = pointAt(path, endStation)
  const startGround = terrain.heightAt(start.x, start.z)
  const endGround = terrain.heightAt(end.x, end.z)
  if (![startGround, endGround, run.waterLevel].every(Number.isFinite)) return null
  const minimumDeck = run.waterLevel + RIVER_BRIDGE_CLEARANCE
  const startDeckHeight = Math.max(startGround, minimumDeck)
  const endDeckHeight = Math.max(endGround, minimumDeck)
  const lift = Math.max(
    startDeckHeight - Math.max(startGround, run.waterLevel),
    endDeckHeight - Math.max(endGround, run.waterLevel),
  )
  const approachLength = Math.min(
    MAXIMUM_BRIDGE_APPROACH,
    Math.max(MINIMUM_APPROACH, (lift * 1.5) / MAXIMUM_APPROACH_GRADE),
  )
  const deckLength = endStation - startStation
  const deckSteps = Math.max(1, Math.ceil(deckLength / DECK_SAMPLE_SPACING))
  const points = Array.from({ length: deckSteps + 1 }, (_, index): RoadPoint3 => {
    const station = startStation + (deckLength * index) / deckSteps
    const point = pointAt(path, station)
    const mix = (station - startStation) / deckLength
    return [point.x, startDeckHeight + (endDeckHeight - startDeckHeight) * mix, point.z]
  })
  const span: BridgeSpan = {
    id: `river-bridge:${edge.id}:${runIndex}`,
    edgeId: edge.id,
    width,
    waterLevel: run.waterLevel,
    startStation,
    endStation,
    approachStartStation: startStation - approachLength,
    approachEndStation: endStation + approachLength,
    points,
    abutmentGroundHeights: [dryStart ? startGround : null, dryEnd ? endGround : null],
  }
  const queryPoints = pathBetween(path, startStation, endStation)
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  const reach = width / 2 + approachLength
  for (const point of queryPoints) {
    minX = Math.min(minX, point.x - reach)
    maxX = Math.max(maxX, point.x + reach)
    minZ = Math.min(minZ, point.z - reach)
    maxZ = Math.max(maxZ, point.z + reach)
  }
  return {
    span,
    startDeckHeight,
    endDeckHeight,
    approachLength,
    queryPoints,
    minX,
    maxX,
    minZ,
    maxZ,
  }
}

function profileHeightAt(profile: BridgeProfile, ground: number, x: number, z: number): number {
  if (x < profile.minX || x > profile.maxX || z < profile.minZ || z > profile.maxZ) return ground
  let nearestDistance = Infinity
  let deckHeight = ground
  const { span, queryPoints } = profile
  for (let index = 1; index < queryPoints.length; index += 1) {
    const start = queryPoints[index - 1]!,
      end = queryPoints[index]!
    const dx = end.x - start.x,
      dz = end.z - start.z
    const length = Math.hypot(dx, dz)
    if (length <= PLAN_EPSILON) continue
    const along = ((x - start.x) * dx + (z - start.z) * dz) / length
    const lateral = Math.abs((x - start.x) * dz - (z - start.z) * dx) / length
    const distance = Math.hypot(
      Math.max(0, -along, along - length),
      Math.max(0, lateral - span.width / 2),
    )
    if (distance >= nearestDistance) continue
    nearestDistance = distance
    const station = start.station + Math.max(0, Math.min(length, along))
    const mix = (station - span.startStation) / (span.endStation - span.startStation)
    deckHeight = profile.startDeckHeight + (profile.endDeckHeight - profile.startDeckHeight) * mix
  }
  const influence = smooth(1 - nearestDistance / profile.approachLength)
  return ground + Math.max(0, deckHeight - ground) * influence
}

/**
 * Find bounded crossings over the full road width. A shared, continuous deck
 * envelope also raises incident junction surfaces and their short approaches;
 * terrain remains untouched so the channel stays open underneath.
 */
export function createRiverBridges(
  network: RoadNetworkNode,
  terrain: ExteriorTerrainSampler,
  waterLevelAt: (x: number, z: number) => number | null,
): RiverBridgesPlan {
  const profiles: BridgeProfile[] = []
  const edges = Object.values(network.edges).sort((left, right) => left.id.localeCompare(right.id))
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.startNodeId, (degree.get(edge.startNodeId) ?? 0) + 1)
    degree.set(edge.endNodeId, (degree.get(edge.endNodeId) ?? 0) + 1)
  }
  for (const edge of edges) {
    const style = styleFor(network, edge)
    const path = measurePath(sampleRoadEdgePoints(network, edge, 64))
    if (!style || !path) continue
    const section = buildRoadCrossSection(style)
    const width = section.sides.left.outerOffset + section.sides.right.outerOffset
    const runs = wetRuns(path, width, waterLevelAt)
    runs.forEach((run, index) => {
      const profile = bridgeProfile(
        edge,
        path,
        width,
        run,
        terrain,
        index,
        (degree.get(edge.startNodeId) ?? 0) > 1,
        (degree.get(edge.endNodeId) ?? 0) > 1,
      )
      if (profile) profiles.push(profile)
    })
  }
  const heightAt = (x: number, z: number): number => {
    const ground = terrain.heightAt(x, z)
    let height = ground
    // Max of continuous envelopes keeps intersecting road surfaces coincident.
    for (const profile of profiles)
      height = Math.max(height, profileHeightAt(profile, ground, x, z))
    return height
  }
  for (const { span } of profiles) {
    for (const point of span.points) point[1] = heightAt(point[0], point[2])
  }
  return { heightAt, spans: profiles.map(({ span }) => span) }
}
