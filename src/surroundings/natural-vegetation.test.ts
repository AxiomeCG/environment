import { expect, test } from 'bun:test'
import { deriveNaturalVegetationPlan, NATURAL_VEGETATION_TILE_SIZE } from './natural-vegetation'

const boundary = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const

test('natural grass occupies tile interiors instead of repeated diagonal rows', () => {
  for (const presetId of ['open-meadow', 'woodland-edge'] as const) {
    const context = { boundary, seed: 'pascal', presetId, heightAt: () => 0 }
    const plan = deriveNaturalVegetationPlan(context)
    let diagonalCount = 0
    let edgeCount = 0
    const cells = new Array<number>(16).fill(0)
    for (const tile of plan.tiles) {
      for (const patch of tile.lowVegetation) {
        const x = patch.position[0] / NATURAL_VEGETATION_TILE_SIZE - tile.address[0]
        const z = patch.position[2] / NATURAL_VEGETATION_TILE_SIZE - tile.address[1]
        if (Math.abs(x - z) < 0.04) diagonalCount += 1
        if (x < 0.04 || x > 0.96 || z < 0.04 || z > 0.96) edgeCount += 1
        cells[Math.floor(z * 4) * 4 + Math.floor(x * 4)]! += 1
      }
    }
    // Independent coordinates put about 8% in this diagonal band, not whole rows.
    expect(diagonalCount / plan.lowVegetationCount).toBeLessThan(0.2)
    expect(edgeCount / plan.lowVegetationCount).toBeGreaterThan(0.08)
    for (const count of cells) {
      expect(count / plan.lowVegetationCount).toBeGreaterThan(0.02)
      expect(count / plan.lowVegetationCount).toBeLessThan(0.12)
    }
    expect(deriveNaturalVegetationPlan(context)).toEqual(plan)
  }
})
