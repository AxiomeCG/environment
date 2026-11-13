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
  /** The Surface's own sheet, cut out where another node opens the ground. */
  sheet: boolean
}

const runtimes = new Map<string, Set<SurfacePaintRuntime>>()
/**
 * Per Surface: the paint cells where another node opens the ground (a pool cut into the lot).
 * The sheet's own texture holds no paint there, so the sheet is not drawn over the opening. It is
 * a cut in the data the material already samples, not one more texture: the surface material
 * binds twelve PBR maps and its paint, and the host's lighting takes the rest of the sixteen a
 * fragment stage may sample.
 */
const sheetCuts = new Map<string, Uint8Array>()

function cutSheet(nodeId: string, values: Uint8Array): void {
  const cut = sheetCuts.get(nodeId)
  if (!cut || cut.length * 4 !== values.length) return
  for (let cell = 0; cell < cut.length; cell += 1) {
    if (cut[cell]) values.fill(0, cell * 4, cell * 4 + 4)
  }
}

/**
 * Set where the Surface's own sheet is cut out (one flag per paint cell, or null for nowhere) and
 * redraw its mounted sheet textures from the paint they hold.
 */
export function setSurfaceSheetCut(nodeId: string, cut: Uint8Array | null): void {
  if (cut?.some((value) => value !== 0)) sheetCuts.set(nodeId, cut)
  else sheetCuts.delete(nodeId)
  for (const runtime of runtimes.get(nodeId) ?? []) {
    if (!runtime.sheet) continue
    const values = runtime.texture.image.data
    if (!(values instanceof Uint8Array) || values.length !== runtime.field.values.length) continue
    values.set(runtime.field.values)
    cutSheet(nodeId, values)
    runtime.texture.needsUpdate = true
  }
}

/** The paint lattice of a Surface's mounted sheet, or null when none is mounted. */
export function getSurfaceSheetField(nodeId: string): SurfaceMaterialField | null {
  for (const runtime of runtimes.get(nodeId) ?? []) if (runtime.sheet) return runtime.field
  return null
}

/** `sheet` marks the Surface's own draped sheet; the lawn's underlay reads the paint uncut. */
export function createSurfacePaintTexture(
  nodeId: string,
  field: SurfaceMaterialField,
  sheet = false,
): DataTexture {
  const values = new Uint8Array(field.values)
  if (sheet) cutSheet(nodeId, values)
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

  // The runtime keeps the paint as painted; only the sheet's texture carries the cut.
  const runtime = { field: sheet ? { ...field, values: new Uint8Array(field.values) } : { ...field, values }, texture, sheet }
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
    if (runtime.sheet) {
      runtime.field = { ...field, values: new Uint8Array(field.values) }
      cutSheet(nodeId, values)
    } else {
      runtime.field = { ...field, values }
    }
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
    if (entries.size === 0) {
      runtimes.delete(nodeId)
      sheetCuts.delete(nodeId)
    }
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
