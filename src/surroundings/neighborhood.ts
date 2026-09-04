import type { NeighborCellDescriptor, SurroundingsLayoutDescriptor } from './corridor'
import type { BoundarySegment, Point2 } from './frontages'
import { buildRoadCrossSection } from './streetscape/road-cross-section'
import type { RoadNetworkNode } from './streetscape/schema'
import { hashString, seededRange, seededUnit } from './seeded-random'

const EPSILON = 1e-7
const ROAD_ACCESS_REACH = 18
// Suburban front yards: room for a driveway, a car, and a lawn strip between
// the sidewalk and the porch.
const ROAD_FRONT_SETBACK = 5.5
const IMPLIED_FRONT_SETBACK = 4.5
const ROAD_CLEARANCE = 1.2
const CELL_MARGIN = 0.45
const TRANSPORT_COVERAGE = 0.35
// Frontage cells are split into lots of roughly this width so a 30 m site edge
// reads as two neighbours rather than one house lost in a 30 m field.
const LOT_WIDTH_TARGET = 17
const HOUSE_OCCUPANCY_RATIO = 0.7
const CORNER_OPEN_BIAS = 0.25
const LONGITUDINAL_VARIATION = 0.75
const SETBACK_VARIATION = 1.25
const ORIENTATION_VARIATION = 2.5 * Math.PI / 180

const HOUSE_STYLES = ['cottage', 'farmhouse', 'pavilion'] as const
const HOUSE_STYLE_CLUSTER_PATTERN = [0, 1, 0, 2, 1, 0] as const

export type HouseStyle = (typeof HOUSE_STYLES)[number]

export type HouseVariant = 0 | 1

type HouseGarageParameters = Readonly<{
  width: number
  depth: number
  wallHeight: number
}>

type HouseVariantParameters = Readonly<{
  variant: HouseVariant
  // Main body width; the envelope adds `garage.width` when present.
  width: number
  depth: number
  wallHeight: number
  pitchDegrees: number
  overhang: number
  garage?: HouseGarageParameters
}>

const GARAGE: HouseGarageParameters = { width: 3.6, depth: 6.2, wallHeight: 2.5 }

const HOUSE_VARIANTS: Readonly<Record<HouseStyle, readonly HouseVariantParameters[]>> = {
  cottage: [
    { variant: 0, width: 7.1, depth: 8.2, wallHeight: 2.65, pitchDegrees: 36, overhang: 0.52 },
    { variant: 1, width: 7.4, depth: 9, wallHeight: 2.82, pitchDegrees: 40, overhang: 0.62, garage: GARAGE },
  ],
  farmhouse: [
    { variant: 0, width: 6.6, depth: 9, wallHeight: 5.1, pitchDegrees: 40, overhang: 0.48 },
    { variant: 1, width: 6.8, depth: 9.8, wallHeight: 5.4, pitchDegrees: 44, overhang: 0.56, garage: GARAGE },
  ],
  pavilion: [
    { variant: 0, width: 8.8, depth: 6.5, wallHeight: 2.55, pitchDegrees: 22, overhang: 0.68 },
    { variant: 1, width: 8.9, depth: 7.2, wallHeight: 2.75, pitchDegrees: 26, overhang: 0.78, garage: GARAGE },
  ],
}

const HOUSE_PALETTES = [
  {
    wall: '#b8b2a5',
    roof: '#4c4b47',
    trim: '#e7e1d6',
    door: '#765540',
    foundation: '#77736b',
    glass: '#53676d',
    accent: '#8a755d',
  },
  {
    wall: '#a8b0a2',
    roof: '#454d4a',
    trim: '#deddd4',
    door: '#586756',
    foundation: '#6e746d',
    glass: '#4d6268',
    accent: '#7e8a77',
  },
  {
    wall: '#bda995',
    roof: '#594e49',
    trim: '#e8dfd3',
    door: '#70493d',
    foundation: '#7c6e63',
    glass: '#50636a',
    accent: '#8d6f5c',
  },
  {
    wall: '#a9b1b0',
    roof: '#464d52',
    trim: '#e0ddd5',
    door: '#4e5d63',
    foundation: '#70777a',
    glass: '#4b6068',
    accent: '#788b8e',
  },
  {
    wall: '#b2a39d',
    roof: '#514b4b',
    trim: '#e4ddd3',
    door: '#664c46',
    foundation: '#766d69',
    glass: '#526269',
    accent: '#866f67',
  },
] as const

export type NeighborCellUse = 'buildable' | 'residual' | 'transport'
export type NeighborCellOccupancy = 'house' | 'garden' | 'grove' | 'none'

export type RoadReservation = Readonly<{
  id: string
  edgeId: string
  start: Point2
  end: Point2
  tangent: Point2
  width: number
  polygon: readonly Point2[]
  clearancePolygon: readonly Point2[]
}>

export type NeighborAccess = Readonly<{
  kind: 'road' | 'implied-outer-road'
  point: Point2
  roadId?: string
}>

export type HouseBuildArea = Readonly<{
  variant: HouseVariant
  center: Point2
  width: number
  depth: number
  front: Point2
  right: Point2
  footprint: readonly Point2[]
  access: NeighborAccess
}>
type HouseFootprintFit = Omit<HouseBuildArea, 'variant' | 'access'>


export type ClassifiedNeighborCell = NeighborCellDescriptor & Readonly<{
  use: NeighborCellUse
  occupancy: NeighborCellOccupancy
  roadCoverage: number
  // Position of this lot along its frontage (0 for corner cells).
  lotIndex: number
  buildArea?: HouseBuildArea
}>

export type HouseGaragePlan = Readonly<{
  // Which side of the body the wing attaches to, in `right` units.
  side: -1 | 1
  width: number
  depth: number
  wallHeight: number
  door: Readonly<{ width: number; height: number }>
}>

export type HouseFacadeSide = 'front' | 'right' | 'back' | 'left'

export type HouseOpening = Readonly<{
  kind: 'door' | 'window'
  offset: number
  width: number
  height: number
  bottom: number
}>

export type HouseFacadePlan = Readonly<{
  side: HouseFacadeSide
  openings: readonly HouseOpening[]
}>

export type HousePalette = Readonly<{
  wall: string
  roof: string
  trim: string
  door: string
  foundation: string
  glass: string
  accent: string
}>

export type HousePlan = Readonly<{
  id: string
  variant: HouseVariant
  cellId: string
  center: Point2
  // Envelope dimensions (body plus attached garage).
  width: number
  depth: number
  front: Point2
  right: Point2
  footprint: readonly Point2[]
  style: HouseStyle
  storeys: 1 | 2
  wallHeight: number
  roof: Readonly<{
    kind: 'gable' | 'gambrel' | 'hip'
    pitchDegrees: number
    overhang: number
  }>
  facades: readonly HouseFacadePlan[]
  garage?: HouseGaragePlan
  palette: HousePalette
  access: NeighborAccess
}>

export type HouseBodyFrame = Readonly<{
  // Body centre offset from the envelope centre, in `right` units.
  offset: number
  width: number
}>

export type HouseFacadeFrame = Readonly<{
  center: Point2
  outward: Point2
  right: Point2
  length: number
}>

function add(first: Point2, second: Point2): Point2 {
  return [first[0] + second[0], first[1] + second[1]]
}

function subtract(first: Point2, second: Point2): Point2 {
  return [first[0] - second[0], first[1] - second[1]]
}

function scale(point: Point2, amount: number): Point2 {
  return [point[0] * amount, point[1] * amount]
}

function dot(first: Point2, second: Point2): number {
  return first[0] * second[0] + first[1] * second[1]
}

function cross(first: Point2, second: Point2): number {
  return first[0] * second[1] - first[1] * second[0]
}

function length(point: Point2): number {
  return Math.hypot(point[0], point[1])
}

function normalize(point: Point2): Point2 | null {
  const magnitude = length(point)
  return magnitude > EPSILON ? scale(point, 1 / magnitude) : null
}

function rightOf(front: Point2): Point2 {
  return [front[1], -front[0]]
}

function rotate(point: Point2, angle: number): Point2 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [
    point[0] * cosine - point[1] * sine,
    point[0] * sine + point[1] * cosine,
  ]
}

function polygonSignedArea(polygon: readonly Point2[]): number {
  let twiceArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    twiceArea += cross(current, next)
  }
  return twiceArea / 2
}

function polygonArea(polygon: readonly Point2[]): number {
  return Math.abs(polygonSignedArea(polygon))
}

function polygonCenter(polygon: readonly Point2[]): Point2 {
  const total = polygon.reduce(
    (sum, point) => add(sum, point),
    [0, 0] as Point2,
  )
  return scale(total, 1 / polygon.length)
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  const segment = subtract(end, start)
  const relative = subtract(point, start)
  if (Math.abs(cross(segment, relative)) > EPSILON) return false
  const projection = dot(relative, segment)
  return projection >= -EPSILON && projection <= dot(segment, segment) + EPSILON
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!
    const end = polygon[index]!
    if (pointOnSegment(point, start, end)) return true
    const crossesRay = (start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < (end[0] - start[0]) * (point[1] - start[1])
        / (end[1] - start[1]) + start[0]
    if (crossesRay) inside = !inside
  }
  return inside
}


function rectangle(
  center: Point2,
  front: Point2,
  width: number,
  depth: number,
): readonly [Point2, Point2, Point2, Point2] {
  const right = rightOf(front)
  const corner = (horizontal: number, forward: number) => add(
    center,
    add(scale(right, horizontal), scale(front, forward)),
  )
  return [
    corner(-width / 2, depth / 2),
    corner(width / 2, depth / 2),
    corner(width / 2, -depth / 2),
    corner(-width / 2, -depth / 2),
  ]
}

function projectPolygon(polygon: readonly Point2[], axis: Point2): [number, number] {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const point of polygon) {
    const projection = dot(point, axis)
    minimum = Math.min(minimum, projection)
    maximum = Math.max(maximum, projection)
  }
  return [minimum, maximum]
}

export function convexPolygonsOverlap(
  first: readonly Point2[],
  second: readonly Point2[],
): boolean {
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]!
      const end = polygon[(index + 1) % polygon.length]!
      const edge = subtract(end, start)
      const axis = normalize([-edge[1], edge[0]])
      if (!axis) continue
      const [firstMinimum, firstMaximum] = projectPolygon(first, axis)
      const [secondMinimum, secondMaximum] = projectPolygon(second, axis)
      if (
        firstMaximum < secondMinimum + EPSILON
        || secondMaximum < firstMinimum + EPSILON
      ) return false
    }
  }
  return true
}

function clipLineIntersection(
  start: Point2,
  end: Point2,
  clipStart: Point2,
  clipEnd: Point2,
): Point2 {
  const direction = subtract(end, start)
  const clipDirection = subtract(clipEnd, clipStart)
  const denominator = cross(direction, clipDirection)
  if (Math.abs(denominator) <= EPSILON) return start
  const mix = cross(subtract(clipStart, start), clipDirection) / denominator
  return add(start, scale(direction, mix))
}

function clipConvexPolygon(
  subject: readonly Point2[],
  clip: readonly Point2[],
): Point2[] {
  let output = subject.map((point) => [...point] as Point2)
  const winding = polygonSignedArea(clip) >= 0 ? 1 : -1

  for (let clipIndex = 0; clipIndex < clip.length; clipIndex += 1) {
    const clipStart = clip[clipIndex]!
    const clipEnd = clip[(clipIndex + 1) % clip.length]!
    const clipEdge = subtract(clipEnd, clipStart)
    const input = output
    output = []
    if (input.length === 0) break

    let previous = input.at(-1)!
    let previousInside = winding * cross(clipEdge, subtract(previous, clipStart)) >= -EPSILON
    for (const current of input) {
      const currentInside = winding * cross(clipEdge, subtract(current, clipStart)) >= -EPSILON
      if (currentInside !== previousInside) {
        output.push(clipLineIntersection(previous, current, clipStart, clipEnd))
      }
      if (currentInside) output.push(current)
      previous = current
      previousInside = currentInside
    }
  }

  return output
}

function closestPointOnSegment(point: Point2, start: Point2, end: Point2): Point2 {
  const segment = subtract(end, start)
  const squaredLength = dot(segment, segment)
  if (squaredLength <= EPSILON) return start
  const mix = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / squaredLength))
  return add(start, scale(segment, mix))
}


function roadPath(
  network: RoadNetworkNode,
  edge: RoadNetworkNode['edges'][string],
): Point2[] {
  const start = network.graphNodes[edge.startNodeId]?.position
  const end = network.graphNodes[edge.endNodeId]?.position
  if (!start || !end) return []
  const points: Point2[] = [
    [start[0], start[2]],
    ...edge.alignment.map((point): Point2 => [point[0], point[2]]),
    [end[0], end[2]],
  ]
  return points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || length(subtract(point, previous)) > EPSILON
  })
}

function roadRectangle(
  start: Point2,
  end: Point2,
  width: number,
): readonly Point2[] | null {
  const direction = subtract(end, start)
  const segmentLength = length(direction)
  const tangent = normalize(direction)
  if (!tangent) return null
  const front = rightOf(tangent)
  return rectangle(
    scale(add(start, end), 0.5),
    front,
    segmentLength + width,
    width,
  )
}

export function deriveRoadReservations(network: RoadNetworkNode): RoadReservation[] {
  return Object.values(network.edges)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((edge): RoadReservation[] => {
      const style = network.stylePresets[edge.styleId]
      if (!style) return []
      const width = buildRoadCrossSection(style).totalWidth
      const points = roadPath(network, edge)
      return points.slice(0, -1).flatMap((start, index): RoadReservation[] => {
        const end = points[index + 1]!
        const tangent = normalize(subtract(end, start))
        const polygon = roadRectangle(start, end, width)
        const clearancePolygon = roadRectangle(start, end, width + ROAD_CLEARANCE * 2)
        if (!tangent || !polygon || !clearancePolygon) return []
        return [{
          id: `${edge.id}:reservation-${index}`,
          edgeId: edge.id,
          start,
          end,
          tangent,
          width,
          polygon,
          clearancePolygon,
        }]
      })
    })
}

function roadCoverage(
  cell: NeighborCellDescriptor,
  reservations: readonly RoadReservation[],
): number {
  const cellArea = polygonArea(cell.polygon)
  if (cellArea <= EPSILON) return 1
  let coveredArea = 0
  for (const reservation of reservations) {
    coveredArea += polygonArea(clipConvexPolygon(cell.polygon, reservation.polygon))
  }
  return Math.min(1, coveredArea / cellArea)
}

function fitsCell(
  cell: NeighborCellDescriptor,
  center: Point2,
  front: Point2,
  width: number,
  depth: number,
  reservations: readonly RoadReservation[],
): HouseFootprintFit | null {
  const footprint = rectangle(center, front, width, depth)
  const envelope = rectangle(
    center,
    front,
    width + CELL_MARGIN * 2,
    depth + CELL_MARGIN * 2,
  )
  if (!envelope.every((point) => pointInPolygon(point, cell.polygon))) return null
  if (reservations.some(({ clearancePolygon }) =>
    convexPolygonsOverlap(footprint, clearancePolygon))) return null
  return {
    center,
    width,
    depth,
    front,
    right: rightOf(front),
    footprint,
  }
}

function houseStyleForCell(
  cell: NeighborCellDescriptor & Readonly<{ lotIndex?: number }>,
  seed: string,
): HouseStyle {
  const frontageIndex = cell.frontageIndices[0] ?? 0
  const position = frontageIndex * 3 + (cell.kind === 'corner' ? 2 : cell.lotIndex ?? 0)
  const phase = Math.floor(seededUnit(seed, 'house-style-cluster-phase') * 2)
  const cluster = Math.floor((position + phase) / 2)
  const role = HOUSE_STYLE_CLUSTER_PATTERN[cluster % HOUSE_STYLE_CLUSTER_PATTERN.length]!
  const themeOffset = Math.floor(seededUnit(seed, 'house-style-theme') * HOUSE_STYLES.length)
  return HOUSE_STYLES[(themeOffset + role) % HOUSE_STYLES.length]!
}

function envelopeWidth(size: HouseVariantParameters): number {
  return size.width + (size.garage?.width ?? 0)
}

function orderedHouseVariants(
  cell: NeighborCellDescriptor,
  seed: string,
): readonly HouseVariantParameters[] {
  const variants = HOUSE_VARIANTS[houseStyleForCell(cell, seed)]
  const preferredIndex = Math.min(
    variants.length - 1,
    Math.floor(seededUnit(seed, `house-variant:${cell.id}`) * variants.length),
  )
  return [
    variants[preferredIndex]!,
    ...variants.filter((_, index) => index !== preferredIndex),
  ]
}

/**
 * Split each frontage cell into side-by-side lots along its site edge. Corner
 * cells stay whole. Lot ids extend the cell id so downstream seeds and tests
 * keep one stable key per lot.
 */
export function subdivideNeighborCells(
  cells: readonly NeighborCellDescriptor[],
): Array<NeighborCellDescriptor & { lotIndex: number }> {
  return cells.flatMap((cell) => {
    if (cell.kind !== 'frontage' || cell.polygon.length !== 4) return [{ ...cell, lotIndex: 0 }]
    const [start, end, outerEnd, outerStart] = cell.polygon as readonly [Point2, Point2, Point2, Point2]
    const frontageLength = length(subtract(end, start))
    const lotCount = Math.max(1, Math.round(frontageLength / LOT_WIDTH_TARGET))
    if (lotCount === 1) return [{ ...cell, lotIndex: 0 }]
    const lerp = (from: Point2, to: Point2, t: number): Point2 => add(from, scale(subtract(to, from), t))
    return Array.from({ length: lotCount }, (_, lotIndex) => {
      const t0 = lotIndex / lotCount
      const t1 = (lotIndex + 1) / lotCount
      return {
        ...cell,
        id: `${cell.id}-lot-${lotIndex}`,
        lotIndex,
        polygon: [
          lerp(start, end, t0),
          lerp(start, end, t1),
          lerp(outerStart, outerEnd, t1),
          lerp(outerStart, outerEnd, t0),
        ],
      }
    })
  })
}

function placementVariation(cell: NeighborCellDescriptor, seed: string) {
  return {
    along: seededRange(
      seed,
      `house-placement:${cell.id}:along`,
      -LONGITUDINAL_VARIATION,
      LONGITUDINAL_VARIATION,
    ),
    angle: seededRange(
      seed,
      `house-placement:${cell.id}:angle`,
      -ORIENTATION_VARIATION,
      ORIENTATION_VARIATION,
    ),
    setback: seededRange(
      seed,
      `house-placement:${cell.id}:setback`,
      -SETBACK_VARIATION,
      SETBACK_VARIATION,
    ),
  }
}

function roadBuildArea(
  cell: NeighborCellDescriptor,
  reservations: readonly RoadReservation[],
  seed: string,
): HouseBuildArea | null {
  const center = polygonCenter(cell.polygon)
  const variation = placementVariation(cell, seed)
  const nearby = reservations.map((road) => {
    const anchor = closestPointOnSegment(center, road.start, road.end)
    return { anchor, distance: length(subtract(center, anchor)), road }
  })
    .filter(({ distance, road }) => distance <= road.width / 2 + ROAD_ACCESS_REACH)
    .sort((left, right) => left.distance - right.distance || left.road.id.localeCompare(right.road.id))

  for (const { anchor, road } of nearby) {
    const normal = rightOf(road.tangent)
    const sideFromCenter = Math.sign(dot(subtract(center, anchor), normal))
      || (hashString(`${cell.id}:${road.id}:side`) % 2 === 0 ? 1 : -1)
    for (const sideSign of [sideFromCenter, -sideFromCenter]) {
      const awayFromRoad = scale(normal, sideSign)
      const nominalFront = scale(awayFromRoad, -1)
      for (const size of orderedHouseVariants(cell, seed)) {
        for (const fallbackAlong of [0, -1.2, 1.2, -2.4, 2.4]) {
          for (const variationScale of [1, 0.5, 0]) {
            const along = fallbackAlong + variation.along * variationScale
            const setback = ROAD_FRONT_SETBACK + variation.setback * variationScale
            const front = rotate(nominalFront, variation.angle * variationScale)
            const accessPoint = add(anchor, scale(road.tangent, along))
            const candidateCenter = add(
              accessPoint,
              scale(awayFromRoad, road.width / 2 + setback + size.depth / 2),
            )
            const fit = fitsCell(
              cell,
              candidateCenter,
              front,
              envelopeWidth(size),
              size.depth,
              reservations,
            )
            if (!fit) continue
            return {
              variant: size.variant,
              ...fit,
              access: {
                kind: 'road',
                point: add(accessPoint, scale(awayFromRoad, road.width / 2)),
                roadId: road.edgeId,
              },
            }
          }
        }
      }
    }
  }

  return null
}

function impliedBuildArea(
  cell: NeighborCellDescriptor,
  segments: ReadonlyMap<number, BoundarySegment>,
  reservations: readonly RoadReservation[],
  seed: string,
): HouseBuildArea | null {
  const variation = placementVariation(cell, seed)
  for (const frontageIndex of cell.frontageIndices) {
    const segment = segments.get(frontageIndex)
    if (!segment || segment.context.separator !== 'none') continue
    const nominalFront = segment.outwardNormal
    const right = rightOf(nominalFront)
    const [, outer] = projectPolygon(cell.polygon, nominalFront)
    const [alongMinimum, alongMaximum] = projectPolygon(cell.polygon, right)
    const alongCenter = (alongMinimum + alongMaximum) / 2

    for (const size of orderedHouseVariants(cell, seed)) {
      for (const fallbackAlong of [0, -1.2, 1.2, -2.4, 2.4]) {
        for (const variationScale of [1, 0.5, 0]) {
          const along = alongCenter + fallbackAlong + variation.along * variationScale
          const setback = IMPLIED_FRONT_SETBACK + variation.setback * variationScale
          const front = rotate(nominalFront, variation.angle * variationScale)
          const accessPoint = add(scale(right, along), scale(nominalFront, outer))
          const candidateCenter = add(accessPoint, scale(nominalFront, -setback - size.depth / 2))
          const fit = fitsCell(
            cell,
            candidateCenter,
            front,
            envelopeWidth(size),
            size.depth,
            reservations,
          )
          if (!fit) continue
          return {
            variant: size.variant,
            ...fit,
            access: {
              kind: 'implied-outer-road',
              point: accessPoint,
            },
          }
        }
      }
    }
  }

  return null
}

function assignLotOccupancies(
  cells: readonly ClassifiedNeighborCell[],
  seed: string,
): ClassifiedNeighborCell[] {
  const viable = cells.filter(({ buildArea }) => buildArea !== undefined)
  const houseCount = Math.round(viable.length * HOUSE_OCCUPANCY_RATIO)
  const openCount = viable.length - houseCount
  const openLots = [...viable]
    .sort((left, right) => {
      const leftScore = seededUnit(seed, `lot-occupancy:${left.id}`)
        - (left.kind === 'corner' ? CORNER_OPEN_BIAS : 0)
      const rightScore = seededUnit(seed, `lot-occupancy:${right.id}`)
        - (right.kind === 'corner' ? CORNER_OPEN_BIAS : 0)
      return leftScore - rightScore || left.id.localeCompare(right.id)
    })
    .slice(0, openCount)
    .sort((left, right) => {
      const difference = seededUnit(seed, `open-lot-type:${left.id}`)
        - seededUnit(seed, `open-lot-type:${right.id}`)
      return difference || left.id.localeCompare(right.id)
    })
  const gardenGetsExtra = seededUnit(seed, 'open-lot-type-extra') < 0.5
  const gardenCount = Math.floor(openLots.length / 2)
    + (openLots.length % 2 === 1 && gardenGetsExtra ? 1 : 0)
  const occupancyById = new Map<string, NeighborCellOccupancy>(
    openLots.map((cell, index) => [cell.id, index < gardenCount ? 'garden' : 'grove']),
  )

  return cells.map((cell) => ({
    ...cell,
    occupancy: cell.buildArea ? occupancyById.get(cell.id) ?? 'house' : 'none',
  }))
}

export function deriveNeighborCellClassifications(
  segments: readonly BoundarySegment[],
  layout: SurroundingsLayoutDescriptor,
  network: RoadNetworkNode,
  seed = 'pascal-neighborhood-v1',
): ClassifiedNeighborCell[] {
  const reservations = deriveRoadReservations(network)
  const segmentByIndex = new Map(segments.map((segment) => [segment.index, segment]))
  const cells = subdivideNeighborCells(layout.neighborCells).map((cell): ClassifiedNeighborCell => {
    const coverage = roadCoverage(cell, reservations)
    const buildArea = roadBuildArea(cell, reservations, seed)
      ?? impliedBuildArea(cell, segmentByIndex, reservations, seed)
    return {
      ...cell,
      use: buildArea
        ? 'buildable'
        : coverage >= TRANSPORT_COVERAGE
          ? 'transport'
          : 'residual',
      occupancy: buildArea ? 'house' : 'none',
      roadCoverage: coverage,
      ...(buildArea ? { buildArea } : {}),
    }
  })
  return assignLotOccupancies(cells, seed)
}

function windowsForStoreys(
  storeys: 1 | 2,
  offsets: readonly number[],
  width: number,
): HouseOpening[] {
  const openings: HouseOpening[] = offsets.map((offset) => ({
    kind: 'window',
    offset,
    width,
    height: 1.25,
    bottom: 0.82,
  }))
  if (storeys === 2) {
    openings.push(...offsets.map((offset) => ({
      kind: 'window' as const,
      offset,
      width,
      height: 1.15,
      bottom: 3.35,
    })))
  }
  return openings
}

function houseFacades(
  seed: string,
  style: HouseStyle,
  width: number,
  depth: number,
  storeys: 1 | 2,
  doorSign: -1 | 1,
  garageSide: -1 | 1 | 0,
): HouseFacadePlan[] {
  const doorOffsetFactor = style === 'pavilion' ? 0.31 : style === 'farmhouse' ? 0.18 : 0.24
  const doorOffset = doorSign * Math.min(width * doorOffsetFactor, width / 2 - 1.05)
  const frontWindowWidth = style === 'pavilion'
    ? Math.min(1.65, width * 0.19)
    : Math.min(1.4, width * 0.21)
  const frontWindowOffsets = style === 'pavilion'
    ? [-doorSign * width * 0.22, 0]
    : [-doorSign * Math.min(width * 0.22, width / 2 - 0.9)]
  const frontWindows = windowsForStoreys(storeys, frontWindowOffsets, frontWindowWidth)
  if (storeys === 2) {
    frontWindows.push(...windowsForStoreys(1, [doorOffset], Math.min(1.2, width * 0.19)).map(
      (opening): HouseOpening => ({ ...opening, bottom: 3.25 }),
    ))
  }

  const backOffset = Math.min(width * 0.24, width / 2 - 0.9)
  const backOffsets = style === 'pavilion'
    ? [-width * 0.22, 0, width * 0.22]
    : [-backOffset, backOffset]
  const sideWindowWidth = Math.min(1.4, depth * 0.18)
  const sideOffsets = style === 'pavilion'
    ? [-depth * 0.2, depth * 0.2]
    : [0]

  // The wing covers the front two thirds of the body's side wall, so that
  // facade keeps no windows.
  const sideOpenings = (side: -1 | 1): HouseOpening[] =>
    side === garageSide ? [] : windowsForStoreys(storeys, sideOffsets, sideWindowWidth)

  return [
    {
      side: 'front',
      openings: [
        {
          kind: 'door',
          offset: doorOffset,
          width: style === 'pavilion' ? 1.06 : 0.96,
          height: style === 'farmhouse' ? 2.25 : 2.14,
          bottom: 0,
        },
        ...frontWindows,
      ],
    },
    { side: 'right', openings: sideOpenings(1) },
    {
      side: 'back',
      openings: windowsForStoreys(
        storeys,
        backOffsets,
        style === 'pavilion' ? 1.45 : Math.min(1.3, width * 0.2),
      ),
    },
    { side: 'left', openings: sideOpenings(-1) },
  ]
}

export function deriveHousePlans(
  cells: readonly ClassifiedNeighborCell[],
  seed = 'pascal-neighborhood-v1',
): HousePlan[] {
  return cells.flatMap((cell): HousePlan[] => {
    const area = cell.buildArea
    if (!area || cell.occupancy !== 'house') return []

    const style = houseStyleForCell(cell, seed)
    const size = HOUSE_VARIANTS[style][area.variant]!
    const storeys: 1 | 2 = style === 'farmhouse' ? 2 : 1
    const prototypeSeed = `${seed}:${style}:v${area.variant}`
    const palette = HOUSE_PALETTES[
      hashString(`${prototypeSeed}:palette`) % HOUSE_PALETTES.length
    ]!
    const doorSign: -1 | 1 = seededUnit(prototypeSeed, 'door-side') < 0.5 ? -1 : 1
    // Garage on the side away from the entry so the driveway and the front
    // path never cross.
    const garageSide: -1 | 1 = doorSign === 1 ? -1 : 1

    return [{
      id: `surroundings-house-${cell.id}`,
      variant: area.variant,
      cellId: cell.id,
      center: area.center,
      width: area.width,
      depth: area.depth,
      front: area.front,
      right: area.right,
      footprint: area.footprint,
      style,
      storeys,
      wallHeight: size.wallHeight,
      roof: {
        kind: style === 'farmhouse' ? 'gambrel' : style === 'pavilion' ? 'hip' : 'gable',
        pitchDegrees: size.pitchDegrees,
        overhang: size.overhang,
      },
      facades: houseFacades(
        prototypeSeed,
        style,
        size.width,
        size.depth,
        storeys,
        doorSign,
        size.garage ? garageSide : 0,
      ),
      ...(size.garage
        ? {
            garage: {
              side: garageSide,
              width: size.garage.width,
              depth: size.garage.depth,
              wallHeight: size.garage.wallHeight,
              door: { width: 2.6, height: 2.15 },
            },
          }
        : {}),
      palette,
      access: area.access,
    }]
  })
}

/** The main body's placement inside the envelope, in `right` units. */
export function houseBodyFrame(plan: HousePlan): HouseBodyFrame {
  if (!plan.garage) return { offset: 0, width: plan.width }
  return {
    offset: -plan.garage.side * plan.garage.width / 2,
    width: plan.width - plan.garage.width,
  }
}

/** Garage wing centre offset from the envelope centre, in (`right`, `front`) units. */
export function houseGarageOffset(plan: HousePlan): Point2 | null {
  if (!plan.garage) return null
  const body = houseBodyFrame(plan)
  return [
    plan.garage.side * body.width / 2,
    plan.depth / 2 - plan.garage.depth / 2,
  ]
}

export function houseFacadeFrame(
  plan: HousePlan,
  side: HouseFacadeSide,
): HouseFacadeFrame {
  const body = houseBodyFrame(plan)
  const outward = side === 'front'
    ? plan.front
    : side === 'back'
      ? scale(plan.front, -1)
      : side === 'right'
        ? plan.right
        : scale(plan.right, -1)
  const distance = side === 'front' || side === 'back'
    ? plan.depth / 2
    : body.width / 2
  const bodyCenter = add(plan.center, scale(plan.right, body.offset))
  return {
    center: add(bodyCenter, scale(outward, distance)),
    outward,
    right: rightOf(outward),
    length: side === 'front' || side === 'back' ? body.width : plan.depth,
  }
}

export function houseOpeningSegment(
  plan: HousePlan,
  facade: HouseFacadePlan,
  opening: HouseOpening,
): readonly [Point2, Point2] {
  const frame = houseFacadeFrame(plan, facade.side)
  const center = add(frame.center, scale(frame.right, opening.offset))
  return [
    add(center, scale(frame.right, -opening.width / 2)),
    add(center, scale(frame.right, opening.width / 2)),
  ]
}

export function houseRoofRidge(plan: HousePlan): readonly [Point2, Point2] {
  const body = houseBodyFrame(plan)
  const ridgeLength = plan.roof.kind === 'gable'
    ? plan.depth + plan.roof.overhang * 2
    : Math.max(0.8, Math.min(plan.depth * 0.55, plan.depth - body.width))
  const bodyCenter = add(plan.center, scale(plan.right, body.offset))
  return [
    add(bodyCenter, scale(plan.front, -ridgeLength / 2)),
    add(bodyCenter, scale(plan.front, ridgeLength / 2)),
  ]
}

/** Garage wing footprint in world space, or null for garage-less variants. */
export function houseGarageFootprint(plan: HousePlan): readonly Point2[] | null {
  const offset = houseGarageOffset(plan)
  if (!offset || !plan.garage) return null
  const center = add(
    add(plan.center, scale(plan.right, offset[0])),
    scale(plan.front, offset[1]),
  )
  return rectangle(center, plan.front, plan.garage.width, plan.garage.depth)
}
