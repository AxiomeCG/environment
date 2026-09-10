import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import type { GrassPaintField } from './paint-field'

type GrassPaintRuntime = {
  field: GrassPaintField
  texture: DataTexture
}

export type GrassPaintTextureSample = {
  red: number
  green: number
  blue: number
  alpha: number
}

const runtimes = new Map<string, GrassPaintRuntime>()

const PREMULTIPLIED_SRGB = buildPremultipliedSrgbTable()
const SRGB_TO_LINEAR = buildSrgbToLinearTable()

export function createGrassPaintTexture(nodeId: string, field: GrassPaintField): DataTexture {
  const values = new Uint8Array(field.values.length)
  writePremultipliedSrgb(field.values, values)
  const texture = new DataTexture(values, field.cols, field.rows, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true

  runtimes.set(nodeId, {
    field,
    texture,
  })
  return texture
}

export function getGrassPaintRuntime(nodeId: string): GrassPaintRuntime | null {
  return runtimes.get(nodeId) ?? null
}

export function updateGrassPaintTexture(nodeId: string, field: GrassPaintField): boolean {
  const runtime = runtimes.get(nodeId)
  if (!runtime) return false
  if (
    runtime.field.cols !== field.cols ||
    runtime.field.rows !== field.rows ||
    runtime.field.origin[0] !== field.origin[0] ||
    runtime.field.origin[1] !== field.origin[1] ||
    runtime.field.spacing !== field.spacing
  ) {
    return false
  }

  const values = runtime.texture.image.data
  if (!(values instanceof Uint8Array) || values.length !== field.values.length) return false
  writePremultipliedSrgb(field.values, values)
  runtime.field = field
  runtime.texture.needsUpdate = true
  return true
}

export function disposeGrassPaintTexture(nodeId: string, texture: DataTexture): void {
  const runtime = runtimes.get(nodeId)
  if (runtime?.texture === texture) runtimes.delete(nodeId)
  texture.dispose()
}

export function sampleGrassPaintTexture(
  field: GrassPaintField,
  x: number,
  z: number,
  output: GrassPaintTextureSample,
): void {
  const width = Math.max((field.cols - 1) * field.spacing, field.spacing)
  const height = Math.max((field.rows - 1) * field.spacing, field.spacing)
  const normalizedU = Number.isFinite(x) ? (x - field.origin[0]) / width : 0
  const normalizedV = Number.isFinite(z) ? (z - field.origin[1]) / height : 0
  const texelX = normalizedU * field.cols - 0.5
  const texelY = normalizedV * field.rows - 0.5
  const baseCol = Math.floor(texelX)
  const baseRow = Math.floor(texelY)
  const col0 = Math.min(field.cols - 1, Math.max(0, baseCol))
  const row0 = Math.min(field.rows - 1, Math.max(0, baseRow))
  const col1 = Math.min(field.cols - 1, Math.max(0, baseCol + 1))
  const row1 = Math.min(field.rows - 1, Math.max(0, baseRow + 1))
  const tx = texelX - baseCol
  const tz = texelY - baseRow

  output.alpha = bilinearTextureChannel(field, col0, row0, col1, row1, tx, tz, 3) / 255
  output.red = bilinearPremultipliedLinear(field, col0, row0, col1, row1, tx, tz, 0)
  output.green = bilinearPremultipliedLinear(field, col0, row0, col1, row1, tx, tz, 1)
  output.blue = bilinearPremultipliedLinear(field, col0, row0, col1, row1, tx, tz, 2)
}

function writePremultipliedSrgb(source: Uint8Array, target: Uint8Array): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3] ?? 0
    target[offset] = PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset] ?? 0)] ?? 0
    target[offset + 1] = PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset + 1] ?? 0)] ?? 0
    target[offset + 2] = PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset + 2] ?? 0)] ?? 0
    target[offset + 3] = alpha
  }
}

function buildPremultipliedSrgbTable(): Uint8Array {
  const table = new Uint8Array(256 * 256)
  for (let alpha = 0; alpha < 256; alpha += 1) {
    const opacity = alpha / 255
    for (let color = 0; color < 256; color += 1) {
      const srgb = color / 255
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
      const premultiplied = linear * opacity
      const encoded =
        premultiplied <= 0.0031308
          ? premultiplied * 12.92
          : 1.055 * premultiplied ** (1 / 2.4) - 0.055
      table[(alpha << 8) | color] = Math.round(encoded * 255)
    }
  }
  return table
}

function buildSrgbToLinearTable(): Float32Array {
  const table = new Float32Array(256)
  for (let value = 0; value < 256; value += 1) {
    const srgb = value / 255
    table[value] = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return table
}

function bilinearPremultipliedLinear(
  field: GrassPaintField,
  col0: number,
  row0: number,
  col1: number,
  row1: number,
  tx: number,
  tz: number,
  channel: number,
): number {
  const values = field.values
  const topLeftOffset = (row0 * field.cols + col0) * 4
  const topRightOffset = (row0 * field.cols + col1) * 4
  const bottomLeftOffset = (row1 * field.cols + col0) * 4
  const bottomRightOffset = (row1 * field.cols + col1) * 4
  const topLeft = premultipliedLinearChannel(values, topLeftOffset, channel)
  const topRight = premultipliedLinearChannel(values, topRightOffset, channel)
  const bottomLeft = premultipliedLinearChannel(values, bottomLeftOffset, channel)
  const bottomRight = premultipliedLinearChannel(values, bottomRightOffset, channel)
  const top = topLeft + (topRight - topLeft) * tx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
  return top + (bottom - top) * tz
}

function premultipliedLinearChannel(values: Uint8Array, offset: number, channel: number): number {
  const alpha = values[offset + 3] ?? 0
  const encoded = PREMULTIPLIED_SRGB[(alpha << 8) | (values[offset + channel] ?? 0)] ?? 0
  return SRGB_TO_LINEAR[encoded] ?? 0
}

function bilinearTextureChannel(
  field: GrassPaintField,
  col0: number,
  row0: number,
  col1: number,
  row1: number,
  tx: number,
  tz: number,
  channel: number,
): number {
  const topLeft = field.values[(row0 * field.cols + col0) * 4 + channel] ?? 0
  const topRight = field.values[(row0 * field.cols + col1) * 4 + channel] ?? 0
  const bottomLeft = field.values[(row1 * field.cols + col0) * 4 + channel] ?? 0
  const bottomRight = field.values[(row1 * field.cols + col1) * 4 + channel] ?? 0
  const top = topLeft + (topRight - topLeft) * tx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
  return top + (bottom - top) * tz
}
