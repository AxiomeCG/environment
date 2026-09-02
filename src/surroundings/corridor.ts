import type { BoundarySegment, Point2 } from './frontages'
import {
  type RoadFrontageSeparator,
  STREETSCAPE_COMPATIBLE_ROAD_WIDTHS,
} from './streetscape-road-presentation'

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

export type NeighborPropertyDescriptor = Readonly<{
  id: string
  center: Point2
  frontageWidth: number
  depth: number
}>

export type SurroundingsCorridorDescriptor = Readonly<{
  id: string
  frontageIndex: number
  separator: RoadFrontageSeparator
  frame: SurroundingsFrame
  road: RoadStripDescriptor
  properties: readonly NeighborPropertyDescriptor[]
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
  roadJunctions: readonly RoadJunctionDescriptor[]
}>

export type SurroundingsCorridorDimensions = Readonly<{
  primaryRoadWidth: number
  secondaryRoadWidth: number
  neighborDepth: number
  targetPropertyFrontage: number
}>

export const DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS: SurroundingsCorridorDimensions =
  Object.freeze({
    primaryRoadWidth: 9,
    secondaryRoadWidth: 6,
    neighborDepth: 22,
    targetPropertyFrontage: 8,
  })

export const STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS: SurroundingsCorridorDimensions =
  Object.freeze({
    ...DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    primaryRoadWidth: STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['primary-road'],
    secondaryRoadWidth: STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['secondary-road'],
  })

function offsetPoint(point: Point2, direction: Point2, distance: number): Point2 {
  return [
    point[0] + direction[0] * distance,
    point[1] + direction[1] * distance,
  ]
}

function cross(a: Point2, b: Point2): number {
  return a[0] * b[1] - a[1] * b[0]
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
  const propertyCount = Math.max(
    1,
    Math.round(segment.length / dimensions.targetPropertyFrontage),
  )
  const frontageWidth = segment.length / propertyCount
  const propertyBandCenter = offsetPoint(
    origin,
    segment.outwardNormal,
    roadWidth + dimensions.neighborDepth / 2,
  )
  const properties = Array.from({ length: propertyCount }, (_, index) => ({
    id: `${id}-property-${index}`,
    center: offsetPoint(
      propertyBandCenter,
      segment.tangent,
      (index + 0.5) * frontageWidth - segment.length / 2,
    ),
    frontageWidth,
    depth: dimensions.neighborDepth,
  }))

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
      length: segment.length,
      width: roadWidth,
    },
    properties,
  }
}

export function deriveSurroundingsCorridors(
  segments: readonly BoundarySegment[],
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
): SurroundingsCorridorDescriptor[] {
  return segments.flatMap((segment) => {
    const corridor = deriveSurroundingsCorridor(segment, dimensions)
    return corridor ? [corridor] : []
  })
}

export function deriveSurroundingsLayout(
  segments: readonly BoundarySegment[],
  dimensions = DEFAULT_SURROUNDINGS_CORRIDOR_DIMENSIONS,
): SurroundingsLayoutDescriptor {
  const corridors = deriveSurroundingsCorridors(segments, dimensions)
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

    const windingSign = -cross(previous.tangent, previous.outwardNormal)
    const signedTurn = cross(previous.tangent, next.tangent) * windingSign
    if (signedTurn <= 1e-9) return []

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

  return { corridors, roadJunctions }
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
  const compatibleJunctions = layout.roadJunctions.filter((junction) => {
    const previous = corridorByFrontage.get(junction.previousFrontageIndex)
    const next = corridorByFrontage.get(junction.nextFrontageIndex)
    return previous?.separator === next?.separator
  })
  const compatibleJunctionIds = new Set(
    compatibleJunctions.map((junction) => junction.id),
  )
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

  for (const junction of layout.roadJunctions) {
    if (compatibleJunctionIds.has(junction.id)) continue
    alignments.push({
      id: junction.id,
      separator: junction.separator,
      centerline: junction.centerline,
      corridorIds: [],
      junctionIds: [junction.id],
    })
  }

  return alignments
}
