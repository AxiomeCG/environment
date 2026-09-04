import { describe, expect, test } from 'bun:test'
import { InstancedMesh } from 'three'
import type { Group } from 'three'
import { buildDistantTreeInstances } from './distant-trees'
import {
  deriveSurroundingsLayout,
  deriveSurroundingsLevelTerrainDistance,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  type SurroundingsCorridorDescriptor,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  deriveHorizonFoliagePlan,
  HORIZON_FOLIAGE_INSTANCE_BUDGET,
  HORIZON_ROAD_SIGHTLINE_HALF_ANGLE,
  HORIZON_ROAD_TERMINAL_CLEARANCE,
  type HorizonFoliagePlan,
} from './horizon-foliage'

import { deriveLandscapeRegion } from './landscape-region'
const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const SECONDARY = {
  separator: 'secondary-road',
  access: 'none',
} as const satisfies FrontageContext
const PRIMARY = {
  separator: 'primary-road',
  access: 'none',
} as const satisfies FrontageContext
const ALL_ROADS = {
  0: SECONDARY,
  1: PRIMARY,
  2: SECONDARY,
  3: SECONDARY,
} as const satisfies Record<number, FrontageContext>

function horizon(contexts: Record<number, FrontageContext> = ALL_ROADS) {
  const segments = deriveBoundarySegments({ points: SITE, contexts })
  const layout = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const levelTerrainDistance = deriveSurroundingsLevelTerrainDistance(
    segments,
    layout,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const heightAt = (x: number, z: number) => 10 + x * 0.01 + z * 0.005
  return {
    corridors: layout.corridors,
    plan: deriveHorizonFoliagePlan({
      boundary: SITE,
      corridors: layout.corridors,
      heightAt,
      levelTerrainDistance,
    }),
  }
}

function terminalPoints(corridors: readonly SurroundingsCorridorDescriptor[]): Point2[] {
  return corridors.flatMap((corridor) => {
    const halfLength = corridor.road.length / 2
    return [-1, 1].map((sign): Point2 => [
      corridor.road.center[0] + corridor.frame.tangent[0] * halfLength * sign,
      corridor.road.center[1] + corridor.frame.tangent[1] * halfLength * sign,
    ])
  })
}

function angularDistance(first: number, second: number): number {
  const difference = Math.abs(first - second) % (Math.PI * 2)
  return Math.min(difference, Math.PI * 2 - difference)
}

function clusterAngles(plan: readonly HorizonFoliagePlan[]): number[] {
  const byCluster = new Map<string, HorizonFoliagePlan[]>()
  for (const placement of plan) {
    byCluster.set(placement.clusterId, [...(byCluster.get(placement.clusterId) ?? []), placement])
  }
  return [...byCluster.values()].map((cluster) => {
    const x = cluster.reduce((sum, placement) => sum + placement.position[0], 0) / cluster.length
    const z = cluster.reduce((sum, placement) => sum + placement.position[2], 0) / cluster.length
    return Math.atan2(z, x)
  })
}

function disposeInstanceWrappers(root: Group): void {
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose()
  })
  root.clear()
}

describe('horizon foliage grammar', () => {
  test('is deterministic and samples every placement from the exterior terrain', () => {
    const first = horizon().plan
    const second = horizon().plan

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThanOrEqual(6)
    expect(first.length).toBeLessThanOrEqual(HORIZON_FOLIAGE_INSTANCE_BUDGET)
    for (const placement of first) {
      expect(placement.position[1]).toBeCloseTo(
        10 + placement.position[0] * 0.01 + placement.position[2] * 0.005,
      )
      expect([
        ...placement.position,
        placement.rotationY,
        placement.height,
      ].every(Number.isFinite)).toBe(true)
    }
  })


  test('forms directional overlapping clusters while leaving a deliberate skyline gap', () => {
    const plan = horizon().plan
    const byCluster = new Map<string, HorizonFoliagePlan[]>()
    for (const placement of plan) {
      byCluster.set(placement.clusterId, [...(byCluster.get(placement.clusterId) ?? []), placement])
    }

    for (const cluster of byCluster.values()) {
      expect(cluster).toHaveLength(2)
      expect(cluster.filter(({ species }) => species === 'bush')).toHaveLength(1)
      const [first, second] = cluster
      expect(Math.hypot(
        first!.position[0] - second!.position[0],
        first!.position[2] - second!.position[2],
      )).toBeLessThan(12)
    }

    const region = deriveLandscapeRegion()
    for (const angle of clusterAngles(plan)) {
      expect(angularDistance(angle, region.openAngle)).toBeGreaterThanOrEqual(region.openHalfAngle)
    }
  })

  test('preserves clearance and angular sightlines at every Ring 3 road terminal', () => {
    const { corridors, plan } = horizon()
    const terminals = terminalPoints(corridors)

    expect(terminals.length).toBeGreaterThan(0)
    for (const placement of plan) {
      const placementAngle = Math.atan2(placement.position[2], placement.position[0])
      for (const terminal of terminals) {
        expect(Math.hypot(
          placement.position[0] - terminal[0],
          placement.position[2] - terminal[1],
        )).toBeGreaterThanOrEqual(HORIZON_ROAD_TERMINAL_CLEARANCE)
        expect(angularDistance(
          placementAngle,
          Math.atan2(terminal[1], terminal[0]),
        )).toBeGreaterThanOrEqual(HORIZON_ROAD_SIGHTLINE_HALF_ANGLE)
      }
    }
  })

  test('does not plant horizon screens below the waterline', () => {
    expect(deriveHorizonFoliagePlan({
      boundary: SITE, corridors: [], levelTerrainDistance: 0, heightAt: () => -7,
    })).toEqual([])
  })
})

describe('horizon foliage rendering budget', () => {
  test('keeps distant forest impostors opaque and bounded by the presentation budget', () => {
    const root = buildDistantTreeInstances(horizon().plan)
    const instances = root.children.filter((child) => child instanceof InstancedMesh)
    try {
      const triangles = instances.reduce((sum, mesh) =>
        sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3 * mesh.count, 0)
      expect(instances.length).toBeLessThanOrEqual(8)
      expect(triangles).toBeLessThan(15_000)
      for (const mesh of instances) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        expect(materials.every((material) => !material.transparent)).toBe(true)
        expect(materials.every((material) => material.alphaTest > 0
          || ('maskNode' in material && material.maskNode != null))).toBe(true)
        expect(mesh.castShadow).toBe(false)
      }
    } finally {
      disposeInstanceWrappers(root)
    }
  })
})
