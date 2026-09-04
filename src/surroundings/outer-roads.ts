import type { Point2 } from './frontages'
import type {
  RoadPresentationAlignmentDescriptor,
  SurroundingsLayoutDescriptor,
} from './corridor'
import { seededRange, seededUnit } from './seeded-random'

export type DeriveOuterRoadsOptions = Readonly<{
  seed?: string
  heightAt?: (x: number, z: number) => number
}>

type RoadAnchor = Readonly<{
  point: Point2
  tangent: Point2
  outward: Point2
  angle: number
  index: number
}>

const DEFAULT_SEED = 'pascal-outer-neighborhood-v1'
const MAXIMUM_GRADE = 0.12
const MINIMUM_DRY_HEIGHT = -3.5
const MAXIMUM_EARTHWORK = 3
const TERRAIN_SAMPLE_SPACING = 10

function add(point: Point2, direction: Point2, distance: number): Point2 {
  return [
    point[0] + direction[0] * distance,
    point[1] + direction[1] * distance,
  ]
}

function distance(first: Point2, second: Point2): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function direction(first: Point2, second: Point2): Point2 {
  const length = distance(first, second)
  return length > 1e-9
    ? [(second[0] - first[0]) / length, (second[1] - first[1]) / length]
    : [1, 0]
}

function layoutCenter(layout: SurroundingsLayoutDescriptor): Point2 | undefined {
  const boundaryPoints = layout.neighborCells
    .filter(({ kind }) => kind === 'frontage')
    .flatMap(({ polygon }) => polygon.slice(0, 2))
  if (boundaryPoints.length === 0) return undefined
  return [
    boundaryPoints.reduce((sum, point) => sum + point[0], 0) / boundaryPoints.length,
    boundaryPoints.reduce((sum, point) => sum + point[1], 0) / boundaryPoints.length,
  ]
}

function angularDistance(first: number, second: number): number {
  const difference = Math.abs(first - second) % (Math.PI * 2)
  return Math.min(difference, Math.PI * 2 - difference)
}

function roadAnchors(
  road: RoadPresentationAlignmentDescriptor,
  center: Point2,
  seed: string,
): RoadAnchor[] {
  const candidates = road.centerline.slice(1, -1).flatMap((point, index): RoadAnchor[] => {
    const end = road.centerline[index + 2]!
    if (distance(point, end) < 8) return []
    const tangent = direction(point, end)
    let outward: Point2 = [-tangent[1], tangent[0]]
    if (
      outward[0] * (point[0] - center[0])
      + outward[1] * (point[1] - center[1]) < 0
    ) outward = [-outward[0], -outward[1]]
    return [{
      point,
      tangent,
      outward,
      angle: Math.atan2(outward[1], outward[0]),
      index,
    }]
  })
  const ranked = [...candidates].sort((first, second) =>
    seededUnit(seed, `anchor:${second.index}`)
    - seededUnit(seed, `anchor:${first.index}`))
  const selected: RoadAnchor[] = []
  for (const candidate of ranked) {
    if (selected.every(({ angle }) => angularDistance(angle, candidate.angle) >= 0.7)) {
      selected.push(candidate)
    }
    if (selected.length === 3) break
  }
  return selected
}

function terrainPenalty(
  centerline: readonly Point2[],
  heightAt: DeriveOuterRoadsOptions['heightAt'],
): number | undefined {
  if (!heightAt) return 0
  let penalty = 0
  for (let segmentIndex = 1; segmentIndex < centerline.length; segmentIndex += 1) {
    const start = centerline[segmentIndex - 1]!
    const end = centerline[segmentIndex]!
    const segmentLength = distance(start, end)
    const steps = Math.max(1, Math.ceil(segmentLength / TERRAIN_SAMPLE_SPACING))
    const startHeight = heightAt(start[0], start[1])
    let previousHeight = startHeight
    if (!Number.isFinite(previousHeight) || previousHeight < MINIMUM_DRY_HEIGHT) return undefined
    const endHeight = heightAt(end[0], end[1])
    // Road grading removes local bumps. Reject an excessive sustained climb,
    // not each raw-ground derivative before the graded profile exists.
    if (!Number.isFinite(endHeight)
      || Math.abs(endHeight - previousHeight) / segmentLength > MAXIMUM_GRADE) return undefined
    for (let step = 1; step <= steps; step += 1) {
      const mix = step / steps
      const x = start[0] + (end[0] - start[0]) * mix
      const z = start[1] + (end[1] - start[1]) * mix
      const height = heightAt(x, z)
      if (!Number.isFinite(height) || height < MINIMUM_DRY_HEIGHT) return undefined
      const gradedHeight = startHeight + (endHeight - startHeight) * mix
      if (Math.abs(height - gradedHeight) > MAXIMUM_EARTHWORK) return undefined
      const grade = Math.abs(height - previousHeight) / (segmentLength / steps)
      penalty += grade * grade
      previousHeight = height
    }
  }
  return penalty
}

function selectTerrainRoute(
  candidates: readonly (readonly Point2[])[],
  heightAt: DeriveOuterRoadsOptions['heightAt'],
): readonly Point2[] | undefined {
  return candidates
    .flatMap((centerline, index) => {
      const penalty = terrainPenalty(centerline, heightAt)
      return penalty === undefined ? [] : [{ centerline, index, penalty }]
    })
    .sort((first, second) => first.penalty - second.penalty || first.index - second.index)[0]
    ?.centerline
}

function collectorCandidates(anchor: RoadAnchor, seed: string): readonly (readonly Point2[])[] {
  const length = seededRange(seed, `collector:${anchor.index}:length`, 125, 165)
  const firstDepth = seededRange(seed, `collector:${anchor.index}:first-depth`, 38, 48)
  const bend = seededRange(seed, `collector:${anchor.index}:bend`, -7, 7)
  return [1, 0.9, 0.8].map((scale) => [
    anchor.point,
    add(anchor.point, anchor.outward, firstDepth),
    add(add(anchor.point, anchor.outward, length * scale * 0.62), anchor.tangent, bend),
    add(add(anchor.point, anchor.outward, length * scale), anchor.tangent, bend * 0.65),
  ])
}

function blockReturnCandidates(
  collector: readonly Point2[],
  anchor: RoadAnchor,
  seed: string,
): readonly (readonly Point2[])[] {
  const width = seededRange(seed, `block:${anchor.index}:width`, 48, 68)
  const preferredSide = seededUnit(seed, `block:${anchor.index}:side`) < 0.5 ? -1 : 1
  // One returning street bounds two unequal residential blocks. Neither the
  // collector nor its local street finishes in a blunt, unconnected stub.
  return [preferredSide, -preferredSide].flatMap((side) => [1, 0.85].map((scale) => [
    collector[1]!,
    add(collector[1]!, anchor.tangent, width * side * scale),
    add(collector[3]!, anchor.tangent, width * side * scale),
    collector[3]!,
  ]))
}

/**
 * Derive a sparse outer neighborhood from the open near street. Every added road
 * starts on an existing centerline or on one of its collector centerlines.
 */
export function deriveOuterRoads(
  layout: SurroundingsLayoutDescriptor,
  options: DeriveOuterRoadsOptions = {},
): RoadPresentationAlignmentDescriptor[] {
  const nearRoad = layout.outerRoad
  const center = layoutCenter(layout)
  if (!nearRoad || !center || nearRoad.centerline.length < 2) return []

  const seed = options.seed ?? DEFAULT_SEED
  const anchors = roadAnchors(nearRoad, center, seed)
  const hasPrimary = layout.corridors.some(({ separator }) => separator === 'primary-road')
  const roads: RoadPresentationAlignmentDescriptor[] = []

  anchors.forEach((anchor, collectorIndex) => {
    let collector: readonly Point2[] | undefined
    let returningStreet: readonly Point2[] | undefined
    for (const candidate of collectorCandidates(anchor, seed)) {
      if (terrainPenalty(candidate, options.heightAt) === undefined) continue
      const returning = selectTerrainRoute(blockReturnCandidates(candidate, anchor, seed), options.heightAt)
      if (!returning) continue
      collector = candidate
      returningStreet = returning
      break
    }
    if (!collector || !returningStreet) return
    roads.push({
      id: `surroundings-collector-${collectorIndex}`,
      separator: hasPrimary && collectorIndex === 0 ? 'primary-road' : 'secondary-road',
      centerline: collector,
      corridorIds: [],
      junctionIds: [],
    }, {
      id: `surroundings-local-block-${collectorIndex}`,
      separator: 'secondary-road',
      centerline: returningStreet,
      corridorIds: [],
      junctionIds: [],
    })
    const start = returningStreet[1]!, end = returningStreet[2]!
    const along = direction(collector[1]!, collector[3]!)
    const fraction = Math.max(0.25, Math.min(0.75,
      ((collector[2]![0] - collector[1]![0]) * along[0]
        + (collector[2]![1] - collector[1]![1]) * along[1])
      / distance(collector[1]!, collector[3]!)))
    const cross: readonly Point2[] = [collector[2]!, [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]]
    if (terrainPenalty(cross, options.heightAt) !== undefined) roads.push({
      id: `surroundings-local-cross-${collectorIndex}`,
      separator: 'secondary-road',
      centerline: cross,
      corridorIds: [],
      junctionIds: [],
    })
  })

  return roads
}

export function distanceToRoads(x: number, z: number, roads: readonly RoadPresentationAlignmentDescriptor[]): number {
  let distance = Infinity
  for (const road of roads) for (let i = 1; i < road.centerline.length; i += 1) {
    const a = road.centerline[i - 1]!, b = road.centerline[i]!, dx = b[0] - a[0], dz = b[1] - a[1]
    const lengthSquared = dx * dx + dz * dz
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared)) : 0
    distance = Math.min(distance, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t))
  }
  return distance
}
