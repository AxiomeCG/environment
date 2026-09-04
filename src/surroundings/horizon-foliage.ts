import type { RoadPresentationAlignmentDescriptor, SurroundingsCorridorDescriptor } from './corridor'
import type { Point2 } from './frontages'
import { seededRange } from './seeded-random'
import { deriveLandscapeRegion } from './landscape-region'
import { distanceToRoads } from './outer-roads'

export type HorizonFoliageSpecies = 'oak' | 'pine' | 'ash' | 'bush'
export type HorizonFoliageArchetypeId = `dense-${HorizonFoliageSpecies}`

type HorizonFoliageArchetype = Readonly<{
  species: HorizonFoliageSpecies
  height: readonly [number, number]
  leafColors: readonly string[]
}>

export type HorizonFoliagePlan = Readonly<{
  id: string
  clusterId: string
  archetype: HorizonFoliageArchetypeId
  species: HorizonFoliageSpecies
  position: readonly [number, number, number]
  rotationY: number
  height: number
  leafColor: string
}>

export type HorizonFoliageContext = Readonly<{
  boundary: readonly Point2[]
  corridors: readonly SurroundingsCorridorDescriptor[]
  heightAt: (x: number, z: number) => number
  levelTerrainDistance: number
  seed?: string
  roads?: readonly RoadPresentationAlignmentDescriptor[]
  nearRoads?: readonly RoadPresentationAlignmentDescriptor[]
}>

export const HORIZON_FOLIAGE_INSTANCE_BUDGET = 10
export const HORIZON_ROAD_TERMINAL_CLEARANCE = 24
export const HORIZON_ROAD_SIGHTLINE_HALF_ANGLE = 0.14

export const HORIZON_FOLIAGE_ARCHETYPES: Readonly<
  Record<HorizonFoliageArchetypeId, HorizonFoliageArchetype>
> = Object.freeze({
  'dense-oak': Object.freeze({
    species: 'oak',
    height: [21, 26] as const,
    leafColors: ['#49683f', '#557348', '#607d50'],
  }),
  'dense-pine': Object.freeze({
    species: 'pine',
    height: [23, 29] as const,
    leafColors: ['#2f533a', '#385f40', '#416947'],
  }),
  'dense-ash': Object.freeze({
    species: 'ash',
    height: [20, 25] as const,
    leafColors: ['#58764a', '#668355', '#718d5e'],
  }),
  'dense-bush': Object.freeze({
    species: 'bush',
    height: [4.5, 6.2] as const,
    leafColors: ['#3f633d', '#4c7045', '#597b4d'],
  }),
})

const CLUSTER_TREE_ARCHETYPES = [
  'dense-oak',
  'dense-pine',
  'dense-ash',
  'dense-pine',
  'dense-oak',
] as const satisfies readonly HorizonFoliageArchetypeId[]
const DESIRED_CLUSTER_ANGLES = [0.12, 1.02, 1.96, 3.14, 4.28] as const
const CLUSTER_SEARCH_OFFSETS = [
  0,
  0.08,
  -0.08,
  0.16,
  -0.16,
  0.24,
  -0.24,
  0.32,
  -0.32,
  0.4,
  -0.4,
] as const
const CLUSTER_MINIMUM_SEPARATION = 0.5
const CLUSTER_MEMBER_ANGLE_OFFSET = 0.022
const CLUSTER_SIGHTLINE_MARGIN = 0.04
const HORIZON_LEVEL_TERRAIN_MARGIN = 28
const TREE_RADIAL_OFFSET = 2
const BUSH_RADIAL_OFFSET = -1
const FULL_TURN = Math.PI * 2
const EPSILON = 1e-9
const DEFAULT_SEED = 'pascal-suburbs'


export function deriveHorizonFoliagePlan({
  boundary,
  corridors,
  heightAt,
  levelTerrainDistance,
  seed = DEFAULT_SEED,
  roads = [],
  nearRoads = [],
}: HorizonFoliageContext): HorizonFoliagePlan[] {
  if (!hasUsableBoundary(boundary)) return []

  const reference = polygonCentroid(boundary)
  const region = deriveLandscapeRegion(seed)
  const clusterRotation = region.forestRotation
  const terminals = roadTerminalPoints(corridors)
  const terminalAngles = terminals.map((terminal) => angleFrom(reference, terminal))
  const clusterAngles = selectClusterAngles(clusterRotation, terminalAngles, region.openAngle, region.openHalfAngle, region.screenCount)
  const levelDistance = Number.isFinite(levelTerrainDistance)
    ? Math.max(0, levelTerrainDistance)
    : 0
  const horizonOffset = Math.max(region.screenDistance, levelDistance + HORIZON_LEVEL_TERRAIN_MARGIN)
  const plans: HorizonFoliagePlan[] = []

  clusterAngles.forEach((clusterAngle, clusterIndex) => {
    const clusterId = `environment-horizon-cluster-${clusterIndex}`
    const treeArchetype = CLUSTER_TREE_ARCHETYPES[clusterIndex % CLUSTER_TREE_ARCHETYPES.length]!
    const tree = createPlacement({
      archetypeId: treeArchetype,
      angle: clusterAngle - CLUSTER_MEMBER_ANGLE_OFFSET,
      boundary,
      clusterId,
      heightAt,
      horizonOffset,
      heightScale: region.forestHeight,
      member: 'tree',
      memberIndex: 0,
      radialOffset: TREE_RADIAL_OFFSET,
      reference,
      seed,
      terminals,
    })
    if (tree) plans.push(tree)
    const bush = createPlacement({
      archetypeId: 'dense-bush',
      angle: clusterAngle + CLUSTER_MEMBER_ANGLE_OFFSET,
      boundary,
      clusterId,
      heightAt,
      horizonOffset,
      heightScale: region.forestHeight,
      member: 'bush',
      memberIndex: 1,
      radialOffset: BUSH_RADIAL_OFFSET,
      reference,
      seed,
      terminals,
    })
    if (bush) plans.push(bush)
  })

  const clearanceRoads = [...roads, ...nearRoads]
  return plans.filter(({ position }) => distanceToRoads(position[0], position[2], clearanceRoads) >= 14)
    .slice(0, HORIZON_FOLIAGE_INSTANCE_BUDGET)
}

type PlacementInput = Readonly<{
  archetypeId: HorizonFoliageArchetypeId
  angle: number
  boundary: readonly Point2[]
  clusterId: string
  heightAt: (x: number, z: number) => number
  horizonOffset: number
  heightScale: number
  member: 'tree' | 'bush'
  memberIndex: number
  radialOffset: number
  reference: Point2
  seed: string
  terminals: readonly Point2[]
}>

function createPlacement({
  archetypeId,
  angle,
  boundary,
  clusterId,
  heightAt,
  horizonOffset,
  heightScale,
  member,
  memberIndex,
  radialOffset,
  reference,
  seed,
  terminals,
}: PlacementInput): HorizonFoliagePlan | null {
  const archetype = HORIZON_FOLIAGE_ARCHETYPES[archetypeId]
  const direction: Point2 = [Math.cos(angle), Math.sin(angle)]
  const boundaryRadius = Math.max(0, ...boundary.map((point) =>
    dot(subtract(point, reference), direction)))
  const radialJitter = seededRange(seed, `${clusterId}:${member}:radius`, -2.5, 2.5)
  let radius = boundaryRadius + horizonOffset + radialOffset + radialJitter
  let position2: Point2 = add(reference, scale(direction, radius))

  for (let attempt = 0; attempt < 4 && terminals.some((terminal) =>
    distance(position2, terminal) < HORIZON_ROAD_TERMINAL_CLEARANCE); attempt += 1) {
    radius += 8
    position2 = add(reference, scale(direction, radius))
  }

  const elevation = heightAt(position2[0], position2[1])
  if (!Number.isFinite(elevation) || elevation < 0) return null
  const colorIndex = Math.floor(
    seededRange(seed, `${clusterId}:${member}:color`, 0, archetype.leafColors.length),
  ) % archetype.leafColors.length

  return {
    id: `${clusterId}-${memberIndex}-${archetype.species}`,
    clusterId,
    archetype: archetypeId,
    species: archetype.species,
    position: [position2[0], elevation, position2[1]],
    rotationY: seededRange(seed, `${clusterId}:${member}:rotation`, -Math.PI, Math.PI),
    height: seededRange(
      seed,
      `${clusterId}:${member}:height`,
      archetype.height[0],
      archetype.height[1],
    ) * heightScale,
    leafColor: archetype.leafColors[colorIndex] ?? archetype.leafColors[0]!,
  }
}

function selectClusterAngles(rotation: number, terminalAngles: readonly number[], openAngle: number, openHalfAngle: number, count: number): number[] {
  const selected: number[] = []
  const valid = (relativeAngle: number): boolean => {
    const angle = normalizeAngle(rotation + relativeAngle)
    if (angularDistance(angle, openAngle) < openHalfAngle + CLUSTER_MEMBER_ANGLE_OFFSET) return false
    if (selected.some((selectedAngle) =>
      angularDistance(angle, selectedAngle) < CLUSTER_MINIMUM_SEPARATION)) return false
    return terminalAngles.every((terminalAngle) =>
      angularDistance(angle, terminalAngle)
        >= HORIZON_ROAD_SIGHTLINE_HALF_ANGLE + CLUSTER_SIGHTLINE_MARGIN)
  }

  for (const desired of DESIRED_CLUSTER_ANGLES) {
    if (selected.length >= count) break
    const relativeAngle = CLUSTER_SEARCH_OFFSETS
      .map((offset) => desired + offset)
      .find(valid)
    if (relativeAngle !== undefined) selected.push(normalizeAngle(rotation + relativeAngle))
  }

  while (selected.length < count) {
    const candidates: number[] = []
    for (let relativeAngle = 0;
      relativeAngle <= FULL_TURN + EPSILON;
      relativeAngle += 0.05) {
      if (valid(relativeAngle)) candidates.push(relativeAngle)
    }
    const candidate = candidates.sort((left, right) => {
      const leftAngle = normalizeAngle(rotation + left)
      const rightAngle = normalizeAngle(rotation + right)
      const leftScore = minimumAngularDistance(leftAngle, [...selected, ...terminalAngles])
      const rightScore = minimumAngularDistance(rightAngle, [...selected, ...terminalAngles])
      return rightScore - leftScore || left - right
    })[0]
    if (candidate === undefined) break
    selected.push(normalizeAngle(rotation + candidate))
  }

  return selected.sort((left, right) => left - right)
}

function roadTerminalPoints(
  corridors: readonly SurroundingsCorridorDescriptor[],
): Point2[] {
  return corridors.flatMap((corridor) => {
    const halfLength = corridor.road.length / 2
    return [-1, 1].map((sign): Point2 => [
      corridor.road.center[0] + corridor.frame.tangent[0] * halfLength * sign,
      corridor.road.center[1] + corridor.frame.tangent[1] * halfLength * sign,
    ])
  })
}

function minimumAngularDistance(angle: number, others: readonly number[]): number {
  if (others.length === 0) return Math.PI
  return Math.min(...others.map((other) => angularDistance(angle, other)))
}

function angularDistance(first: number, second: number): number {
  const difference = Math.abs(first - second) % FULL_TURN
  return Math.min(difference, FULL_TURN - difference)
}

function normalizeAngle(angle: number): number {
  return (angle % FULL_TURN + FULL_TURN) % FULL_TURN
}

function angleFrom(origin: Point2, point: Point2): number {
  return Math.atan2(point[1] - origin[1], point[0] - origin[0])
}

function add(first: Point2, second: Point2): Point2 {
  return [first[0] + second[0], first[1] + second[1]]
}

function subtract(first: Point2, second: Point2): Point2 {
  return [first[0] - second[0], first[1] - second[1]]
}

function scale(vector: Point2, amount: number): Point2 {
  return [vector[0] * amount, vector[1] * amount]
}

function dot(first: Point2, second: Point2): number {
  return first[0] * second[0] + first[1] * second[1]
}

function distance(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function polygonCentroid(boundary: readonly Point2[]): Point2 {
  let crossSum = 0
  let xSum = 0
  let zSum = 0
  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!
    const next = boundary[(index + 1) % boundary.length]!
    const cross = current[0] * next[1] - next[0] * current[1]
    crossSum += cross
    xSum += (current[0] + next[0]) * cross
    zSum += (current[1] + next[1]) * cross
  }
  const denominator = crossSum * 3
  if (Math.abs(denominator) > EPSILON) return [xSum / denominator, zSum / denominator]

  const x = boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length
  const z = boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length
  return [x, z]
}

function hasUsableBoundary(boundary: readonly Point2[]): boolean {
  return boundary.length >= 3
    && boundary.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}
