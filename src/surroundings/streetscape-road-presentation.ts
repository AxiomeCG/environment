import {
  buildRoadCrossSection,
  buildRoadJunctionBands,
  ROAD_SIDE_COMPONENT_SPECS,
  resolveRoadSideComponents,
  type RoadSide,
  type RoadSideComponentKind,
} from './streetscape/road-cross-section'
import {
  buildJunctionBoundaryGeometry,
  buildJunctionBoundarySidePaths,
  junctionBoundarySidePathPoint,
  sampleRoadEdgePoints,
  type JunctionBoundaryGeometryData,
  type RoadSurfaceGeometryData,
} from './streetscape/road-network-geometry'
import { buildRoadNetworkMarkings, type RoadMarkingKind, type RoadMarkingPolygon } from './streetscape/road-network-markings'
import {
  buildRoadTransitionProfiles,
  trimRoadTransitionProfile,
  type RoadTransitionSample,
} from './streetscape/road-transition-profile'
import { DEFAULT_ROAD_STYLE_PRESETS } from './streetscape/road-style-presets'
import type { RoadGraphEdge, RoadNetworkNode, RoadStylePreset } from './streetscape/schema'
import type { FrontageSeparator } from './frontages'

// Presentation algorithms and values are pinned to this exact source because the
// independent plugins intentionally have no runtime API between them.
export const STREETSCAPE_ROAD_SNAPSHOT_SOURCE =
  'sudhir9297/streetscape-pascal-plugin@1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef'

export type StreetscapeRoadStyleId = 'local-street' | 'collector'
export type RoadFrontageSeparator = Exclude<FrontageSeparator, 'none'>
export type RoadPresentationPoint = readonly [x: number, y: number, z: number]
export type RoadPresentationSurfaceKind =
  | 'carriageway'
  | 'junction-carriageway'
  | 'median'
  | RoadSideComponentKind
  | RoadMarkingKind

export type RoadPresentationSurface = Readonly<{
  id: string
  name: string
  kind: RoadPresentationSurfaceKind
  color: string
  roughness: number
  metalness: number
  doubleSided: boolean
  castShadow: boolean
  receiveShadow: boolean
  material: 'basic' | 'standard'
  depthWrite: boolean
  polygonOffsetFactor: number
  width?: number
  geometry: RoadSurfaceGeometryData
}>

export type RoadJunctionPresentation = Readonly<{
  id: string
  approachCuts: Readonly<Record<string, number>>
  boundary: ReadonlyArray<readonly [number, number]>
  primaryEdgeIds: readonly string[]
  surfaceIds: readonly string[]
}>

export type RoadPresentationPlan = Readonly<{
  id: string
  junctions: readonly RoadJunctionPresentation[]
  surfaces: readonly RoadPresentationSurface[]
}>

type VariableRibbonSample = Pick<RoadTransitionSample, 'point' | 'surfaceThickness'> & {
  leftOffset: number
  rightOffset: number
}

type SolvedJunction = {
  constrainedCornerKey?: string
  graphNode: RoadNetworkNode['graphNodes'][string]
  sideBands: ReturnType<typeof buildRoadJunctionBands>
  solution: JunctionBoundaryGeometryData
  style: RoadStylePreset
}

function resolveStyle(
  network: RoadNetworkNode,
  edge: RoadGraphEdge,
): RoadStylePreset | undefined {
  const styleId = network.applyStyleToAll ? network.activeStyleId : edge.styleId
  return (
    network.stylePresets[styleId]
    ?? DEFAULT_ROAD_STYLE_PRESETS[
      styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
    ] as RoadStylePreset | undefined
    ?? network.stylePresets[network.activeStyleId]
  )
}

function carriagewayWidth(style: RoadStylePreset): number {
  return style.laneCount * style.laneWidth + style.shoulderWidth * 2 + style.medianWidth
}

export const STREETSCAPE_COMPATIBLE_ROAD_WIDTHS = Object.freeze({
  'secondary-road': buildRoadCrossSection(
    DEFAULT_ROAD_STYLE_PRESETS['local-street'],
  ).totalWidth,
  'primary-road': buildRoadCrossSection(
    DEFAULT_ROAD_STYLE_PRESETS.collector,
  ).totalWidth,
} satisfies Record<RoadFrontageSeparator, number>)

function standardSurface(
  surface: Omit<
    RoadPresentationSurface,
    | 'castShadow'
    | 'depthWrite'
    | 'doubleSided'
    | 'material'
    | 'metalness'
    | 'receiveShadow'
    | 'roughness'
  >,
): RoadPresentationSurface {
  return {
    ...surface,
    castShadow: false,
    depthWrite: true,
    doubleSided: true,
    material: 'standard',
    metalness: 0.02,
    receiveShadow: true,
    roughness: 0.94,
  }
}

function variableRibbonGeometry(
  samples: readonly VariableRibbonSample[],
  elevationOffset = 0,
): RoadSurfaceGeometryData {
  if (samples.length < 2) return { indices: [], positions: [] }
  const lastIndex = samples.length - 1
  const firstPoint = samples[0]!.point
  const lastPoint = samples[lastIndex]!.point
  const closed = samples.length > 2 && Math.hypot(
    lastPoint[0] - firstPoint[0],
    lastPoint[2] - firstPoint[2],
  ) <= 1e-5
  const positions: number[] = []
  for (let index = 0; index < samples.length; index += 1) {
    const atClosure = closed && (index === 0 || index === lastIndex)
    const sample = closed && index === lastIndex ? samples[0]! : samples[index]!
    const previous = atClosure
      ? samples[lastIndex - 1]!
      : samples[Math.max(0, index - 1)]!
    const next = atClosure
      ? samples[1]!
      : samples[Math.min(lastIndex, index + 1)]!
    const deltaX = next.point[0] - previous.point[0]
    const deltaZ = next.point[2] - previous.point[2]
    const length = Math.max(Math.hypot(deltaX, deltaZ), 1e-6)
    const normalX = -deltaZ / length
    const normalZ = deltaX / length
    const y = sample.point[1] + sample.surfaceThickness + elevationOffset
    positions.push(
      sample.point[0] + normalX * sample.leftOffset,
      y,
      sample.point[2] + normalZ * sample.leftOffset,
      sample.point[0] + normalX * sample.rightOffset,
      y,
      sample.point[2] + normalZ * sample.rightOffset,
    )
  }
  const indices: number[] = []
  for (let index = 0; index < samples.length - 1; index += 1) {
    const left = index * 2
    const right = left + 1
    const nextLeft = left + 2
    const nextRight = left + 3
    indices.push(left, nextLeft, right, nextLeft, nextRight, right)
  }
  return { indices, positions }
}

function junctionComponentWidths(
  style: RoadStylePreset,
  side: RoadSide,
): number[] {
  const config = resolveRoadSideComponents(style, side)
  return ROAD_SIDE_COMPONENT_SPECS.map((spec) => config[spec.widthKey])
}

function interpolate(first: number, second: number, mix: number): number {
  return first + (second - first) * mix
}

function graphEdgeLength(
  edge: RoadGraphEdge,
  graphNodes: RoadNetworkNode['graphNodes'],
): number {
  const start = graphNodes[edge.startNodeId]?.position
  const end = graphNodes[edge.endNodeId]?.position
  if (!start || !end) return 0
  const points = [start, ...edge.alignment, end]
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    total += Math.hypot(point[0] - previous[0], point[2] - previous[2])
  }
  return total
}

function junctionCornerKey(firstEdgeId: string, secondEdgeId: string): string {
  return [firstEdgeId, secondEdgeId].sort().join('::')
}

function mixedTSiteSideCornerKey(
  network: RoadNetworkNode,
  junctionId: string,
): string | undefined {
  const incident = Object.values(network.edges).filter(
    (edge) => edge.startNodeId === junctionId || edge.endNodeId === junctionId,
  )
  const localEdges = incident.filter(({ roadClass }) => roadClass === 'local')
  const collectorEdges = incident.filter(({ roadClass }) => roadClass === 'collector')
  if ((localEdges.length !== 1 && localEdges.length !== 2) || collectorEdges.length !== 2) {
    return undefined
  }

  const longestFirst = (left: RoadGraphEdge, right: RoadGraphEdge) =>
    graphEdgeLength(right, network.graphNodes) - graphEdgeLength(left, network.graphNodes)
    || left.id.localeCompare(right.id)
  const siteSideLocal = [...localEdges].sort(longestFirst)[0]!
  const siteSideCollector = [...collectorEdges].sort(longestFirst)[0]!
  if (localEdges.length === 2) {
    const awayFromJunction = (edge: RoadGraphEdge): JunctionPlanPoint => {
      const terminalId = edge.startNodeId === junctionId ? edge.endNodeId : edge.startNodeId
      const terminal = network.graphNodes[terminalId]!.position
      const center = network.graphNodes[junctionId]!.position
      const deltaX = terminal[0] - center[0]
      const deltaZ = terminal[2] - center[2]
      const length = Math.hypot(deltaX, deltaZ)
      return [deltaX / length, deltaZ / length]
    }
    const localDirection = awayFromJunction(siteSideLocal)
    const collectorDirection = awayFromJunction(siteSideCollector)
    const absoluteCosine = Math.abs(
      localDirection[0] * collectorDirection[0]
      + localDirection[1] * collectorDirection[1],
    )
    if (absoluteCosine < 1e-5) return undefined
  }
  return junctionCornerKey(siteSideLocal.id, siteSideCollector.id)
}

type JunctionPlanPoint = readonly [number, number]

function lineIntersection(
  firstPoint: JunctionPlanPoint,
  firstDirection: JunctionPlanPoint,
  secondPoint: JunctionPlanPoint,
  secondDirection: JunctionPlanPoint,
): JunctionPlanPoint | undefined {
  const denominator = firstDirection[0] * secondDirection[1]
    - firstDirection[1] * secondDirection[0]
  if (Math.abs(denominator) <= 1e-6) return undefined
  const deltaX = secondPoint[0] - firstPoint[0]
  const deltaZ = secondPoint[1] - firstPoint[1]
  const distance = (
    deltaX * secondDirection[1] - deltaZ * secondDirection[0]
  ) / denominator
  return [
    firstPoint[0] + firstDirection[0] * distance,
    firstPoint[1] + firstDirection[1] * distance,
  ]
}

type ConstrainedBoundaryFrame = {
  basePoints: JunctionPlanPoint[]
  outerPoints: JunctionPlanPoint[]
  pathMixes: number[]
}

/**
 * Join the rounded carriageway return to the sharp Site edge with ordered fan
 * rulings. Every inner fillet sample terminates at the same miter apex, while
 * the cap rulings retain both complete outer boundary arms.
 */
function constrainedMiterBoundaryFrame(
  solution: JunctionBoundaryGeometryData,
  pathIndex: number,
  fromOffset: number,
  toOffset: number,
  basePoints: readonly JunctionPlanPoint[],
): ConstrainedBoundaryFrame | undefined {
  const corner = solution.corners[pathIndex]
  if (!corner || corner.innerPoints.length + 2 !== basePoints.length) return undefined
  const from = solution.approaches.find(({ edgeId }) => edgeId === corner.fromEdgeId)
  const to = solution.approaches.find(({ edgeId }) => edgeId === corner.toEdgeId)
  const fromCut = from ? solution.approachCuts[from.edgeId] : undefined
  const toCut = to ? solution.approachCuts[to.edgeId] : undefined
  if (!from || !to || fromCut === undefined || toCut === undefined) return undefined

  const fromDirection = [Math.cos(from.angle), Math.sin(from.angle)] as const
  const fromLeft = [-fromDirection[1], fromDirection[0]] as const
  const toDirection = [Math.cos(to.angle), Math.sin(to.angle)] as const
  const toLeft = [-toDirection[1], toDirection[0]] as const
  const fromCap = [
    fromDirection[0] * fromCut + fromLeft[0] * (from.halfWidth + fromOffset),
    fromDirection[1] * fromCut + fromLeft[1] * (from.halfWidth + fromOffset),
  ] as const
  const toCap = [
    toDirection[0] * toCut - toLeft[0] * (to.halfWidth + toOffset),
    toDirection[1] * toCut - toLeft[1] * (to.halfWidth + toOffset),
  ] as const
  const miter = lineIntersection(fromCap, fromDirection, toCap, toDirection)
  if (!miter) return undefined

  const framedBase = [basePoints[0]!, ...basePoints, basePoints.at(-1)!]
  return {
    basePoints: framedBase,
    outerPoints: framedBase.map((_, index) => {
      if (index === 0) return fromCap
      if (index === framedBase.length - 1) return toCap
      return miter
    }),
    pathMixes: framedBase.map((_, index) => {
      if (index <= 1) return 0
      if (index >= framedBase.length - 2) return 1
      return (index - 2) / Math.max(1, corner.innerPoints.length - 1)
    }),
  }
}

const JUNCTION_GEOMETRY_EPSILON = 1e-8

function pointsCoincide(first: JunctionPlanPoint, second: JunctionPlanPoint): boolean {
  return Math.hypot(first[0] - second[0], first[1] - second[1]) <= JUNCTION_GEOMETRY_EPSILON
}

function upwardDoubleArea(
  first: JunctionPlanPoint,
  second: JunctionPlanPoint,
  third: JunctionPlanPoint,
): number {
  return (second[1] - first[1]) * (third[0] - first[0])
    - (second[0] - first[0]) * (third[1] - first[1])
}

function appendUniqueJunctionPoint(
  points: JunctionPlanPoint[],
  point: JunctionPlanPoint,
): void {
  if (!points.at(-1) || !pointsCoincide(points.at(-1)!, point)) points.push(point)
}

function junctionBoundaryPointsCoincide(
  first: JunctionPlanPoint,
  second: JunctionPlanPoint,
): boolean {
  return Math.hypot(first[0] - second[0], first[1] - second[1]) < 1e-5
}

function appendUniqueJunctionBoundaryPoint(
  points: JunctionPlanPoint[],
  point: JunctionPlanPoint,
): void {
  const previous = points.at(-1)
  if (!previous || !junctionBoundaryPointsCoincide(previous, point)) points.push(point)
}

function withMinimumApproachCuts(
  solution: JunctionBoundaryGeometryData,
  minimumCuts: Readonly<Record<string, number>>,
): JunctionBoundaryGeometryData {
  const approachCuts = Object.fromEntries(solution.approaches.map((approach) => [
    approach.edgeId,
    Math.max(solution.approachCuts[approach.edgeId] ?? 0, minimumCuts[approach.edgeId] ?? 0),
  ]))
  const boundary: JunctionPlanPoint[] = []
  for (let index = 0; index < solution.approaches.length; index += 1) {
    const approach = solution.approaches[index]!
    const previousCorner = solution.corners[
      (index - 1 + solution.corners.length) % solution.corners.length
    ]!
    const nextCorner = solution.corners[index]!
    const cut = approachCuts[approach.edgeId]!
    const direction = [Math.cos(approach.angle), Math.sin(approach.angle)] as const
    const left = [-direction[1], direction[0]] as const
    appendUniqueJunctionBoundaryPoint(boundary, previousCorner.innerPoints.at(-1)!)
    appendUniqueJunctionBoundaryPoint(boundary, [
      direction[0] * cut - left[0] * approach.halfWidth,
      direction[1] * cut - left[1] * approach.halfWidth,
    ])
    appendUniqueJunctionBoundaryPoint(boundary, [
      direction[0] * cut + left[0] * approach.halfWidth,
      direction[1] * cut + left[1] * approach.halfWidth,
    ])
    for (const point of nextCorner.innerPoints) {
      appendUniqueJunctionBoundaryPoint(boundary, point)
    }
  }
  if (
    boundary.length > 1
    && junctionBoundaryPointsCoincide(boundary[0]!, boundary.at(-1)!)
  ) boundary.pop()

  const positions = [0, 0, 0]
  for (const [x, z] of boundary) positions.push(x, 0, z)
  const indices: number[] = []
  for (let index = 0; index < boundary.length; index += 1) {
    indices.push(0, index + 1, ((index + 1) % boundary.length) + 1)
  }
  return {
    ...solution,
    approachCuts,
    boundary,
    indices,
    maxExtent: Math.max(0, ...boundary.map(([x, z]) => Math.hypot(x, z))),
    positions,
  }
}

function unsafeRulingIntersection(
  firstStart: JunctionPlanPoint,
  firstEnd: JunctionPlanPoint,
  secondStart: JunctionPlanPoint,
  secondEnd: JunctionPlanPoint,
): boolean {
  const firstDirection = [
    firstEnd[0] - firstStart[0],
    firstEnd[1] - firstStart[1],
  ] as const
  const secondDirection = [
    secondEnd[0] - secondStart[0],
    secondEnd[1] - secondStart[1],
  ] as const
  const denominator = firstDirection[0] * secondDirection[1]
    - firstDirection[1] * secondDirection[0]
  const delta = [
    secondStart[0] - firstStart[0],
    secondStart[1] - firstStart[1],
  ] as const
  if (Math.abs(denominator) <= JUNCTION_GEOMETRY_EPSILON) {
    if (Math.abs(delta[0] * firstDirection[1] - delta[1] * firstDirection[0])
      > JUNCTION_GEOMETRY_EPSILON) return false
    const axis = Math.abs(firstDirection[0]) >= Math.abs(firstDirection[1]) ? 0 : 1
    const firstMinimum = Math.min(firstStart[axis], firstEnd[axis])
    const firstMaximum = Math.max(firstStart[axis], firstEnd[axis])
    const secondMinimum = Math.min(secondStart[axis], secondEnd[axis])
    const secondMaximum = Math.max(secondStart[axis], secondEnd[axis])
    return Math.min(firstMaximum, secondMaximum) - Math.max(firstMinimum, secondMinimum)
      > JUNCTION_GEOMETRY_EPSILON
  }

  const firstMix = (
    delta[0] * secondDirection[1] - delta[1] * secondDirection[0]
  ) / denominator
  const secondMix = (
    delta[0] * firstDirection[1] - delta[1] * firstDirection[0]
  ) / denominator
  if (
    firstMix < -JUNCTION_GEOMETRY_EPSILON
    || firstMix > 1 + JUNCTION_GEOMETRY_EPSILON
    || secondMix < -JUNCTION_GEOMETRY_EPSILON
    || secondMix > 1 + JUNCTION_GEOMETRY_EPSILON
  ) return false
  const firstAtEndpoint = firstMix <= JUNCTION_GEOMETRY_EPSILON
    || firstMix >= 1 - JUNCTION_GEOMETRY_EPSILON
  const secondAtEndpoint = secondMix <= JUNCTION_GEOMETRY_EPSILON
    || secondMix >= 1 - JUNCTION_GEOMETRY_EPSILON
  return !(firstAtEndpoint && secondAtEndpoint)
}

function constrainedFrameIsTopologySafe(frame: ConstrainedBoundaryFrame): boolean {
  const lastIndex = frame.basePoints.length - 1
  for (let firstIndex = 0; firstIndex <= lastIndex; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex <= lastIndex; secondIndex += 1) {
      const bothInterior = firstIndex > 0
        && firstIndex < lastIndex
        && secondIndex > 0
        && secondIndex < lastIndex
      if (bothInterior) continue
      if (unsafeRulingIntersection(
        frame.basePoints[firstIndex]!,
        frame.outerPoints[firstIndex]!,
        frame.basePoints[secondIndex]!,
        frame.outerPoints[secondIndex]!,
      )) return false
    }
  }

  let orientation = 0
  for (let index = 0; index < lastIndex; index += 1) {
    const points: JunctionPlanPoint[] = []
    for (const point of [
      frame.basePoints[index]!,
      frame.basePoints[index + 1]!,
      frame.outerPoints[index + 1]!,
      frame.outerPoints[index]!,
    ]) appendUniqueJunctionPoint(points, point)
    if (points.length > 1 && pointsCoincide(points[0]!, points.at(-1)!)) points.pop()
    if (points.length < 3) continue
    let doubleArea = 0
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex]!
      const next = points[(pointIndex + 1) % points.length]!
      doubleArea += point[0] * next[1] - point[1] * next[0]
    }
    if (Math.abs(doubleArea) <= JUNCTION_GEOMETRY_EPSILON) return false
    const cellOrientation = Math.sign(doubleArea)
    if (orientation !== 0 && cellOrientation !== orientation) return false
    orientation = cellOrientation
  }
  return orientation !== 0
}

const CONSTRAINED_APPROACH_SEPARATION = 1e-4
const PRESENTATION_TERMINAL_REMAINDER = 1e-3

function constrainedMiterSolution(
  network: RoadNetworkNode,
  solution: JunctionBoundaryGeometryData,
  constrainedCornerKey: string,
): JunctionBoundaryGeometryData | undefined {
  const pathIndex = solution.corners.findIndex((corner) => constrainedCornerKey ===
    junctionCornerKey(corner.fromEdgeId, corner.toEdgeId))
  const corner = solution.corners[pathIndex]
  const fromEdge = corner ? network.edges[corner.fromEdgeId] : undefined
  const toEdge = corner ? network.edges[corner.toEdgeId] : undefined
  const fromStyle = fromEdge ? resolveStyle(network, fromEdge) : undefined
  const toStyle = toEdge ? resolveStyle(network, toEdge) : undefined
  if (!corner || !fromEdge || !toEdge || !fromStyle || !toStyle) return undefined

  const fromSideWidth = junctionComponentWidths(fromStyle, 'left')
    .reduce((total, width) => total + width, 0)
  const toSideWidth = junctionComponentWidths(toStyle, 'right')
    .reduce((total, width) => total + width, 0)
  const from = solution.approaches.find(({ edgeId }) => edgeId === corner.fromEdgeId)
  const to = solution.approaches.find(({ edgeId }) => edgeId === corner.toEdgeId)
  if (!from || !to) return undefined

  const fromDirection = [Math.cos(from.angle), Math.sin(from.angle)] as const
  const fromLeft = [-fromDirection[1], fromDirection[0]] as const
  const toDirection = [Math.cos(to.angle), Math.sin(to.angle)] as const
  const toLeft = [-toDirection[1], toDirection[0]] as const
  const miter = lineIntersection(
    [
      fromLeft[0] * (from.halfWidth + fromSideWidth),
      fromLeft[1] * (from.halfWidth + fromSideWidth),
    ],
    fromDirection,
    [
      -toLeft[0] * (to.halfWidth + toSideWidth),
      -toLeft[1] * (to.halfWidth + toSideWidth),
    ],
    toDirection,
  )
  if (!miter) return undefined

  const candidate = withMinimumApproachCuts(solution, {
    [from.edgeId]: miter[0] * fromDirection[0]
      + miter[1] * fromDirection[1]
      + CONSTRAINED_APPROACH_SEPARATION,
    [to.edgeId]: miter[0] * toDirection[0]
      + miter[1] * toDirection[1]
      + CONSTRAINED_APPROACH_SEPARATION,
  })
  const candidatePath = buildJunctionBoundarySidePaths(candidate)[pathIndex]
  if (!candidatePath) return undefined
  const frame = constrainedMiterBoundaryFrame(
    candidate,
    pathIndex,
    fromSideWidth,
    toSideWidth,
    candidatePath.points,
  )
  return frame && constrainedFrameIsTopologySafe(frame) ? candidate : undefined
}

type JunctionCellPoint = {
  point: JunctionPlanPoint
  surfaceThickness: number
}

function appendOrientedJunctionCell(
  geometry: RoadSurfaceGeometryData,
  cellPoints: readonly JunctionCellPoint[],
): void {
  const points: JunctionCellPoint[] = []
  for (const point of cellPoints) {
    if (!points.at(-1) || !pointsCoincide(points.at(-1)!.point, point.point)) points.push(point)
  }
  if (
    points.length > 1
    && pointsCoincide(points[0]!.point, points.at(-1)!.point)
  ) points.pop()
  if (points.length < 3) return

  const localTriangles: Array<readonly [number, number, number]> = []
  if (points.length === 3) {
    const area = upwardDoubleArea(points[0]!.point, points[1]!.point, points[2]!.point)
    if (Math.abs(area) <= JUNCTION_GEOMETRY_EPSILON) return
    localTriangles.push(area > 0 ? [0, 1, 2] : [0, 2, 1])
  } else if (points.length === 4) {
    const turns = points.map(({ point }, index) => upwardDoubleArea(
      point,
      points[(index + 1) % points.length]!.point,
      points[(index + 2) % points.length]!.point,
    )).filter((area) => Math.abs(area) > JUNCTION_GEOMETRY_EPSILON)
    if (turns.some((area) => area > 0) && turns.some((area) => area < 0)) {
      throw new Error('Cannot triangulate a non-convex junction band cell')
    }

    const candidates = [
      [[0, 1, 2], [0, 2, 3]],
      [[0, 1, 3], [1, 2, 3]],
    ] as const
    const validCandidates = candidates.flatMap((triangles) => {
      const areas = triangles.map(([first, second, third]) => upwardDoubleArea(
        points[first]!.point,
        points[second]!.point,
        points[third]!.point,
      ))
      if (
        areas.some((area) => Math.abs(area) <= JUNCTION_GEOMETRY_EPSILON)
        || Math.sign(areas[0]!) !== Math.sign(areas[1]!)
      ) return []
      return [{ areas, score: Math.min(...areas.map(Math.abs)), triangles }]
    }).sort((first, second) => second.score - first.score)
    const selected = validCandidates[0]
    if (!selected) {
      throw new Error('Cannot triangulate a degenerate junction band cell')
    }
    const reverse = selected.areas[0]! < 0
    for (const [first, second, third] of selected.triangles) {
      localTriangles.push(reverse ? [first, third, second] : [first, second, third])
    }
  } else {
    throw new Error('Junction band cells must contain at most four points')
  }

  const base = geometry.positions.length / 3
  for (const { point, surfaceThickness } of points) {
    geometry.positions.push(point[0], surfaceThickness, point[1])
  }
  for (const triangle of localTriangles) {
    geometry.indices.push(base + triangle[0], base + triangle[1], base + triangle[2])
  }
}

function classAwareJunctionBandGeometries(
  network: RoadNetworkNode,
  solution: JunctionBoundaryGeometryData,
  constrainedCornerKey?: string,
): Map<RoadSideComponentKind, RoadSurfaceGeometryData> {
  const geometries = new Map<RoadSideComponentKind, RoadSurfaceGeometryData>(
    ROAD_SIDE_COMPONENT_SPECS.map((spec) => [
      spec.kind,
      { indices: [], positions: [] },
    ]),
  )
  const basePaths = buildJunctionBoundarySidePaths(solution)
  const vergeIndex = ROAD_SIDE_COMPONENT_SPECS.findIndex(({ kind }) => kind === 'verge')

  for (let pathIndex = 0; pathIndex < basePaths.length; pathIndex += 1) {
    const basePath = basePaths[pathIndex]!
    const fromEdge = network.edges[basePath.fromEdgeId]
    const toEdge = network.edges[basePath.toEdgeId]
    const fromStyle = fromEdge ? resolveStyle(network, fromEdge) : undefined
    const toStyle = toEdge ? resolveStyle(network, toEdge) : undefined
    if (!fromStyle || !toStyle) continue

    const fromWidths = junctionComponentWidths(fromStyle, 'left')
    const toWidths = junctionComponentWidths(toStyle, 'right')
    const fromSideWidth = fromWidths.reduce((total, width) => total + width, 0)
    const toSideWidth = toWidths.reduce((total, width) => total + width, 0)
    const isConstrainedCorner = constrainedCornerKey === junctionCornerKey(
      basePath.fromEdgeId,
      basePath.toEdgeId,
    )
    const constrainedFrame = isConstrainedCorner
      ? constrainedMiterBoundaryFrame(
          solution,
          pathIndex,
          fromSideWidth,
          toSideWidth,
          basePath.points,
        )
      : undefined
    const referencePoints = constrainedFrame?.basePoints ?? basePath.points
    const distances = [0]
    for (let index = 1; index < referencePoints.length; index += 1) {
      const previous = referencePoints[index - 1]!
      const point = referencePoints[index]!
      distances.push(distances[index - 1]! + Math.hypot(
        point[0] - previous[0],
        point[1] - previous[1],
      ))
    }
    const totalDistance = distances.at(-1) ?? 0
    const pathMixes = constrainedFrame?.pathMixes ?? distances.map(
      (distance) => totalDistance > 1e-6 ? distance / totalDistance : 0,
    )
    const componentWidths = ROAD_SIDE_COMPONENT_SPECS.map(() => [] as number[])
    const boundaries = Array.from(
      { length: ROAD_SIDE_COMPONENT_SPECS.length + 1 },
      () => [] as JunctionPlanPoint[],
    )

    for (let pointIndex = 0; pointIndex < referencePoints.length; pointIndex += 1) {
      const pathMix = pathMixes[pointIndex]!
      const widths = fromWidths.map((width, componentIndex) => interpolate(
        width,
        toWidths[componentIndex]!,
        pathMix,
      ))
      const inner = referencePoints[pointIndex]!

      if (constrainedFrame) {
        const outer = constrainedFrame.outerPoints[pointIndex]!
        const geometricDepth = Math.hypot(outer[0] - inner[0], outer[1] - inner[1])
        const authoredDepth = widths.reduce((total, width) => total + width, 0)
        const residualVergeWidth = widths[vergeIndex]! + geometricDepth - authoredDepth
        if (residualVergeWidth < -JUNCTION_GEOMETRY_EPSILON) {
          throw new Error('Constrained junction ruling is too short for its rigid bands')
        }
        widths[vergeIndex] = Math.max(0, residualVergeWidth)
        boundaries[0]!.push(inner)
        let offset = 0
        for (let componentIndex = 0; componentIndex < widths.length; componentIndex += 1) {
          const width = widths[componentIndex]!
          componentWidths[componentIndex]!.push(width)
          offset += width
          const fraction = geometricDepth > JUNCTION_GEOMETRY_EPSILON
            ? Math.min(1, offset / geometricDepth)
            : 0
          boundaries[componentIndex + 1]!.push([
            interpolate(inner[0], outer[0], fraction),
            interpolate(inner[1], outer[1], fraction),
          ])
        }
        boundaries.at(-1)![pointIndex] = outer
        continue
      }

      boundaries[0]!.push(inner)
      let offset = 0
      for (let componentIndex = 0; componentIndex < widths.length; componentIndex += 1) {
        const width = widths[componentIndex]!
        componentWidths[componentIndex]!.push(width)
        offset += width
        boundaries[componentIndex + 1]!.push(
          junctionBoundarySidePathPoint(solution, pathIndex, pointIndex, offset) ?? inner,
        )
      }
    }

    if (!constrainedFrame && referencePoints.length > 1) {
      const lastIndex = referencePoints.length - 1
      if (junctionBoundaryPointsCoincide(referencePoints[0]!, referencePoints[1]!)) {
        for (const boundary of boundaries) boundary[1] = boundary[0]!
        for (const widths of componentWidths) widths[1] = widths[0]!
        pathMixes[1] = pathMixes[0]!
      }
      if (junctionBoundaryPointsCoincide(
        referencePoints[lastIndex - 1]!,
        referencePoints[lastIndex]!,
      )) {
        for (const boundary of boundaries) boundary[lastIndex - 1] = boundary[lastIndex]!
        for (const widths of componentWidths) widths[lastIndex - 1] = widths[lastIndex]!
        pathMixes[lastIndex - 1] = pathMixes[lastIndex]!
      }
    }

    const boundaryThicknesses = boundaries.map((_, boundaryIndex) => pathMixes.map(
      (pathMix, pointIndex) => {
        if (
          constrainedFrame
          && boundaryIndex === boundaries.length - 1
          && pointIndex > 0
          && pointIndex < referencePoints.length - 1
        ) return Math.max(fromStyle.surfaceThickness, toStyle.surfaceThickness)
        return interpolate(fromStyle.surfaceThickness, toStyle.surfaceThickness, pathMix)
      },
    ))

    for (let componentIndex = 0; componentIndex < ROAD_SIDE_COMPONENT_SPECS.length; componentIndex += 1) {
      const geometry = geometries.get(ROAD_SIDE_COMPONENT_SPECS[componentIndex]!.kind)!
      const innerPoints = boundaries[componentIndex]!
      const outerPoints = boundaries[componentIndex + 1]!
      const innerThicknesses = boundaryThicknesses[componentIndex]!
      const outerThicknesses = boundaryThicknesses[componentIndex + 1]!
      const widths = componentWidths[componentIndex]!
      for (let pointIndex = 0; pointIndex < referencePoints.length - 1; pointIndex += 1) {
        if (Math.max(widths[pointIndex]!, widths[pointIndex + 1]!) <= JUNCTION_GEOMETRY_EPSILON) {
          continue
        }
        appendOrientedJunctionCell(geometry, [
          { point: innerPoints[pointIndex]!, surfaceThickness: innerThicknesses[pointIndex]! },
          { point: innerPoints[pointIndex + 1]!, surfaceThickness: innerThicknesses[pointIndex + 1]! },
          { point: outerPoints[pointIndex + 1]!, surfaceThickness: outerThicknesses[pointIndex + 1]! },
          { point: outerPoints[pointIndex]!, surfaceThickness: outerThicknesses[pointIndex]! },
        ])
      }
    }
  }

  return geometries
}

function geometryTrianglePoints(
  geometry: RoadSurfaceGeometryData,
  offset: number,
): readonly [JunctionPlanPoint, JunctionPlanPoint, JunctionPlanPoint] {
  return geometry.indices.slice(offset, offset + 3).map((vertex) => [
    geometry.positions[vertex * 3]!,
    geometry.positions[vertex * 3 + 2]!,
  ] as const) as [JunctionPlanPoint, JunctionPlanPoint, JunctionPlanPoint]
}

function planCross(
  first: JunctionPlanPoint,
  second: JunctionPlanPoint,
  point: JunctionPlanPoint,
): number {
  return (second[0] - first[0]) * (point[1] - first[1])
    - (second[1] - first[1]) * (point[0] - first[0])
}

function triangleIntersectionArea(
  subject: readonly JunctionPlanPoint[],
  clip: readonly JunctionPlanPoint[],
): number {
  let polygon = [...subject]
  const clipOrientation = Math.sign(planCross(clip[0]!, clip[1]!, clip[2]!))
  if (clipOrientation === 0) return 0

  for (let edgeIndex = 0; edgeIndex < clip.length; edgeIndex += 1) {
    const edgeStart = clip[edgeIndex]!
    const edgeEnd = clip[(edgeIndex + 1) % clip.length]!
    const input = polygon
    polygon = []
    if (input.length === 0) break

    let previous = input.at(-1)!
    let previousDistance = clipOrientation * planCross(edgeStart, edgeEnd, previous)
    for (const current of input) {
      const currentDistance = clipOrientation * planCross(edgeStart, edgeEnd, current)
      const previousInside = previousDistance >= -1e-10
      const currentInside = currentDistance >= -1e-10
      if (previousInside !== currentInside) {
        const mix = previousDistance / (previousDistance - currentDistance)
        polygon.push([
          interpolate(previous[0], current[0], mix),
          interpolate(previous[1], current[1], mix),
        ])
      }
      if (currentInside) polygon.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }

  let doubleArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    doubleArea += point[0] * next[1] - point[1] * next[0]
  }
  return Math.abs(doubleArea) / 2
}

function junctionCandidateGeometryIsTopologySafe(
  network: RoadNetworkNode,
  solution: JunctionBoundaryGeometryData,
  constrainedCornerKey: string,
): boolean {
  let carriagewayOrientation = 0
  for (let offset = 0; offset < solution.indices.length; offset += 3) {
    const points = geometryTrianglePoints(solution, offset)
    const area = upwardDoubleArea(points[0], points[1], points[2])
    if (Math.abs(area) <= JUNCTION_GEOMETRY_EPSILON) return false
    const orientation = Math.sign(area)
    if (carriagewayOrientation !== 0 && orientation !== carriagewayOrientation) return false
    carriagewayOrientation = orientation
  }

  let geometries: Map<RoadSideComponentKind, RoadSurfaceGeometryData>
  try {
    geometries = classAwareJunctionBandGeometries(network, solution, constrainedCornerKey)
  } catch {
    return false
  }
  const triangles: Array<readonly [JunctionPlanPoint, JunctionPlanPoint, JunctionPlanPoint]> = []
  for (const geometry of geometries.values()) {
    for (let offset = 0; offset < geometry.indices.length; offset += 3) {
      const points = geometryTrianglePoints(geometry, offset)
      if (upwardDoubleArea(points[0], points[1], points[2])
        <= JUNCTION_GEOMETRY_EPSILON) return false
      triangles.push(points)
    }
  }
  for (let firstIndex = 0; firstIndex < triangles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < triangles.length; secondIndex += 1) {
      if (triangleIntersectionArea(triangles[firstIndex]!, triangles[secondIndex]!)
        > JUNCTION_GEOMETRY_EPSILON) return false
    }
  }
  return true
}

function junctionCarriagewayGeometry(
  network: RoadNetworkNode,
  solution: JunctionBoundaryGeometryData,
  defaultThickness: number,
): RoadSurfaceGeometryData {
  const samples: Array<{ point: JunctionPlanPoint; surfaceThickness: number }> = []
  for (const path of buildJunctionBoundarySidePaths(solution)) {
    const fromEdge = network.edges[path.fromEdgeId]
    const toEdge = network.edges[path.toEdgeId]
    const fromStyle = fromEdge ? resolveStyle(network, fromEdge) : undefined
    const toStyle = toEdge ? resolveStyle(network, toEdge) : undefined
    if (!fromStyle || !toStyle) continue

    const distances = [0]
    for (let index = 1; index < path.points.length; index += 1) {
      const previous = path.points[index - 1]!
      const point = path.points[index]!
      distances.push(distances[index - 1]! + Math.hypot(
        point[0] - previous[0],
        point[1] - previous[1],
      ))
    }
    const totalDistance = distances.at(-1) ?? 0
    for (let index = 0; index < path.points.length; index += 1) {
      const pathMix = totalDistance > 1e-6 ? distances[index]! / totalDistance : 0
      samples.push({
        point: path.points[index]!,
        surfaceThickness: interpolate(
          fromStyle.surfaceThickness,
          toStyle.surfaceThickness,
          pathMix,
        ),
      })
    }
  }

  const positions = [...solution.positions]
  for (let index = 0; index < solution.boundary.length; index += 1) {
    const point = solution.boundary[index]!
    const surfaceThickness = samples.find((sample) => pointsCoincide(sample.point, point))
      ?.surfaceThickness ?? defaultThickness
    positions[index * 3 + 1] = surfaceThickness
  }
  return { indices: [...solution.indices], positions }
}

function translatedGeometry(
  geometry: RoadSurfaceGeometryData,
  translation: RoadPresentationPoint,
): RoadSurfaceGeometryData {
  const positions = [...geometry.positions]
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! + translation[0]
    positions[index + 1] = positions[index + 1]! + translation[1]
    positions[index + 2] = positions[index + 2]! + translation[2]
  }
  return { indices: [...geometry.indices], positions }
}

function markingGeometry(polygons: readonly RoadMarkingPolygon[]): RoadSurfaceGeometryData {
  const positions: number[] = []
  const indices: number[] = []
  for (const polygon of polygons) {
    if (polygon.points.length < 3) continue
    const base = positions.length / 3
    for (const point of polygon.points) positions.push(point[0], point[1], point[2])
    for (let index = 1; index < polygon.points.length - 1; index += 1) {
      indices.push(base, base + index, base + index + 1)
    }
  }
  return { indices, positions }
}

/** Keep a real inner fillet while the outer Site edge remains an exact miter. */
function constrainedInnerReturnRadius(): number {
  return 1.45
}

function solveJunctions(network: RoadNetworkNode): SolvedJunction[] {
  return Object.values(network.graphNodes).flatMap((graphNode) => {
    const incident = Object.values(network.edges).filter(
      (edge) => edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
    )
    if (
      incident.length < 2
      || (incident.length === 2 && !network.junctions[graphNode.id])
    ) return []
    const styles = incident.flatMap((edge) => {
      const style = resolveStyle(network, edge)
      return style ? [style] : []
    })
    const junction = network.junctions[graphNode.id]
    const primaryStyle = junction?.primaryEdgeIds.flatMap((edgeId) => {
      const edge = network.edges[edgeId]
      const style = edge ? resolveStyle(network, edge) : undefined
      return style ? [style] : []
    })[0]
    const style = primaryStyle ?? styles[0]
    if (!style) return []
    const approaches = incident.flatMap((edge) => {
      const edgeStyle = resolveStyle(network, edge)
      const points = sampleRoadEdgePoints(network, edge)
      if (!edgeStyle || points.length < 2) return []
      const from = edge.startNodeId === graphNode.id ? points[0]! : points.at(-1)!
      const toward = edge.startNodeId === graphNode.id ? points[1]! : points.at(-2)!
      return [{
        angle: Math.atan2(toward[2] - from[2], toward[0] - from[0]),
        edgeId: edge.id,
        halfWidth: carriagewayWidth(edgeStyle) / 2,
      }]
    })
    const constrainedCornerKey = mixedTSiteSideCornerKey(network, graphNode.id)
    const cornerRadii = { ...junction?.cornerRadii }
    let solution: JunctionBoundaryGeometryData
    if (constrainedCornerKey) {
      const solutionAtRadius = (radius: number): JunctionBoundaryGeometryData | undefined => {
        const initialSolution = buildJunctionBoundaryGeometry(approaches, {
          ...cornerRadii,
          [constrainedCornerKey]: radius,
        })
        return constrainedMiterSolution(
          network,
          initialSolution,
          constrainedCornerKey,
        )
      }
      const preferredRadius = constrainedInnerReturnRadius()
      const preferredSolution = solutionAtRadius(preferredRadius)
      if (preferredSolution) {
        solution = preferredSolution
      } else {
        let lowerRadius = 0.5
        let lowerSolution = solutionAtRadius(lowerRadius)
        if (!lowerSolution) {
          throw new Error('Unable to fit a topology-safe constrained junction fan')
        }
        let upperRadius = preferredRadius
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const radius = (lowerRadius + upperRadius) / 2
          const candidate = solutionAtRadius(radius)
          if (candidate) {
            lowerRadius = radius
            lowerSolution = candidate
          } else {
            upperRadius = radius
          }
        }
        solution = lowerSolution
      }
      if (!junctionCandidateGeometryIsTopologySafe(
        network,
        solution,
        constrainedCornerKey,
      )) {
        throw new Error('Unable to build a topology-safe constrained junction fan')
      }
    } else {
      solution = buildJunctionBoundaryGeometry(approaches, cornerRadii)
    }
    return [{
      constrainedCornerKey,
      graphNode,
      sideBands: buildRoadJunctionBands(styles),
      solution,
      style,
    }]
  })
}

type EdgeApproachCuts = {
  end: number
  start: number
}

function sampledRoadEdgeLength(
  edge: RoadGraphEdge,
  graphNodes: RoadNetworkNode['graphNodes'],
): number {
  const points = sampleRoadEdgePoints({ graphNodes }, edge)
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    total += Math.hypot(point[0] - previous[0], point[2] - previous[2])
  }
  return total
}

function presentationNetworkWithTerminalExtensions(
  network: RoadNetworkNode,
  junctions: readonly SolvedJunction[],
): RoadNetworkNode {
  const cutsByEdge = new Map<string, EdgeApproachCuts>()
  for (const { graphNode, solution } of junctions) {
    for (const [edgeId, cut] of Object.entries(solution.approachCuts)) {
      const edge = network.edges[edgeId]
      if (!edge) continue
      const cuts = cutsByEdge.get(edgeId) ?? { end: 0, start: 0 }
      if (edge.startNodeId === graphNode.id) cuts.start = Math.max(cuts.start, cut)
      if (edge.endNodeId === graphNode.id) cuts.end = Math.max(cuts.end, cut)
      cutsByEdge.set(edgeId, cuts)
    }
  }

  const incidentCounts = new Map<string, number>()
  for (const edge of Object.values(network.edges)) {
    incidentCounts.set(edge.startNodeId, (incidentCounts.get(edge.startNodeId) ?? 0) + 1)
    incidentCounts.set(edge.endNodeId, (incidentCounts.get(edge.endNodeId) ?? 0) + 1)
  }

  let graphNodes = network.graphNodes
  let edges = network.edges
  for (const [edgeId, cuts] of cutsByEdge) {
    let edge = edges[edgeId]
    if (!edge) continue
    const targetLength = cuts.start + cuts.end + PRESENTATION_TERMINAL_REMAINDER
    if (sampledRoadEdgeLength(edge, graphNodes) >= targetLength) continue

    let terminalNodeId = cuts.start > JUNCTION_GEOMETRY_EPSILON
      && cuts.end <= JUNCTION_GEOMETRY_EPSILON
      ? edge.endNodeId
      : cuts.end > JUNCTION_GEOMETRY_EPSILON
        && cuts.start <= JUNCTION_GEOMETRY_EPSILON
        ? edge.startNodeId
        : undefined
    if (!terminalNodeId) {
      throw new Error(`Unable to extend road edge cut at both ends ${edge.id}`)
    }
    if (incidentCounts.get(terminalNodeId) !== 1) {
      const terminal = graphNodes[terminalNodeId]
      if (!terminal) {
        throw new Error(`Unable to resolve terminal node for road edge ${edge.id}`)
      }
      const detachedTerminalId = `${terminalNodeId}:presentation-terminal:${edge.id}`
      if (graphNodes === network.graphNodes) graphNodes = { ...network.graphNodes }
      graphNodes[detachedTerminalId] = { ...terminal, id: detachedTerminalId }
      if (edges === network.edges) edges = { ...network.edges }
      edge = {
        ...edge,
        ...(edge.startNodeId === terminalNodeId
          ? { startNodeId: detachedTerminalId }
          : { endNodeId: detachedTerminalId }),
      }
      edges[edgeId] = edge
      terminalNodeId = detachedTerminalId
    }

    if (graphNodes === network.graphNodes) graphNodes = { ...network.graphNodes }
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const deficit = targetLength - sampledRoadEdgeLength(edge, graphNodes)
      if (deficit <= JUNCTION_GEOMETRY_EPSILON) break
      const samples = sampleRoadEdgePoints({ graphNodes }, edge)
      const ordered = edge.startNodeId === terminalNodeId
        ? samples
        : [...samples].reverse()
      const terminal = graphNodes[terminalNodeId]
      const towardRoad = ordered[1]
      if (!terminal || !towardRoad) {
        throw new Error(`Unable to resolve terminal tangent for road edge ${edge.id}`)
      }
      const deltaX = terminal.position[0] - towardRoad[0]
      const deltaZ = terminal.position[2] - towardRoad[2]
      const length = Math.hypot(deltaX, deltaZ)
      if (length <= JUNCTION_GEOMETRY_EPSILON) {
        throw new Error(`Unable to resolve terminal tangent for road edge ${edge.id}`)
      }
      graphNodes[terminalNodeId] = {
        ...terminal,
        position: [
          terminal.position[0] + deltaX / length * (deficit + JUNCTION_GEOMETRY_EPSILON),
          terminal.position[1],
          terminal.position[2] + deltaZ / length * (deficit + JUNCTION_GEOMETRY_EPSILON),
        ],
      }
    }
    if (sampledRoadEdgeLength(edge, graphNodes) < targetLength - JUNCTION_GEOMETRY_EPSILON) {
      throw new Error(`Unable to preserve a nonzero road segment for edge ${edge.id}`)
    }
  }

  return graphNodes === network.graphNodes && edges === network.edges
    ? network
    : { ...network, edges, graphNodes }
}

function edgeSurfaces(
  network: RoadNetworkNode,
  junctions: readonly SolvedJunction[],
): RoadPresentationSurface[] {
  const approachCuts = Object.fromEntries(junctions.flatMap(({ graphNode, solution }) =>
    Object.entries(solution.approachCuts).map(([edgeId, cut]) => [
      `${graphNode.id}:${edgeId}`,
      cut,
    ])))
  const surfaces: RoadPresentationSurface[] = []

  for (const profile of buildRoadTransitionProfiles(network)) {
    const decorativeProfile = trimRoadTransitionProfile(
      profile,
      approachCuts[`${profile.startNodeId}:${profile.edgeIds[0]}`] ?? 0,
      approachCuts[`${profile.endNodeId}:${profile.edgeIds.at(-1)}`] ?? 0,
    )
    surfaces.push(standardSurface({
      id: `${profile.key}:carriageway`,
      name: 'road-segment-surface',
      kind: 'carriageway',
      color: profile.style.surfaceColor,
      polygonOffsetFactor: -1,
      width: carriagewayWidth(profile.style),
      geometry: variableRibbonGeometry(decorativeProfile.samples.map((sample) => ({
        ...sample,
        leftOffset: sample.carriagewayHalfWidth,
        rightOffset: -sample.carriagewayHalfWidth,
      }))),
    }))

    for (const side of ['left', 'right'] as const) {
      for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
        if (!decorativeProfile.samples.some(
          (sample) => sample.components[side][spec.kind].width > 1e-4,
        )) continue
        surfaces.push(standardSurface({
          id: `${profile.key}:${side}:${spec.kind}`,
          name: `road-side-${side}-${spec.kind}`,
          kind: spec.kind,
          color: spec.color,
          polygonOffsetFactor: -1,
          geometry: variableRibbonGeometry(
            decorativeProfile.samples.map((sample) => {
              const bounds = sample.components[side][spec.kind]
              return {
                ...sample,
                leftOffset: side === 'left' ? bounds.outerOffset : -bounds.innerOffset,
                rightOffset: side === 'left' ? bounds.innerOffset : -bounds.outerOffset,
              }
            }),
            spec.elevationOffset,
          ),
        }))
      }
    }

    if (decorativeProfile.samples.some((sample) => sample.medianWidth > 1e-4)) {
      surfaces.push(standardSurface({
        id: `${profile.key}:median`,
        name: 'road-median',
        kind: 'median',
        color: '#777d70',
        polygonOffsetFactor: -1,
        geometry: variableRibbonGeometry(
          decorativeProfile.samples.map((sample) => ({
            ...sample,
            leftOffset: sample.medianWidth * 0.36,
            rightOffset: -sample.medianWidth * 0.36,
          })),
          0.07,
        ),
      }))
    }
  }

  return surfaces
}

function markingSurfaces(
  network: RoadNetworkNode,
  junctions: readonly SolvedJunction[],
): RoadPresentationSurface[] {
  const groups = new Map<string, RoadMarkingPolygon[]>()
  const junctionApproachCuts = Object.fromEntries(
    junctions.map(({ graphNode, solution }) => [
      graphNode.id,
      solution.approachCuts,
    ]),
  )
  for (const marking of buildRoadNetworkMarkings(network, junctionApproachCuts)) {
    const key = `${marking.kind}:${marking.color}`
    groups.set(key, [...(groups.get(key) ?? []), marking])
  }
  return [...groups.entries()].map(([key, polygons]) => ({
    id: `road-marking:${key}`,
    name: `road-marking-${polygons[0]!.kind}`,
    kind: polygons[0]!.kind,
    color: polygons[0]!.color,
    roughness: 1,
    metalness: 0,
    doubleSided: true,
    castShadow: false,
    receiveShadow: false,
    material: 'basic' as const,
    depthWrite: true,
    polygonOffsetFactor: -4,
    geometry: markingGeometry(polygons),
  }))
}

function junctionSurfaces(
  network: RoadNetworkNode,
  junctions: readonly SolvedJunction[],
): {
  descriptors: RoadJunctionPresentation[]
  surfaces: RoadPresentationSurface[]
} {
  const surfaces: RoadPresentationSurface[] = []
  const descriptors: RoadJunctionPresentation[] = []

  for (const {
    constrainedCornerKey,
    graphNode,
    sideBands,
    solution,
    style,
  } of junctions) {
    const surfaceIds: string[] = []
    const carriagewayId = `${graphNode.id}:junction-carriageway`
    surfaceIds.push(carriagewayId)
    surfaces.push(standardSurface({
      id: carriagewayId,
      name: 'road-junction-surface',
      kind: 'junction-carriageway',
      color: style.surfaceColor,
      polygonOffsetFactor: -2,
      geometry: translatedGeometry(
        junctionCarriagewayGeometry(network, solution, style.surfaceThickness),
        graphNode.position,
      ),
    }))

    const bandGeometries = classAwareJunctionBandGeometries(
      network,
      solution,
      constrainedCornerKey,
    )
    for (const band of [...sideBands].reverse()) {
      const id = `${graphNode.id}:junction-${band.kind}`
      surfaceIds.push(id)
      surfaces.push(standardSurface({
        id,
        name: `road-junction-${band.kind}`,
        kind: band.kind,
        color: band.color,
        polygonOffsetFactor: -3,
        width: band.width,
        geometry: translatedGeometry(
          bandGeometries.get(band.kind) ?? { indices: [], positions: [] },
          [
            graphNode.position[0],
            graphNode.position[1] + band.elevationOffset,
            graphNode.position[2],
          ],
        ),
      }))
    }

    descriptors.push({
      id: graphNode.id,
      approachCuts: solution.approachCuts,
      boundary: solution.boundary.map(([x, z]) => [
        x + graphNode.position[0],
        z + graphNode.position[2],
      ] as const),
      primaryEdgeIds: network.junctions[graphNode.id]?.primaryEdgeIds ?? [],
      surfaceIds,
    })
  }

  return { descriptors, surfaces }
}

export function buildRoadPresentationPlan(
  network: RoadNetworkNode,
): RoadPresentationPlan {
  const initialJunctions = solveJunctions(network)
  const presentationNetwork = presentationNetworkWithTerminalExtensions(
    network,
    initialJunctions,
  )
  const solvedJunctions = presentationNetwork === network
    ? initialJunctions
    : solveJunctions(presentationNetwork)
  const presentedJunctions = junctionSurfaces(presentationNetwork, solvedJunctions)
  return {
    id: 'environment-streetscape-road-network',
    junctions: presentedJunctions.descriptors,
    surfaces: [
      ...edgeSurfaces(presentationNetwork, solvedJunctions),
      ...markingSurfaces(presentationNetwork, solvedJunctions),
      ...presentedJunctions.surfaces,
    ].filter(({ geometry }) => geometry.positions.length > 0),
  }
}
