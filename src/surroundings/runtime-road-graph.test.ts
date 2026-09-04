import { describe, expect, test } from 'bun:test'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { deriveOuterRoads } from './outer-roads'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const PRIMARY = { separator: 'primary-road', access: 'none' } as const satisfies FrontageContext
const SECONDARY = { separator: 'secondary-road', access: 'none' } as const satisfies FrontageContext

function networkForSite(
  points: readonly Point2[],
  contexts: Record<number, FrontageContext>,
) {
  return deriveRuntimeRoadNetwork(deriveSurroundingsLayout(
    deriveBoundarySegments({ points, contexts }),
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  ))
}

function network(contexts: Record<number, FrontageContext>) {
  return networkForSite(SITE, contexts)
}

function incidentEdgeIds(
  graph: ReturnType<typeof network>,
  nodeId: string,
): string[] {
  return Object.values(graph.edges)
    .filter((edge) => edge.startNodeId === nodeId || edge.endNodeId === nodeId)
    .map(({ id }) => id)
    .sort()
}

function junctionForSourceRoads(
  graph: ReturnType<typeof network>,
  sourceRoadIds: readonly string[],
) {
  return Object.values(graph.junctions).find(({ nodeId }) => {
    const incidentSources = new Set(incidentEdgeIds(graph, nodeId)
      .map((edgeId) => graph.edges[edgeId]!.sourceRoadId))
    return sourceRoadIds.every((sourceRoadId) => incidentSources.has(sourceRoadId))
  })
}

function reachableNodeIds(graph: ReturnType<typeof network>): Set<string> {
  const start = Object.keys(graph.graphNodes)[0]
  if (!start) return new Set()
  const reachable = new Set([start])
  const pending = [start]
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    for (const edge of Object.values(graph.edges)) {
      const adjacent = edge.startNodeId === nodeId
        ? edge.endNodeId
        : edge.endNodeId === nodeId
          ? edge.startNodeId
          : undefined
      if (adjacent && !reachable.has(adjacent)) {
        reachable.add(adjacent)
        pending.push(adjacent)
      }
    }
  }
  return reachable
}

describe('deriveRuntimeRoadNetwork', () => {
  test('returns an empty disposable graph when no frontage has a road', () => {
    expect(network({})).toMatchObject({
      graphNodes: {},
      edges: {},
      junctions: {},
      applyStyleToAll: false,
      regionalPack: 'right-driving',
    })
  })

  test('adds one open near local street connected to a selected frontage road', () => {
    const graph = network({ 2: PRIMARY })
    const nearEdges = Object.values(graph.edges).filter(
      ({ sourceRoadId }) => sourceRoadId === 'surroundings-near-neighborhood-road',
    )
    const frontageEdges = Object.values(graph.edges).filter(
      ({ sourceRoadId }) => sourceRoadId === 'surroundings-frontage-2-road',
    )
    const nearDegree = new Map<string, number>()

    for (const edge of nearEdges) {
      nearDegree.set(edge.startNodeId, (nearDegree.get(edge.startNodeId) ?? 0) + 1)
      nearDegree.set(edge.endNodeId, (nearDegree.get(edge.endNodeId) ?? 0) + 1)
    }

    expect(nearEdges.length).toBeGreaterThan(0)
    expect(nearEdges.every(({ styleId, roadClass }) =>
      styleId === 'local-street' && roadClass === 'local')).toBe(true)
    expect([...nearDegree.values()].filter((degree) => degree === 1)).toHaveLength(2)
    expect([...nearDegree.values()].every((degree) => degree <= 2)).toBe(true)
    expect(frontageEdges.length).toBeGreaterThan(0)
    expect(frontageEdges.some((frontage) => nearEdges.some((near) =>
      frontage.startNodeId === near.startNodeId
      || frontage.startNodeId === near.endNodeId
      || frontage.endNodeId === near.startNodeId
      || frontage.endNodeId === near.endNodeId))).toBe(true)
  })

  test('joins residential street ends instead of leaving cut-off ribbons in the grass', () => {
    for (const contexts of [
      { 2: SECONDARY },
      { 1: SECONDARY, 2: PRIMARY },
      { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY },
    ]) for (const seed of ['pascal-suburbs', 'a', 'b']) {
      const layout = deriveSurroundingsLayout(
        deriveBoundarySegments({ points: SITE, contexts }),
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
        { seed, depthVariation: 0.2 },
      )
      for (const heightAt of [() => 0, (x: number) => x > 120 ? -10 : 0]) {
        const graph = deriveRuntimeRoadNetwork(layout, deriveOuterRoads(layout, { seed, heightAt }))
        const degrees = new Map<string, number>()
        for (const edge of Object.values(graph.edges)) for (const id of [edge.startNodeId, edge.endNodeId]) {
          degrees.set(id, (degrees.get(id) ?? 0) + 1)
        }
        expect([...degrees.values()].every((degree) => degree >= 2)).toBe(true)
        expect(reachableNodeIds(graph).size).toBe(Object.keys(graph.graphNodes).length)
      }
    }
  })

  test('turns a primary-secondary frontage contact into a degree-four crossing', () => {
    const graph = network({ 1: SECONDARY, 2: PRIMARY })
    const junction = junctionForSourceRoads(graph, [
      'surroundings-frontage-1-road',
      'surroundings-frontage-2-road',
    ])!
    const junctionNode = graph.graphNodes[junction.nodeId]!
    const incident = incidentEdgeIds(graph, junction.nodeId)

    expect(junction.kind).toBe('four-way-plus')
    expect(junctionNode.position[0]).toBeCloseTo(20.2)
    expect(junctionNode.position[2]).toBeCloseTo(22.85)
    expect(incident).toHaveLength(4)
    expect(junction.primaryEdgeIds).toHaveLength(2)
    expect(junction.primaryEdgeIds.every((edgeId) => graph.edges[edgeId]?.styleId === 'collector')).toBe(true)
    expect(incident.some((edgeId) => graph.edges[edgeId]?.styleId === 'local-street')).toBe(true)
    expect(junction.cornerRadii).toEqual({})
  })

  test('declares a mixed-width Site extension on the production outer road as a shared bend', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: SITE,
        contexts: { 1: SECONDARY, 2: PRIMARY },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'pascal-suburbs', depthVariation: 0.2 },
    )
    const graph = deriveRuntimeRoadNetwork(
      layout,
      deriveOuterRoads(layout, { seed: 'pascal-suburbs' }),
    )
    const extension = Object.values(graph.junctions).find(({ nodeId }) => {
      const incident = incidentEdgeIds(graph, nodeId).map((edgeId) => graph.edges[edgeId]!)
      return incident.length === 2
        && new Set(incident.map(({ sourceRoadId }) => sourceRoadId)).size === 2
        && incident.some(({ sourceRoadId }) =>
          sourceRoadId === 'surroundings-frontage-2-road')
        && incident.some(({ sourceRoadId }) =>
          sourceRoadId === 'surroundings-near-neighborhood-road')
    })

    expect(extension?.kind).toBe('y')
    const incident = incidentEdgeIds(graph, extension!.nodeId).map((edgeId) => graph.edges[edgeId]!)
    expect(incident.map(({ styleId }) => styleId).sort()).toEqual([
      'collector',
      'local-street',
    ])
  })

  test('is independent of primary-secondary frontage ordering', () => {
    const graph = network({ 1: PRIMARY, 2: SECONDARY })
    const junction = junctionForSourceRoads(graph, [
      'surroundings-frontage-1-road',
      'surroundings-frontage-2-road',
    ])!

    expect(junction.kind).toBe('four-way-plus')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(4)
    expect(junction.primaryEdgeIds).toHaveLength(2)
  })

  test('connects intersecting frontage roads across an acute Site corner', () => {
    const acuteSite = [
      [-100, 0],
      [0, 0],
      [-81.91520442889918, 57.35764363510461],
    ] as const satisfies readonly Point2[]
    const graph = networkForSite(acuteSite, { 0: SECONDARY, 1: PRIMARY })
    const junction = junctionForSourceRoads(graph, [
      'surroundings-frontage-0-road',
      'surroundings-frontage-1-road',
    ])!

    expect(junction.kind).toBe('four-way-plus')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(4)
    expect(junction.primaryEdgeIds).toHaveLength(2)
  })

  test('splits adjacent primary through-axes into a degree-four crossing', () => {
    const graph = network({ 1: PRIMARY, 2: PRIMARY })
    const junction = junctionForSourceRoads(graph, [
      'surroundings-frontage-1-road',
      'surroundings-frontage-2-road',
    ])!
    const junctionNode = graph.graphNodes[junction.nodeId]!

    expect(junction.kind).toBe('four-way-plus')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(4)
    expect(junctionNode.position[0]).toBeCloseTo(22.85)
    expect(junctionNode.position[2]).toBeCloseTo(22.85)
    expect(new Set(Object.values(graph.edges).map(({ sourceRoadId }) => sourceRoadId))).toEqual(
      new Set([
        'surroundings-frontage-1-road',
        'surroundings-frontage-2-road',
        'surroundings-near-neighborhood-road',
      ]),
    )
  })

  test('keeps adjacent secondary frontages as independent outward roads', () => {
    const graph = network({ 0: SECONDARY, 1: SECONDARY, 2: SECONDARY })
    const frontageSourceIds = new Set(Object.values(graph.edges)
      .map(({ sourceRoadId }) => sourceRoadId)
      .filter((sourceRoadId) => sourceRoadId !== 'surroundings-near-neighborhood-road'))

    expect(frontageSourceIds).toEqual(new Set([
      'surroundings-frontage-0-road',
      'surroundings-frontage-1-road',
      'surroundings-frontage-2-road',
    ]))
    expect(Object.values(graph.edges).every(({ styleId }) => styleId === 'local-street')).toBe(true)
  })

  test('connects every selected frontage and the near street in one graph component', () => {
    const fixtures: Record<number, FrontageContext>[] = [
      { 2: SECONDARY },
      { 1: SECONDARY, 2: PRIMARY },
      { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY },
      { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY },
    ]

    for (const contexts of fixtures) {
      const graph = network(contexts)
      const sourceRoadIds = new Set(Object.values(graph.edges).map(({ sourceRoadId }) => sourceRoadId))
      expect(sourceRoadIds.has('surroundings-near-neighborhood-road')).toBe(true)
      for (const frontageIndex of Object.keys(contexts)) {
        expect(sourceRoadIds.has(`surroundings-frontage-${frontageIndex}-road`)).toBe(true)
      }
      expect(reachableNodeIds(graph).size).toBe(Object.keys(graph.graphNodes).length)
    }
  })

  test('adds a deterministic sparse outer neighborhood to the same graph', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({ points: SITE, contexts: { 2: PRIMARY } }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'outer-topology', depthVariation: 0.2 },
    )
    const roads = deriveOuterRoads(layout, { seed: 'outer-topology' })
    const graph = deriveRuntimeRoadNetwork(layout, roads)
    const sourceRoadIds = new Set(Object.values(graph.edges).map(({ sourceRoadId }) => sourceRoadId))

    expect(roads).toEqual(deriveOuterRoads(layout, { seed: 'outer-topology' }))
    expect(roads.length).toBeGreaterThanOrEqual(6)
    expect(roads.length).toBeLessThanOrEqual(9)
    expect(roads.reduce((sum, road) => sum + road.centerline.length, 0)).toBeLessThanOrEqual(30)
    expect(roads.every(({ id }) => !id.includes('ring'))).toBe(true)
    expect(roads.every(({ id }) => sourceRoadIds.has(id))).toBe(true)
    expect(reachableNodeIds(graph).size).toBe(Object.keys(graph.graphNodes).length)
    expect(roads.flatMap(({ centerline }) => centerline).every(([x, z]) =>
      Math.max(Math.abs(x), Math.abs(z)) > 40)).toBe(true)
  })

  test('keeps translated irregular Site roads finite and connected', () => {
    const translatedSite = [
      [32, -18],
      [78, -7],
      [70, 34],
      [21, 27],
    ] as const satisfies readonly Point2[]
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: translatedSite,
        contexts: { 1: SECONDARY, 3: PRIMARY },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'translated-irregular', depthVariation: 0.2 },
    )
    const roads = deriveOuterRoads(layout, { seed: 'translated-irregular' })
    const graph = deriveRuntimeRoadNetwork(layout, roads)

    expect(roads.length).toBeGreaterThan(0)
    expect(roads.flatMap(({ centerline }) => centerline).flat().every(Number.isFinite)).toBe(true)
    expect(reachableNodeIds(graph).size).toBe(Object.keys(graph.graphNodes).length)
  })

  test('rejects outer routes that would continue into water', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({ points: SITE, contexts: { 2: PRIMARY } }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )
    const roads = deriveOuterRoads(layout, {
      heightAt: (x, z) => Math.hypot(x, z) > 80 ? -10 : 0,
      seed: 'flooded-outskirts',
    })

    expect(roads).toEqual([])
  })

  test('derives deterministic finite graph records without zero-length edges', () => {
    const first = network({ 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY })
    const second = network({ 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY })

    expect(second).toEqual(first)
    for (const edge of Object.values(first.edges)) {
      const start = first.graphNodes[edge.startNodeId]!.position
      const end = first.graphNodes[edge.endNodeId]!.position
      const points = [start, ...edge.alignment, end]
      expect(points.flat().every(Number.isFinite)).toBe(true)
      for (let index = 1; index < points.length; index += 1) {
        expect(Math.hypot(
          points[index]![0] - points[index - 1]![0],
          points[index]![2] - points[index - 1]![2],
        )).toBeGreaterThan(1e-5)
      }
    }
  })
})
