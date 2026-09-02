import {
  pointInPolygon2D,
  type FloorplanGeometry,
  type GeometryContext,
} from '@pascal-app/core'
import { resolveGroundCoverFields } from './field-context'
import { sampleGrassObstacle } from './obstacle-field'
import { paintAt } from './paint-field'
import { buildSmoothMaskPath, prepareSmoothMask } from './mask-contour'
import { rgbaPngDataUrl } from './png'
import type { GrassFieldNode } from './schema'

const FLOORPLAN_MASK_SIDE = 256
const FLOORPLAN_BOUNDARY_STROKE = '#a8c995'

export function buildGrassFieldFloorplan(
  node: GrassFieldNode,
  context: GeometryContext,
): FloorplanGeometry | null {
  const fields = resolveGroundCoverFields(node, context)
  if (!fields || fields.boundary.length < 3) return null

  const width = fields.bounds.maxX - fields.bounds.minX
  const height = fields.bounds.maxZ - fields.bounds.minZ
  if (width <= 0 || height <= 0) return null

  const mask = maskDimensions(fields.bounds.minX, fields.bounds.minZ, width, height)
  const sampleCount = mask.columns * mask.rows
  const alpha = new Float32Array(sampleCount)
  const colors = new Uint8Array(sampleCount * 3)
  const density = clamp01((node.density ?? 100) / 100)
  let maximumAlpha = 0

  for (let row = 0; row < mask.rows; row += 1) {
    const z = mask.origin[1] + row * mask.spacing
    for (let column = 0; column < mask.columns; column += 1) {
      const x = mask.origin[0] + column * mask.spacing
      const index = row * mask.columns + column
      const paint = paintAt(fields.paint, x, z)
      colors[index * 3] = Math.round(paint.r * 255)
      colors[index * 3 + 1] = Math.round(paint.g * 255)
      colors[index * 3 + 2] = Math.round(paint.b * 255)

      if (!pointInPolygon2D([x, z], fields.boundary as [number, number][])) continue
      if (sampleGrassObstacle(fields.obstacles, x, z).allowed < 0.5) continue
      const sampleAlpha = clamp01(paint.a)
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
  const contourPath =
    density > 0
      ? buildSmoothMaskPath({ values: displayMask, ...pathOptions })
      : ''
  const children: FloorplanGeometry[] = []

  if (contourPath) {
    const smoothedAlpha = prepareSmoothMask(displayMask, mask.columns, mask.rows)
    const pixels = new Uint8Array(sampleCount * 4)
    for (let index = 0; index < sampleCount; index += 1) {
      pixels[index * 4] = colors[index * 3] ?? 0
      pixels[index * 4 + 1] = colors[index * 3 + 1] ?? 0
      pixels[index * 4 + 2] = colors[index * 3 + 2] ?? 0
      pixels[index * 4 + 3] = Math.round(
        clamp01((smoothedAlpha[index] ?? 0) * maximumAlpha * density * 0.3) * 255,
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
      stroke: FLOORPLAN_BOUNDARY_STROKE,
      strokeWidth: 0.03,
      strokeDasharray: '0.18 0.12',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: 'all',
    } as unknown as FloorplanGeometry)
  } else {
    children.push({
      kind: 'polygon',
      points: fields.boundary,
      fill: '#000000',
      fillOpacity: 0,
      stroke: FLOORPLAN_BOUNDARY_STROKE,
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
  origin: readonly [number, number]
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
