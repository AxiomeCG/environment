import { describe, expect, test } from 'bun:test'
import {
  createGrassPaintField,
  decodeGrassPaintField,
  DEFAULT_GRASS_PAINT_FIELD_SPACING,
  encodeGrassPaintField,
  GRASS_PAINT_FIELD_SIZES,
  GrassPaintFieldData,
  grassPaintFieldCoversBounds,
  hexToRgb,
  paintAt,
  resolveGrassPaintField,
  rgbToHex,
  siteBounds,
  type GrassPaintField,
} from './paint-field'

describe('grass paint field codec', () => {
  test('round-trips metadata and every RGBA byte canonically', () => {
    const field = createGrassPaintField(
      { minX: -2, maxX: 2, minZ: -3, maxZ: 3 },
      '#1a7fc0',
      0.4,
    )
    field.values.set([0, 1, 2, 3, 252, 253, 254, 255], 4)

    const encoded = encodeGrassPaintField(field)
    const decoded = decodeGrassPaintField(JSON.parse(JSON.stringify(encoded)))

    expect(GrassPaintFieldData.safeParse(encoded).success).toBe(true)
    expect(encoded.values.length % 4).toBe(0)
    expect(decoded?.origin).toEqual(field.origin)
    expect(decoded?.spacing).toBe(field.spacing)
    expect(decoded?.cols).toBe(field.cols)
    expect(decoded?.rows).toBe(field.rows)
    expect(Array.from(decoded?.values ?? [])).toEqual(Array.from(field.values))
    expect(encodeGrassPaintField(decoded as GrassPaintField)).toEqual(encoded)
  })

  test('rejects corrupt, non-canonical, mismatched, and invalid metadata', () => {
    const encoded = encodeGrassPaintField(
      createGrassPaintField({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, '#123456'),
    )

    expect(decodeGrassPaintField({ ...encoded, values: 'not base64!!' })).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, values: encoded.values.slice(0, -4) })).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, values: `${encoded.values}AAAA` })).toBeNull()
    expect(
      decodeGrassPaintField({
        type: 'grass-paint-field',
        origin: [0, 0],
        spacing: 1,
        cols: 1,
        rows: 1,
        values: 'AAAAAB==',
      }),
    ).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, spacing: 0 })).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, origin: [0, Number.NaN] })).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, cols: 514 })).toBeNull()
    expect(decodeGrassPaintField({ ...encoded, extra: true })).toBeNull()
  })
})

describe('field creation and resolution', () => {
  test('computes site bounds and creates an aligned square field covering them', () => {
    const bounds = siteBounds([
      [100.1, -20.2],
      [123.4, -18],
      [119, 7.7],
      [101, 5],
    ])
    const field = createGrassPaintField(bounds, '#abcdef')
    const maxX = field.origin[0] + (field.cols - 1) * field.spacing
    const maxZ = field.origin[1] + (field.rows - 1) * field.spacing

    expect(bounds).toEqual({ minX: 100.1, maxX: 123.4, minZ: -20.2, maxZ: 7.7 })
    expect(field.cols).toBe(field.rows)
    expect([...GRASS_PAINT_FIELD_SIZES] as number[]).toContain(field.cols)
    expect(field.spacing).toBe(DEFAULT_GRASS_PAINT_FIELD_SPACING)
    expect(field.origin[0] / field.spacing).toBeCloseTo(
      Math.round(field.origin[0] / field.spacing),
      9,
    )
    expect(field.origin[1] / field.spacing).toBeCloseTo(
      Math.round(field.origin[1] / field.spacing),
      9,
    )
    expect(field.origin[0]).toBeLessThanOrEqual(bounds.minX)
    expect(field.origin[1]).toBeLessThanOrEqual(bounds.minZ)
    expect(maxX).toBeGreaterThanOrEqual(bounds.maxX)
    expect(maxZ).toBeGreaterThanOrEqual(bounds.maxZ)
    expect(grassPaintFieldCoversBounds(field, bounds)).toBe(true)
  })

  test('caps huge sites at 513 samples and coarsens enough to cover them', () => {
    const bounds = { minX: -300, maxX: 300, minZ: -200, maxZ: 200 }
    const field = createGrassPaintField(bounds, '#ffffff')

    expect(field.cols).toBe(513)
    expect(field.rows).toBe(513)
    expect(field.spacing).toBeGreaterThan(DEFAULT_GRASS_PAINT_FIELD_SPACING)
    expect(grassPaintFieldCoversBounds(field, bounds)).toBe(true)
  })

  test('absent or corrupt data resolves to the supplied base color at full density', () => {
    const bounds = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 }
    for (const data of [undefined, null, { type: 'grass-paint-field' }] as const) {
      const field = resolveGrassPaintField(data as never, bounds, '#204060')
      expect(paintAt(field, 1, 1)).toEqual({
        r: 0x20 / 255,
        g: 0x40 / 255,
        b: 0x60 / 255,
        a: 1,
      })
    }
  })

  test('expansion preserves old RGBA and initializes only new space', () => {
    const original = createGrassPaintField(
      { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      '#203040',
      1,
    )
    const paintedIndex = (2 * original.cols + 2) * 4
    original.values.set([240, 120, 60, 32], paintedIndex)

    const expanded = resolveGrassPaintField(
      encodeGrassPaintField(original),
      { minX: -4, maxX: 20, minZ: -4, maxZ: 20 },
      '#abcdef',
    )

    expect(expanded.cols).toBeGreaterThan(original.cols)
    expect(paintAt(expanded, 0.5, 0.5)).toEqual({
      r: 240 / 255,
      g: 120 / 255,
      b: 60 / 255,
      a: 32 / 255,
    })
    expect(paintAt(expanded, -3.5, -3.5)).toEqual({
      r: 0xab / 255,
      g: 0xcd / 255,
      b: 0xef / 255,
      a: 1,
    })
  })
})

describe('color and sampling helpers', () => {
  test('accepts short and long RGB hex and emits canonical lowercase hex', () => {
    expect(hexToRgb('#3aF')).toEqual({ r: 0x33, g: 0xaa, b: 0xff })
    expect(hexToRgb('204060')).toEqual({ r: 0x20, g: 0x40, b: 0x60 })
    expect(rgbToHex({ r: 51, g: 170, b: 255 })).toBe('#33aaff')
    expect(() => hexToRgb('#12')).toThrow()
  })

  test('bilinearly samples normalized RGBA channels', () => {
    const field: GrassPaintField = {
      origin: [10, 20],
      spacing: 2,
      cols: 2,
      rows: 2,
      values: Uint8Array.from([
        0, 0, 0, 0,
        255, 0, 0, 255,
        0, 255, 0, 255,
        255, 255, 255, 0,
      ]),
    }

    const centre = paintAt(field, 11, 21)
    expect(centre.r).toBeCloseTo(0.5, 6)
    expect(centre.g).toBeCloseTo(0.5, 6)
    expect(centre.b).toBeCloseTo(0.25, 6)
    expect(centre.a).toBeCloseTo(0.5, 6)
    expect(paintAt(field, -100, -100)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})
