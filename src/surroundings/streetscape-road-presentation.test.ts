import { describe, expect, test } from 'bun:test'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { deriveOuterRoads } from './outer-roads'
import {
  buildRoadPresentationPlan,
  STREETSCAPE_COMPATIBLE_ROAD_WIDTHS,
  type RoadPresentationPlan,
  type RoadPresentationSurface,
} from './streetscape-road-presentation'
import { buildRoadNetworkMarkings } from './streetscape/road-network-markings'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const PRIMARY = { separator: 'primary-road', access: 'none' } as const satisfies FrontageContext
const SECONDARY = { separator: 'secondary-road', access: 'none' } as const satisfies FrontageContext

type RuntimeRoadNetwork = ReturnType<typeof deriveRuntimeRoadNetwork>
type RuntimeRoadEdge = RuntimeRoadNetwork['edges'][string]

function runtimeRoadNetworkForSite(
  points: readonly Point2[],
  contexts: Record<number, FrontageContext>,
) {
  return deriveRuntimeRoadNetwork(deriveSurroundingsLayout(
    deriveBoundarySegments({ points, contexts }),
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  ))
}

function runtimeRoadNetwork(contexts: Record<number, FrontageContext>) {
  return runtimeRoadNetworkForSite(SITE, contexts)
}

function presentation(contexts: Record<number, FrontageContext>): RoadPresentationPlan {
  return buildRoadPresentationPlan(runtimeRoadNetwork(contexts))
}

function roadEdges(network: RuntimeRoadNetwork, roadId: string): RuntimeRoadEdge[] {
  return Object.values(network.edges)
    .filter(({ id }) => id.startsWith(`${roadId}:segment-`))
    .sort((first, second) => first.id.localeCompare(second.id, undefined, { numeric: true }))
}

function segmentBandKinds(plan: RoadPresentationPlan, edgeId: string) {
  return plan.surfaces
    .filter(({ id, name }) => id.startsWith(`${edgeId}:`)
      && (name === 'road-segment-surface' || name.startsWith('road-side-')))
    .map(({ kind }) => kind)
}


function frontageOnlyJunctions(plan: RoadPresentationPlan) {
  return plan.junctions.filter(({ approachCuts }) =>
    Object.keys(approachCuts).every((edgeId) => edgeId.startsWith('surroundings-frontage-')))
}

function minimumOutwardStation(
  network: RuntimeRoadNetwork,
  edge: RuntimeRoadEdge,
  junctionId: string,
  surface: RoadPresentationSurface,
): number {
  const origin = network.graphNodes[junctionId]!.position
  const target = edge.startNodeId === junctionId
    ? edge.alignment[0] ?? network.graphNodes[edge.endNodeId]!.position
    : edge.alignment.at(-1) ?? network.graphNodes[edge.startNodeId]!.position
  const deltaX = target[0] - origin[0]
  const deltaZ = target[2] - origin[2]
  const length = Math.hypot(deltaX, deltaZ)
  const directionX = deltaX / length
  const directionZ = deltaZ / length
  const stations: number[] = []
  for (let index = 0; index < surface.geometry.positions.length; index += 3) {
    stations.push(
      (surface.geometry.positions[index]! - origin[0]) * directionX
      + (surface.geometry.positions[index + 2]! - origin[2]) * directionZ,
    )
  }
  return Math.min(...stations)
}

function elevationsAtApproachCut(
  network: RuntimeRoadNetwork,
  edge: RuntimeRoadEdge,
  junctionId: string,
  surface: RoadPresentationSurface,
  cut: number,
): number[] {
  const origin = network.graphNodes[junctionId]!.position
  const target = edge.startNodeId === junctionId
    ? edge.alignment[0] ?? network.graphNodes[edge.endNodeId]!.position
    : edge.alignment.at(-1) ?? network.graphNodes[edge.startNodeId]!.position
  const deltaX = target[0] - origin[0]
  const deltaZ = target[2] - origin[2]
  const length = Math.hypot(deltaX, deltaZ)
  const directionX = deltaX / length
  const directionZ = deltaZ / length
  const elevations: number[] = []
  for (let index = 0; index < surface.geometry.positions.length; index += 3) {
    const relativeX = surface.geometry.positions[index]! - origin[0]
    const relativeZ = surface.geometry.positions[index + 2]! - origin[2]
    const station = relativeX * directionX + relativeZ * directionZ
    if (Math.abs(station - cut) <= 1e-4) {
      elevations.push(surface.geometry.positions[index + 1]!)
    }
  }
  return elevations
}

function maximumAbsoluteLateralOffsetAtApproachCut(
  network: RuntimeRoadNetwork,
  edge: RuntimeRoadEdge,
  junctionId: string,
  surface: RoadPresentationSurface,
  cut: number,
): number {
  const origin = network.graphNodes[junctionId]!.position
  const target = edge.startNodeId === junctionId
    ? edge.alignment[0] ?? network.graphNodes[edge.endNodeId]!.position
    : edge.alignment.at(-1) ?? network.graphNodes[edge.startNodeId]!.position
  const deltaX = target[0] - origin[0]
  const deltaZ = target[2] - origin[2]
  const length = Math.hypot(deltaX, deltaZ)
  const directionX = deltaX / length
  const directionZ = deltaZ / length
  const lateralX = -directionZ
  const lateralZ = directionX
  const offsets: number[] = []
  for (let index = 0; index < surface.geometry.positions.length; index += 3) {
    const relativeX = surface.geometry.positions[index]! - origin[0]
    const relativeZ = surface.geometry.positions[index + 2]! - origin[2]
    const station = relativeX * directionX + relativeZ * directionZ
    if (Math.abs(station - cut) <= 1e-4) {
      offsets.push(Math.abs(relativeX * lateralX + relativeZ * lateralZ))
    }
  }
  return Math.max(0, ...offsets)
}

function planarVertexDistance(
  positions: readonly number[],
  first: number,
  second: number,
): number {
  return Math.hypot(
    positions[second * 3]! - positions[first * 3]!,
    positions[second * 3 + 2]! - positions[first * 3 + 2]!,
  )
}


function minimumCellRulingWidth(surface: RoadPresentationSurface): number {
  const { indices, positions } = surface.geometry
  const vertexCount = positions.length / 3
  const adjacent = Array.from({ length: vertexCount }, () => new Set<number>())
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = indices.slice(offset, offset + 3)
    for (const first of triangle) {
      for (const second of triangle) {
        if (first !== second) adjacent[first]!.add(second)
      }
    }
  }

  const visited = new Set<number>()
  const rulingWidths: number[] = []
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (visited.has(vertex)) continue
    const pending = [vertex]
    const cell: number[] = []
    while (pending.length > 0) {
      const current = pending.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      cell.push(current)
      pending.push(...adjacent[current]!)
    }
    cell.sort((first, second) => first - second)
    if (cell.length === 4) {
      rulingWidths.push(
        planarVertexDistance(positions, cell[0]!, cell[3]!),
        planarVertexDistance(positions, cell[1]!, cell[2]!),
      )
      continue
    }
    if (cell.length === 3) {
      const firstSecond = planarVertexDistance(positions, cell[0]!, cell[1]!)
      const firstThird = planarVertexDistance(positions, cell[0]!, cell[2]!)
      const secondThird = planarVertexDistance(positions, cell[1]!, cell[2]!)
      const collapsedInner = [firstSecond, firstThird]
      const collapsedOuter = [firstThird, secondThird]
      const widths = Math.abs(collapsedInner[0]! - collapsedInner[1]!)
        <= Math.abs(collapsedOuter[0]! - collapsedOuter[1]!)
        ? collapsedInner
        : collapsedOuter
      rulingWidths.push(...widths)
    }
  }
  return Math.min(...rulingWidths)
}

type PlanPoint = readonly [number, number]

function planCross(first: PlanPoint, second: PlanPoint, point: PlanPoint): number {
  return (second[0] - first[0]) * (point[1] - first[1])
    - (second[1] - first[1]) * (point[0] - first[0])
}

function pointInTriangle(point: PlanPoint, triangle: readonly PlanPoint[]): boolean {
  const crosses = triangle.map((vertex, index) => planCross(
    vertex,
    triangle[(index + 1) % triangle.length]!,
    point,
  ))
  return !(
    crosses.some((cross) => cross > 1e-9)
    && crosses.some((cross) => cross < -1e-9)
  )
}

function segmentIntersectsSiteInterior(start: PlanPoint, end: PlanPoint): boolean {
  const minimum = -15 + 1e-5
  const maximum = 15 - 1e-5
  let minimumMix = 0
  let maximumMix = 1
  for (const axis of [0, 1] as const) {
    const coordinate = start[axis]
    const delta = end[axis] - coordinate
    if (Math.abs(delta) <= 1e-9) {
      if (coordinate < minimum || coordinate > maximum) return false
      continue
    }
    const firstMix = (minimum - coordinate) / delta
    const secondMix = (maximum - coordinate) / delta
    minimumMix = Math.max(minimumMix, Math.min(firstMix, secondMix))
    maximumMix = Math.min(maximumMix, Math.max(firstMix, secondMix))
    if (minimumMix > maximumMix) return false
  }
  return true
}

function triangleIntersectsSiteInterior(triangle: readonly PlanPoint[]): boolean {
  const minimum = -15 + 1e-5
  const maximum = 15 - 1e-5
  if (triangle.some(([x, z]) =>
    x >= minimum && x <= maximum && z >= minimum && z <= maximum)) return true
  if (triangle.some((point, index) => segmentIntersectsSiteInterior(
    point,
    triangle[(index + 1) % triangle.length]!,
  ))) return true
  const siteCorners = [
    [minimum, minimum],
    [maximum, minimum],
    [maximum, maximum],
    [minimum, maximum],
  ] as const satisfies readonly PlanPoint[]
  return siteCorners.some((point) => pointInTriangle(point, triangle))
}

function expectFiniteGeometry(plan: RoadPresentationPlan): void {
  const ids = plan.surfaces.map(({ id }) => id)
  expect(new Set(ids).size).toBe(ids.length)

  for (const surface of plan.surfaces) {
    const vertexCount = surface.geometry.positions.length / 3
    expect(surface.geometry.positions.length).toBeGreaterThan(0)
    expect(surface.geometry.positions.length % 3).toBe(0)
    expect(surface.geometry.indices.length).toBeGreaterThan(0)
    expect(surface.geometry.indices.length % 3).toBe(0)
    expect(surface.geometry.positions.every(Number.isFinite)).toBe(true)
    expect(surface.geometry.indices.every((index) =>
      Number.isInteger(index) && index >= 0 && index < vertexCount)).toBe(true)
  }
  for (const junction of plan.junctions) {
    const approachCuts = Object.values(junction.approachCuts)
    expect(approachCuts.length).toBeGreaterThanOrEqual(3)
    expect(approachCuts.every((cut) => Number.isFinite(cut) && cut >= 0)).toBe(true)
    expect(junction.boundary.length).toBeGreaterThanOrEqual(3)
    for (const point of junction.boundary) {
      expect(point).toHaveLength(2)
      expect(point.every(Number.isFinite)).toBe(true)
    }
  }
}

describe('pinned Streetscape road-network presentation', () => {
  test('keeps local-street width and ordered side bands along the frontage', () => {
    const network = runtimeRoadNetwork({ 2: SECONDARY })
    const plan = buildRoadPresentationPlan(network)
    const carriageways = plan.surfaces.filter(({ kind }) => kind === 'carriageway')
    const expectedKinds: RoadPresentationSurface['kind'][] = [
      'carriageway',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
    ]

    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['secondary-road']).toBeCloseTo(10.4)
    expect(carriageways.length).toBeGreaterThan(0)
    for (const carriageway of carriageways) {
      const alignmentId = carriageway.id.slice(0, -':carriageway'.length)
      expect(segmentBandKinds(plan, alignmentId)).toEqual(expectedKinds)
      expect(carriageway.width).toBeCloseTo(7.5)
    }
  })

  test('keeps collector width and ordered side bands along the frontage', () => {
    const network = runtimeRoadNetwork({ 2: PRIMARY })
    const plan = buildRoadPresentationPlan(network)
    const edges = roadEdges(network, 'surroundings-frontage-2-road')
    const expectedKinds: RoadPresentationSurface['kind'][] = [
      'carriageway',
      'bike-lane',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
      'bike-lane',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
    ]

    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['primary-road']).toBeCloseTo(15.7)
    expect(edges.length).toBeGreaterThan(0)
    for (const edge of edges) {
      expect(segmentBandKinds(plan, edge.id)).toEqual(expectedKinds)
      expect(plan.surfaces.find(({ id }) => id === `${edge.id}:carriageway`)?.width).toBeCloseTo(9)
    }
  })

  test('returns no surfaces for an empty runtime road network', () => {
    const plan = presentation({})

    expect(plan.junctions).toEqual([])
    expect(plan.surfaces).toEqual([])
  })

  test('builds a real marked mixed crossing with one collector-colored footprint', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({ points: SITE, contexts: { 1: SECONDARY, 2: PRIMARY } }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )
    const network = deriveRuntimeRoadNetwork({ ...layout, outerRoad: undefined })
    const plan = buildRoadPresentationPlan(network)
    const centralJunctions = frontageOnlyJunctions(plan)

    expect(centralJunctions).toHaveLength(1)

    const junction = centralJunctions[0]!
    const junctionSurface = plan.surfaces.find(
      ({ id }) => id === `${junction.id}:junction-carriageway`,
    )!
    const incidentEdges = Object.keys(junction.approachCuts).map((edgeId) => network.edges[edgeId]!)
    const localEdges = incidentEdges.filter(({ styleId }) => styleId === 'local-street')
    const collectorEdges = incidentEdges.filter(({ styleId }) => styleId === 'collector')

    expect(Object.keys(junction.approachCuts)).toHaveLength(4)
    expect(localEdges).toHaveLength(2)
    expect(collectorEdges).toHaveLength(2)
    expect(junction.primaryEdgeIds).toHaveLength(2)
    expect(junction.primaryEdgeIds.every((edgeId) => network.edges[edgeId]!.styleId === 'collector')).toBe(true)
    expect(junction.boundary.length).toBeGreaterThan(3)
    expect(junctionSurface.kind).toBe('junction-carriageway')
    expect(junctionSurface.geometry.positions.length).toBeGreaterThan(0)
    expect(junctionSurface.geometry.indices.length).toBeGreaterThan(0)

    const junctionKinds = junction.surfaceIds.map((id) =>
      plan.surfaces.find((surface) => surface.id === id)?.kind)
    for (const kind of ['gutter', 'curb', 'verge', 'sidewalk'] as const) {
      expect(junctionKinds).toContain(kind)
    }

    for (const edge of incidentEdges) {
      const cut = junction.approachCuts[edge.id]!
      const carriageway = plan.surfaces.find(({ id }) => id === `${edge.id}:carriageway`)!
      expect(minimumOutwardStation(network, edge, junction.id, carriageway)).toBeGreaterThan(
        cut - 0.25,
      )
    }
    for (const edgeId of junction.primaryEdgeIds) {
      const carriageway = plan.surfaces.find(({ id }) => id === `${edgeId}:carriageway`)!
      expect(carriageway.color).toBe(junctionSurface.color)
    }

    const localEdge = localEdges[0]!
    const localSideBands = plan.surfaces.filter(
      ({ id, name }) => id.startsWith(`${localEdge.id}:`) && name.startsWith('road-side-'),
    )
    expect(localSideBands.length).toBeGreaterThan(0)
    for (const surface of localSideBands) {
      expect(minimumOutwardStation(network, localEdge, junction.id, surface)).toBeGreaterThan(
        junction.approachCuts[localEdge.id]! - 0.25,
      )
    }

    const junctionBikeLane = plan.surfaces.find(
      ({ id }) => id === `${junction.id}:junction-bike-lane`,
    )!
    const collectorEdge = collectorEdges[0]!
    expect(junctionBikeLane).toBeDefined()
    expect(maximumAbsoluteLateralOffsetAtApproachCut(
      network,
      localEdge,
      junction.id,
      junctionBikeLane,
      junction.approachCuts[localEdge.id]!,
    )).toBeCloseTo(3.75)
    expect(maximumAbsoluteLateralOffsetAtApproachCut(
      network,
      collectorEdge,
      junction.id,
      junctionBikeLane,
      junction.approachCuts[collectorEdge.id]!,
    )).toBeCloseTo(6.1)

    for (const edge of [localEdge, collectorEdge]) {
      const cut = junction.approachCuts[edge.id]!
      for (const kind of [
        'carriageway',
        'bike-lane',
        'gutter',
        'curb',
        'verge',
        'sidewalk',
      ] as const) {
        const junctionKind = kind === 'carriageway' ? 'junction-carriageway' : kind
        const junctionBand = plan.surfaces.find(
          ({ id, kind: surfaceKind }) => id.startsWith(`${junction.id}:junction-`)
            && surfaceKind === junctionKind,
        )
        const edgeBands = plan.surfaces.filter(
          ({ id, kind: surfaceKind }) => id.startsWith(`${edge.id}:`)
            && surfaceKind === kind,
        )
        if (!junctionBand || edgeBands.length === 0) continue

        const junctionElevations = elevationsAtApproachCut(
          network,
          edge,
          junction.id,
          junctionBand,
          cut,
        )
        const edgeElevations = edgeBands.flatMap((surface) => elevationsAtApproachCut(
          network,
          edge,
          junction.id,
          surface,
          cut,
        ))
        expect(junctionElevations.length).toBeGreaterThan(0)
        expect(edgeElevations.length).toBeGreaterThan(0)
        for (const elevation of junctionElevations) {
          expect(elevation).toBeCloseTo(edgeElevations[0]!, 8)
        }
      }
    }

    const markingKinds = new Set(plan.surfaces.map(({ kind }) => kind))
    for (const kind of ['centerline', 'direction-arrow', 'stop-line', 'crosswalk'] as const) {
      expect(markingKinds.has(kind)).toBe(true)
    }
  })

  test('keeps the carriageway continuous across an eight-metre connector between T junctions', () => {
    const network = deriveRuntimeRoadNetwork(
      { corridors: [], neighborCells: [], roadJunctions: [] },
      [
        {
          id: 'short-connector-road',
          separator: 'secondary-road',
          centerline: [[-20, 0], [20, 0]],
          corridorIds: [],
          junctionIds: [],
        },
        {
          id: 'west-t-branch',
          separator: 'secondary-road',
          centerline: [[-4, 0], [-4, 20]],
          corridorIds: [],
          junctionIds: [],
        },
        {
          id: 'east-t-branch',
          separator: 'secondary-road',
          centerline: [[4, 0], [4, 20]],
          corridorIds: [],
          junctionIds: [],
        },
      ],
    )
    const junctionNodeIds = new Set(
      Object.values(network.junctions).map(({ nodeId }) => nodeId),
    )
    const connector = Object.values(network.edges).find(
      ({ sourceRoadId, startNodeId, endNodeId }) =>
        sourceRoadId === 'short-connector-road'
        && junctionNodeIds.has(startNodeId)
        && junctionNodeIds.has(endNodeId),
    )
    expect(connector).toBeDefined()
    const start = network.graphNodes[connector!.startNodeId]!.position
    const end = network.graphNodes[connector!.endNodeId]!.position
    expect(Math.hypot(end[0] - start[0], end[2] - start[2])).toBeCloseTo(8)

    const plan = buildRoadPresentationPlan(network)
    const carriageway = plan.surfaces.find(
      ({ id }) => id === `${connector!.id}:carriageway`,
    )
    expect(carriageway).toBeDefined()
    const midpoint = [(start[0] + end[0]) / 2, (start[2] + end[2]) / 2] as const
    const triangles = Array.from(
      { length: carriageway!.geometry.indices.length / 3 },
      (_, triangleIndex) => carriageway!.geometry.indices
        .slice(triangleIndex * 3, triangleIndex * 3 + 3)
        .map((vertex) => [
          carriageway!.geometry.positions[vertex * 3]!,
          carriageway!.geometry.positions[vertex * 3 + 2]!,
        ] as const),
    )

    expect(triangles.length).toBeGreaterThan(0)
    expect(triangles.some((triangle) => pointInTriangle(midpoint, triangle))).toBe(true)
    expect(triangles.every((triangle) => {
      const upwardArea = -planCross(triangle[0]!, triangle[1]!, triangle[2]!)
      return Number.isFinite(upwardArea) && upwardArea > 1e-9
    })).toBe(true)
  })

  test('joins mixed widths at the production outer-road extension without crossing side bands or paint', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: SITE,
        contexts: { 1: SECONDARY, 2: PRIMARY },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'pascal-suburbs', depthVariation: 0.2 },
    )
    const network = deriveRuntimeRoadNetwork(
      layout,
      deriveOuterRoads(layout, { seed: 'pascal-suburbs' }),
    )
    const extension = Object.values(network.junctions).flatMap(({ nodeId }) => {
      const incident = Object.values(network.edges).filter(
        ({ startNodeId, endNodeId }) => startNodeId === nodeId || endNodeId === nodeId,
      )
      return incident.length === 2
        && incident.some(({ sourceRoadId }) =>
          sourceRoadId === 'surroundings-frontage-2-road')
        && incident.some(({ sourceRoadId }) =>
          sourceRoadId === 'surroundings-near-neighborhood-road')
        ? [{ incident, nodeId }]
        : []
    })
    const plan = buildRoadPresentationPlan(network)

    expect(extension).toHaveLength(1)
    const { incident, nodeId } = extension[0]!
    const junction = plan.junctions.find(({ id }) => id === nodeId)!
    expect(Object.keys(junction.approachCuts)).toHaveLength(2)
    const junctionKinds = junction.surfaceIds.map((id) =>
      plan.surfaces.find((surface) => surface.id === id)?.kind)
    for (const kind of [
      'junction-carriageway',
      'bike-lane',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
    ] as const) {
      expect(junctionKinds).toContain(kind)
    }

    for (const edge of incident) {
      const cut = junction.approachCuts[edge.id]!
      const approachSurfaces = plan.surfaces.filter(
        ({ id, name }) => id.startsWith(`${edge.id}:`)
          && (name === 'road-segment-surface' || name.startsWith('road-side-')),
      )
      expect(approachSurfaces.length).toBeGreaterThan(0)
      for (const surface of approachSurfaces) {
        expect(minimumOutwardStation(network, edge, nodeId, surface)).toBeGreaterThan(
          cut - 0.25,
        )
      }
    }

    const markings = buildRoadNetworkMarkings(network, Object.fromEntries(
      plan.junctions.map((junction) => [junction.id, junction.approachCuts]),
    ))
    // The straight side-road crossing has a one-metre setback from the
    // rendered junction cut, not from an independently solved fillet.
    const crossing = markings.filter(({ edgeId, kind }) =>
      edgeId === 'surroundings-local-cross-0:segment-0' && kind === 'crosswalk')
    const crossingJunction = plan.junctions.find(({ id }) => id === crossing[0]!.junctionId)!
    const edge = network.edges[crossing[0]!.edgeId]!
    const origin = network.graphNodes[crossingJunction.id]!.position
    const target = edge.startNodeId === crossingJunction.id
      ? edge.alignment[0] ?? network.graphNodes[edge.endNodeId]!.position
      : edge.alignment.at(-1) ?? network.graphNodes[edge.startNodeId]!.position
    const dx = target[0] - origin[0], dz = target[2] - origin[2]
    const length = Math.hypot(dx, dz)
    const nearestPaint = Math.min(...crossing.flatMap(({ points }) => points.map((point) =>
      ((point[0] - origin[0]) * dx + (point[2] - origin[2]) * dz) / length)))
    // First bar center is 1 m beyond the cut; its half-thickness is 17 cm.
    const setback = nearestPaint - crossingJunction.approachCuts[edge.id]!
    expect(setback).toBeGreaterThan(0.8)
    expect(setback).toBeLessThan(0.86)
  })

  test('keeps mixed crossing carriageways outside the Site without collapsed corner bands', () => {
    const fixtures: Array<Record<number, FrontageContext>> = [
      { 1: PRIMARY, 2: SECONDARY },
      { 1: SECONDARY, 2: PRIMARY },
    ]

    for (const contexts of fixtures) {
      const plan = presentation(contexts)
      const centralJunctions = frontageOnlyJunctions(plan)
      expect(centralJunctions).toHaveLength(1)
      const junctionId = centralJunctions[0]!.id
      const interiorVertices = plan.surfaces.flatMap((surface) => {
        const points: Array<{ id: string; x: number; z: number }> = []
        for (let index = 0; index < surface.geometry.positions.length; index += 3) {
          const x = surface.geometry.positions[index]!
          const z = surface.geometry.positions[index + 2]!
          if (
            x > -15 + 1e-5 && x < 15 - 1e-5
            && z > -15 + 1e-5 && z < 15 - 1e-5
          ) points.push({ id: surface.id, x, z })
        }
        return points
      })
      expect([...new Set(interiorVertices.map(({ id }) => id))].sort()).toEqual([
        `${junctionId}:junction-curb`,
        `${junctionId}:junction-sidewalk`,
        `${junctionId}:junction-verge`,
      ].sort())
      expect(interiorVertices.every(({ x, z }) => x > 12 && z > 12)).toBe(true)

      const interiorTriangles = plan.surfaces.flatMap((surface) => {
        const triangles: Array<{ id: string; triangle: number }> = []
        for (let offset = 0; offset < surface.geometry.indices.length; offset += 3) {
          const triangle = surface.geometry.indices.slice(offset, offset + 3).map((vertex) => [
            surface.geometry.positions[vertex * 3]!,
            surface.geometry.positions[vertex * 3 + 2]!,
          ] as const)
          if (triangleIntersectsSiteInterior(triangle)) {
            triangles.push({ id: surface.id, triangle: offset / 3 })
          }
        }
        return triangles
      })
      expect([...new Set(interiorTriangles.map(({ id }) => id))].sort()).toEqual([
        `${junctionId}:junction-curb`,
        `${junctionId}:junction-gutter`,
        `${junctionId}:junction-sidewalk`,
        `${junctionId}:junction-verge`,
      ].sort())

      const minimumBandWidths = {
        gutter: 0.35,
        curb: 0.15,
        sidewalk: 0.5,
      } as const
      for (const [kind, minimumWidth] of Object.entries(minimumBandWidths)) {
        const surface = plan.surfaces.find(
          ({ id }) => id === `${junctionId}:junction-${kind}`,
        )!
        expect(minimumCellRulingWidth(surface)).toBeGreaterThanOrEqual(
          minimumWidth - 1e-5,
        )
      }

      const sidewalk = plan.surfaces.find(
        ({ id }) => id === `${junctionId}:junction-sidewalk`,
      )!
      const sidewalkPoints = Array.from(
        { length: sidewalk.geometry.positions.length / 3 },
        (_, index) => ({
          x: sidewalk.geometry.positions[index * 3]!,
          z: sidewalk.geometry.positions[index * 3 + 2]!,
        }),
      )

      expect(sidewalkPoints.some(({ x, z }) =>
        Math.abs(x - 15) <= 1e-5 && z < 15 - 1e-3)).toBe(true)
      expect(sidewalkPoints.some(({ x, z }) =>
        x < 15 - 1e-3 && Math.abs(z - 15) <= 1e-5)).toBe(true)
    }
  })

  test('keeps an acute mixed frontage crossing finite without an unsafe outer loop', () => {
    const points = [
      [-100, 0],
      [0, 0],
      [-81.91520442889918, 57.35764363510461],
    ] as const satisfies readonly Point2[]
    const network = runtimeRoadNetworkForSite(points, { 0: SECONDARY, 1: PRIMARY })
    const plan = buildRoadPresentationPlan(network)
    const centralJunctions = frontageOnlyJunctions(plan)

    expect(new Set(Object.values(network.edges).map(({ sourceRoadId }) => sourceRoadId))).toEqual(
      new Set([
        'surroundings-frontage-0-road',
        'surroundings-frontage-1-road',
      ]),
    )
    expect(centralJunctions).toHaveLength(1)
    expect(Object.keys(centralJunctions[0]!.approachCuts)).toHaveLength(4)
    expect(Object.values(network.edges).filter(({ startNodeId, endNodeId }) =>
      startNodeId === centralJunctions[0]!.id || endNodeId === centralJunctions[0]!.id,
    )).toHaveLength(4)
    expectFiniteGeometry(plan)

    const junctionBands = plan.surfaces.filter(({ id, kind }) =>
      id.startsWith(`${centralJunctions[0]!.id}:junction-`)
      && kind !== 'junction-carriageway')
    expect(junctionBands.length).toBeGreaterThan(0)
    expect(junctionBands.every((surface) => minimumCellRulingWidth(surface) > 1e-5)).toBe(true)
  })


  test('builds one degree-four frontage crossing footprint for adjacent primaries', () => {
    const network = runtimeRoadNetwork({ 1: PRIMARY, 2: PRIMARY })
    const plan = buildRoadPresentationPlan(network)
    const centralJunctions = frontageOnlyJunctions(plan)

    expect(centralJunctions).toHaveLength(1)

    const junction = centralJunctions[0]!
    const incident = Object.values(network.edges).filter(
      ({ startNodeId, endNodeId }) => startNodeId === junction.id || endNodeId === junction.id,
    )
    const centralCarriageways = incident.map((edge) =>
      plan.surfaces.find(({ id }) => id === `${edge.id}:carriageway`))

    expect(incident).toHaveLength(4)
    expect(Object.keys(junction.approachCuts)).toHaveLength(4)
    expect(plan.surfaces.filter(({ id, kind }) =>
      kind === 'junction-carriageway' && id.startsWith(`${junction.id}:`))).toHaveLength(1)
    expect(centralCarriageways).toHaveLength(4)
    expect(centralCarriageways.every(Boolean)).toBe(true)
  })

  test('shares marking ribbon edges through bends instead of overlapping square caps', () => {
    const network = deriveRuntimeRoadNetwork(
      { corridors: [], neighborCells: [], roadJunctions: [] },
      [{
        id: 'bent-road',
        separator: 'secondary-road',
        centerline: [[0, 0], [18, 0], [18, 18]],
        corridorIds: [],
        junctionIds: [],
      }],
    )
    const centerline = buildRoadNetworkMarkings(network).filter((marking) =>
      marking.edgeId === 'bent-road:segment-0' && marking.kind === 'centerline')

    expect(centerline.length).toBeGreaterThan(2)
    for (let index = 0; index < centerline.length - 1; index += 1) {
      expect([centerline[index]!.points[1], centerline[index]!.points[2]]).toEqual([
        centerline[index + 1]!.points[0],
        centerline[index + 1]!.points[3],
      ])
    }
  })
})
