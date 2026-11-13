import {
  normalAt,
  surfaceHeightAt,
  terrainFieldOf,
  type AnyNode,
  type GeometryContext,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { DoubleSide, Group, Mesh, type Object3D } from 'three'
import { positionGeometry, step, texture, vec2 } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { buildGroundOwnerField, collectSiteNodes } from '../ground-cover/obstacle-adapter'
import { createGrassObstacleTopology } from '../ground-cover/obstacle-field'
import {
  createGrassObstacleTexture,
  disposeGrassObstacleTexture,
  getGrassObstacleRuntime,
  updateGrassObstacleTexture,
} from '../ground-cover/obstacle-texture'
import { siteBounds } from '../ground-cover/paint-field'
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
  // The sheet lies 5 mm over the whole lot: where another node owns the ground (a pool cut into
  // it, a paved slab, a house) it is not drawn, or it would lie over a pool's water as a lid.
  // Environment's own water is no owner here: a pond keeps the surface as its bed.
  const { field: owners, texture: ownerTexture } = createSurfaceOwnerMask(
    node,
    resolved.site,
    collectSiteNodes(resolved.site, context.resolve),
  )
  const ownerUv = positionGeometry.xz.sub(vec2(owners.origin[0], owners.origin[1])).div(
    vec2(
      Math.max((owners.cols - 1) * owners.spacing, owners.spacing),
      Math.max((owners.rows - 1) * owners.spacing, owners.spacing),
    ),
  )
  material.opacityNode = materialNodes.coverage.mul(step(0.5, texture(ownerTexture, ownerUv).a))
  material.addEventListener('dispose', () => {
    disposeSurfacePaintTexture(node.id, paintTexture)
    disposeGrassObstacleTexture(node.id, ownerTexture)
  })

  const mesh = new Mesh(geometry, material)
  mesh.name = SURFACE_MESH_NAME
  mesh.receiveShadow = true
  mesh.userData[SURFACE_TOPOLOGY_KEY] = terrainTopologyKey(resolved.terrain)
  group.add(mesh)
  return group
}

/** Where the surface is cut out for what owns the ground, as the texture its material samples. */
export function createSurfaceOwnerMask(
  node: { id: string },
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  const field = buildGroundOwnerField(
    site,
    nodes,
    createGrassObstacleTopology(siteBounds(site.polygon.points)),
  )
  return { field, texture: createGrassObstacleTexture(node.id, field) }
}

/**
 * Redraw where the mounted surface is cut out for what owns the ground, after a node was placed,
 * moved or removed. False when the surface is not mounted or the lot changed size: rebuild then.
 */
export function updateSurfaceMaterialObstacles(
  node: { id: string },
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const runtime = getGrassObstacleRuntime(node.id)
  if (!runtime) return false
  return updateGrassObstacleTexture(node.id, buildGroundOwnerField(site, nodes, runtime.field))
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
