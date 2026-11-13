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
import { positionGeometry } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { collectGroundOpeningShapes, collectSiteNodes } from '../ground-cover/obstacle-adapter'
import { rasterizeObstacleCells } from '../ground-cover/obstacle-field'
import { buildDrapedGroundGeometry } from '../ground-cover/terrain-drape'
import { resolveSurfaceMaterial } from './field-context'
import { buildSurfaceMaterialNodes } from './materials'
import type { SurfaceMaterialNode } from './schema'
import type { SurfaceMaterialField } from './field'
import {
  createSurfacePaintTexture,
  disposeSurfacePaintTexture,
  getSurfaceSheetField,
  setSurfaceSheetCut,
} from './texture'

const SURFACE_MESH_NAME = 'environment-surface-material'
const SURFACE_TOPOLOGY_KEY = 'surfaceTerrainTopology'

export function buildSurfaceMaterialGeometry(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): Group {
  const group = new Group()
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return group

  // The sheet lies 5 mm over the whole lot: where another node opens the ground (a pool cut into
  // it) the sheet's own paint is cut out, or it would lie over the pool's water as a lid.
  setSurfaceSheetCut(
    node.id,
    surfaceSheetCut(resolved.field, resolved.site, collectSiteNodes(resolved.site, context.resolve)),
  )
  const paintTexture = createSurfacePaintTexture(node.id, resolved.field, true)
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

/**
 * The paint cells of the Surface's sheet that lie in a ground opening (one flag per cell), or null
 * when the lot has none. It is applied to the sheet's own paint texture, not sampled as one more
 * texture: the surface material already binds thirteen of the sixteen a fragment stage may sample
 * and the host's lighting takes the other three.
 */
export function surfaceSheetCut(
  field: Pick<SurfaceMaterialField, 'origin' | 'spacing' | 'cols' | 'rows'>,
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
): Uint8Array | null {
  const openings = collectGroundOpeningShapes(site, nodes)
  if (openings.length === 0) return null
  return rasterizeObstacleCells(field, openings)
}

/**
 * Redraw where the mounted sheet is cut out, after a node that opens the ground was placed, moved
 * or removed. False when the surface is not mounted: nothing to redraw.
 */
export function updateSurfaceSheetCut(
  node: { id: string },
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const field = getSurfaceSheetField(node.id)
  if (!field) return false
  setSurfaceSheetCut(node.id, surfaceSheetCut(field, site, nodes))
  return true
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
