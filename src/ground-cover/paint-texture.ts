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

export function createGrassPaintTexture(nodeId: string, field: GrassPaintField): DataTexture {
  const values = new Uint8Array(field.values)
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
    field: { ...field, values },
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
  values.set(field.values)
  runtime.field = { ...field, values }
  runtime.texture.needsUpdate = true
  return true
}

export function disposeGrassPaintTexture(nodeId: string, texture: DataTexture): void {
  const runtime = runtimes.get(nodeId)
  if (runtime?.texture === texture) runtimes.delete(nodeId)
  texture.dispose()
}
