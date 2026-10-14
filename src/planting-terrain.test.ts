import { createTerrainField, normalAt, quantize, surfaceHeightAt } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { plantingDensityAt, samplePlantingTerrain } from './planting-terrain'

function plane(gradient: number) {
  const terrain = createTerrainField({ origin: [-4, -4], spacing: 1, cols: 9, rows: 9 })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let column = 0; column < terrain.cols; column += 1) {
      terrain.heights[row * terrain.cols + column] = quantize(terrain,
        2 + gradient * (terrain.origin[0] + column * terrain.spacing))
    }
  }
  return terrain
}

describe('planting terrain seam', () => {
  test('samples the host height and normal without changing the field', () => {
    const terrain = plane(0.5)
    const before = Array.from(terrain.heights)
    const sample = samplePlantingTerrain(terrain, 0.2, -0.3)
    expect(sample.heightM).toBe(surfaceHeightAt(terrain, 0.2, -0.3))
    const hostNormal = normalAt(terrain, 0.2, -0.3)
    sample.normal.forEach((component, index) => {
      expect(component).toBeCloseTo(hostNormal[index] ?? 0, 12)
    })
    expect(sample.slopeDeg).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI, 5)
    expect(Array.from(terrain.heights)).toEqual(before)
  })

  test('missing and flat terrain retain full density for every planting category', () => {
    const missing = samplePlantingTerrain(null, 0, 0)
    expect(missing).toEqual({ heightM: 0, normal: [0, 1, 0], slopeDeg: 0, southExposure: 0 })
    for (const category of ['grass', 'flower', 'tree'] as const) {
      expect(plantingDensityAt(missing, category)).toBe(1)
      expect(plantingDensityAt(samplePlantingTerrain(plane(0), 0, 0), category)).toBe(1)
    }
  })

  test('banks thin planting and near-vertical faces support none', () => {
    const bank = samplePlantingTerrain(plane(1), 0, 0)
    expect(plantingDensityAt(bank, 'grass')).toBeGreaterThan(0)
    expect(plantingDensityAt(bank, 'grass')).toBeLessThan(1)
    expect(plantingDensityAt(bank, 'tree')).toBe(0)
    const face = samplePlantingTerrain(plane(10), 0, 0)
    for (const category of ['grass', 'flower', 'tree'] as const) {
      expect(plantingDensityAt(face, category)).toBe(0)
    }
  })
})
