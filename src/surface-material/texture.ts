import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import type { SurfaceMaterialField } from './field'

type SurfacePaintRuntime = {
  field: SurfaceMaterialField
  texture: DataTexture
}

const runtimes = new Map<string, Set<SurfacePaintRuntime>>()

export function createSurfacePaintTexture(
  nodeId: string,
  field: SurfaceMaterialField,
): DataTexture {
  const values = new Uint8Array(field.values)
  const texture = new DataTexture(
    values,
    field.cols,
    field.rows,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.colorSpace = NoColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true

  const runtime = { field: { ...field, values }, texture }
  const entries = runtimes.get(nodeId)
  if (entries) entries.add(runtime)
  else runtimes.set(nodeId, new Set([runtime]))
  return texture
}

export function updateSurfacePaintTextures(
  nodeId: string,
  field: SurfaceMaterialField,
): boolean {
  const entries = runtimes.get(nodeId)
  if (!entries?.size) return false

  for (const runtime of entries) {
    if (!sameTopology(runtime.field, field)) return false
    const values = runtime.texture.image.data
    if (!(values instanceof Uint8Array) || values.length !== field.values.length) return false
  }

  for (const runtime of entries) {
    const values = runtime.texture.image.data as Uint8Array
    values.set(field.values)
    runtime.field = { ...field, values }
    runtime.texture.needsUpdate = true
  }
  return true
}

export function disposeSurfacePaintTexture(nodeId: string, texture: DataTexture): void {
  const entries = runtimes.get(nodeId)
  if (entries) {
    for (const runtime of entries) {
      if (runtime.texture !== texture) continue
      entries.delete(runtime)
      break
    }
    if (entries.size === 0) runtimes.delete(nodeId)
  }
  texture.dispose()
}

function sameTopology(a: SurfaceMaterialField, b: SurfaceMaterialField): boolean {
  return (
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.origin[0] === b.origin[0] &&
    a.origin[1] === b.origin[1] &&
    a.spacing === b.spacing
  )
}
