import type { GeometryContext } from '@pascal-app/core'
import {
  DoubleSide,
  Group,
  type Object3D,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  NoColorSpace,
  SRGBColorSpace,
  type BufferGeometry,
  type CanvasTexture,
} from 'three'
import { positionGeometry, sRGBTransferOETF, vec3, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  MATERIAL_BAKE_TILE_SIZE,
  applyPlanarBakeUvs,
  bakeMaterialChannels,
  materialBakeBounds,
  planMaterialBakeSize,
  type MaterialBakeBounds,
} from '../export/material-baker'
import { buildDrapedGroundGeometry } from '../ground-cover/terrain-drape'
import { resolveSurfaceMaterial, type ResolvedSurfaceMaterial } from './field-context'
import { buildSurfaceMaterialChannelNodes, loadSurfaceMaterialTextureSets } from './materials'
import type { SurfaceMaterialNode } from './schema'
import { createSurfacePaintTexture, disposeSurfacePaintTexture } from './texture'

const SURFACE_BAKE_PIXELS_PER_METRE = 32

export type BakedSurfaceMaterialMaps = Readonly<{
  base: CanvasTexture
  normal: CanvasTexture | null
  arm: CanvasTexture | null
  bounds: MaterialBakeBounds
  width: number
  height: number
  backend: 'webgpu' | 'webgl2'
  basePixels: Uint8ClampedArray
}>

export function buildSurfaceMaterialBakeGeometry(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): Object3D {
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return new Group()
  const geometry = buildDrapedGroundGeometry(resolved.boundary, resolved.terrain)
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: 1,
      side: DoubleSide,
    }),
  )
  mesh.name = 'Surface'
  mesh.receiveShadow = true
  return mesh
}

export async function buildSurfaceMaterialBakeGeometryAsync(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): Promise<Object3D> {
  const resolved = resolveSurfaceMaterial(node, context)
  if (!resolved) return new Group()
  const geometry = buildDrapedGroundGeometry(resolved.boundary, resolved.terrain)
  let maps: BakedSurfaceMaterialMaps
  try {
    maps = await bakeSurfaceMaterialMaps(node, resolved, geometry)
  } catch (cause) {
    geometry.dispose()
    throw new Error(`Unable to bake export materials for Surface ${String(node.id)}`, { cause })
  }
  const baseMap = maps.base
  const normalMap = maps.normal
  const armMap = maps.arm
  if (!normalMap || !armMap) {
    baseMap.dispose()
    normalMap?.dispose()
    armMap?.dispose()
    geometry.dispose()
    throw new Error(`Surface ${String(node.id)} material bake omitted a required PBR channel`)
  }
  let material: MeshStandardMaterial
  try {
    applyPlanarBakeUvs(geometry, maps.bounds)
    material = new MeshStandardMaterial({
      aoMap: armMap,
      color: '#ffffff',
      depthWrite: false,
      map: baseMap,
      metalness: 1,
      metalnessMap: armMap,
      normalMap,
      roughness: 1,
      roughnessMap: armMap,
      side: DoubleSide,
      transparent: true,
    })
    material.name = 'Surface baked PBR'
  } catch (cause) {
    baseMap.dispose()
    normalMap.dispose()
    armMap.dispose()
    geometry.dispose()
    throw new Error(`Unable to create portable Surface material ${String(node.id)}`, { cause })
  }
  material.addEventListener('dispose', () => {
    baseMap.dispose()
    normalMap.dispose()
    armMap.dispose()
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Surface'
  mesh.receiveShadow = true
  mesh.userData.materialBake = {
    backend: maps.backend,
    height: maps.height,
    pixelsPerMeter: SURFACE_BAKE_PIXELS_PER_METRE * (100 / finiteTextureSize(node.textureSize)),
    tileSize: MATERIAL_BAKE_TILE_SIZE,
    width: maps.width,
  }
  return mesh
}

export async function bakeSurfaceMaterialMaps(
  node: SurfaceMaterialNode,
  resolved: ResolvedSurfaceMaterial,
  geometry: BufferGeometry,
  channels: readonly ('base' | 'normal' | 'arm')[] = ['base', 'normal', 'arm'],
  samplePadding = 0,
): Promise<BakedSurfaceMaterialMaps> {
  const textureSize = finiteTextureSize(node.textureSize)
  const geometryBounds = materialBakeBounds(geometry)
  const pixelsPerMeter = SURFACE_BAKE_PIXELS_PER_METRE * (100 / textureSize)
  const rasterPadding = samplePadding > 0 ? samplePadding + 1 / pixelsPerMeter : 0
  const bounds = {
    minX: geometryBounds.minX - rasterPadding,
    minZ: geometryBounds.minZ - rasterPadding,
    maxX: geometryBounds.maxX + rasterPadding,
    maxZ: geometryBounds.maxZ + rasterPadding,
  }
  const size = planMaterialBakeSize(bounds, pixelsPerMeter)
  await loadSurfaceMaterialTextureSets()
  const rasterGeometry = new PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
  rasterGeometry.rotateX(-Math.PI * 0.5)
  rasterGeometry.translate((bounds.minX + bounds.maxX) * 0.5, 0, (bounds.minZ + bounds.maxZ) * 0.5)
  const paintTexture = createSurfacePaintTexture(String(node.id), resolved.field)
  try {
    const materialNodes = buildSurfaceMaterialChannelNodes(
      positionGeometry.xz,
      paintTexture,
      resolved.field,
      textureSize,
    )
    const tangentNormal = vec3(
      materialNodes.rawNormal.r.mul(2).sub(1).mul(0.55),
      materialNodes.rawNormal.g.mul(2).sub(1).mul(-0.55),
      materialNodes.rawNormal.b.mul(2).sub(1),
    ).normalize()
    const encodedColor = sRGBTransferOETF(materialNodes.color) as Node<'vec3'>
    const requested = channels.map((channel) => {
      if (channel === 'base') {
        return {
          name: 'surface-base-coverage',
          colorSpace: SRGBColorSpace,
          outputNode: vec4(encodedColor, materialNodes.coverage),
        }
      }
      if (channel === 'normal') {
        return {
          name: 'surface-tangent-normal',
          colorSpace: NoColorSpace,
          outputNode: vec4(tangentNormal.mul(0.5).add(0.5), 1),
          clearColor: [0.5, 0.5, 1] as const,
          clearAlpha: 1,
        }
      }
      return {
        name: 'surface-arm',
        colorSpace: NoColorSpace,
        outputNode: vec4(materialNodes.ao, materialNodes.roughness, 0, 1),
        clearColor: [1, 1, 0] as const,
        clearAlpha: 1,
      }
    })
    const result = await bakeMaterialChannels({
      geometry: rasterGeometry,
      bounds,
      size,
      channels: requested,
    })
    const base = result.channels.get('surface-base-coverage')
    if (!base) {
      for (const output of result.channels.values()) output.texture.dispose()
      throw new Error('Surface material bake did not produce its required base channel')
    }
    const normal = result.channels.get('surface-tangent-normal')
    const arm = result.channels.get('surface-arm')
    return {
      base: base.texture,
      normal: normal?.texture ?? null,
      arm: arm?.texture ?? null,
      bounds,
      width: result.width,
      height: result.height,
      backend: result.backend,
      basePixels: base.pixels,
    }
  } finally {
    disposeSurfacePaintTexture(String(node.id), paintTexture)
    rasterGeometry.dispose()
  }
}

function finiteTextureSize(value: number): number {
  return Number.isFinite(value) ? Math.max(25, Math.min(200, value)) : 100
}
