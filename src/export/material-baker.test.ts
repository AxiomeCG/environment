import { describe, expect, test } from 'bun:test'
import { normalizeMaterialReadback } from './material-baker'

const WIDTH = 3
const HEIGHT = 3
const BYTES_PER_ROW = WIDTH * 4
const PADDED_BYTES_PER_ROW = 256
const REQUIRED_BYTES = PADDED_BYTES_PER_ROW * (HEIGHT - 1) + BYTES_PER_ROW
const ROWS = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
  [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52],
] as const

describe('material readback normalization', () => {
  test('accepts an unpadded final WebGPU row and strips intermediate padding', () => {
    const readback = new Uint8Array(REQUIRED_BYTES)
    for (let row = 0; row < HEIGHT; row += 1) {
      readback.set(ROWS[row]!, row * PADDED_BYTES_PER_ROW)
    }

    expect(Array.from(normalizeMaterialReadback(readback, WIDTH, HEIGHT, 'webgpu'))).toEqual(
      ROWS.flat(),
    )
  })

  test('rejects a WebGPU readback one byte short of the final row', () => {
    const truncated = new Uint8Array(REQUIRED_BYTES - 1)

    expect(() => normalizeMaterialReadback(truncated, WIDTH, HEIGHT, 'webgpu')).toThrow()
  })
})
