/**
 * Lossless run-length coding of RGBA pixels (PackBits over 4-byte pixels). A header byte below 128
 * is followed by that many plus one literal pixels; from 128 up, by one pixel repeated
 * `header - 126` times. Painted ground is mostly runs of one value, so a tile of it is a few bytes,
 * and the worst case (no two neighbours alike) costs one byte per 128 pixels.
 */
const MAX_LITERAL_PIXELS = 128
const MAX_REPEATED_PIXELS = 129
const REPEAT_HEADER_OFFSET = 126

function samePixel(values: Uint8Array, first: number, second: number): boolean {
  const a = first * 4
  const b = second * 4
  return (
    values[a] === values[b] &&
    values[a + 1] === values[b + 1] &&
    values[a + 2] === values[b + 2] &&
    values[a + 3] === values[b + 3]
  )
}

function repeatLength(values: Uint8Array, start: number, pixelCount: number): number {
  let length = 1
  while (
    start + length < pixelCount &&
    length < MAX_REPEATED_PIXELS &&
    samePixel(values, start, start + length)
  ) {
    length += 1
  }
  return length
}

/** Literal pixels from `start` up to (not into) the next pair of equal neighbours. */
function literalLength(values: Uint8Array, start: number, pixelCount: number): number {
  let length = 1
  while (
    start + length < pixelCount &&
    length < MAX_LITERAL_PIXELS &&
    !(start + length + 1 < pixelCount && samePixel(values, start + length, start + length + 1))
  ) {
    length += 1
  }
  return length
}

export function encodePixelRuns(values: Uint8Array): Uint8Array {
  const pixelCount = Math.floor(values.length / 4)
  const out: number[] = []
  let pixel = 0
  while (pixel < pixelCount) {
    const repeated = repeatLength(values, pixel, pixelCount)
    if (repeated >= 2) {
      out.push(repeated + REPEAT_HEADER_OFFSET, ...values.subarray(pixel * 4, pixel * 4 + 4))
      pixel += repeated
      continue
    }
    const literal = literalLength(values, pixel, pixelCount)
    out.push(literal - 1, ...values.subarray(pixel * 4, (pixel + literal) * 4))
    pixel += literal
  }
  return Uint8Array.from(out)
}

/** The `pixelCount` RGBA pixels `runs` encodes, or null unless it encodes exactly that many. */
export function decodePixelRuns(runs: Uint8Array, pixelCount: number): Uint8Array | null {
  const values = new Uint8Array(pixelCount * 4)
  let read = 0
  let pixel = 0
  while (read < runs.length) {
    const header = runs[read] ?? 0
    read += 1
    if (header < MAX_LITERAL_PIXELS) {
      const count = header + 1
      if (pixel + count > pixelCount || read + count * 4 > runs.length) return null
      values.set(runs.subarray(read, read + count * 4), pixel * 4)
      read += count * 4
      pixel += count
      continue
    }
    const count = header - REPEAT_HEADER_OFFSET
    if (pixel + count > pixelCount || read + 4 > runs.length) return null
    const color = runs.subarray(read, read + 4)
    for (let index = 0; index < count; index += 1) values.set(color, (pixel + index) * 4)
    read += 4
    pixel += count
  }
  return pixel === pixelCount ? values : null
}
