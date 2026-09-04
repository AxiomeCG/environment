import {
  createGrassPaintField,
  createRgbaPaintFieldDataSchema,
  decodeGrassPaintField,
  encodeGrassPaintField,
  paintAt,
  type GrassPaintField,
  type GrassPaintSample,
  type SiteBounds,
} from '../ground-cover/paint-field'
import type { SurfaceMaterialId } from './material-types'
import { SURFACE_MATERIAL_CHANNEL } from './material-types'

export type SurfaceMaterialField = GrassPaintField
export type SurfaceMaterialWeights = readonly [
  grass: number,
  road: number,
  desert: number,
  paved: number,
]

const SURFACE_MATERIAL_FIELD_SPACING = 0.05

export const SurfaceMaterialFieldData = createRgbaPaintFieldDataSchema(
  'surface-material-field',
)
export type SurfaceMaterialFieldData = typeof SurfaceMaterialFieldData._output

export function createSurfaceMaterialField(bounds: SiteBounds): SurfaceMaterialField {
  return createGrassPaintField(bounds, '#000000', 0, SURFACE_MATERIAL_FIELD_SPACING)
}

export function encodeSurfaceMaterialField(
  field: SurfaceMaterialField,
): SurfaceMaterialFieldData {
  const encoded = encodeGrassPaintField(field)
  return SurfaceMaterialFieldData.parse({
    ...encoded,
    type: 'surface-material-field',
  })
}

export function decodeSurfaceMaterialField(data: unknown): SurfaceMaterialField | null {
  const parsed = SurfaceMaterialFieldData.safeParse(data)
  if (!parsed.success) return null
  return decodeGrassPaintField({ ...parsed.data, type: 'grass-paint-field' })
}

export function resolveSurfaceMaterialField(
  data: unknown,
  bounds: SiteBounds,
): SurfaceMaterialField {
  const existing = decodeSurfaceMaterialField(data)
  if (!existing) return createSurfaceMaterialField(bounds)

  const existingMaxX = existing.origin[0] + (existing.cols - 1) * existing.spacing
  const existingMaxZ = existing.origin[1] + (existing.rows - 1) * existing.spacing
  const minX = Math.min(existing.origin[0], bounds.minX, bounds.maxX)
  const maxX = Math.max(existingMaxX, bounds.minX, bounds.maxX)
  const minZ = Math.min(existing.origin[1], bounds.minZ, bounds.maxZ)
  const maxZ = Math.max(existingMaxZ, bounds.minZ, bounds.maxZ)
  const tolerance = existing.spacing * 1e-9
  if (
    existing.origin[0] <= minX + tolerance &&
    existingMaxX >= maxX - tolerance &&
    existing.origin[1] <= minZ + tolerance &&
    existingMaxZ >= maxZ - tolerance
  ) {
    return existing
  }

  const expanded = createSurfaceMaterialField({ minX, maxX, minZ, maxZ })
  for (let row = 0; row < expanded.rows; row += 1) {
    const z = expanded.origin[1] + row * expanded.spacing
    if (z < existing.origin[1] - tolerance || z > existingMaxZ + tolerance) continue
    for (let col = 0; col < expanded.cols; col += 1) {
      const x = expanded.origin[0] + col * expanded.spacing
      if (x < existing.origin[0] - tolerance || x > existingMaxX + tolerance) continue
      const sample = paintAt(existing, x, z)
      const index = (row * expanded.cols + col) * 4
      expanded.values[index] = Math.round(sample.r * 255)
      expanded.values[index + 1] = Math.round(sample.g * 255)
      expanded.values[index + 2] = Math.round(sample.b * 255)
      expanded.values[index + 3] = Math.round(sample.a * 255)
    }
  }
  return expanded
}


export function writeSurfaceMaterialWeights(
  sample: GrassPaintSample,
  output: [number, number, number, number],
): void {
  if (sample.a <= Number.EPSILON) {
    output[0] = 1
    output[1] = 0
    output[2] = 0
    output[3] = 0
    return
  }

  const red = sample.r / sample.a
  const green = sample.g / sample.a
  const blue = sample.b / sample.a
  const paved = (red + green + blue - 1) / 2
  const grass = Math.max(0, red - paved)
  const road = Math.max(0, green - paved)
  const desert = Math.max(0, blue - paved)
  const pavedRoad = Math.max(0, paved)
  const sum = grass + road + desert + pavedRoad
  if (sum <= Number.EPSILON) {
    output[0] = 1
    output[1] = 0
    output[2] = 0
    output[3] = 0
    return
  }

  output[0] = grass / sum
  output[1] = road / sum
  output[2] = desert / sum
  output[3] = pavedRoad / sum
}

export function surfaceMaterialWeightsAt(
  field: SurfaceMaterialField,
  x: number,
  z: number,
): SurfaceMaterialWeights {
  const weights: [number, number, number, number] = [0, 0, 0, 0]
  writeSurfaceMaterialWeights(paintAt(field, x, z), weights)
  return weights
}

export function surfaceMaterialTarget(
  material: SurfaceMaterialId,
): SurfaceMaterialWeights {
  const weights: [number, number, number, number] = [0, 0, 0, 0]
  weights[SURFACE_MATERIAL_CHANNEL[material]] = 1
  return weights
}
