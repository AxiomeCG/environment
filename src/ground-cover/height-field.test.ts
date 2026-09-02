import { describe, expect, test } from 'bun:test'
import {
  createGrassHeightField,
  decodeLocalHeightScale,
  grassHeightTargetColor,
  localGrassHeightScaleAt,
  resolveGrassHeightField,
} from './height-field'
import { hexToRgb } from './paint-field'

describe('local grass height field', () => {
  const bounds = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 }

  test('starts neutral without changing the general blade height', () => {
    const field = createGrassHeightField(bounds)

    expect(localGrassHeightScaleAt(field, 1, 1)).toBe(1)
    expect(resolveGrassHeightField(undefined, bounds).values).toEqual(field.values)
  })

  test('encodes symmetric raise and lower targets', () => {
    const raised = hexToRgb(grassHeightTargetColor('raise', 50)).r / 255
    const lowered = hexToRgb(grassHeightTargetColor('lower', 50)).r / 255

    expect(decodeLocalHeightScale(raised)).toBeCloseTo(1.5, 2)
    expect(decodeLocalHeightScale(lowered)).toBeCloseTo(0.5, 2)
  })

  test('supports the full zero-to-double-height range', () => {
    expect(decodeLocalHeightScale(0)).toBe(0)
    expect(decodeLocalHeightScale(128 / 255)).toBe(1)
    expect(decodeLocalHeightScale(1)).toBe(2)
  })
})
