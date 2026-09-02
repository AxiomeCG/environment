import type { BoundarySegment, Point2 } from './frontages'

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
  frame: SurroundingsFrame
  road: RoadStripDescriptor
  properties: readonly NeighborPropertyDescriptor[]
}>

export type RoadJunctionDescriptor = Readonly<{
  id: string
  corners: readonly Point2[]
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
  if (segment.context.separator === 'none') return null

  const origin: Point2 = [
    (segment.start[0] + segment.end[0]) / 2,
    (segment.start[1] + segment.end[1]) / 2,
  ]
  const roadWidth = segment.context.separator === 'primary-road'
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
  const roadJunctions = segments.flatMap((previous, index) => {
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
      corners,
    }]
  })

  return { corridors, roadJunctions }
}
