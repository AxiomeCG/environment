import type { BoundarySegment, Point2 } from './frontages'
import {
  type RoadFrontageSeparator,
  STREETSCAPE_COMPATIBLE_ROAD_WIDTHS,
} from './streetscape-road-presentation'
import { seededRange } from './seeded-random'

export type SurroundingsFrame = Readonly<{
  origin: Point2
  tangent: Point2
  outwardNormal: Point2
}>

export type RoadStripDescriptor = Readonly<{
  id: string
  center: Point2
  length: number
  width: number
}>

export type NeighborCellKind = 'frontage' | 'corner'

export type NeighborCellDescriptor = Readonly<{
  id: string
  kind: NeighborCellKind
  frontageIndices: readonly number[]
  polygon: readonly Point2[]
}>

export type SurroundingsCorridorDescriptor = Readonly<{
  id: string
  frontageIndex: number
  separator: RoadFrontageSeparator
  frame: SurroundingsFrame
  road: RoadStripDescriptor
}>

export type RoadJunctionDescriptor = Readonly<{
  id: string
  previousFrontageIndex: number
  nextFrontageIndex: number
  centerline: readonly Point2[]
  corners: readonly Point2[]
  separator: RoadFrontageSeparator
}>

export type RoadPresentationAlignmentDescriptor = Readonly<{
  id: string
  separator: RoadFrontageSeparator
  centerline: readonly Point2[]
  corridorIds: readonly string[]
  junctionIds: readonly string[]
}>

export type SurroundingsLayoutDescriptor = Readonly<{
  corridors: readonly SurroundingsCorridorDescriptor[]
  neighborCells: readonly NeighborCellDescriptor[]
  roadJunctions: readonly RoadJunctionDescriptor[]
  outerRoad?: RoadPresentationAlignmentDescriptor
}>

export type SurroundingsCorridorDimensions = Readonly<{
  primaryRoadWidth: number
  secondaryRoadWidth: number
  neighborDepth: number
}>
export type NeighborCellVariationParameters = Readonly<{
  seed: string
  depthVariation: number
}>


export const DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS: SurroundingsCorridorDimensions =
  Object.freeze({
    primaryRoadWidth: 9,
    secondaryRoadWidth: 6,
    neighborDepth: 22,
  })

export const STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS: SurroundingsCorridorDimensions =
  Object.freeze({
    ...DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    primaryRoadWidth: STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['primary-road'],
    secondaryRoadWidth: STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['secondary-road'],
  })
export const DEFAULT_NEIGHBOR_CELL_VARIATION: NeighborCellVariationParameters =
  Object.freeze({
    seed: 'pascal-neighborhood-v1',
    depthVariation: 0.2,
  })

const OUTER_ROAD_MITER_LIMIT_RATIO = 2

function neighborRingDepth(
  dimensions: SurroundingsCorridorDimensions,
): number {
  return Math.max(
    dimensions.primaryRoadWidth,
    dimensions.secondaryRoadWidth,
  ) + dimensions.neighborDepth
}
function frontageRoadContinuationDepth(
  dimensions: SurroundingsCorridorDimensions,
): number {
  return neighborRingDepth(dimensions) * 2
}

function neighborCellDepth(
  segment: BoundarySegment,
  dimensions: SurroundingsCorridorDimensions,
  variation: NeighborCellVariationParameters,
): number {
  const infrastructureDepth = Math.max(
    dimensions.primaryRoadWidth,
    dimensions.secondaryRoadWidth,
  )
  const variationAmount = Math.max(0, Math.min(0.35, variation.depthVariation))
  const depthScale = seededRange(
    variation.seed,
    `frontage-depth:${segment.index}`,
    1 - variationAmount,
    1 + variationAmount,
  )
  return infrastructureDepth + dimensions.neighborDepth * depthScale
}


function offsetPoint(point: Point2, direction: Point2, distance: number): Point2 {
  return [
    point[0] + direction[0] * distance,
    point[1] + direction[1] * distance,
  ]
}

function cross(a: Point2, b: Point2): number {
  return a[0] * b[1] - a[1] * b[0]
}

function pointDistanceToBoundary(
  point: Point2,
  segments: readonly BoundarySegment[],
): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    const deltaX = segment.end[0] - segment.start[0]
    const deltaZ = segment.end[1] - segment.start[1]
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
    const mix = lengthSquared > 1e-9
      ? Math.max(0, Math.min(1, (
          (point[0] - segment.start[0]) * deltaX
          + (point[1] - segment.start[1]) * deltaZ
        ) / lengthSquared))
      : 0
    nearest = Math.min(nearest, Math.hypot(
      point[0] - (segment.start[0] + deltaX * mix),
      point[1] - (segment.start[1] + deltaZ * mix),
    ))
  }
  return Number.isFinite(nearest) ? nearest : 0
}

function isConvexCorner(
  previous: BoundarySegment,
  next: BoundarySegment,
): boolean {
  const windingSign = -cross(previous.tangent, previous.outwardNormal)
  return cross(previous.tangent, next.tangent) * windingSign > 1e-9
}

function lineIntersection(
  firstPoint: Point2,
  firstDirection: Point2,
  secondPoint: Point2,
  secondDirection: Point2,
): Point2 | null {
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= 1e-9) return null

  const betweenPoints: Point2 = [
    secondPoint[0] - firstPoint[0],
    secondPoint[1] - firstPoint[1],
  ]
  return offsetPoint(
    firstPoint,
    firstDirection,
    cross(betweenPoints, secondDirection) / denominator,
  )
}


function cubicBezierPoint(
  start: Point2,
  startControl: Point2,
  endControl: Point2,
  end: Point2,
  t: number,
): Point2 {
  const inverse = 1 - t
  const startWeight = inverse * inverse * inverse
  const startControlWeight = 3 * inverse * inverse * t
  const endControlWeight = 3 * inverse * t * t
  const endWeight = t * t * t

  return [
    start[0] * startWeight
      + startControl[0] * startControlWeight
      + endControl[0] * endControlWeight
      + end[0] * endWeight,
    start[1] * startWeight
      + startControl[1] * startControlWeight
      + endControl[1] * endControlWeight
      + end[1] * endWeight,
  ]
}

function roadBendCenterline(
  vertex: Point2,
  previous: SurroundingsCorridorDescriptor,
  next: SurroundingsCorridorDescriptor,
): readonly Point2[] {
  const start = offsetPoint(
    vertex,
    previous.frame.outwardNormal,
    previous.road.width / 2,
  )
  const end = offsetPoint(
    vertex,
    next.frame.outwardNormal,
    next.road.width / 2,
  )
  const tangentDot = Math.max(
    -1,
    Math.min(
      1,
      previous.frame.tangent[0] * next.frame.tangent[0]
        + previous.frame.tangent[1] * next.frame.tangent[1],
    ),
  )
  const turnAngle = Math.acos(tangentDot)
  const radius = Math.min(previous.road.width, next.road.width) / 2
  const handleLength = Math.min(
    radius * (4 / 3) * Math.tan(turnAngle / 4),
    previous.road.length * 0.45,
    next.road.length * 0.45,
  )
  const startControl = offsetPoint(
    start,
    previous.frame.tangent,
    handleLength,
  )
  const endControl = offsetPoint(
    end,
    next.frame.tangent,
    -handleLength,
  )

  return Array.from({ length: 11 }, (_, index) => cubicBezierPoint(
    start,
    startControl,
    endControl,
    end,
    index / 10,
  ))
}

export function orientedRectangleCorners(
  rectangle: Readonly<{ center: Point2; length: number; width: number }>,
  frame: Pick<SurroundingsFrame, 'tangent' | 'outwardNormal'>,
): readonly [Point2, Point2, Point2, Point2] {
  const corner = (along: number, outward: number): Point2 => [
    rectangle.center[0]
      + frame.tangent[0] * along
      + frame.outwardNormal[0] * outward,
    rectangle.center[1]
      + frame.tangent[1] * along
      + frame.outwardNormal[1] * outward,
  ]
  const halfLength = rectangle.length / 2
  const halfWidth = rectangle.width / 2

  return [
    corner(-halfLength, -halfWidth),
    corner(halfLength, -halfWidth),
    corner(halfLength, halfWidth),
    corner(-halfLength, halfWidth),
  ]
}

export function deriveNeighborCells(
  segments: readonly BoundarySegment[],
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  variation = DEFAULT_NEIGHBOR_CELL_VARIATION,
): NeighborCellDescriptor[] {
  const depthByFrontage = new Map(
    segments.map((segment) => [
      segment.index,
      neighborCellDepth(segment, dimensions, variation),
    ]),
  )
  const frontageCells = segments.map((segment): NeighborCellDescriptor => {
    const depth = depthByFrontage.get(segment.index)!
    return {
      id: `surroundings-cell-frontage-${segment.index}`,
      kind: 'frontage',
      frontageIndices: [segment.index],
      polygon: [
        segment.start,
        segment.end,
        offsetPoint(segment.end, segment.outwardNormal, depth),
        offsetPoint(segment.start, segment.outwardNormal, depth),
      ],
    }
  })
  const cornerCells = segments.flatMap(
    (previous, index): NeighborCellDescriptor[] => {
      const next = segments[(index + 1) % segments.length]
      if (!next) return []

      if (!isConvexCorner(previous, next)) return []

      const vertex = previous.end
      const previousDepth = depthByFrontage.get(previous.index)!
      const nextDepth = depthByFrontage.get(next.index)!
      const previousOuter = offsetPoint(
        vertex,
        previous.outwardNormal,
        previousDepth,
      )
      const nextOuter = offsetPoint(vertex, next.outwardNormal, nextDepth)
      const outerCorner = lineIntersection(
        previousOuter,
        previous.tangent,
        nextOuter,
        next.tangent,
      )
      if (!outerCorner) return []

      const miterLength = Math.hypot(
        outerCorner[0] - vertex[0],
        outerCorner[1] - vertex[1],
      )
      const miterLimit = Math.max(previousDepth, nextDepth) * 3
      const polygon = miterLength <= miterLimit
        ? [vertex, previousOuter, outerCorner, nextOuter]
        : [vertex, previousOuter, nextOuter]

      return [{
        id: `surroundings-cell-corner-${previous.index}-${next.index}`,
        kind: 'corner',
        frontageIndices: [previous.index, next.index],
        polygon,
      }]
    },
  )

  return [...frontageCells, ...cornerCells]
}

export function deriveSurroundingsLevelTerrainDistance(
  segments: readonly BoundarySegment[],
  layout: SurroundingsLayoutDescriptor,
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
): number {
  const cellDistance = Math.max(0, ...layout.neighborCells.flatMap(({ polygon }) =>
    polygon.map((point) => pointDistanceToBoundary(point, segments))))
  const corridorDistance = Math.max(0, ...layout.corridors.flatMap((corridor) =>
    orientedRectangleCorners(corridor.road, corridor.frame)
      .map((point) => pointDistanceToBoundary(point, segments))))
  const outerRoadDistance = layout.outerRoad
    ? Math.max(0, ...layout.outerRoad.centerline.map((point) =>
        pointDistanceToBoundary(point, segments))) + dimensions.secondaryRoadWidth / 2
    : 0

  return Math.max(cellDistance, corridorDistance, outerRoadDistance)
}

export function deriveSurroundingsCorridor(
  segment: BoundarySegment,
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
): SurroundingsCorridorDescriptor | null {
  const separator = segment.context.separator
  if (separator === 'none') return null

  const origin: Point2 = [
    (segment.start[0] + segment.end[0]) / 2,
    (segment.start[1] + segment.end[1]) / 2,
  ]
  const roadWidth = separator === 'primary-road'
    ? dimensions.primaryRoadWidth
    : dimensions.secondaryRoadWidth
  const id = `surroundings-frontage-${segment.index}`

  return {
    id,
    frontageIndex: segment.index,
    separator,
    frame: {
      origin,
      tangent: segment.tangent,
      outwardNormal: segment.outwardNormal,
    },
    road: {
      id: `${id}-road`,
      center: offsetPoint(origin, segment.outwardNormal, roadWidth / 2),
      length: segment.length + frontageRoadContinuationDepth(dimensions) * 2,
      width: roadWidth,
    },
  }
}

export function deriveSurroundingsCorridors(
  segments: readonly BoundarySegment[],
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
): SurroundingsCorridorDescriptor[] {
  const corridors = segments.flatMap((segment) => {
    const corridor = deriveSurroundingsCorridor(segment, dimensions)
    return corridor ? [corridor] : []
  })
  return corridors
}

function deriveOuterRoadAlignment(
  segments: readonly BoundarySegment[],
  dimensions: SurroundingsCorridorDimensions,
  seed: string,
): RoadPresentationAlignmentDescriptor | undefined {
  if (!segments.some(({ context }) => context.separator !== 'none')) return undefined

  const baseOffset = neighborRingDepth(dimensions)
  const offsetByFrontage = new Map(segments.map((segment) => [
    segment.index,
    baseOffset * seededRange(seed, `near-road-depth:${segment.index}`, 1.06, 1.18),
  ]))
  const vertices: Point2[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]!
    const previous = segments[(index - 1 + segments.length) % segments.length]!
    const vertex = current.start
    const previousOffsetDistance = offsetByFrontage.get(previous.index)!
    const currentOffsetDistance = offsetByFrontage.get(current.index)!
    const previousOffset = offsetPoint(
      vertex,
      previous.outwardNormal,
      previousOffsetDistance,
    )
    const currentOffset = offsetPoint(
      vertex,
      current.outwardNormal,
      currentOffsetDistance,
    )
    const miter = lineIntersection(
      previousOffset,
      previous.tangent,
      currentOffset,
      current.tangent,
    )
    const miterLength = miter
      ? Math.hypot(miter[0] - vertex[0], miter[1] - vertex[1])
      : Number.POSITIVE_INFINITY
    const miterLimit = Math.max(
      previousOffsetDistance,
      currentOffsetDistance,
    ) * OUTER_ROAD_MITER_LIMIT_RATIO

    if (!miter || miterLength > miterLimit) return undefined
    vertices.push(miter)
  }

  if (vertices.length < 3) return undefined

  // Cut the perimeter only between real frontage crossings. An open street must
  // meet another street at each end, never terminate halfway through a lawn.
  const corridors = deriveSurroundingsCorridors(segments, dimensions)
  const stations = [0]
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!, b = vertices[(index + 1) % vertices.length]!
    stations.push(stations[index]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const crossings: { point: Point2; station: number }[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!, b = vertices[(index + 1) % vertices.length]!
    const length = stations[index + 1]! - stations[index]!
    const along: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    for (const corridor of corridors) {
      const point = lineIntersection(a, along, corridor.road.center, corridor.frame.tangent)
      if (!point) continue
      const s = (point[0] - a[0]) * along[0] + (point[1] - a[1]) * along[1]
      const t = (point[0] - corridor.road.center[0]) * corridor.frame.tangent[0]
        + (point[1] - corridor.road.center[1]) * corridor.frame.tangent[1]
      if (s >= 0 && s <= length && Math.abs(t) < corridor.road.length / 2) {
        crossings.push({ point, station: stations[index]! + s })
      }
    }
  }
  crossings.sort((a, b) => a.station - b.station)
  if (crossings.length < 2) return undefined
  const perimeter = stations.at(-1)!
  let gap = 0, gapLength = Infinity
  for (let index = 0; index < crossings.length; index += 1) {
    const length = (crossings[(index + 1) % crossings.length]!.station
      - crossings[index]!.station + perimeter) % perimeter
    if (length > 1e-5 && length < gapLength) { gap = index; gapLength = length }
  }
  const start = crossings[(gap + 1) % crossings.length]!
  const end = crossings[gap]!
  const endStation = end.station <= start.station ? end.station + perimeter : end.station
  const centerline: Point2[] = [start.point]
  for (let lap = 0; lap < 2; lap += 1) for (let index = 0; index < vertices.length; index += 1) {
    const station = stations[index]! + lap * perimeter
    if (station > start.station + 1e-5 && station < endStation - 1e-5) centerline.push(vertices[index]!)
  }
  centerline.push(end.point)

  return {
    id: 'surroundings-near-neighborhood-road',
    separator: 'secondary-road',
    centerline,
    corridorIds: [],
    junctionIds: [],
  }
}

export function deriveSurroundingsLayout(
  segments: readonly BoundarySegment[],
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  cellVariation = DEFAULT_NEIGHBOR_CELL_VARIATION,
): SurroundingsLayoutDescriptor {
  const corridors = deriveSurroundingsCorridors(segments, dimensions)
  const neighborCells = deriveNeighborCells(segments, dimensions, cellVariation)
  const corridorByFrontage = new Map(
    corridors.map((corridor) => [corridor.frontageIndex, corridor]),
  )
  const roadJunctions: RoadJunctionDescriptor[] = segments.flatMap(
    (previous, index): RoadJunctionDescriptor[] => {
    const next = segments[(index + 1) % segments.length]
    if (!next) return []

    const previousCorridor = corridorByFrontage.get(previous.index)
    const nextCorridor = corridorByFrontage.get(next.index)
    if (!previousCorridor || !nextCorridor) return []

    if (!isConvexCorner(previous, next)) return []

    const vertex = previous.end
    const previousOuter = offsetPoint(
      vertex,
      previous.outwardNormal,
      previousCorridor.road.width,
    )
    const nextOuter = offsetPoint(
      vertex,
      next.outwardNormal,
      nextCorridor.road.width,
    )
    const outerCorner = lineIntersection(
      previousOuter,
      previous.tangent,
      nextOuter,
      next.tangent,
    )
    if (!outerCorner) return []

    const miterLength = Math.hypot(
      outerCorner[0] - vertex[0],
      outerCorner[1] - vertex[1],
    )
    const miterLimit = Math.max(
      previousCorridor.road.width,
      nextCorridor.road.width,
    ) * 3
    const corners = miterLength <= miterLimit
      ? [vertex, previousOuter, outerCorner, nextOuter]
      : [vertex, previousOuter, nextOuter]

      return [{
        id: `surroundings-junction-${previous.index}-${next.index}`,
        previousFrontageIndex: previous.index,
        nextFrontageIndex: next.index,
        centerline: roadBendCenterline(vertex, previousCorridor, nextCorridor),
        corners,
        separator:
          previousCorridor.separator === 'primary-road'
          || nextCorridor.separator === 'primary-road'
            ? 'primary-road'
            : 'secondary-road',
      }]
    },
  )

  const outerRoad = deriveOuterRoadAlignment(segments, dimensions, cellVariation.seed)
  return {
    corridors,
    neighborCells,
    roadJunctions,
    ...(outerRoad ? { outerRoad } : {}),
  }
}

function corridorCenterline(
  corridor: SurroundingsCorridorDescriptor,
): readonly [Point2, Point2] {
  const halfLength = corridor.road.length / 2
  const [tangentX, tangentZ] = corridor.frame.tangent
  const [centerX, centerZ] = corridor.road.center

  return [
    [centerX - tangentX * halfLength, centerZ - tangentZ * halfLength],
    [centerX + tangentX * halfLength, centerZ + tangentZ * halfLength],
  ]
}

export function deriveRoadPresentationAlignments(
  layout: SurroundingsLayoutDescriptor,
): RoadPresentationAlignmentDescriptor[] {
  const corridorByFrontage = new Map(
    layout.corridors.map((corridor) => [corridor.frontageIndex, corridor]),
  )
  const compatibleJunctions = layout.outerRoad
    ? []
    : layout.roadJunctions.filter((junction) => {
        const previous = corridorByFrontage.get(junction.previousFrontageIndex)
        const next = corridorByFrontage.get(junction.nextFrontageIndex)
        return previous?.separator === 'secondary-road'
          && next?.separator === 'secondary-road'
      })
  const outgoingJunctionByFrontage = new Map(
    compatibleJunctions.map((junction) => [
      junction.previousFrontageIndex,
      junction,
    ]),
  )
  const incomingFrontages = new Set(
    compatibleJunctions.map((junction) => junction.nextFrontageIndex),
  )
  const visitedFrontages = new Set<number>()
  const alignments: RoadPresentationAlignmentDescriptor[] = []

  const appendAlignment = (start: SurroundingsCorridorDescriptor) => {
    const centerline: Point2[] = [...corridorCenterline(start)]
    const corridorIds = [start.id]
    const frontageIndices = [start.frontageIndex]
    const junctionIds: string[] = []
    let current = start
    visitedFrontages.add(current.frontageIndex)

    while (true) {
      const junction = outgoingJunctionByFrontage.get(current.frontageIndex)
      if (!junction) break

      const next = corridorByFrontage.get(junction.nextFrontageIndex)
      if (!next) break

      junctionIds.push(junction.id)
      centerline.push(...junction.centerline.slice(1))
      if (visitedFrontages.has(next.frontageIndex)) break

      const nextCenterline = corridorCenterline(next)
      centerline.push(nextCenterline[1])
      corridorIds.push(next.id)
      frontageIndices.push(next.frontageIndex)
      visitedFrontages.add(next.frontageIndex)
      current = next
    }

    alignments.push({
      id: junctionIds.length === 0
        ? start.road.id
        : `surroundings-road-alignment-${frontageIndices.join('-')}`,
      separator: start.separator,
      centerline,
      corridorIds,
      junctionIds,
    })
  }

  for (const corridor of layout.corridors) {
    if (
      !visitedFrontages.has(corridor.frontageIndex)
      && !incomingFrontages.has(corridor.frontageIndex)
    ) appendAlignment(corridor)
  }

  for (const corridor of layout.corridors) {
    if (!visitedFrontages.has(corridor.frontageIndex)) appendAlignment(corridor)
  }

  if (layout.outerRoad) alignments.push(layout.outerRoad)
  return alignments
}
