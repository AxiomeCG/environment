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

const runtimes = new Map<string, GrassPaintRuntime>()

const PREMULTIPLIED_SRGB = buildPremultipliedSrgbTable()

export function createGrassPaintTexture(nodeId: string, field: GrassPaintField): DataTexture {
  const values = new Uint8Array(field.values.length)
  writePremultipliedSrgb(field.values, values)
  const texture = new DataTexture(
    values,
    field.cols,
    field.rows,
    RGBAFormat,
    UnsignedByteType,
  )
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

function writePremultipliedSrgb(source: Uint8Array, target: Uint8Array): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3] ?? 0
    target[offset] = PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset] ?? 0)] ?? 0
    target[offset + 1] =
      PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset + 1] ?? 0)] ?? 0
    target[offset + 2] =
      PREMULTIPLIED_SRGB[(alpha << 8) | (source[offset + 2] ?? 0)] ?? 0
    target[offset + 3] = alpha
  }
}

function buildPremultipliedSrgbTable(): Uint8Array {
  const table = new Uint8Array(256 * 256)
  for (let alpha = 0; alpha < 256; alpha += 1) {
    const opacity = alpha / 255
    for (let color = 0; color < 256; color += 1) {
      const srgb = color / 255
      const linear =
        srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
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
