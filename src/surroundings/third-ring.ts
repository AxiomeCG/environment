import type { Point2 } from './frontages'
import type { HorizonFoliagePlan } from './horizon-foliage'
import type { RoadPresentationAlignmentDescriptor } from './corridor'
import { distanceToRoads } from './outer-roads'
import { hashString, seededRange, seededUnit } from './seeded-random'
import { polygonCentroid } from './exterior-terrain'
import { deriveLandscapeRegion, regionPoint, type LandscapeRegion } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'

export type DistantHousePalette = Readonly<{
  wall: string
  roof: string
  trim: string
  door: string
  foundation: string
  glass: string
}>

export type DistantMass = Readonly<{
  id: string
  position: readonly [number, number, number]
  dimensions: readonly [width: number, wallHeight: number, depth: number]
  rotationY: number
  style: 'bungalow' | 'cottage' | 'villa'
  storeys: 1 | 2
  roof: Readonly<{
    kind: 'gable' | 'hip'
    pitchDegrees: number
    overhang: number
  }>
  facade: Readonly<{
    doorSide: -1 | 1
    frontWindowCount: 2 | 3
    sideWindowSide: -1 | 1
  }>
  wing?: Readonly<{
    side: -1 | 1
    width: number
    depth: number
    wallHeight: number
    roofKind: 'gable' | 'hip'
    roofPitchDegrees: number
  }>
  palette: DistantHousePalette
  foundationDepth: number
}>
export type SkylineMass = Readonly<{
  id: string
  position: readonly [number, number, number]
  dimensions: readonly [width: number, height: number, depth: number]
  rotationY: number
  style: 'slab' | 'stepped' | 'tower'
  storeys: number
  palette: DistantHousePalette
  foundationDepth: number
}>
export type FieldPatch = Readonly<{
  id: string
  kind: 'wheat' | 'woodland'
  center: Point2
  width: number
  depth: number
  rotationY: number
  seed: number
}>
export type BoulderPlan = Readonly<{
  id: string
  position: readonly [number, number, number]
  dimensions: readonly [number, number, number]
  rotationY: number
  variant: number
  color: string
}>
export type LighthousePlan = Readonly<{
  position: readonly [number, number, number]
  rotationY: number
  height: number
  stripe: string
  foundationDepth: number
}>
export type ThirdRingPlan = Readonly<{
  buildings: readonly DistantMass[]
  skyline: readonly SkylineMass[]
  trees: readonly HorizonFoliagePlan[]
  fields: readonly FieldPatch[]
  region: LandscapeRegion
  boulders: readonly BoulderPlan[]
  lighthouse: LighthousePlan | null
}>
export type ThirdRingContext = Readonly<{
  boundary: readonly Point2[]
  roads: readonly RoadPresentationAlignmentDescriptor[]
  heightAt: (x: number, z: number) => number
  seed?: string
  nearRoads?: readonly RoadPresentationAlignmentDescriptor[]
  exclusions?: readonly (readonly Point2[])[]
}>
export const THIRD_RING_BUDGET = { buildings: 64, skyline: 12, trees: 3072, fields: 8, fieldBlades: 8192, boulders: 96 } as const

type FootprintRectangle = Readonly<{
  center: Point2
  right: Point2
  front: Point2
  width: number
  depth: number
  polygon: readonly Point2[]
}>

type RoadCandidate = Readonly<{
  key: string
  road: RoadPresentationAlignmentDescriptor
  point: Point2
  tangent: Point2
  side: -1 | 1
  priority: number
}>

const EPSILON = 1e-7
const SITE_CLEARANCE = 10
const HOUSE_CLEARANCE = 3.5
const MAX_FOOTPRINT_RELIEF = 0.85

const DISTANT_PALETTE_DISTRICTS = [
  {
    walls: ['#b8b2a5', '#c0b9aa', '#afa99d'],
    roof: '#4c4b47',
    trim: '#e4dfd5',
    door: '#765540',
    foundation: '#77736b',
    glass: '#53676d',
  },
  {
    walls: ['#a8b0a2', '#b2b7aa', '#9fa89c'],
    roof: '#454d4a',
    trim: '#deddd4',
    door: '#586756',
    foundation: '#6e746d',
    glass: '#4d6268',
  },
  {
    walls: ['#bda995', '#b4a492', '#c2b09c'],
    roof: '#594e49',
    trim: '#e8dfd3',
    door: '#70493d',
    foundation: '#7c6e63',
    glass: '#50636a',
  },
  {
    walls: ['#a9b1b0', '#b4bab7', '#a2abaa'],
    roof: '#464d52',
    trim: '#e0ddd5',
    door: '#4e5d63',
    foundation: '#70777a',
    glass: '#4b6068',
  },
] as const

function add(first: Point2, second: Point2): Point2 {
  return [first[0] + second[0], first[1] + second[1]]
}

function scale(point: Point2, amount: number): Point2 {
  return [point[0] * amount, point[1] * amount]
}

function pointToSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0], dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const amount = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared))
  return Math.hypot(point[0] - start[0] - dx * amount, point[1] - start[1] - dz * amount)
}

function cross(first: Point2, second: Point2, third: Point2): number {
  return (second[0] - first[0]) * (third[1] - first[1])
    - (second[1] - first[1]) * (third[0] - first[0])
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return Math.abs(cross(start, end, point)) <= EPSILON
    && point[0] >= Math.min(start[0], end[0]) - EPSILON
    && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON
    && point[1] <= Math.max(start[1], end[1]) + EPSILON
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d)
  const cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true
  return (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d))
}

function segmentDistance(a: Point2, b: Point2, c: Point2, d: Point2): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  )
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!, end = polygon[index]!
    if (pointOnSegment(point, start, end)) return true
    if ((start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]) {
      inside = !inside
    }
  }
  return inside
}

function polygonDistance(first: readonly Point2[], second: readonly Point2[]): number {
  if (first.some((point) => pointInPolygon(point, second))
    || second.some((point) => pointInPolygon(point, first))) return 0
  let distance = Infinity
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex]!, firstEnd = first[(firstIndex + 1) % first.length]!
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      distance = Math.min(distance, segmentDistance(
        firstStart,
        firstEnd,
        second[secondIndex]!,
        second[(secondIndex + 1) % second.length]!,
      ))
    }
  }
  return distance
}

function rectangle(
  center: Point2,
  right: Point2,
  front: Point2,
  width: number,
  depth: number,
): FootprintRectangle {
  const halfRight = scale(right, width / 2), halfFront = scale(front, depth / 2)
  return {
    center,
    right,
    front,
    width,
    depth,
    polygon: [
      add(add(center, scale(halfRight, -1)), scale(halfFront, -1)),
      add(add(center, halfRight), scale(halfFront, -1)),
      add(add(center, halfRight), halfFront),
      add(add(center, scale(halfRight, -1)), halfFront),
    ],
  }
}

function alignmentClearance(road: RoadPresentationAlignmentDescriptor): number {
  return road.separator === 'primary-road' ? 8.5 : 6.5
}

function clearOfRoads(
  footprints: readonly FootprintRectangle[],
  roads: readonly RoadPresentationAlignmentDescriptor[],
): boolean {
  for (const footprint of footprints) {
    for (const road of roads) {
      for (let pointIndex = 1; pointIndex < road.centerline.length; pointIndex += 1) {
        const start = road.centerline[pointIndex - 1]!, end = road.centerline[pointIndex]!
        if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= EPSILON) continue
        if (pointInPolygon(start, footprint.polygon) || pointInPolygon(end, footprint.polygon)) return false
        for (let edge = 0; edge < footprint.polygon.length; edge += 1) {
          if (segmentDistance(
            start,
            end,
            footprint.polygon[edge]!,
            footprint.polygon[(edge + 1) % footprint.polygon.length]!,
          ) < alignmentClearance(road)) return false
        }
      }
    }
  }
  return true
}

function clearOfSiteAndHouses(
  footprints: readonly FootprintRectangle[],
  boundary: readonly Point2[],
  occupied: readonly (readonly Point2[])[],
): boolean {
  return footprints.every(({ polygon }) =>
    polygonDistance(polygon, boundary) >= SITE_CLEARANCE
    && occupied.every((other) => polygonDistance(polygon, other) >= HOUSE_CLEARANCE))
}

function footprintGround(
  footprints: readonly FootprintRectangle[],
  heightAt: (x: number, z: number) => number,
  maximumRelief = MAX_FOOTPRINT_RELIEF,
): Readonly<{ base: number; foundationDepth: number }> | null {
  let minimum = Infinity, maximum = -Infinity
  for (const footprint of footprints) {
    for (let across = 0; across <= 4; across += 1) {
      for (let along = 0; along <= 4; along += 1) {
        const localAcross = (across / 4 - 0.5) * footprint.width
        const localAlong = (along / 4 - 0.5) * footprint.depth
        const point = add(add(
          footprint.center,
          scale(footprint.right, localAcross),
        ), scale(footprint.front, localAlong))
        const height = heightAt(point[0], point[1])
        if (!Number.isFinite(height) || height < 0) return null
        minimum = Math.min(minimum, height)
        maximum = Math.max(maximum, height)
      }
    }
  }
  const relief = maximum - minimum
  if (relief > maximumRelief) return null
  return { base: maximum, foundationDepth: Math.max(0.24, relief + 0.22) }
}

function sampleAlignment(
  centerline: readonly Point2[],
  distance: number,
): Readonly<{ point: Point2; tangent: Point2 }> | null {
  let traversed = 0
  for (let index = 1; index < centerline.length; index += 1) {
    const start = centerline[index - 1]!, end = centerline[index]!
    const dx = end[0] - start[0], dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length <= EPSILON) continue
    if (distance <= traversed + length || index === centerline.length - 1) {
      const amount = Math.max(0, Math.min(1, (distance - traversed) / length))
      return {
        point: [start[0] + dx * amount, start[1] + dz * amount],
        tangent: [dx / length, dz / length],
      }
    }
    traversed += length
  }
  return null
}

function alignmentLength(centerline: readonly Point2[]): number {
  let length = 0
  for (let index = 1; index < centerline.length; index += 1) {
    length += Math.hypot(
      centerline[index]![0] - centerline[index - 1]![0],
      centerline[index]![1] - centerline[index - 1]![1],
    )
  }
  return length
}

function paletteAt(seed: string, key: string, x: number, z: number): DistantHousePalette {
  const districtKey = `district:${Math.round(x / 96)}:${Math.round(z / 96)}`
  const district = DISTANT_PALETTE_DISTRICTS[
    Math.floor(seededUnit(seed, districtKey) * DISTANT_PALETTE_DISTRICTS.length)
  ]!
  return {
    wall: district.walls[Math.floor(seededUnit(seed, `${key}:wall`) * district.walls.length)]!,
    roof: district.roof,
    trim: district.trim,
    door: district.door,
    foundation: district.foundation,
    glass: district.glass,
  }
}

function collectRoadCandidates(
  roads: readonly RoadPresentationAlignmentDescriptor[],
  seed: string,
): RoadCandidate[] {
  const candidates: RoadCandidate[] = []
  for (const road of roads) {
    const length = alignmentLength(road.centerline)
    if (length < 18) continue
    const first = road.centerline[0]!, last = road.centerline[road.centerline.length - 1]!
    const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) <= EPSILON
    const endMargin = closed ? 0 : Math.min(12, length * 0.18)
    let station = endMargin + seededRange(seed, `${road.id}:station-origin`, 6, 13)
    let slot = 0
    while (station < length - endMargin) {
      const sample = sampleAlignment(road.centerline, station)
      if (sample) {
        const stationKey = `${road.id}:frontage:${slot}`
        const firstSide: -1 | 1 = seededUnit(seed, `${stationKey}:side-order`) < 0.5 ? -1 : 1
        for (const side of [firstSide, firstSide === 1 ? -1 : 1] as const) {
          const key = `${stationKey}:${side < 0 ? 'left' : 'right'}`
          if (seededUnit(seed, `${key}:occupied`) >= 0.16) {
            candidates.push({
              key,
              road,
              point: sample.point,
              tangent: sample.tangent,
              side,
              priority: seededUnit(seed, `${key}:priority`),
            })
          }
        }
      }
      station += seededRange(seed, `${road.id}:station-gap:${slot}`, 18, 25)
      slot += 1
    }
  }
  return candidates.sort((first, second) =>
    first.priority - second.priority || first.key.localeCompare(second.key))
}

function deriveSkyline(
  center: Point2,
  radius: number,
  boundary: readonly Point2[],
  roads: readonly RoadPresentationAlignmentDescriptor[],
  heightAt: (x: number, z: number) => number,
  occupied: (readonly Point2[])[],
  seed: string,
  region: LandscapeRegion,
): SkylineMass[] {
  const skyline: SkylineMass[] = []
  for (let district = 0; district < region.cityDistricts; district += 1) {
    let districtCenter: Point2 | undefined
    let bestScore = Infinity
    let districtAngle = region.cityAngle
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const angle = region.cityAngle + (district - 0.5) * 0.65 + (attempt % 2 ? -1 : 1) * Math.ceil(attempt / 2) * 0.24
      const point = regionPoint(center, angle, radius + region.cityDistance + district * 25)
      const samples = [[0, 0], [-45, 0], [45, 0], [0, -35], [0, 35]].map(([dx, dz]) =>
        heightAt(point[0] + dx!, point[1] + dz!))
      if (samples.some((height) => !Number.isFinite(height) || height < 0)) continue
      const relief = Math.max(...samples) - Math.min(...samples)
      const score = relief + attempt * 0.5
      if (score < bestScore) { bestScore = score; districtCenter = point; districtAngle = angle }
    }
    if (!districtCenter) continue
    const rotationY = Math.PI / 2 - districtAngle + seededRange(seed, `skyline:${district}:yaw`, -0.14, 0.14)
    const right: Point2 = [Math.cos(rotationY), -Math.sin(rotationY)]
    const front: Point2 = [Math.sin(rotationY), Math.cos(rotationY)]
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 3; column += 1) {
      if (skyline.length >= THIRD_RING_BUDGET.skyline) return skyline
      const key = `skyline:${district}:${row}:${column}`
      const style: SkylineMass['style'] = column === 1 ? 'tower' : row === 1 ? 'stepped' : 'slab'
      const storeys = Math.floor(seededRange(seed, `${key}:storeys`,
        style === 'tower' ? 19 : style === 'stepped' ? 12 : 8,
        style === 'tower' ? 25 : style === 'stepped' ? 17 : 12))
      const width = seededRange(seed, `${key}:width`, style === 'slab' ? 28 : 18, style === 'slab' ? 38 : 26)
      const depth = seededRange(seed, `${key}:depth`, 16, 24)
      const point = add(add(districtCenter,
        scale(right, (column - 1) * 50 + seededRange(seed, `${key}:x`, -6, 6))),
      scale(front, row * 48 + seededRange(seed, `${key}:z`, -6, 6)))
      // Include the wider two-storey podium in every clearance and ground check.
      const footprint = rectangle(point, right, front, width + 4, depth + 4)
      if (!clearOfRoads([footprint], roads)
        || !clearOfSiteAndHouses([footprint], boundary, occupied)) continue
      const ground = footprintGround([footprint], heightAt, 5)
      if (!ground) continue
      skyline.push({
        id: key,
        position: [point[0], ground.base, point[1]],
        dimensions: [width, storeys * 3.4, depth],
        rotationY,
        style,
        storeys,
        palette: paletteAt(seed, key, point[0], point[1]),
        foundationDepth: ground.foundationDepth,
      })
      occupied.push(footprint.polygon)
    }
  }
  return skyline
}

/** A staggered woodland belt screens city podiums without hiding the skyline. */
function deriveCityWoodland(
  skyline: readonly SkylineMass[], center: Point2,
  groundAt: (x: number, z: number) => number | undefined,
  seed: string, region: LandscapeRegion,
): HorizonFoliagePlan[] {
  const districts = new Map<number, SkylineMass[]>()
  for (const building of skyline) {
    const district = districts.get(building.rotationY)
    if (district) district.push(building)
    else districts.set(building.rotationY, [building])
  }
  const trees: HorizonFoliagePlan[] = []
  let districtIndex = 0
  for (const buildings of districts.values()) {
    const x = buildings.reduce((sum, building) => sum + building.position[0], 0) / buildings.length - center[0]
    const z = buildings.reduce((sum, building) => sum + building.position[2], 0) / buildings.length - center[1]
    const angle = Math.atan2(z, x), cosine = Math.cos(angle), sine = Math.sin(angle)
    let nearest = Infinity, left = Infinity, right = -Infinity
    for (const building of buildings) {
      const dx = building.position[0] - center[0], dz = building.position[2] - center[1]
      const radius = Math.hypot(building.dimensions[0] + 4, building.dimensions[2] + 4) / 2
      nearest = Math.min(nearest, dx * cosine + dz * sine - radius)
      left = Math.min(left, -dx * sine + dz * cosine - radius - 8)
      right = Math.max(right, -dx * sine + dz * cosine + radius + 8)
    }
    for (let row = 0; row < 5; row += 1) for (let column = 0; left + column * 7 < right; column += 1) {
      if (trees.length >= THIRD_RING_BUDGET.trees / 8) return trees
      const key = `city-woodland:${districtIndex}:${row}:${column}`
      const along = nearest - 24 - row * 8 + seededRange(seed, `${key}:along`, -2, 2)
      const across = left + column * 7 + (row % 2) * 3.5 + seededRange(seed, `${key}:across`, -2.5, 2.5)
      const point = regionPoint(center, angle, along, across)
      const y = groundAt(point[0], point[1])
      if (y === undefined) continue
      const pine = seededUnit(seed, `city-woodland:${districtIndex}:species:${Math.floor(column / 5)}`) < 0.4
      trees.push({
        id: key, clusterId: `city-woodland-${districtIndex}`, archetype: pine ? 'dense-pine' : 'dense-oak',
        species: pine ? 'pine' : 'oak', position: [point[0], y, point[1]],
        rotationY: seededRange(seed, `${key}:yaw`, -Math.PI, Math.PI),
        height: seededRange(seed, `${key}:height`, 12, 19) * region.forestHeight,
        leafColor: region.palette.foliage[column % region.palette.foliage.length]!,
      })
    }
    districtIndex += 1
  }
  return trees
}

function deriveFields(
  center: Point2,
  radius: number,
  boundary: readonly Point2[],
  roads: readonly RoadPresentationAlignmentDescriptor[],
  heightAt: (x: number, z: number) => number,
  occupied: (readonly Point2[])[],
  trees: readonly HorizonFoliagePlan[],
  seed: string,
): FieldPatch[] {
  const fields: FieldPatch[] = []
  const woodlandTrees = trees.filter(({ position }) =>
    Math.hypot(position[0] - center[0], position[2] - center[1]) < radius + 330)
  const counts = { wheat: 0, woodland: 0 }
  for (let index = 0; index < 48 && fields.length < THIRD_RING_BUDGET.fields; index += 1) {
    const kind = index % 2 === 0 ? 'wheat' : 'woodland'
    if (counts[kind] >= THIRD_RING_BUDGET.fields / 2) continue
    const key = `field:${kind}:${index}`
    const angle = index * 2.399963229728653 + seededRange(seed, `${key}:angle`, -0.3, 0.3)
    const distance = radius + seededRange(seed, `${key}:distance`, 110, 195)
    const tree = woodlandTrees[Math.floor(seededUnit(seed, `${key}:tree`) * woodlandTrees.length)]
    if (kind === 'woodland' && !tree) continue
    const point: Point2 = kind === 'woodland' && tree
      ? [tree.position[0] + 6, tree.position[2] - 6]
      : [center[0] + Math.cos(angle) * distance, center[1] + Math.sin(angle) * distance]
    const rotationY = seededRange(seed, `${key}:yaw`, -0.3, 0.3)
    const width = seededRange(seed, `${key}:width`, kind === 'wheat' ? 50 : 32, kind === 'wheat' ? 74 : 54)
    const depth = seededRange(seed, `${key}:depth`, 30, 48)
    const right: Point2 = [Math.cos(rotationY), -Math.sin(rotationY)]
    const front: Point2 = [Math.sin(rotationY), Math.cos(rotationY)]
    const footprint = rectangle(point, right, front, width, depth)
    if (!clearOfRoads([footprint], roads)
      || !clearOfSiteAndHouses([footprint], boundary, occupied)
      || !footprintGround([footprint], heightAt, kind === 'wheat' ? 5 : 9)) continue
    if (kind === 'wheat' && trees.some(({ position }) =>
      pointInPolygon([position[0], position[2]], footprint.polygon))) continue
    fields.push({ id: key, kind, center: point, width, depth, rotationY, seed: hashString(`${seed}:${key}`) })
    occupied.push(footprint.polygon)
    counts[kind] += 1
  }
  return fields
}

function deriveLighthouse(
  center: Point2, radius: number, boundary: readonly Point2[],
  roads: readonly RoadPresentationAlignmentDescriptor[],
  heightAt: (x: number, z: number) => number, occupied: (readonly Point2[])[],
  seed: string, region: LandscapeRegion,
): LighthousePlan | null {
  if (!region.coast) return null
  const angle = region.coast.angle
  const rotationY = Math.PI / 2 - angle
  const right: Point2 = [Math.cos(rotationY), -Math.sin(rotationY)]
  const front: Point2 = [Math.sin(rotationY), Math.cos(rotationY)]
  let selected: LighthousePlan | null = null
  let selectedFootprint: FootprintRectangle | undefined
  let bestScore = -Infinity
  for (let across = -310; across <= 310; across += 31) {
    let land = radius + 65, water = radius + 400
    const landPoint = regionPoint(center, angle, land, across)
    if (heightAt(landPoint[0], landPoint[1]) < SEA_LEVEL) continue
    const waterPoint = regionPoint(center, angle, water, across)
    if (heightAt(waterPoint[0], waterPoint[1]) >= SEA_LEVEL) continue
    for (let iteration = 0; iteration < 9; iteration += 1) {
      const middle = (land + water) / 2
      const point = regionPoint(center, angle, middle, across)
      if (heightAt(point[0], point[1]) >= SEA_LEVEL) land = middle
      else water = middle
    }
    const point = regionPoint(center, angle, land - 38, across)
    // Include the keeper's cottage east of the shaft in the foundation envelope.
    const footprint = rectangle(add(point, scale(right, 4)), right, front, 21, 12)
    if (!clearOfRoads([footprint], roads) || !clearOfSiteAndHouses([footprint], boundary, occupied)) continue
    const ground = footprintGround([footprint], heightAt, 3)
    if (!ground) continue
    const score = land - radius + ground.base * 2
    if (score <= bestScore) continue
    bestScore = score
    selectedFootprint = footprint
    selected = {
      position: [point[0], ground.base, point[1]], rotationY,
      height: seededRange(seed, 'lighthouse:height', 18, 28),
      stripe: seededUnit(seed, 'lighthouse:stripe') < 0.6 ? '#9e5947' : '#4e6270',
      foundationDepth: ground.foundationDepth,
    }
  }
  if (selectedFootprint) occupied.push(selectedFootprint.polygon)
  return selected
}

function deriveBoulders(
  center: Point2, radius: number, boundary: readonly Point2[],
  roads: readonly RoadPresentationAlignmentDescriptor[],
  heightAt: (x: number, z: number) => number, occupied: (readonly Point2[])[],
  seed: string, region: LandscapeRegion,
): BoulderPlan[] {
  const boulders: BoulderPlan[] = []
  for (let index = 0; index < THIRD_RING_BUDGET.boulders; index += 1) {
    const cluster = Math.floor(index / 8)
    const key = `boulder:${index}`
    const angle = seededRange(seed, `boulder-cluster:${cluster}:angle`, -Math.PI, Math.PI)
    const distance = radius + seededRange(seed, `boulder-cluster:${cluster}:distance`, 48, 390)
    const centerPoint = regionPoint(center, angle, distance)
    const point: Point2 = [centerPoint[0] + seededRange(seed, `${key}:x`, -22, 22),
      centerPoint[1] + seededRange(seed, `${key}:z`, -22, 22)]
    const large = index % 8 === 0 && distance > radius + 130
    const width = seededRange(seed, `${key}:width`, large ? 7 : 2, large ? 16 : 6)
    const height = width * seededRange(seed, `${key}:height`, 0.65, 1.1)
    const depth = width * seededRange(seed, `${key}:depth`, 0.75, 1.25)
    const rotationY = seededRange(seed, `${key}:yaw`, -Math.PI, Math.PI)
    const right: Point2 = [Math.cos(rotationY), -Math.sin(rotationY)]
    const front: Point2 = [Math.sin(rotationY), Math.cos(rotationY)]
    const footprint = rectangle(point, right, front, width, depth)
    if (!clearOfRoads([footprint], roads) || !clearOfSiteAndHouses([footprint], boundary, occupied)) continue
    const ground = footprintGround([footprint], heightAt, height * 0.5)
    if (!ground) continue
    boulders.push({
      id: key, position: [point[0], ground.base - height * 0.05, point[1]],
      dimensions: [width, height, depth], rotationY,
      variant: Math.floor(seededUnit(seed, `${key}:variant`) * 4), color: region.palette.stone,
    })
    occupied.push(footprint.polygon)
  }
  return boulders
}

/** Streets determine settlements; elevation and clearance determine buildable ground. */
export function deriveThirdRingPlan({ boundary, roads, heightAt, seed = 'pascal-suburbs', nearRoads = [], exclusions = [] }: ThirdRingContext): ThirdRingPlan {
  const region = deriveLandscapeRegion(seed)
  if (boundary.length < 3 || !boundary.every((point) => point.every(Number.isFinite))) return { buildings: [], skyline: [], trees: [], fields: [], region, boulders: [], lighthouse: null }
  const center = polygonCentroid(boundary)
  const radius = Math.max(...boundary.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1])))
  const buildings: DistantMass[] = [], trees: HorizonFoliagePlan[] = []
  const occupied: (readonly Point2[])[] = [...exclusions]
  const clearanceRoads = [...roads, ...nearRoads]
  const greens = region.palette.foliage
  for (const candidate of collectRoadCandidates(roads, seed)) {
    if (buildings.length >= THIRD_RING_BUDGET.buildings) break
    const { key, point, tangent, side } = candidate
    const styleRoll = seededUnit(seed, `${key}:style`)
    const style: DistantMass['style'] = styleRoll < 0.38
      ? 'bungalow'
      : styleRoll < 0.73 ? 'cottage' : 'villa'
    const storeys: 1 | 2 = style === 'villa' ? 2 : 1
    const width = seededRange(seed, `${key}:width`,
      style === 'bungalow' ? 9.2 : 7.8, style === 'bungalow' ? 12.2 : 10.8)
    const depth = seededRange(seed, `${key}:depth`, 7.2, style === 'bungalow' ? 9.4 : 10.2)
    const wallHeight = storeys === 2
      ? seededRange(seed, `${key}:wall-height`, 5.25, 5.85)
      : seededRange(seed, `${key}:wall-height`, 2.8, 3.35)
    const roofKind: DistantMass['roof']['kind'] = style === 'bungalow'
      || seededUnit(seed, `${key}:roof-kind`) < 0.26 ? 'hip' : 'gable'
    const pitchDegrees = roofKind === 'hip'
      ? seededRange(seed, `${key}:roof-pitch`, 20, 29)
      : seededRange(seed, `${key}:roof-pitch`, 27, 38)
    const front: Point2 = [tangent[1] * side, -tangent[0] * side]
    const right: Point2 = [front[1], -front[0]]
    const awayFromRoad = scale(front, -1)
    const setback = seededRange(seed, `${key}:setback`, 2.8, 5.6)
    const centerPoint = add(point, scale(
      awayFromRoad,
      alignmentClearance(candidate.road) + setback + depth / 2,
    ))
    const body = rectangle(centerPoint, right, front, width, depth)
    let wing: DistantMass['wing']
    let footprints: FootprintRectangle[] = [body]
    if (seededUnit(seed, `${key}:wing`) < 0.34) {
      const wingSide: -1 | 1 = seededUnit(seed, `${key}:wing-side`) < 0.5 ? -1 : 1
      const wingWidth = seededRange(seed, `${key}:wing-width`, 3.1, 4.3)
      const wingDepth = seededRange(seed, `${key}:wing-depth`, 4.7, Math.min(6.5, depth - 0.45))
      const wingCenter = add(add(
        centerPoint,
        scale(right, wingSide * (width / 2 + wingWidth / 2 - 0.32)),
      ), scale(front, depth / 2 - wingDepth / 2))
      const proposedWing = rectangle(wingCenter, right, front, wingWidth, wingDepth)
      const proposedFootprints = [body, proposedWing]
      if (clearOfRoads(proposedFootprints, clearanceRoads)
        && clearOfSiteAndHouses(proposedFootprints, boundary, occupied)) {
        wing = {
          side: wingSide,
          width: wingWidth,
          depth: wingDepth,
          wallHeight: seededRange(seed, `${key}:wing-wall-height`, 2.45, 2.85),
          roofKind: seededUnit(seed, `${key}:wing-roof-kind`) < 0.34 ? 'gable' : 'hip',
          roofPitchDegrees: seededRange(seed, `${key}:wing-roof-pitch`, 18, 27),
        }
        footprints = proposedFootprints
      }
    }
    if (!clearOfRoads(footprints, clearanceRoads)
      || !clearOfSiteAndHouses(footprints, boundary, occupied)) continue
    let ground = footprintGround(footprints, heightAt)
    if (!ground && wing) {
      wing = undefined
      footprints = [body]
      ground = footprintGround(footprints, heightAt)
    }
    if (!ground) continue
    const rotationY = Math.atan2(front[0], front[1])
    buildings.push({
      id: `third-ring-house-${key}`,
      position: [centerPoint[0], ground.base, centerPoint[1]],
      dimensions: [width, wallHeight, depth],
      rotationY,
      style,
      storeys,
      roof: {
        kind: roofKind,
        pitchDegrees,
        overhang: seededRange(seed, `${key}:roof-overhang`, 0.42, 0.72),
      },
      facade: {
        doorSide: wing ? (wing.side === 1 ? -1 : 1) : seededUnit(seed, `${key}:door-side`) < 0.5 ? -1 : 1,
        frontWindowCount: seededUnit(seed, `${key}:window-count`) < 0.54 ? 2 : 3,
        sideWindowSide: seededUnit(seed, `${key}:side-window`) < 0.5 ? -1 : 1,
      },
      ...(wing ? { wing } : {}),
      palette: paletteAt(seed, key, centerPoint[0], centerPoint[1]),
      foundationDepth: ground.foundationDepth,
    })
    occupied.push(...footprints.map(({ polygon }) => polygon))
  }
  const skyline = deriveSkyline(center, radius, boundary, clearanceRoads, heightAt, occupied, seed, region)
  const lighthouse = deriveLighthouse(center, radius, boundary, clearanceRoads, heightAt, occupied, seed, region)
  const buildingClearances = occupied.map((polygon) => {
    const [x, z] = polygonCentroid(polygon)
    return { x, z, radiusSquared: (Math.max(...polygon.map((point) => Math.hypot(point[0] - x, point[1] - z))) + 8) ** 2 }
  })
  const treeGroundAt = (x: number, z: number): number | undefined => {
    const y = heightAt(x, z)
    if (!Number.isFinite(y) || y < 0 || y > 100 || distanceToRoads(x, z, clearanceRoads) < 14) return undefined
    if (buildingClearances.some((building) =>
      (x - building.x) ** 2 + (z - building.z) ** 2 < building.radiusSquared)) return undefined
    return y
  }
  trees.push(...deriveCityWoodland(skyline, center, treeGroundAt, seed, region))
  const forestCandidates = THIRD_RING_BUDGET.trees - trees.length
  // Only these very distant forest masses use simplified silhouettes. Near
  // streets and the intermediate skyline retain shared EZ-Tree prototypes.
  for (let i = 0; i < forestCandidates; i += 1) {
    const cluster = Math.floor(i / 12)
    if (seededUnit(seed, `forest-presence:${cluster}`) > region.forestDensity) continue
    const angle = cluster * 2.399963229728653 + region.forestRotation + seededRange(seed, `tree-angle:${i}`, -0.065, 0.065)
    const distance = radius + Math.sqrt(210 * 210 + seededUnit(seed, `forest-radius:${cluster}`) * (465 * 465 - 210 * 210))
      + seededRange(seed, `tree-radius:${i}`, -14, 14)
    const x = center[0] + Math.cos(angle) * distance, z = center[1] + Math.sin(angle) * distance
    const y = treeGroundAt(x, z)
    if (y === undefined) continue
    const pine = seededUnit(seed, `tree-species:${cluster}`) < 0.4
    trees.push({ id: `third-ring-tree-${i}`, clusterId: `third-ring-grove-${cluster}`, archetype: pine ? 'dense-pine' : 'dense-oak', species: pine ? 'pine' : 'oak', position: [x, y, z], rotationY: seededRange(seed, `tree-yaw:${i}`, -Math.PI, Math.PI), height: seededRange(seed, `tree-height:${i}`, 10, 18) * region.forestHeight, leafColor: greens[cluster % greens.length]! })
  }
  const boulders = deriveBoulders(center, radius, boundary, clearanceRoads, heightAt, occupied, seed, region)
  const fields = deriveFields(center, radius, boundary, clearanceRoads, heightAt, occupied, trees, seed)
  return { buildings, skyline, trees, fields, region, boulders, lighthouse }
}
