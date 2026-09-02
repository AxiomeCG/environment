export const SURFACE_MATERIAL_IDS = [
  'flowered-grass',
  'road-path',
  'desert-ground',
  'paved-road',
] as const

export type SurfaceMaterialId = (typeof SURFACE_MATERIAL_IDS)[number]

export const DEFAULT_SURFACE_MATERIAL: SurfaceMaterialId = 'flowered-grass'

export const SURFACE_MATERIAL_CHANNEL: Record<SurfaceMaterialId, 0 | 1 | 2 | 3> = {
  'flowered-grass': 0,
  'road-path': 1,
  'desert-ground': 2,
  'paved-road': 3,
}

export type SurfaceMaterialPaintColor = Readonly<{
  r: 0 | 255
  g: 0 | 255
  b: 0 | 255
}>

export const SURFACE_MATERIAL_PAINT_COLOR: Record<
  SurfaceMaterialId,
  SurfaceMaterialPaintColor
> = {
  'flowered-grass': { r: 255, g: 0, b: 0 },
  'road-path': { r: 0, g: 255, b: 0 },
  'desert-ground': { r: 0, g: 0, b: 255 },
  'paved-road': { r: 255, g: 255, b: 255 },
}

export const SURFACE_MATERIAL_AVERAGE_COLOR: Record<
  SurfaceMaterialId,
  readonly [r: number, g: number, b: number]
> = {
  'flowered-grass': [0.298, 0.353, 0.113],
  'road-path': [0.46, 0.375, 0.286],
  'desert-ground': [0.861, 0.759, 0.582],
  'paved-road': [0.476, 0.473, 0.46],
}
