import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { paintAt, siteBounds } from '../ground-cover/paint-field'
import { buildPaintFieldFloorplan } from '../paint-field-floorplan'
import { resolveSurfaceMaterial } from './field-context'
import { writeSurfaceMaterialWeights } from './field'
import { SURFACE_MATERIAL_AVERAGE_COLOR } from './material-types'
import type { SurfaceMaterialNode } from './schema'

const FLOORPLAN_BOUNDARY_STROKE = '#b5a58d'

export function buildSurfaceMaterialFloorplan(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): FloorplanGeometry | null {
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return null

  const floweredGrass = SURFACE_MATERIAL_AVERAGE_COLOR['flowered-grass']
  const roadPath = SURFACE_MATERIAL_AVERAGE_COLOR['road-path']
  const desertGround = SURFACE_MATERIAL_AVERAGE_COLOR['desert-ground']
  const pavedRoad = SURFACE_MATERIAL_AVERAGE_COLOR['paved-road']
  const weights: [number, number, number, number] = [0, 0, 0, 0]

  return buildPaintFieldFloorplan({
    boundary: resolved.boundary,
    bounds: siteBounds(resolved.boundary),
    boundaryStroke: FLOORPLAN_BOUNDARY_STROKE,
    sampleAt: (x, z, output) => {
      const paint = paintAt(resolved.field, x, z)
      writeSurfaceMaterialWeights(paint, weights)
      output.red =
        floweredGrass[0] * weights[0] +
        roadPath[0] * weights[1] +
        desertGround[0] * weights[2] +
        pavedRoad[0] * weights[3]
      output.green =
        floweredGrass[1] * weights[0] +
        roadPath[1] * weights[1] +
        desertGround[1] * weights[2] +
        pavedRoad[1] * weights[3]
      output.blue =
        floweredGrass[2] * weights[0] +
        roadPath[2] * weights[1] +
        desertGround[2] * weights[2] +
        pavedRoad[2] * weights[3]
      output.coverage = paint.a
    },
  })
}
