import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import type { GrassObstacleField } from './obstacle-field'

type GrassObstacleRuntime = {
  field: GrassObstacleField
  texture: DataTexture
}

const runtimes = new Map<string, GrassObstacleRuntime>()

export function createGrassObstacleTexture(
  nodeId: string,
  field: GrassObstacleField,
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

export function getGrassObstacleRuntime(nodeId: string): GrassObstacleRuntime | null {
  return runtimes.get(nodeId) ?? null
}

export function updateGrassObstacleTexture(
  nodeId: string,
  field: GrassObstacleField,
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

export function disposeGrassObstacleTexture(nodeId: string, texture: DataTexture): void {
  const runtime = runtimes.get(nodeId)
  if (runtime?.texture === texture) runtimes.delete(nodeId)
  texture.dispose()
}

function sameTopology(left: GrassObstacleField, right: GrassObstacleField): boolean {
  return (
    left.cols === right.cols &&
    left.rows === right.rows &&
    left.origin[0] === right.origin[0] &&
    left.origin[1] === right.origin[1] &&
    left.spacing === right.spacing
  )
}
