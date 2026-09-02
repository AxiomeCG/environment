import { describe, expect, test } from 'bun:test'
import { buildSmoothMaskPath, erodeMask } from './mask-contour'

  test('softly erodes the mask before smoothing the boundary', () => {
    const values = new Float32Array(7 * 7)
    fillRect(values, 7, 1, 1, 6, 6, 1)

    const eroded = erodeMask(values, 7, 7)

    expect(eroded[2 * 7 + 2]).toBe(1)
    expect(eroded[1 * 7 + 1]).toBe(0.5)
    expect(eroded[5 * 7 + 5]).toBe(0.5)
  })

describe('Ground Cover mask contours', () => {
  test('turns a hard raster block into one closed curved vector boundary', () => {
    const values = new Float32Array(9 * 9)
    fillRect(values, 9, 2, 2, 7, 7, 1)

    const path = buildSmoothMaskPath({
      values,
      columns: 9,
      rows: 9,
      origin: [-1, -1],
      spacing: 0.5,
    })

    expect(path).toStartWith('M')
    expect(path).toContain('Q')
    expect(path).toEndWith('Z')
    expect(path.match(/M/g)).toHaveLength(1)
  })

  test('preserves an erased island as a second contour ring', () => {
    const values = new Float32Array(17 * 17)
    fillRect(values, 17, 2, 2, 15, 15, 1)
    fillRect(values, 17, 6, 6, 11, 11, 0)

    const path = buildSmoothMaskPath({
      values,
      columns: 17,
      rows: 17,
      origin: [0, 0],
      spacing: 1,
    })

    expect(path.match(/M/g)?.length).toBeGreaterThanOrEqual(2)
    expect(path.match(/Z/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test('drops small color speckles without cutting the main region', () => {
    const values = new Float32Array(25 * 25)
    fillRect(values, 25, 3, 3, 13, 13, 1)
    values[20 * 25 + 20] = 1

    const path = buildSmoothMaskPath({
      values,
      columns: 25,
      rows: 25,
      origin: [0, 0],
      spacing: 1,
      threshold: 0.14,
      erosionStrength: 0,
      minimumArea: 12,
    })

    expect(path.match(/M/g)).toHaveLength(1)
  })

  test('emits no geometry for an empty mask', () => {
    expect(
      buildSmoothMaskPath({
        values: new Float32Array(25),
        columns: 5,
        rows: 5,
        origin: [0, 0],
        spacing: 1,
      }),
    ).toBe('')
  })
})

function fillRect(
  values: Float32Array,
  columns: number,
  minColumn: number,
  minRow: number,
  maxColumn: number,
  maxRow: number,
  value: number,
): void {
  for (let row = minRow; row < maxRow; row += 1) {
    for (let column = minColumn; column < maxColumn; column += 1) {
      values[row * columns + column] = value
    }
  }
}
