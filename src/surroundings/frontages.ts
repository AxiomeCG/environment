export type Point2 = readonly [x: number, z: number]

export type FrontageSeparator =
  | 'none'
  | 'secondary-road'
  | 'primary-road'

export type FrontageAccess = 'none' | 'driveway' | 'pedestrian-path'

export type FrontageContext = Readonly<{
  separator: FrontageSeparator
  access: FrontageAccess
  roadStyleId?: string
}>

export type FrontageContexts = Readonly<
  Partial<Record<number, FrontageContext>>
>

export type BoundarySegment = Readonly<{
  index: number
  start: Point2
  end: Point2
  length: number
  tangent: Point2
  outwardNormal: Point2
  context: FrontageContext
}>

export type DeriveBoundarySegmentsInput = Readonly<{
  points: readonly Point2[]
  contexts?: FrontageContexts
}>

const GEOMETRY_EPSILON = 1e-9
export const DEFAULT_FRONTAGE_CONTEXT: FrontageContext = Object.freeze({
  separator: 'none',
  access: 'none',
})

export function withFrontageSeparator(
  contexts: FrontageContexts,
  index: number,
  separator: FrontageSeparator,
): FrontageContexts {
  const context = contexts[index] ?? DEFAULT_FRONTAGE_CONTEXT
  const nextContexts = { ...contexts }

  if (separator === 'none' && context.access === 'none') {
    delete nextContexts[index]
  } else {
    nextContexts[index] = { ...context, separator }
  }

  return nextContexts
}

function assertFinitePoint(point: Point2): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new Error('Site polygon coordinates must be finite')
  }
}

function signedDoubleArea(points: readonly Point2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    area += start[0] * end[1] - end[0] * start[1]
  }
  return area
}

export function deriveBoundarySegments({
  points,
  contexts,
}: DeriveBoundarySegmentsInput): BoundarySegment[] {
  if (points.length < 3) {
    throw new Error('Site polygon requires at least three points')
  }
  points.forEach(assertFinitePoint)

  const area = signedDoubleArea(points)
  if (!Number.isFinite(area) || Math.abs(area) <= GEOMETRY_EPSILON) {
    throw new Error('Site polygon requires a non-zero oriented area')
  }
  const counterClockwise = area > 0

  return points.map((start, index) => {
    const end = points[(index + 1) % points.length]!
    const deltaX = end[0] - start[0]
    const deltaZ = end[1] - start[1]
    const length = Math.hypot(deltaX, deltaZ)
    if (length <= GEOMETRY_EPSILON) {
      throw new Error(`Site polygon segment ${index} has zero length`)
    }

    const tangent: Point2 = [deltaX / length, deltaZ / length]
    const outwardNormal: Point2 = counterClockwise
      ? [tangent[1], -tangent[0]]
      : [-tangent[1], tangent[0]]
    const context = contexts?.[index] ?? DEFAULT_FRONTAGE_CONTEXT

    return {
      index,
      start: [start[0], start[1]],
      end: [end[0], end[1]],
      length,
      tangent,
      outwardNormal,
      context: { ...context },
    }
  })
}
