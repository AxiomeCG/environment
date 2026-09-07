import { describe, expect, test } from 'bun:test'
import type { ExteriorTerrainSampler } from './exterior-terrain'
import { createRiverBridges, MAXIMUM_BRIDGE_WET_RUN, RIVER_BRIDGE_CLEARANCE } from './river-bridges'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'

function networkFor(centerline: readonly (readonly [number, number])[]) {
  return deriveRuntimeRoadNetwork({ corridors: [], neighborCells: [], roadJunctions: [] }, [
    {
      id: 'crossing-street',
      separator: 'secondary-road',
      centerline,
      corridorIds: [],
      junctionIds: [],
    },
  ])
}

const terrain: ExteriorTerrainSampler = {
  heightAt: (x, z) => 0.32 + x * 0.002 + z * 0.001,
  normalAt: () => [0, 1, 0],
}

describe('river road bridges', () => {
  test('clears a skew channel and joins the unchanged dry grade continuously', () => {
    const network = networkFor([
      [-60, -18],
      [60, 18],
    ])
    const waterLevelAt = (x: number, z: number) => (Math.abs(x - z * 0.25) <= 5 ? 0 : null)
    const bridges = createRiverBridges(network, terrain, waterLevelAt)

    expect(bridges.spans).toHaveLength(1)
    const span = bridges.spans[0]!
    const middle = span.points[Math.floor(span.points.length / 2)]!
    expect(bridges.heightAt(middle[0], middle[2])).toBeGreaterThanOrEqual(
      span.waterLevel + RIVER_BRIDGE_CLEARANCE - 1e-6,
    )

    const startX = -60 + (120 * span.approachStartStation) / Math.hypot(120, 36)
    const startZ = -18 + (36 * span.approachStartStation) / Math.hypot(120, 36)
    expect(bridges.heightAt(startX, startZ)).toBeCloseTo(terrain.heightAt(startX, startZ), 6)
    expect(bridges.heightAt(-60, -18)).toBe(terrain.heightAt(-60, -18))
    expect(bridges.heightAt(60, 18)).toBe(terrain.heightAt(60, 18))

    const bridgeStart = span.points[0]!
    const beforeMix = (span.startStation - 0.001) / Math.hypot(120, 36)
    const beforeX = -60 + 120 * beforeMix
    const beforeZ = -18 + 36 * beforeMix
    expect(
      Math.abs(
        bridges.heightAt(beforeX, beforeZ) - bridges.heightAt(bridgeStart[0], bridgeStart[2]),
      ),
    ).toBeLessThan(0.002)

    const pathLength = Math.hypot(120, 36)
    let previousHeight = bridges.heightAt(startX, startZ)
    let maximumGrade = 0
    for (
      let station = span.approachStartStation + 0.25;
      station <= span.startStation;
      station += 0.25
    ) {
      const mix = station / pathLength
      const x = -60 + 120 * mix
      const z = -18 + 36 * mix
      const height = bridges.heightAt(x, z)
      maximumGrade = Math.max(maximumGrade, Math.abs(height - previousHeight) / 0.25)
      previousHeight = height
    }
    expect(maximumGrade).toBeLessThan(0.103)
  })

  test('fits an off-center crossing on a default Site frontage without lifting its junctions', () => {
    const network = networkFor([
      [20.2, -20.2],
      [20.2, 20.2],
    ])
    const waterLevelAt = (_x: number, z: number) => (Math.abs(z + 0.8) <= 2 ? -0.108 : null)
    const ground: ExteriorTerrainSampler = {
      heightAt: (x, z) => (waterLevelAt(x, z) === null ? 0 : -1),
      normalAt: () => [0, 1, 0],
    }
    const bridges = createRiverBridges(network, ground, waterLevelAt)
    expect(bridges.spans).toHaveLength(1)
    expect(bridges.heightAt(20.2, -0.8)).toBeGreaterThan(0.4)
    expect(bridges.heightAt(20.2, -20.2)).toBe(0)
    expect(bridges.heightAt(20.2, 20.2)).toBe(0)
  })

  test('covers wet shoulders even when the road centerline is dry', () => {
    const network = networkFor([
      [0, -30],
      [0, 30],
    ])
    const ground: ExteriorTerrainSampler = { heightAt: () => 0, normalAt: () => [0, 1, 0] }
    const waterLevelAt = (x: number, z: number) =>
      x >= 3.5 && x <= 6 && Math.abs(z) <= 2 ? -0.1 : null
    const bridges = createRiverBridges(network, ground, waterLevelAt)
    expect(bridges.spans).toHaveLength(1)
    expect(bridges.heightAt(4.5, 0)).toBeGreaterThan(0.5)
    expect(bridges.heightAt(0, -30)).toBe(0)
  })

  test('joins bridge decks over a wet junction without cracks on incident roads', () => {
    const roads = [
      {
        id: 'east-west',
        centerline: [
          [-30, 0],
          [30, 0],
        ] as const,
      },
      {
        id: 'north-south',
        centerline: [
          [0, -30],
          [0, 30],
        ] as const,
      },
    ].map((road) => ({
      ...road,
      separator: 'secondary-road' as const,
      corridorIds: [],
      junctionIds: [],
    }))
    const network = deriveRuntimeRoadNetwork(
      { corridors: [], neighborCells: [], roadJunctions: [] },
      roads,
    )
    const ground: ExteriorTerrainSampler = { heightAt: () => 0, normalAt: () => [0, 1, 0] }
    const bridges = createRiverBridges(network, ground, (x, z) =>
      Math.abs(x - z) <= 2 ? -0.1 : null,
    )
    expect(bridges.spans).toHaveLength(4)
    const junctionHeight = bridges.heightAt(0, 0)
    expect(junctionHeight).toBeGreaterThan(0.5)
    for (const [x, z] of [
      [-0.001, 0],
      [0.001, 0],
      [0, -0.001],
      [0, 0.001],
    ]) {
      expect(bridges.heightAt(x!, z!)).toBeCloseTo(junctionHeight, 4)
    }
    for (const [x, z] of [
      [-30, 0],
      [30, 0],
      [0, -30],
      [0, 30],
    ]) {
      expect(bridges.heightAt(x!, z!)).toBe(0)
    }
  })

  test('finds separate crossings deterministically and leaves dry roads unchanged', () => {
    const network = networkFor([
      [-100, 0],
      [100, 0],
    ])
    const waterLevelAt = (x: number) =>
      x >= -38 && x <= -30 ? -0.1 : x >= 24 && x <= 32 ? 0.05 : null
    const first = createRiverBridges(network, terrain, waterLevelAt)
    const second = createRiverBridges(network, terrain, waterLevelAt)

    expect(first.spans).toHaveLength(2)
    expect(first.spans).toEqual(second.spans)

    const dry = createRiverBridges(network, terrain, () => null)
    expect(dry.spans).toEqual([])
    for (const [x, z] of [
      [-100, 0],
      [-12, 4],
      [0, 20],
      [100, 0],
    ] as const) {
      expect(dry.heightAt(x, z)).toBe(terrain.heightAt(x, z))
    }
  })

  test('rejects non-finite water and boundedly skips an ocean-length wet run', () => {
    const network = networkFor([
      [-100, 0],
      [100, 0],
    ])
    expect(createRiverBridges(network, terrain, () => Number.NaN).spans).toEqual([])

    const halfLength = MAXIMUM_BRIDGE_WET_RUN / 2 + 1
    const ocean = createRiverBridges(network, terrain, (x) =>
      Math.abs(x) <= halfLength ? 0 : null,
    )
    expect(ocean.spans).toEqual([])
    expect(ocean.heightAt(0, 0)).toBe(terrain.heightAt(0, 0))
  })
})
