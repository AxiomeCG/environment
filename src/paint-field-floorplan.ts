import { pointInPolygon2D, type FloorplanGeometry } from '@pascal-app/core'
import { buildSmoothMaskPath, prepareSmoothMask } from './ground-cover/mask-contour'
import { rgbaPngDataUrl } from './ground-cover/png'

const FLOORPLAN_MASK_SIDE = 256
const FLOORPLAN_FILL_OPACITY = 0.3

type Point2 = readonly [x: number, z: number]
type SchematicFieldSample = {
  red: number
  green: number
  blue: number
  coverage: number
}

type PaintFieldFloorplanOptions = Readonly<{
  boundary: readonly Point2[]
  bounds: Readonly<{
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }>
  boundaryStroke: string
  sampleAt: (x: number, z: number, output: SchematicFieldSample) => void
  acceptsAt?: (x: number, z: number) => boolean
}>

export function buildPaintFieldFloorplan({
  boundary,
  bounds,
  boundaryStroke,
  sampleAt,
  acceptsAt,
}: PaintFieldFloorplanOptions): FloorplanGeometry | null {
  if (boundary.length < 3) return null

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxZ - bounds.minZ
  if (width <= 0 || height <= 0) return null

  const mask = maskDimensions(bounds.minX, bounds.minZ, width, height)
  const sampleCount = mask.columns * mask.rows
  const alpha = new Float32Array(sampleCount)
  const colors = new Uint8Array(sampleCount * 3)
  let maximumAlpha = 0
  const sample: SchematicFieldSample = { red: 0, green: 0, blue: 0, coverage: 0 }

  for (let row = 0; row < mask.rows; row += 1) {
    const z = mask.origin[1] + row * mask.spacing
    for (let column = 0; column < mask.columns; column += 1) {
      const x = mask.origin[0] + column * mask.spacing
      const index = row * mask.columns + column
      sampleAt(x, z, sample)
      colors[index * 3] = Math.round(clamp01(sample.red) * 255)
      colors[index * 3 + 1] = Math.round(clamp01(sample.green) * 255)
      colors[index * 3 + 2] = Math.round(clamp01(sample.blue) * 255)

      if (!pointInPolygon2D([x, z], boundary as [number, number][])) continue
      if (acceptsAt && !acceptsAt(x, z)) continue
      const sampleAlpha = clamp01(sample.coverage)
      alpha[index] = sampleAlpha
      maximumAlpha = Math.max(maximumAlpha, sampleAlpha)
    }
  }

  const displayMask = new Float32Array(alpha)
  if (maximumAlpha > 0) {
    for (let index = 0; index < displayMask.length; index += 1) {
      displayMask[index] = (displayMask[index] ?? 0) / maximumAlpha
    }
  }

  const pathOptions = {
    columns: mask.columns,
    rows: mask.rows,
    origin: mask.origin,
    spacing: mask.spacing,
  }
  const contourPath = buildSmoothMaskPath({ values: displayMask, ...pathOptions })
  const children: FloorplanGeometry[] = []

  if (contourPath) {
    const smoothedAlpha = prepareSmoothMask(displayMask, mask.columns, mask.rows)
    const pixels = new Uint8Array(sampleCount * 4)
    for (let index = 0; index < sampleCount; index += 1) {
      pixels[index * 4] = colors[index * 3] ?? 0
      pixels[index * 4 + 1] = colors[index * 3 + 1] ?? 0
      pixels[index * 4 + 2] = colors[index * 3 + 2] ?? 0
      pixels[index * 4 + 3] = Math.round(
        clamp01((smoothedAlpha[index] ?? 0) * maximumAlpha * FLOORPLAN_FILL_OPACITY) * 255,
      )
    }
    children.push({
      kind: 'image',
      url: rgbaPngDataUrl(mask.columns, mask.rows, pixels),
      center: [
        mask.origin[0] + ((mask.columns - 1) * mask.spacing) / 2,
        mask.origin[1] + ((mask.rows - 1) * mask.spacing) / 2,
      ],
      width: mask.columns * mask.spacing,
      height: mask.rows * mask.spacing,
      preserveAspectRatio: 'none',
    })
    children.push({
      kind: 'path',
      d: contourPath,
      fill: '#000000',
      fillRule: 'evenodd',
      fillOpacity: 0,
      stroke: boundaryStroke,
      strokeWidth: 0.03,
      strokeDasharray: '0.18 0.12',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: 'all',
    } as unknown as FloorplanGeometry)
  } else {
    children.push({
      kind: 'polygon',
      points: boundary,
      fill: '#000000',
      fillOpacity: 0,
      stroke: boundaryStroke,
      strokeWidth: 0.03,
      strokeDasharray: '0.18 0.12',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: 'all',
    })
  }

  return { kind: 'group', children }
}

function maskDimensions(
  minX: number,
  minZ: number,
  width: number,
  height: number,
): {
  origin: Point2
  spacing: number
  columns: number
  rows: number
} {
  const spacing = Math.max(width, height) / FLOORPLAN_MASK_SIDE
  return {
    origin: [minX - spacing * 4, minZ - spacing * 4],
    spacing,
    columns: Math.ceil(width / spacing) + 9,
    rows: Math.ceil(height / spacing) + 9,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
