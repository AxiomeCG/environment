import { describe, expect, test } from 'bun:test'
import { createRoadGradedTerrain } from './road-elevation'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import type { ExteriorTerrainSampler } from './exterior-terrain'

const boundary = [[-15, -15], [15, -15], [15, 15], [-15, 15]] as const
const terrain: ExteriorTerrainSampler = {
  heightAt: (x, z) => z * 0.02 + Math.sin(z / 5) * 1.1 + (x - 45) * 0.08,
  normalAt: () => [0, 1, 0],
}
const network = deriveRuntimeRoadNetwork({ corridors: [], neighborCells: [], roadJunctions: [] }, [
  { id: 'street', separator: 'secondary-road', centerline: [[45, -100], [45, 100]], corridorIds: [], junctionIds: [] },
])

describe('presentation road earthworks', () => {
  test('levels the street across its width and attenuates abrupt longitudinal terrain bumps', () => {
    const graded = createRoadGradedTerrain(network, terrain, boundary)
    let rawRise = 0, roadRise = 0
    for (let z = -85; z < 85; z += 0.5) {
      expect(graded.heightAt(42, z)).toBeCloseTo(graded.heightAt(48, z), 6)
      rawRise = Math.max(rawRise, Math.abs(terrain.heightAt(45, z + 0.5) - terrain.heightAt(45, z)))
      roadRise = Math.max(roadRise, Math.abs(graded.heightAt(45, z + 0.5) - graded.heightAt(45, z)))
    }
    expect(roadRise).toBeLessThan(rawRise * 0.55)
    expect(roadRise / 0.5).toBeLessThan(0.11)
  })

  test('keeps the authored boundary and distant landscape intact with a continuous shoulder', () => {
    const graded = createRoadGradedTerrain(network, terrain, boundary)
    for (const [x, z] of [...boundary, [0, 0], [-4, 7], [200, 50]] as const) {
      expect(graded.heightAt(x, z)).toBe(terrain.heightAt(x, z))
    }
    for (let x = 45; x <= 70; x += 0.2) {
      expect(Math.abs(graded.heightAt(x + 0.001, 12) - graded.heightAt(x, 12))).toBeLessThan(0.001)
      expect(Math.hypot(...graded.normalAt(x, 12))).toBeCloseTo(1, 6)
    }
    expect(graded.heightAt(70, 12)).toBe(terrain.heightAt(70, 12))
  })

  test('leaves wet channel terrain open instead of turning the road grade into an embankment', () => {
    const channelTerrain: ExteriorTerrainSampler = {
      heightAt: (x) => Math.abs(x - 45) <= 4 ? -2 : 0.4,
      normalAt: () => [0, 1, 0],
    }
    const waterLevelAt = (x: number) => Math.abs(x - 45) <= 4 ? 0 : null
    const graded = createRoadGradedTerrain(network, channelTerrain, boundary, waterLevelAt)

    expect(graded.heightAt(45, 40)).toBe(-2)
    expect(graded.heightAt(45, -40)).toBe(-2)
    expect(graded.heightAt(45, 0)).toBe(-2)
  })

  test('keeps dry grading identical and preserves optional sampler metadata', () => {
    const sectionSegments = () => 18
    const source = { ...terrain, sectionSegments }
    const ordinary = createRoadGradedTerrain(network, source, boundary)
    const dryCallback = createRoadGradedTerrain(network, source, boundary, () => null)

    for (const [x, z] of [[45, -70], [42, 12], [53, 28], [100, 50]] as const) {
      expect(dryCallback.heightAt(x, z)).toBe(ordinary.heightAt(x, z))
    }
    expect((dryCallback as ExteriorTerrainSampler & {
      sectionSegments: typeof sectionSegments
    }).sectionSegments).toBe(sectionSegments)
  })
})
