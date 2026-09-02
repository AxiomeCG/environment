import {
  normalAt,
  surfaceHeightAt,
  terrainFieldOf,
  type GeometryContext,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { DoubleSide, Group, Mesh, type Object3D } from 'three'
import { positionGeometry } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { buildDrapedGroundGeometry } from '../ground-cover/terrain-drape'
import { resolveSurfaceMaterial } from './field-context'
import { buildSurfaceMaterialNodes } from './materials'
import type { SurfaceMaterialNode } from './schema'
import { createSurfacePaintTexture, disposeSurfacePaintTexture } from './texture'

const SURFACE_MESH_NAME = 'environment-surface-material'
const SURFACE_TOPOLOGY_KEY = 'surfaceTerrainTopology'

export function buildSurfaceMaterialGeometry(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): Group {
  const group = new Group()
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return group

  const paintTexture = createSurfacePaintTexture(node.id, resolved.field)
  const geometry = buildDrapedGroundGeometry(resolved.boundary, resolved.terrain)
  const materialNodes = buildSurfaceMaterialNodes(
    positionGeometry.xz,
    paintTexture,
    resolved.field,
    Number.isFinite(node.textureSize) ? node.textureSize : 100,
  )
  const material = new MeshStandardNodeMaterial({
    depthWrite: false,
    metalness: 0,
    roughness: 1,
    side: DoubleSide,
    transparent: true,
  })
  material.colorNode = materialNodes.color
  material.normalNode = materialNodes.normal
  material.roughnessNode = materialNodes.roughness
  material.aoNode = materialNodes.ao
  material.opacityNode = materialNodes.coverage
  material.addEventListener('dispose', () => {
    disposeSurfacePaintTexture(node.id, paintTexture)
  })

  const mesh = new Mesh(geometry, material)
  mesh.name = SURFACE_MESH_NAME
  mesh.receiveShadow = true
  mesh.userData[SURFACE_TOPOLOGY_KEY] = terrainTopologyKey(resolved.terrain)
  group.add(mesh)
  return group
}

export function updateSurfaceMaterialTerrain(root: Object3D, site: SiteNode): boolean {
  const mesh = root.getObjectByName(SURFACE_MESH_NAME)
  if (!(mesh instanceof Mesh)) return false
  const terrain = terrainFieldOf(site)
  const nextTopology = terrainTopologyKey(terrain)
  if (mesh.userData[SURFACE_TOPOLOGY_KEY] !== nextTopology) return false

  const positions = mesh.geometry.getAttribute('position')
  const normals = mesh.geometry.getAttribute('normal')
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    positions.setY(index, terrain ? surfaceHeightAt(terrain, x, z) + 0.005 : 0.005)
    const [nx, ny, nz] = terrain ? normalAt(terrain, x, z) : [0, 1, 0]
    normals.setXYZ(index, nx, ny, nz)
  }
  positions.needsUpdate = true
  normals.needsUpdate = true
  mesh.geometry.computeBoundingBox()
  mesh.geometry.computeBoundingSphere()
  return true
}

function terrainTopologyKey(terrain: TerrainField | null): string {
  return terrain
    ? `${terrain.origin[0]}:${terrain.origin[1]}:${terrain.spacing}:${terrain.cols}:${terrain.rows}`
    : 'flat'
}
