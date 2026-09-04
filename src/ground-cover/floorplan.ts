import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildPaintFieldFloorplan } from '../paint-field-floorplan'
import { resolveGroundCoverFields } from './field-context'
import { sampleGrassObstacle } from './obstacle-field'
import { paintAt } from './paint-field'
import type { GrassFieldNode } from './schema'

const FLOORPLAN_BOUNDARY_STROKE = '#a8c995'

export function buildGrassFieldFloorplan(
  node: GrassFieldNode,
  context: GeometryContext,
): FloorplanGeometry | null {
  const fields = resolveGroundCoverFields(node, context)
  if (!fields) return null

  const density = clamp01((node.density ?? 100) / 100)
  return buildPaintFieldFloorplan({
    boundary: fields.boundary,
    bounds: fields.bounds,
    boundaryStroke: FLOORPLAN_BOUNDARY_STROKE,
    sampleAt: (x, z, output) => {
      const paint = paintAt(fields.paint, x, z)
      output.red = paint.r
      output.green = paint.g
      output.blue = paint.b
      output.coverage = paint.a * density
    },
    acceptsAt: (x, z) => sampleGrassObstacle(fields.obstacles, x, z).allowed >= 0.5,
  })
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
