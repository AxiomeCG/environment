import {
  buildJunctionBoundaryGeometry,
  sampleRoadEdgePoints,
} from './road-network-geometry'
import {
  buildRoadTransitionProfiles,
  trimRoadTransitionProfile,
  type RoadTransitionSample,
} from './road-transition-profile'
import type { RoadGraphEdge, RoadNetworkNode, RoadStylePreset } from './schema'
import { DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'
import { resolveRoadRegionalPack, type RoadRegionalPack } from './road-regional-packs'

export type RoadMarkingKind =
  | 'centerline'
  | 'crosswalk'
  | 'direction-arrow'
  | 'lane-dash'
  | 'stop-line'
  | 'yield-line'

export type RoadMarkingPolygon = {
  color: string
  edgeId: string
  junctionId?: string
  kind: RoadMarkingKind
  points: Array<readonly [number, number, number]>
}

type Point3 = readonly [number, number, number]
type PathSample = {
  direction: readonly [number, number]
  point: Point3
}

function resolveStyle(node: RoadNetworkNode, edge: RoadGraphEdge): RoadStylePreset | undefined {
  const styleId = node.applyStyleToAll ? node.activeStyleId : edge.styleId
  return (
    node.stylePresets[styleId] ??
    (DEFAULT_ROAD_STYLE_PRESETS[styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS] as
      | RoadStylePreset
      | undefined) ??
    node.stylePresets[node.activeStyleId]
  )
}

function carriagewayWidth(style: RoadStylePreset): number {
  return style.laneCount * style.laneWidth + style.shoulderWidth * 2 + style.medianWidth
}

function distanceXZ(first: Point3, second: Point3): number {
  return Math.hypot(second[0] - first[0], second[2] - first[2])
}

function interpolate(first: Point3, second: Point3, t: number): Point3 {
  return [
    first[0] + (second[0] - first[0]) * t,
    first[1] + (second[1] - first[1]) * t,
    first[2] + (second[2] - first[2]) * t,
  ]
}

function pointAtDistance(points: Point3[], distance: number): PathSample | null {
  let remaining = Math.max(0, distance)
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!
    const end = points[index + 1]!
    const length = distanceXZ(start, end)
    if (length <= 1e-6) continue
    if (remaining <= length + 1e-6) {
      const t = Math.max(0, Math.min(1, remaining / length))
      return {
        direction: [(end[0] - start[0]) / length, (end[2] - start[2]) / length],
        point: interpolate(start, end, t),
      }
    }
    remaining -= length
  }
  return null
}

function offsetTransitionPath(
  samples: RoadTransitionSample[],
  boundaryIndex: number,
): Point3[] {
  return samples.map((sample, index) => {
    const previous = samples[Math.max(0, index - 1)]!
    const next = samples[Math.min(samples.length - 1, index + 1)]!
    const length = Math.max(distanceXZ(previous.point, next.point), 1e-6)
    const left = [
      -(next.point[2] - previous.point[2]) / length,
      (next.point[0] - previous.point[0]) / length,
    ] as const
    const offset = sample.laneBoundaryOffsets[boundaryIndex] ?? 0
    return [
      sample.point[0] + left[0] * offset,
      sample.point[1] + sample.surfaceThickness + 0.014,
      sample.point[2] + left[1] * offset,
    ]
  })
}

/** Split a sampled centerline into physical dash runs without resetting on curves. */
export function splitRoadMarkingDashes(
  points: Point3[],
  dashLength = 3,
  gapLength = 3,
): Point3[][] {
  if (points.length < 2 || dashLength <= 0 || gapLength < 0) return []
  const result: Point3[][] = []
  let drawing = true
  let patternRemaining = dashLength
  let current: Point3[] = [[...points[0]!] as Point3]
  for (let index = 0; index < points.length - 1; index++) {
    let start = points[index]!
    const end = points[index + 1]!
    let segmentRemaining = distanceXZ(start, end)
    if (segmentRemaining <= 1e-6) continue
    while (segmentRemaining > 1e-6) {
      const step = Math.min(segmentRemaining, patternRemaining)
      const next = interpolate(start, end, step / segmentRemaining)
      if (drawing) current.push(next)
      segmentRemaining -= step
      patternRemaining -= step
      start = next
      if (patternRemaining <= 1e-6) {
        if (drawing && current.length >= 2) result.push(current)
        drawing = !drawing
        patternRemaining = drawing ? dashLength : gapLength
        current = drawing ? [[...start] as Point3] : []
        if (patternRemaining <= 1e-6) {
          drawing = true
          patternRemaining = dashLength
          current = [[...start] as Point3]
        }
      }
    }
  }
  if (drawing && current.length >= 2) result.push(current)
  return result
}

function ribbonPolygons(
  points: Point3[],
  width: number,
  kind: RoadMarkingKind,
  color: string,
  edgeId: string,
): RoadMarkingPolygon[] {
  const halfWidth = width / 2
  const edges = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!
    const next = points[Math.min(points.length - 1, index + 1)]!
    const incomingLength = Math.max(distanceXZ(previous, point), 1e-6)
    const outgoingLength = Math.max(distanceXZ(point, next), 1e-6)
    const incomingNormalX = -(point[2] - previous[2]) / incomingLength
    const incomingNormalZ = (point[0] - previous[0]) / incomingLength
    const outgoingNormalX = -(next[2] - point[2]) / outgoingLength
    const outgoingNormalZ = (next[0] - point[0]) / outgoingLength
    let normalX = outgoingNormalX
    let normalZ = outgoingNormalZ
    let offset = halfWidth
    if (index === points.length - 1) {
      normalX = incomingNormalX
      normalZ = incomingNormalZ
    } else if (index > 0) {
      const sumX = incomingNormalX + outgoingNormalX
      const sumZ = incomingNormalZ + outgoingNormalZ
      const sumLength = Math.hypot(sumX, sumZ)
      if (sumLength > 1e-6) {
        normalX = sumX / sumLength
        normalZ = sumZ / sumLength
        const projection = Math.abs(
          normalX * outgoingNormalX + normalZ * outgoingNormalZ,
        )
        offset *= Math.min(4, 1 / Math.max(projection, 0.25))
      }
    }
    return {
      left: [
        point[0] + normalX * offset,
        point[1],
        point[2] + normalZ * offset,
      ] as Point3,
      right: [
        point[0] - normalX * offset,
        point[1],
        point[2] - normalZ * offset,
      ] as Point3,
    }
  })
  return edges.slice(0, -1).flatMap((start, index) => {
    const end = edges[index + 1]!
    if (distanceXZ(points[index]!, points[index + 1]!) <= 1e-6) return []
    return [{
      color,
      edgeId,
      kind,
      points: [start.left, end.left, end.right, start.right],
    }]
  })
}

function orientedRectangle(
  sample: PathSample,
  centerOffset: number,
  width: number,
  depth: number,
): Point3[] {
  const outward = sample.direction
  const left = [-outward[1], outward[0]] as const
  const center = [
    sample.point[0] + left[0] * centerOffset,
    sample.point[1],
    sample.point[2] + left[1] * centerOffset,
  ] as const
  return [
    [center[0] - outward[0] * depth / 2 + left[0] * width / 2, center[1], center[2] - outward[1] * depth / 2 + left[1] * width / 2],
    [center[0] + outward[0] * depth / 2 + left[0] * width / 2, center[1], center[2] + outward[1] * depth / 2 + left[1] * width / 2],
    [center[0] + outward[0] * depth / 2 - left[0] * width / 2, center[1], center[2] + outward[1] * depth / 2 - left[1] * width / 2],
    [center[0] - outward[0] * depth / 2 - left[0] * width / 2, center[1], center[2] - outward[1] * depth / 2 - left[1] * width / 2],
  ]
}

function arrowPolygons(sample: PathSample, lateralOffset: number): Point3[][] {
  const forward = [-sample.direction[0], -sample.direction[1]] as const
  const left = [-forward[1], forward[0]] as const
  const center = [
    sample.point[0] - sample.direction[1] * lateralOffset,
    sample.point[1],
    sample.point[2] + sample.direction[0] * lateralOffset,
  ] as const
  const toWorld = ([along, across]: readonly [number, number]): Point3 => [
    center[0] + forward[0] * along + left[0] * across,
    center[1],
    center[2] + forward[1] * along + left[1] * across,
  ]
  const shaft: Array<readonly [number, number]> = [
    [-1.7, 0.22], [0.55, 0.22], [0.55, -0.22], [-1.7, -0.22],
  ]
  const head: Array<readonly [number, number]> = [
    [0.15, 0.78], [2.1, 0], [0.15, -0.78],
  ]
  return [
    shaft.map(toWorld),
    head.map(toWorld),
  ]
}

function yieldTeeth(sample: PathSample, centerOffset: number, width: number): Point3[][] {
	const outward = sample.direction
	const left = [-outward[1], outward[0]] as const
	const toothCount = Math.max(1, Math.floor(width / 0.9))
	return Array.from({ length: toothCount }, (_, index) => {
		const lateral = centerOffset - width / 2 + (index + 0.5) * width / toothCount
		const centerX = sample.point[0] + left[0] * lateral
		const centerZ = sample.point[2] + left[1] * lateral
		const half = Math.min(0.32, width / toothCount * 0.35)
		return [
			[centerX - outward[0] * 0.28 - left[0] * half, sample.point[1], centerZ - outward[1] * 0.28 - left[1] * half],
			[centerX - outward[0] * 0.28 + left[0] * half, sample.point[1], centerZ - outward[1] * 0.28 + left[1] * half],
			[centerX + outward[0] * 0.28, sample.point[1], centerZ + outward[1] * 0.28],
		] as Point3[]
	})
}

export function incomingLaneOffsets(
  edge: RoadGraphEdge,
  junctionId: string,
  style: RoadStylePreset,
	drivingSide: RoadRegionalPack['drivingSide'] = 'right',
): number[] {
  const incoming =
    edge.direction === 'both' ||
    (edge.direction === 'forward' && edge.endNodeId === junctionId) ||
    (edge.direction === 'reverse' && edge.startNodeId === junctionId)
  if (!incoming) return []
  if (edge.direction !== 'both') {
    return Array.from({ length: style.laneCount }, (_, index) =>
      (index - (style.laneCount - 1) / 2) * style.laneWidth)
  }
  const count = Math.max(1, Math.floor(style.laneCount / 2))
	const side = drivingSide === 'right' ? 1 : -1
  return Array.from({ length: count }, (_, index) =>
    side * (style.medianWidth / 2 + style.laneWidth * (index + 0.5)))
}

function approachControlWidth(
  edge: RoadGraphEdge,
  junctionId: string,
  style: RoadStylePreset,
	drivingSide: RoadRegionalPack['drivingSide'],
): { centerOffset: number; width: number } | null {
  const offsets = incomingLaneOffsets(edge, junctionId, style, drivingSide)
  if (offsets.length === 0) return null
  if (edge.direction !== 'both') {
    return { centerOffset: 0, width: style.laneCount * style.laneWidth }
  }
  return {
		centerOffset: offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length,
    width: offsets.length * style.laneWidth,
  }
}

function buildJunctionData(node: RoadNetworkNode) {
  return Object.values(node.junctions).flatMap((junction) => {
    const graphNode = node.graphNodes[junction.nodeId]
    if (!graphNode) return []
    const incident = Object.values(node.edges).filter(
      (edge) => edge.startNodeId === junction.nodeId || edge.endNodeId === junction.nodeId,
    )
    const approaches = incident.flatMap((edge) => {
      const style = resolveStyle(node, edge)
      const points = sampleRoadEdgePoints(node, edge, 48)
      if (!style || points.length < 2) return []
      const outward = edge.startNodeId === junction.nodeId ? points : [...points].reverse()
      const from = outward[0]!
      const toward = outward[1]!
      return [{
        angle: Math.atan2(toward[2] - from[2], toward[0] - from[0]),
        edgeId: edge.id,
        halfWidth: carriagewayWidth(style) / 2,
      }]
    })
    const solution = buildJunctionBoundaryGeometry(approaches, junction.cornerRadii)
    return [{ graphNode, incident, junction, solution }]
  })
}

/** Build all topology-driven painted road markings as flat, non-interactive polygons. */
export function buildRoadNetworkMarkings(
  node: RoadNetworkNode,
  junctionApproachCuts: Readonly<Record<string, Readonly<Record<string, number>>>> = {},
): RoadMarkingPolygon[] {
  const polygons: RoadMarkingPolygon[] = []
  const regionalPack = resolveRoadRegionalPack(node)
  const junctionData = buildJunctionData(node)
  const approachCut = (() => {
    const genericCuts = Object.fromEntries(junctionData.flatMap(({ junction, solution }) =>
      Object.entries(solution.approachCuts).map(([edgeId, cut]) => [
        `${junction.nodeId}:${edgeId}`,
        cut,
      ])))
    return (junctionId: string, edgeId: string): number =>
      junctionApproachCuts[junctionId]?.[edgeId]
      ?? genericCuts[`${junctionId}:${edgeId}`]
      ?? 0
  })()

  for (const profile of buildRoadTransitionProfiles(node)) {
    const edge = node.edges[profile.edgeIds[0]!]
    if (!edge) continue
    const style = profile.style
    if (!style?.markings) continue
    const trimmed = trimRoadTransitionProfile(
      profile,
      approachCut(profile.startNodeId, profile.edgeIds[0]!),
      approachCut(profile.endNodeId, profile.edgeIds.at(-1)!),
    )
    const points = trimmed.samples.map((sample) => [
      sample.point[0],
      sample.point[1] + sample.surfaceThickness + 0.014,
      sample.point[2],
    ] as Point3)
    if (points.length < 2) continue
    if (style.medianWidth === 0 && style.laneCount >= 2) {
      polygons.push(...ribbonPolygons(
        points,
        0.12,
        'centerline',
        regionalPack.centerlineColor,
        edge.id,
      ))
    }
    for (let boundary = 1; boundary < style.laneCount; boundary++) {
      if (style.laneCount % 2 === 0 && boundary === style.laneCount / 2) continue
      for (const dash of splitRoadMarkingDashes(
        offsetTransitionPath(trimmed.samples, boundary - 1),
      )) {
        polygons.push(...ribbonPolygons(
          dash,
          0.09,
          'lane-dash',
          regionalPack.markingColor,
          edge.id,
        ))
      }
    }
  }

  for (const { junction, incident } of junctionData) {
    const primaryEdges = new Set(junction.primaryEdgeIds)
    for (const edge of incident) {
      const style = resolveStyle(node, edge)
      const cut = approachCut(junction.nodeId, edge.id)
      if (!style?.markings) continue
      const sampled = sampleRoadEdgePoints(node, edge, 96)
      const outward = edge.startNodeId === junction.nodeId ? sampled : [...sampled].reverse()
      const yOffset = style.surfaceThickness + 0.016
      const elevated = outward.map((point) => [
        point[0],
        point[1] + yOffset,
        point[2],
      ] as Point3)
      const laneOffsets = incomingLaneOffsets(
        edge,
        junction.nodeId,
        style,
        regionalPack.drivingSide,
      )
      const arrowSample = pointAtDistance(elevated, cut + 10.5)
      if (arrowSample) {
        for (const laneOffset of laneOffsets) {
          for (const points of arrowPolygons(arrowSample, laneOffset)) {
            polygons.push({
              color: regionalPack.markingColor,
              edgeId: edge.id,
              junctionId: junction.nodeId,
              kind: 'direction-arrow',
              points,
            })
          }
        }
      }
      const explicitControl = junction.approachControls?.[edge.id] ?? 'auto'
      const control = explicitControl !== 'auto'
        ? explicitControl
        : junction.treatment === 'stop' || junction.treatment === 'yield' || junction.treatment === 'signal'
          ? junction.treatment
          : junction.treatment === 'auto' && !primaryEdges.has(edge.id)
            ? 'stop'
            : 'none'
      const controlWidth = approachControlWidth(
        edge,
        junction.nodeId,
        style,
        regionalPack.drivingSide,
      )
      if (control === 'none' || !controlWidth) continue
      const stopSample = pointAtDistance(elevated, cut + 5.5)
      if (stopSample) {
        if (control === 'yield') {
          for (const points of yieldTeeth(
            stopSample,
            controlWidth.centerOffset,
            controlWidth.width,
          )) {
            polygons.push({
              color: regionalPack.markingColor,
              edgeId: edge.id,
              junctionId: junction.nodeId,
              kind: 'yield-line',
              points,
            })
          }
        } else {
          polygons.push({
            color: regionalPack.markingColor,
            edgeId: edge.id,
            junctionId: junction.nodeId,
            kind: 'stop-line',
            points: orientedRectangle(
              stopSample,
              controlWidth.centerOffset,
              controlWidth.width,
              0.35,
            ),
          })
        }
      }
      for (let bar = 0; bar < 6; bar++) {
        const sample = pointAtDistance(elevated, cut + 1 + bar * 0.68)
        if (!sample) continue
        polygons.push({
          color: regionalPack.markingColor,
          edgeId: edge.id,
          junctionId: junction.nodeId,
          kind: 'crosswalk',
          points: orientedRectangle(
            sample,
            0,
            style.laneCount * style.laneWidth + style.medianWidth,
            0.34,
          ),
        })
      }
    }
  }
  return polygons
}
