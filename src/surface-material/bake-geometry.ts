import type { GeometryContext } from '@pascal-app/core'
import {
  Color,
  Float32BufferAttribute,
  Group,
  type Object3D,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three'
import { buildDrapedGroundGeometry } from '../ground-cover/terrain-drape'
import { resolveSurfaceMaterial } from './field-context'
import { surfaceMaterialWeightsAt } from './field'
import { SURFACE_MATERIAL_AVERAGE_COLOR } from './material-types'
import type { SurfaceMaterialNode } from './schema'

export function buildSurfaceMaterialBakeGeometry(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): Object3D {
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return new Group()

  const geometry = buildDrapedGroundGeometry(resolved.boundary, resolved.terrain)
  const positions = geometry.getAttribute('position')
  const colors: number[] = []
  const floweredGrass = SURFACE_MATERIAL_AVERAGE_COLOR['flowered-grass']
  const road = SURFACE_MATERIAL_AVERAGE_COLOR['road-path']
  const desert = SURFACE_MATERIAL_AVERAGE_COLOR['desert-ground']
  const paved = SURFACE_MATERIAL_AVERAGE_COLOR['paved-road']
  const color = new Color()

  for (let index = 0; index < positions.count; index += 1) {
    const weights = surfaceMaterialWeightsAt(
      resolved.field,
      positions.getX(index),
      positions.getZ(index),
    )
    color.setRGB(
      floweredGrass[0] * weights[0] +
        road[0] * weights[1] +
        desert[0] * weights[2] +
        paved[0] * weights[3],
      floweredGrass[1] * weights[0] +
        road[1] * weights[1] +
        desert[1] * weights[2] +
        paved[1] * weights[3],
      floweredGrass[2] * weights[0] +
        road[2] * weights[1] +
        desert[2] * weights[2] +
        paved[2] * weights[3],
      SRGBColorSpace,
    )
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))

  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: 0.88,
      vertexColors: true,
    }),
  )
  mesh.name = 'Surface'
  mesh.receiveShadow = true
  return mesh
}
