import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import type { GrassPaintField } from './paint-field'

type GrassHeightRuntime = {
  field: GrassPaintField
  texture: DataTexture
}

const runtimes = new Map<string, GrassHeightRuntime>()

export function createGrassHeightTexture(
  nodeId: string,
  field: GrassPaintField,
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

  runtimes.set(nodeId, {
    field: { ...field, values },
    texture,
  })
  return texture
}

export function getGrassHeightRuntime(nodeId: string): GrassHeightRuntime | null {
  return runtimes.get(nodeId) ?? null
}

export function updateGrassHeightTexture(
  nodeId: string,
  field: GrassPaintField,
): boolean {
  const runtime = runtimes.get(nodeId)
  if (!runtime || !sameTopology(runtime.field, field)) return false

  const values = runtime.texture.image.data
  if (!(values instanceof Uint8Array) || values.length !== field.values.length) return false
  values.set(field.values)
  runtime.field = { ...field, values }
  runtime.texture.needsUpdate = true
  return true
}

export function disposeGrassHeightTexture(
  nodeId: string,
  texture: DataTexture,
): void {
  const runtime = runtimes.get(nodeId)
  if (runtime?.texture === texture) runtimes.delete(nodeId)
  texture.dispose()
}

function sameTopology(a: GrassPaintField, b: GrassPaintField): boolean {
  return (
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.origin[0] === b.origin[0] &&
    a.origin[1] === b.origin[1] &&
    a.spacing === b.spacing
  )
}
