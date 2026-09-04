import {
  deriveRoadPresentationAlignments,
  type RoadPresentationAlignmentDescriptor,
  type SurroundingsLayoutDescriptor,
} from './corridor'
import type { Point2 } from './frontages'
import { DEFAULT_ROAD_STYLE_ID, DEFAULT_ROAD_STYLE_PRESETS } from './streetscape/road-style-presets'
import type {
  RoadGraphEdge,
  RoadJunction,
  RoadNetworkNode,
  RoadStylePreset,
} from './streetscape/schema'

const EPSILON = 1e-5

type LogicalRoad = {
  id: string
  separator: RoadPresentationAlignmentDescriptor['separator']
  corridorIds: readonly string[]
  points: Point2[]
}

type RoadMeasure = {
  distances: number[]
  total: number
}

type Intersection = {
  point: Point2
  stations: Map<string, number>
}

type SplitMarker = {
  nodeId: string
  point: Point2
  station: number
}

function distance(first: Point2, second: Point2): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function cross(first: Point2, second: Point2): number {
  return first[0] * second[1] - first[1] * second[0]
}

function subtract(first: Point2, second: Point2): Point2 {
  return [first[0] - second[0], first[1] - second[1]]
}

function measureRoad(points: readonly Point2[]): RoadMeasure {
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1]! + distance(points[index - 1]!, points[index]!))
  }
  return { distances, total: distances.at(-1) ?? 0 }
}

function pointAtStation(
  points: readonly Point2[],
  measure: RoadMeasure,
  station: number,
): Point2 {
  const target = Math.max(0, Math.min(measure.total, station))
  for (let index = 0; index < points.length - 1; index += 1) {
    const startDistance = measure.distances[index]!
    const endDistance = measure.distances[index + 1]!
    if (target > endDistance + EPSILON) continue
    const span = Math.max(EPSILON, endDistance - startDistance)
    const mix = (target - startDistance) / span
    const start = points[index]!
    const end = points[index + 1]!
    return [
      start[0] + (end[0] - start[0]) * mix,
      start[1] + (end[1] - start[1]) * mix,
    ]
  }
  return [...points.at(-1)!]
}

function subpath(
  points: readonly Point2[],
  measure: RoadMeasure,
  startStation: number,
  endStation: number,
): Point2[] {
  const result = [pointAtStation(points, measure, startStation)]
  for (let index = 1; index < points.length - 1; index += 1) {
    const station = measure.distances[index]!
    if (station > startStation + EPSILON && station < endStation - EPSILON) {
      result.push([...points[index]!] as Point2)
    }
  }
  const end = pointAtStation(points, measure, endStation)
  if (distance(result.at(-1)!, end) > EPSILON) result.push(end)
  return result
}

function segmentIntersection(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): { point: Point2; firstMix: number; secondMix: number } | null {
  const firstDirection = subtract(firstEnd, firstStart)
  const secondDirection = subtract(secondEnd, secondStart)
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= EPSILON) return null

  const between = subtract(secondStart, firstStart)
  const firstMix = cross(between, secondDirection) / denominator
  const secondMix = cross(between, firstDirection) / denominator
  if (
    firstMix < -EPSILON
    || firstMix > 1 + EPSILON
    || secondMix < -EPSILON
    || secondMix > 1 + EPSILON
  ) return null

  return {
    firstMix: Math.max(0, Math.min(1, firstMix)),
    secondMix: Math.max(0, Math.min(1, secondMix)),
    point: [
      firstStart[0] + firstDirection[0] * firstMix,
      firstStart[1] + firstDirection[1] * firstMix,
    ],
  }
}

function raySegmentIntersection(
  origin: Point2,
  direction: Point2,
  segmentStart: Point2,
  segmentEnd: Point2,
): { distance: number; point: Point2 } | null {
  const segmentDirection = subtract(segmentEnd, segmentStart)
  const denominator = cross(direction, segmentDirection)
  if (Math.abs(denominator) <= EPSILON) return null
  const between = subtract(segmentStart, origin)
  const rayDistance = cross(between, segmentDirection) / denominator
  const segmentMix = cross(between, direction) / denominator
  if (
    rayDistance < -EPSILON
    || segmentMix < -EPSILON
    || segmentMix > 1 + EPSILON
  ) return null
  return {
    distance: Math.max(0, rayDistance),
    point: [
      origin[0] + direction[0] * rayDistance,
      origin[1] + direction[1] * rayDistance,
    ],
  }
}

function endpointDirection(points: readonly Point2[], atStart: boolean): Point2 | null {
  if (points.length < 2) return null
  const endpoint = atStart ? points[0]! : points.at(-1)!
  const neighbor = atStart ? points[1]! : points.at(-2)!
  const delta = atStart ? subtract(endpoint, neighbor) : subtract(endpoint, neighbor)
  const length = Math.hypot(delta[0], delta[1])
  return length > EPSILON ? [delta[0] / length, delta[1] / length] : null
}

function extendSecondaryToPrimary(secondary: LogicalRoad, primary: LogicalRoad): void {
  const candidates = ([true, false] as const).flatMap((atStart) => {
    const origin = atStart ? secondary.points[0] : secondary.points.at(-1)
    const direction = endpointDirection(secondary.points, atStart)
    if (!origin || !direction) return []
    return primary.points.slice(0, -1).flatMap((segmentStart, index) => {
      const segmentEnd = primary.points[index + 1]!
      const hit = raySegmentIntersection(origin, direction, segmentStart, segmentEnd)
      return hit ? [{ ...hit, atStart }] : []
    })
  })
    .filter(({ distance }) => distance > EPSILON)
    .sort((left, right) => left.distance - right.distance)

  const nearest = candidates[0]
  if (!nearest) return
  if (nearest.atStart) secondary.points.unshift(nearest.point)
  else secondary.points.push(nearest.point)
}

function logicalRoadsFromLayout(layout: SurroundingsLayoutDescriptor): LogicalRoad[] {
  const roads = deriveRoadPresentationAlignments(layout).map((alignment): LogicalRoad => ({
    id: alignment.id,
    separator: alignment.separator,
    corridorIds: alignment.corridorIds,
    points: alignment.centerline.map((point) => [...point] as Point2),
  }))
  const roadByCorridorId = new Map<string, LogicalRoad>()
  for (const road of roads) {
    for (const corridorId of road.corridorIds) roadByCorridorId.set(corridorId, road)
  }
  const corridorByFrontage = new Map(
    layout.corridors.map((corridor) => [corridor.frontageIndex, corridor]),
  )

  for (const junction of layout.roadJunctions) {
    const previous = corridorByFrontage.get(junction.previousFrontageIndex)
    const next = corridorByFrontage.get(junction.nextFrontageIndex)
    if (!previous || !next || previous.separator === next.separator) continue
    const secondaryCorridor = previous.separator === 'secondary-road' ? previous : next
    const primaryCorridor = previous.separator === 'primary-road' ? previous : next
    const secondary = roadByCorridorId.get(secondaryCorridor.id)
    const primary = roadByCorridorId.get(primaryCorridor.id)
    if (secondary && primary && secondary !== primary) {
      extendSecondaryToPrimary(secondary, primary)
    }
  }

  return roads.filter((road) => road.points.length >= 2)
}

function collectIntersections(roads: readonly LogicalRoad[]): Intersection[] {
  const measures = new Map(roads.map((road) => [road.id, measureRoad(road.points)]))
  const intersections: Intersection[] = []

  for (let firstIndex = 0; firstIndex < roads.length - 1; firstIndex += 1) {
    const first = roads[firstIndex]!
    const firstMeasure = measures.get(first.id)!
    for (let secondIndex = firstIndex + 1; secondIndex < roads.length; secondIndex += 1) {
      const second = roads[secondIndex]!
      const secondMeasure = measures.get(second.id)!
      for (let firstSegment = 0; firstSegment < first.points.length - 1; firstSegment += 1) {
        const firstStart = first.points[firstSegment]!
        const firstEnd = first.points[firstSegment + 1]!
        const firstLength = distance(firstStart, firstEnd)
        if (firstLength <= EPSILON) continue
        for (let secondSegment = 0; secondSegment < second.points.length - 1; secondSegment += 1) {
          const secondStart = second.points[secondSegment]!
          const secondEnd = second.points[secondSegment + 1]!
          const secondLength = distance(secondStart, secondEnd)
          if (secondLength <= EPSILON) continue
          const hit = segmentIntersection(firstStart, firstEnd, secondStart, secondEnd)
          if (!hit) continue
          const firstStation = firstMeasure.distances[firstSegment]!
            + firstLength * hit.firstMix
          const secondStation = secondMeasure.distances[secondSegment]!
            + secondLength * hit.secondMix
          const existing = intersections.find(({ point }) => distance(point, hit.point) <= EPSILON)
          const intersection = existing ?? { point: hit.point, stations: new Map<string, number>() }
          intersection.stations.set(first.id, firstStation)
          intersection.stations.set(second.id, secondStation)
          if (!existing) intersections.push(intersection)
        }
      }
    }
  }

  return intersections.sort((left, right) =>
    left.point[0] - right.point[0] || left.point[1] - right.point[1])
}

function mergeMarkers(markers: readonly SplitMarker[]): SplitMarker[] {
  const sorted = [...markers].sort((left, right) => left.station - right.station)
  const merged: SplitMarker[] = []
  for (const marker of sorted) {
    const previous = merged.at(-1)
    if (previous && Math.abs(previous.station - marker.station) <= EPSILON) {
      if (marker.nodeId.startsWith('surroundings-road-junction-')) {
        merged[merged.length - 1] = marker
      }
      continue
    }
    merged.push(marker)
  }
  return merged
}

function junctionKind(degree: number): RoadJunction['kind'] {
  if (degree === 3) return 'tee'
  if (degree === 4) return 'four-way-plus'
  return degree > 4 ? 'multi-leg' : 'y'
}


function primaryEdges(incident: readonly RoadGraphEdge[]): string[] {
  const groups = new Map<string, RoadGraphEdge[]>()
  for (const edge of incident) {
    groups.set(edge.sourceRoadId, [...(groups.get(edge.sourceRoadId) ?? []), edge])
  }
  const priority = (edge: RoadGraphEdge) => edge.roadClass === 'collector' ? 1 : 0
  const selected = [...groups.entries()].sort((left, right) => {
    const priorityDifference = priority(right[1][0]!) - priority(left[1][0]!)
    return priorityDifference || right[1].length - left[1].length || left[0].localeCompare(right[0])
  })[0]?.[1] ?? []
  return selected.slice(0, 2).map(({ id }) => id)
}

export function deriveRuntimeRoadNetwork(
  layout: SurroundingsLayoutDescriptor,
): RoadNetworkNode {
  const roads = logicalRoadsFromLayout(layout)
  const intersections = collectIntersections(roads)
  const graphNodes: RoadNetworkNode['graphNodes'] = {}
  const edges: RoadNetworkNode['edges'] = {}

  intersections.forEach((intersection, index) => {
    const id = `surroundings-road-junction-${index}`
    graphNodes[id] = { id, position: [intersection.point[0], 0, intersection.point[1]] }
  })

  for (const road of roads) {
    const measure = measureRoad(road.points)
    if (measure.total <= EPSILON) continue
    const closed = distance(road.points[0]!, road.points.at(-1)!) <= EPSILON
    const startNodeId = closed ? `${road.id}:loop` : `${road.id}:start`
    const endNodeId = closed ? startNodeId : `${road.id}:end`
    const markers: SplitMarker[] = [
      { nodeId: startNodeId, point: road.points[0]!, station: 0 },
      { nodeId: endNodeId, point: road.points.at(-1)!, station: measure.total },
    ]

    intersections.forEach((intersection, index) => {
      const station = intersection.stations.get(road.id)
      if (station === undefined) return
      markers.push({
        nodeId: `surroundings-road-junction-${index}`,
        point: intersection.point,
        station,
      })
    })

    const mergedMarkers = mergeMarkers(markers)
    for (const marker of mergedMarkers) {
      graphNodes[marker.nodeId] ??= {
        id: marker.nodeId,
        position: [marker.point[0], 0, marker.point[1]],
      }
    }

    for (let index = 0; index < mergedMarkers.length - 1; index += 1) {
      const start = mergedMarkers[index]!
      const end = mergedMarkers[index + 1]!
      if (end.station - start.station <= EPSILON) continue
      const points = subpath(road.points, measure, start.station, end.station)
      if (points.length < 2) continue
      const id = `${road.id}:segment-${index}`
      edges[id] = {
        id,
        startNodeId: start.nodeId,
        endNodeId: end.nodeId,
        alignment: points.slice(1, -1).map(([x, z]) => [x, 0, z]),
        profileMode: 'legacy',
        verticalProfile: [],
        styleId: road.separator === 'primary-road' ? 'collector' : 'local-street',
        direction: 'both',
        roadClass: road.separator === 'primary-road' ? 'collector' : 'local',
        joinMode: 'auto',
        stackLevel: 0,
        sourceRoadId: road.id,
      }
    }
  }

  const junctions: Record<string, RoadJunction> = {}
  for (const graphNode of Object.values(graphNodes)) {
    const incident = Object.values(edges).filter(
      (edge) => edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
    )
    if (incident.length < 3) continue
    junctions[graphNode.id] = {
      nodeId: graphNode.id,
      kind: junctionKind(incident.length),
      treatment: 'auto',
      primaryEdgeIds: primaryEdges(incident),
      approachControls: {},
      cornerRadii: {},
    }
  }

  return {
    graphNodes,
    edges,
    junctions,
    stylePresets: { ...DEFAULT_ROAD_STYLE_PRESETS } as Record<string, RoadStylePreset>,
    activeStyleId: DEFAULT_ROAD_STYLE_ID,
    applyStyleToAll: false,
    regionalPack: 'right-driving',
  }
}
