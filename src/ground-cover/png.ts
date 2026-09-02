const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function rgbaPngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length !== width * height * 4
  ) {
    throw new TypeError('RGBA PNG dimensions and byte length must agree')
  }

  const scanlines = new Uint8Array(height * (width * 4 + 1))
  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * (width * 4 + 1)
    scanlines[scanlineOffset] = 0
    scanlines.set(
      rgba.subarray(row * width * 4, (row + 1) * width * 4),
      scanlineOffset + 1,
    )
  }

  const png = concatenate([
    PNG_SIGNATURE,
    pngChunk('IHDR', imageHeader(width, height)),
    pngChunk('IDAT', zlibStore(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
  return `data:image/png;base64,${encodeBase64(png)}`
}

function imageHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)
  writeUint32(header, 0, width)
  writeUint32(header, 4, height)
  header.set([8, 6, 0, 0, 0], 8)
  return header
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.length)
  writeUint32(chunk, 0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  writeUint32(chunk, 8 + data.length, crc32(concatenate([typeBytes, data])))
  return chunk
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blockCount = Math.ceil(data.length / 65_535)
  const output = new Uint8Array(2 + data.length + blockCount * 5 + 4)
  output.set([0x78, 0x01], 0)
  let sourceOffset = 0
  let outputOffset = 2
  while (sourceOffset < data.length) {
    const length = Math.min(65_535, data.length - sourceOffset)
    const final = sourceOffset + length === data.length
    output[outputOffset++] = final ? 1 : 0
    output[outputOffset++] = length & 0xff
    output[outputOffset++] = length >>> 8
    const inverse = (~length) & 0xffff
    output[outputOffset++] = inverse & 0xff
    output[outputOffset++] = inverse >>> 8
    output.set(data.subarray(sourceOffset, sourceOffset + length), outputOffset)
    sourceOffset += length
    outputOffset += length
  }
  writeUint32(output, outputOffset, adler32(data))
  return output
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65_521
    b = (b + a) % 65_521
  }
  return ((b << 16) | a) >>> 0
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value >>> 24
  target[offset + 1] = value >>> 16
  target[offset + 2] = value >>> 8
  target[offset + 3] = value
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function encodeBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const remaining = bytes.length - index
    output += BASE64_ALPHABET.charAt(first >> 2)
    output += BASE64_ALPHABET.charAt(((first & 3) << 4) | (second >> 4))
    output += remaining > 1 ? BASE64_ALPHABET.charAt(((second & 15) << 2) | (third >> 6)) : '='
    output += remaining > 2 ? BASE64_ALPHABET.charAt(third & 63) : '='
  }
  return output
}
