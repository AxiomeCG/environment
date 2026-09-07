import { describe, expect, test } from 'bun:test'
import { deriveBoundarySegments, type Point2 } from './frontages'
import { deriveRoadPresentationAlignments, deriveSurroundingsLayout, deriveSurroundingsLevelTerrainDistance, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS } from './corridor'
import { deriveOuterRoads, distanceToRoads } from './outer-roads'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { createExteriorTerrainSampler } from './exterior-terrain'
import { deriveThirdRingPlan, THIRD_RING_BUDGET } from './third-ring'
import { buildDistantTreeInstances } from './distant-trees'
import { disposePrimitiveInstances } from './primitive-instances'
import { createRoadGradedTerrain } from './road-elevation'
import { convexPolygonsOverlap } from './neighborhood'

const boundary = [[-15, -15], [15, -15], [15, 15], [-15, 15]] as const
const road = { separator: 'secondary-road', access: 'none' } as const
function fixture(all: boolean) {
  const segments = deriveBoundarySegments({ points: boundary, contexts: all ? { 0: road, 1: road, 2: road, 3: road } : { 2: road } })
  const layout = deriveSurroundingsLayout(segments, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS)
  const terrain = createExteriorTerrainSampler({ boundary, terrain: null, levelTerrainDistance: deriveSurroundingsLevelTerrainDistance(segments, layout, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS) })
  const roads = deriveOuterRoads(layout, { heightAt: terrain.heightAt })
  const sampler = createRoadGradedTerrain(deriveRuntimeRoadNetwork(layout, roads), terrain, boundary)
  return { layout, roads, sampler }
}

describe('connected outer landscape', () => {
  test('connects terrain-routed neighborhoods to one or four active frontages', () => {
    for (const all of [false, true]) {
      const { layout, roads } = fixture(all)
      const network = deriveRuntimeRoadNetwork(layout, roads), edges = Object.values(network.edges)
      const visited = new Set([edges.find((edge) => edge.sourceRoadId === layout.corridors[0]!.road.id)!.startNodeId])
      let changed = true
      while (changed) {
        changed = false
        for (const edge of edges) if (visited.has(edge.startNodeId) || visited.has(edge.endNodeId)) {
          for (const id of [edge.startNodeId, edge.endNodeId]) if (!visited.has(id)) { visited.add(id); changed = true }
        }
      }
      expect(roads.some((road) => road.centerline.some(([x, z]) => Math.hypot(x, z) > 120))).toBe(true)
      for (const road of roads) {
        const neighborhoodEdges = edges.filter((edge) => edge.sourceRoadId === road.id)
        expect(neighborhoodEdges.length).toBeGreaterThan(0)
        expect(neighborhoodEdges.every((edge) => visited.has(edge.startNodeId) && visited.has(edge.endNodeId))).toBe(true)
      }
    }
  })

  test('preserves the construction zone and keeps distant planting clear of streets', () => {
    const { layout, sampler, roads } = fixture(true)
    const nearRoads = deriveRoadPresentationAlignments(layout)
    for (const [x, z] of [...boundary, [0, 0], [30, 0]]) expect(sampler.heightAt(x!, z!)).toBe(0)
    const context = { boundary, roads, nearRoads, heightAt: sampler.heightAt }
    const plan = deriveThirdRingPlan(context)
    expect(plan).toEqual(deriveThirdRingPlan(context))
    expect(plan.buildings.length).toBeLessThanOrEqual(THIRD_RING_BUDGET.buildings)
    expect(plan.trees.length).toBeLessThanOrEqual(THIRD_RING_BUDGET.trees)
    for (const tree of plan.trees) {
      expect(tree.position[1]).toBe(sampler.heightAt(tree.position[0], tree.position[2]))
      expect(tree.position[1]).toBeGreaterThanOrEqual(0)
      expect(distanceToRoads(tree.position[0], tree.position[2], [...roads, ...nearRoads])).toBeGreaterThanOrEqual(14)
    }
    const instances = buildDistantTreeInstances(plan.trees)
    expect(instances.userData.drawCallCount).toBeLessThanOrEqual(2)
    expect(instances.userData.visibleTriangleCount).toBeLessThanOrEqual(12_288)
    disposePrimitiveInstances(instances)
  })

  test('separates a realistically scaled skyline with dense foreground woodland belts', () => {
    const plan = deriveThirdRingPlan({ boundary, roads: [], heightAt: () => 0 })
    for (const rotation of new Set(plan.skyline.map((building) => building.rotationY))) {
      const buildings = plan.skyline.filter((building) => building.rotationY === rotation)
      const centerX = buildings.reduce((sum, building) => sum + building.position[0], 0) / buildings.length
      const centerZ = buildings.reduce((sum, building) => sum + building.position[2], 0) / buildings.length
      const distance = Math.hypot(centerX, centerZ), x = centerX / distance, z = centerZ / distance
      let frontEdge = Infinity
      for (const building of buildings) {
        expect(Math.hypot(building.position[0], building.position[2])).toBeGreaterThan(320)
        expect(building.dimensions[0]).toBeLessThan(40)
        expect(building.dimensions[1]).toBeGreaterThan(25)
        expect(building.dimensions[1]).toBeLessThan(90)
        frontEdge = Math.min(frontEdge, building.position[0] * x + building.position[2] * z
          - Math.hypot(building.dimensions[0] + 4, building.dimensions[2] + 4) / 2)
      }
      const foregroundTrees = plan.trees.filter(({ position }) => {
        const along = position[0] * x + position[2] * z
        const across = -position[0] * z + position[2] * x
        return along > frontEdge - 60 && along < frontEdge - 20 && Math.abs(across) < 100
      })
      expect(foregroundTrees.length).toBeGreaterThanOrEqual(100)
    }
    expect(plan.skyline.some((building) => building.style === 'tower')).toBe(true)
    expect(plan.trees.length).toBeLessThanOrEqual(THIRD_RING_BUDGET.trees)
  })

  test('reserves commercial lots and access from houses and planting, and rejects flooded lots', () => {
    const seed = 'commercial-0'
    const segments = deriveBoundarySegments({
      points: boundary,
      contexts: { 0: road, 1: road, 2: { separator: 'primary-road', access: 'none' }, 3: road },
    })
    const layout = deriveSurroundingsLayout(segments, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS, { seed, depthVariation: 0.2 })
    const roads = deriveOuterRoads(layout, { seed, heightAt: () => 0 })
    const context = { boundary, roads, nearRoads: deriveRoadPresentationAlignments(layout), seed, heightAt: () => 0 }
    const plan = deriveThirdRingPlan(context)
    expect(plan.commercialSites.map((site) => site.kind).sort()).toEqual(['gas-station', 'supermarket'])
    expect(plan.commercialSites).toEqual(deriveThirdRingPlan(context).commercialSites)
    for (const site of plan.commercialSites) {
      const cosine = Math.cos(site.rotationY), sine = Math.sin(site.rotationY)
      const [width, depth] = site.lotDimensions
      const rectangles = [[0, width, depth], [depth / 2 + site.accessDepth / 2, site.accessWidth, site.accessDepth]]
        .map(([centerZ, width, depth]) => [[-1,-1],[-1,1],[1,1],[1,-1]].map(([x,z]): Point2 => {
          const localX = x! * width! / 2, localZ = centerZ! + z! * depth! / 2
          return [site.position[0] + cosine * localX + sine * localZ,
            site.position[2] - sine * localX + cosine * localZ]
        }))
      for (const polygon of rectangles) {
        expect(convexPolygonsOverlap(polygon, boundary)).toBe(false)
        for (const house of plan.buildings) {
          const c = Math.cos(house.rotationY), s = Math.sin(house.rotationY)
          const footprint = [[-1,-1],[-1,1],[1,1],[1,-1]].map(([x,z]): Point2 => [
            house.position[0] + c * x! * house.dimensions[0] / 2 + s * z! * house.dimensions[2] / 2,
            house.position[2] - s * x! * house.dimensions[0] / 2 + c * z! * house.dimensions[2] / 2,
          ])
          expect(convexPolygonsOverlap(polygon, footprint)).toBe(false)
        }
      }
      for (const tree of plan.trees) {
        const dx = tree.position[0] - site.position[0], dz = tree.position[2] - site.position[2]
        const x = cosine * dx - sine * dz, z = sine * dx + cosine * dz
        expect(Math.abs(x) > width / 2 || Math.abs(z) > depth / 2).toBe(true)
        expect(Math.abs(x) > site.accessWidth / 2 || z < depth / 2 || z > depth / 2 + site.accessDepth).toBe(true)
      }
    }
    expect(deriveThirdRingPlan({ ...context, heightAt: () => -4 }).commercialSites).toEqual([])
  })
})
