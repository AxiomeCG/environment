import { describe, expect, test } from 'bun:test'
import type { GrassPaintField } from './paint-field'
import { sampleGrassPaintTexture } from './paint-texture'

describe('Grass paint texture sampling', () => {
  test('interpolates unequal-alpha paint in premultiplied working-linear color', () => {
    const field: GrassPaintField = {
      origin: [0, 0],
      spacing: 1,
      cols: 2,
      rows: 1,
      values: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 64]),
    }
    const sample = { red: 0, green: 0, blue: 0, alpha: 0 }

    sampleGrassPaintTexture(field, 0.5, 0, sample)

    expect(sample.alpha).toBeCloseTo(0.625, 3)
    expect(sample.red / sample.alpha).toBeCloseTo(0.8, 2)
    expect(sample.green).toBe(0)
    expect(sample.blue / sample.alpha).toBeCloseTo(0.2, 2)
  })
})
