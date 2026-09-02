import { describe, expect, test } from 'bun:test'
import {
  createSurfaceMaterialField,
  decodeSurfaceMaterialField,
  encodeSurfaceMaterialField,
  resolveSurfaceMaterialField,
  surfaceMaterialTarget,
  surfaceMaterialWeightsAt,
} from './field'
import type { SurfaceMaterialId } from './material-types'
import { SurfaceMaterialNode } from './schema'

describe('Surface material field', () => {
  test('defaults every texel to flowered grass and round-trips persistence', () => {
    const field = createSurfaceMaterialField({ minX: -2, maxX: 2, minZ: -1, maxZ: 1 })

    expect(surfaceMaterialWeightsAt(field, 0, 0)).toEqual([1, 0, 0, 0])
    const decoded = decodeSurfaceMaterialField(encodeSurfaceMaterialField(field))
    expect(decoded?.values).toEqual(field.values)
    expect(decoded?.origin).toEqual(field.origin)
  })

  test('uses a 5 cm lattice for new Surface paint fields', () => {
    const field = createSurfaceMaterialField({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 })

    expect(field.spacing).toBe(0.05)
  })

  test('defaults persisted texture size to 100 percent', () => {
    expect(
      SurfaceMaterialNode.parse({
        id: 'surface-material_scale',
        parentId: 'site_scale',
      }).textureSize,
    ).toBe(100)
  })


  test('preserves painted values when the site bounds expand', () => {
    const field = createSurfaceMaterialField({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })
    const center = (2 * field.cols + 2) * 4
    field.values.set([0, 255, 0, 255], center)

    const expanded = resolveSurfaceMaterialField(encodeSurfaceMaterialField(field), {
      minX: -1,
      maxX: 3,
      minZ: -1,
      maxZ: 3,
    })

    expect(
      surfaceMaterialWeightsAt(
        expanded,
        field.origin[0] + field.spacing * 2,
        field.origin[1] + field.spacing * 2,
      ),
    ).toEqual([0, 1, 0, 0])
    expect(surfaceMaterialWeightsAt(expanded, 3, 3)).toEqual([1, 0, 0, 0])
  })


  test('decodes every material paint color into its target weight', () => {
    const field = createSurfaceMaterialField({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })
    const targets: Array<
      readonly [SurfaceMaterialId, readonly [number, number, number], readonly [number, number, number, number]]
    > = [
      ['flowered-grass', [255, 0, 0], [1, 0, 0, 0]],
      ['road-path', [0, 255, 0], [0, 1, 0, 0]],
      ['desert-ground', [0, 0, 255], [0, 0, 1, 0]],
      ['paved-road', [255, 255, 255], [0, 0, 0, 1]],
    ]

    for (const [material, color, expected] of targets) {
      for (let offset = 0; offset < field.values.length; offset += 4) {
        field.values.set([...color, 255], offset)
      }
      expect(surfaceMaterialWeightsAt(field, 0, 0)).toEqual(expected)
      expect(surfaceMaterialTarget(material)).toEqual(expected)
    }
  })

  test('decodes interpolated partial paved and road coverage', () => {
    const field = createSurfaceMaterialField({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })
    for (let row = 0; row < field.rows; row += 1) {
      field.values.set([128, 128, 128, 128], (row * field.cols) * 4)
      field.values.set([0, 128, 0, 128], (row * field.cols + 1) * 4)
    }

    expect(surfaceMaterialWeightsAt(field, field.origin[0] + field.spacing / 2, field.origin[1])).toEqual([
      0, 0.5, 0, 0.5,
    ])
  })
  test('rejects malformed persisted maps', () => {
    expect(
      decodeSurfaceMaterialField({
        type: 'surface-material-field',
        origin: [0, 0],
        spacing: 0.25,
        cols: 33,
        rows: 33,
        values: 'not base64',
      }),
    ).toBeNull()
  })
})
