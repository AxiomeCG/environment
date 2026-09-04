import { describe, expect, test } from 'bun:test'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'

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

  test('keeps one primary frontage as one full ring-spanning edge', () => {
    const graph = network({ 2: PRIMARY })
    const edge = Object.values(graph.edges)[0]!

    expect(Object.keys(graph.graphNodes)).toHaveLength(2)
    expect(Object.keys(graph.edges)).toHaveLength(1)
    expect(graph.junctions).toEqual({})
    expect(edge.styleId).toBe('collector')
    expect(edge.roadClass).toBe('collector')
    expect(graph.graphNodes[edge.startNodeId]?.position[0]).toBeCloseTo(52.7)
    expect(graph.graphNodes[edge.endNodeId]?.position[0]).toBeCloseTo(-52.7)
  })

  test('turns a primary-secondary frontage contact into one degree-three T', () => {
    const graph = network({ 1: SECONDARY, 2: PRIMARY })
    const junction = Object.values(graph.junctions)[0]!
    const junctionNode = graph.graphNodes[junction.nodeId]!
    const incident = incidentEdgeIds(graph, junction.nodeId)

    expect(Object.keys(graph.junctions)).toHaveLength(1)
    expect(junction.kind).toBe('tee')
    expect(junctionNode.position[0]).toBeCloseTo(20.2)
    expect(junctionNode.position[2]).toBeCloseTo(22.85)
    expect(incident).toHaveLength(3)
    expect(junction.primaryEdgeIds).toHaveLength(2)
    expect(junction.primaryEdgeIds.every((edgeId) => graph.edges[edgeId]?.styleId === 'collector')).toBe(true)
    expect(incident.some((edgeId) => graph.edges[edgeId]?.styleId === 'local-street')).toBe(true)
    expect(junction.cornerRadii).toEqual({})
  })

  test('is independent of primary-secondary frontage ordering', () => {
    const graph = network({ 1: PRIMARY, 2: SECONDARY })
    const junction = Object.values(graph.junctions)[0]!

    expect(junction.kind).toBe('tee')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(3)
    expect(junction.primaryEdgeIds).toHaveLength(2)
  })

  test('connects a secondary feeder across an acute Site corner', () => {
    const acuteSite = [
      [-100, 0],
      [0, 0],
      [-81.91520442889918, 57.35764363510461],
    ] as const satisfies readonly Point2[]
    const graph = networkForSite(acuteSite, { 0: SECONDARY, 1: PRIMARY })
    const junction = Object.values(graph.junctions)[0]!

    expect(Object.keys(graph.junctions)).toHaveLength(1)
    expect(junction.kind).toBe('tee')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(3)
    expect(junction.primaryEdgeIds).toHaveLength(2)
  })

  test('splits adjacent primary through-axes into a degree-four crossing', () => {
    const graph = network({ 1: PRIMARY, 2: PRIMARY })
    const junction = Object.values(graph.junctions)[0]!
    const junctionNode = graph.graphNodes[junction.nodeId]!

    expect(Object.keys(graph.edges)).toHaveLength(4)
    expect(junction.kind).toBe('four-way-plus')
    expect(incidentEdgeIds(graph, junction.nodeId)).toHaveLength(4)
    expect(junctionNode.position[0]).toBeCloseTo(22.85)
    expect(junctionNode.position[2]).toBeCloseTo(22.85)
    expect(new Set(Object.values(graph.edges).map(({ sourceRoadId }) => sourceRoadId)).size).toBe(2)
  })

  test('preserves three adjacent secondary frontages as one curved graph edge', () => {
    const graph = network({ 0: SECONDARY, 1: SECONDARY, 2: SECONDARY })
    const edge = Object.values(graph.edges)[0]!

    expect(Object.keys(graph.edges)).toHaveLength(1)
    expect(graph.junctions).toEqual({})
    expect(edge.styleId).toBe('local-street')
    expect(edge.alignment.length).toBeGreaterThan(20)
  })

  test('connects both ends of a three-frontage secondary run to one primary', () => {
    const graph = network({ 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY })
    const junctions = Object.values(graph.junctions)

    expect(junctions).toHaveLength(2)
    expect(junctions.every(({ nodeId }) => incidentEdgeIds(graph, nodeId).length === 3)).toBe(true)
    expect(junctions.every(({ primaryEdgeIds }) => primaryEdgeIds.length === 2)).toBe(true)
    expect(Object.values(graph.edges).filter(({ styleId }) => styleId === 'local-street')).toHaveLength(1)
    expect(Object.values(graph.edges).filter(({ styleId }) => styleId === 'collector')).toHaveLength(3)
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
      expect(points.some((point, index) => index > 0 && Math.hypot(
        point[0] - points[index - 1]![0],
        point[2] - points[index - 1]![2],
      ) > 1e-5)).toBe(true)
    }
  })
})
