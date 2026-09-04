import { describe, expect, test } from 'bun:test'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import {
  buildRoadPresentationPlan,
  STREETSCAPE_COMPATIBLE_ROAD_WIDTHS,
  STREETSCAPE_ROAD_SNAPSHOT_SOURCE,
  type RoadPresentationPlan,
  type RoadPresentationSurface,
} from './streetscape-road-presentation'

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

function segmentBandKinds(plan: RoadPresentationPlan) {
  return plan.surfaces
    .filter(({ name }) => name === 'road-segment-surface' || name.startsWith('road-side-'))
    .map(({ kind }) => kind)
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
    expect(surface.geometry.positions.length % 3).toBe(0)
    expect(surface.geometry.indices.length % 3).toBe(0)
    expect(surface.geometry.positions.every(Number.isFinite)).toBe(true)
    expect(surface.geometry.indices.every((index) =>
      Number.isInteger(index) && index >= 0 && index < vertexCount)).toBe(true)
  }
  for (const junction of plan.junctions) {
    expect(Object.values(junction.approachCuts).every(Number.isFinite)).toBe(true)
    expect(junction.boundary.flat().every(Number.isFinite)).toBe(true)
  }
}

describe('pinned Streetscape road-network presentation', () => {
  test('records the exact copied Streetscape source commit', () => {
    expect(STREETSCAPE_ROAD_SNAPSHOT_SOURCE).toBe(
      'sudhir9297/streetscape-pascal-plugin@1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef',
    )
  })

  test('keeps the local-street width and ordered side bands', () => {
    const plan = presentation({ 2: SECONDARY })

    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['secondary-road']).toBeCloseTo(10.4)
    expect(segmentBandKinds(plan)).toEqual([
      'carriageway',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
    ])
    expect(plan.surfaces.find(({ kind }) => kind === 'carriageway')?.width).toBeCloseTo(7.5)
  })

  test('keeps the collector width and ordered side bands', () => {
    const plan = presentation({ 2: PRIMARY })

    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['primary-road']).toBeCloseTo(15.7)
    expect(segmentBandKinds(plan)).toEqual([
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
    ])
    expect(plan.surfaces.find(({ kind }) => kind === 'carriageway')?.width).toBeCloseTo(9)
  })

  test('returns no surfaces for an empty runtime road network', () => {
    const plan = presentation({})

    expect(plan.junctions).toEqual([])
    expect(plan.surfaces).toEqual([])
  })

  test('builds a real marked T junction with one collector-colored footprint', () => {
    const network = runtimeRoadNetwork({ 1: SECONDARY, 2: PRIMARY })
    const plan = buildRoadPresentationPlan(network)
    const junction = plan.junctions[0]!
    const junctionSurface = plan.surfaces.find(
      ({ id }) => id === `${junction.id}:junction-carriageway`,
    )!

    expect(plan.junctions).toHaveLength(1)
    expect(Object.keys(junction.approachCuts)).toHaveLength(3)
    expect(junction.boundary.length).toBeGreaterThan(3)
    expect(junctionSurface.kind).toBe('junction-carriageway')
    expect(junctionSurface.geometry.positions.length).toBeGreaterThan(0)
    expect(junctionSurface.geometry.indices.length).toBeGreaterThan(0)

    const junctionKinds = junction.surfaceIds.map((id) =>
      plan.surfaces.find((surface) => surface.id === id)?.kind)
    for (const kind of ['gutter', 'curb', 'verge', 'sidewalk'] as const) {
      expect(junctionKinds).toContain(kind)
    }

    for (const [edgeId, cut] of Object.entries(junction.approachCuts)) {
      const edge = network.edges[edgeId]!
      const carriageway = plan.surfaces.find(({ id }) => id === `${edge.id}:carriageway`)!
      expect(minimumOutwardStation(network, edge, junction.id, carriageway)).toBeGreaterThan(
        cut - 0.25,
      )
    }
    for (const edgeId of junction.primaryEdgeIds) {
      const carriageway = plan.surfaces.find(({ id }) => id === `${edgeId}:carriageway`)!
      expect(carriageway.color).toBe(junctionSurface.color)
    }
    expect(junctionSurface.color).toBe('#393c40')

    const localEdge = Object.values(network.edges).find(
      ({ styleId }) => styleId === 'local-street',
    )!
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
    const collectorEdge = network.edges[junction.primaryEdgeIds[0]!]!
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

  test('keeps differently offset mixed T junctions outside the Site boundary without collapsed bands', () => {
    const fixtures = [
      { 1: PRIMARY, 2: SECONDARY },
      { 1: SECONDARY, 2: PRIMARY },
    ]

    for (const contexts of fixtures) {
      const plan = presentation(contexts)
      const interiorVertices = plan.surfaces.flatMap((surface) => {
        const points: Array<{ kind: RoadPresentationSurface['kind']; x: number; z: number }> = []
        for (let index = 0; index < surface.geometry.positions.length; index += 3) {
          const x = surface.geometry.positions[index]!
          const z = surface.geometry.positions[index + 2]!
          if (x < 15 - 1e-5 && z < 15 - 1e-5) points.push({ kind: surface.kind, x, z })
        }
        return points
      })
      expect(interiorVertices).toEqual([])

      const interiorTriangles = plan.surfaces.flatMap((surface) => {
        const triangles: Array<{ kind: RoadPresentationSurface['kind']; triangle: number }> = []
        for (let offset = 0; offset < surface.geometry.indices.length; offset += 3) {
          const triangle = surface.geometry.indices.slice(offset, offset + 3).map((vertex) => [
            surface.geometry.positions[vertex * 3]!,
            surface.geometry.positions[vertex * 3 + 2]!,
          ] as const)
          if (triangleIntersectsSiteInterior(triangle)) {
            triangles.push({ kind: surface.kind, triangle: offset / 3 })
          }
        }
        return triangles
      })
      expect(interiorTriangles).toEqual([])

      const junctionId = plan.junctions[0]!.id
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
        Math.abs(x - 15) <= 1e-5 && Math.abs(z - 15) <= 1e-5)).toBe(true)
      expect(sidewalkPoints.some(({ x, z }) =>
        Math.abs(x - 15) <= 1e-5 && z < 15 - 1e-3)).toBe(true)
      expect(sidewalkPoints.some(({ x, z }) =>
        x < 15 - 1e-3 && Math.abs(z - 15) <= 1e-5)).toBe(true)
    }
  })

  test('keeps the acute mixed T outer edge pinned to its exact Site miter', () => {
    const points = [
      [-100, 0],
      [0, 0],
      [-81.91520442889918, 57.35764363510461],
    ] as const satisfies readonly Point2[]
    const plan = buildRoadPresentationPlan(runtimeRoadNetworkForSite(
      points,
      { 0: SECONDARY, 1: PRIMARY },
    ))
    const junctionId = plan.junctions[0]!.id
    const sidewalk = plan.surfaces.find(
      ({ id }) => id === `${junctionId}:junction-sidewalk`,
    )!

    expect(sidewalk.geometry.positions.some((coordinate, index) =>
      index % 3 === 0
      && Math.abs(coordinate) <= 1e-5
      && Math.abs(sidewalk.geometry.positions[index + 2]!) <= 1e-5)).toBe(true)
  })

  test('closes an all-secondary ring without a diagonal ribbon seam', () => {
    const network = runtimeRoadNetwork({
      0: SECONDARY,
      1: SECONDARY,
      2: SECONDARY,
      3: SECONDARY,
    })
    const edge = Object.values(network.edges)[0]!
    const plan = buildRoadPresentationPlan(network)
    const ribbons = plan.surfaces.filter(
      ({ id, name }) => id.startsWith(`${edge.id}:`)
        && (name === 'road-segment-surface' || name.startsWith('road-side-')),
    )

    expect(Object.keys(network.edges)).toHaveLength(1)
    expect(edge.startNodeId).toBe(edge.endNodeId)
    expect(ribbons.length).toBeGreaterThan(0)
    for (const ribbon of ribbons) {
      const positions = ribbon.geometry.positions
      const firstLeft = positions.slice(0, 3)
      const firstRight = positions.slice(3, 6)
      const lastLeft = positions.slice(-6, -3)
      const lastRight = positions.slice(-3)
      expect(lastLeft).toEqual(firstLeft)
      expect(lastRight).toEqual(firstRight)
    }
  })

  test('builds one degree-four crossing footprint for adjacent primaries', () => {
    const network = runtimeRoadNetwork({ 1: PRIMARY, 2: PRIMARY })
    const plan = buildRoadPresentationPlan(network)
    const junction = plan.junctions[0]!
    const incident = Object.values(network.edges).filter(
      ({ startNodeId, endNodeId }) => startNodeId === junction.id || endNodeId === junction.id,
    )

    expect(plan.junctions).toHaveLength(1)
    expect(incident).toHaveLength(4)
    expect(Object.keys(junction.approachCuts)).toHaveLength(4)
    expect(plan.surfaces.filter(({ kind }) => kind === 'junction-carriageway')).toHaveLength(1)
    expect(plan.surfaces.filter(({ kind }) => kind === 'carriageway')).toHaveLength(4)
  })

  test('generates unique IDs and finite indexed geometry for mixed junction networks', () => {
    const fixtures: Array<Record<number, FrontageContext>> = [
      { 1: SECONDARY, 2: PRIMARY },
      { 1: PRIMARY, 2: PRIMARY },
      { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY },
    ]
    for (const contexts of fixtures) {
      expectFiniteGeometry(presentation(contexts))
    }
  })
})
