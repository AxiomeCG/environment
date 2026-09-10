import { MeshPhysicalMaterial, NoColorSpace, SRGBColorSpace, type BufferGeometry } from 'three'
import { attribute, float, positionGeometry, sRGBTransferOETF, vec3, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  MATERIAL_BAKE_TILE_SIZE,
  applyPlanarBakeUvs,
  bakeMaterialChannels,
  materialBakeBounds,
  planMaterialBakeSize,
  type MaterialBakeBounds,
} from './material-baker'
import { buildWaterMaterialNodes, type WaterMaterialOptions } from '../surroundings/water-material'

const WATER_BAKE_PHASE_SECONDS = 0
const WATER_BAKE_PIXELS_PER_METRE = 24

export type WaterMaterialBakeProfile = Readonly<{
  pixelsPerMetre?: number
}>

export type BakedWaterMaterial = Readonly<{
  material: MeshPhysicalMaterial
  bounds: MaterialBakeBounds
  width: number
  height: number
  backend: 'webgpu' | 'webgl2'
  pixelsPerMeter: number
  tileSize: number
  phaseSeconds: number
}>

export async function bakeWaterMaterial(
  geometry: BufferGeometry,
  options: WaterMaterialOptions,
  profile: WaterMaterialBakeProfile = {},
): Promise<BakedWaterMaterial> {
  if (!geometry.hasAttribute('waterDepth')) {
    throw new Error(`Water material ${options.name} cannot bake without waterDepth geometry data`)
  }
  if (options.shoreFade && !geometry.hasAttribute('shoreDistance')) {
    throw new Error(
      `Water material ${options.name} cannot bake without shoreDistance geometry data`,
    )
  }
  if (
    options.flow &&
    (!geometry.hasAttribute('waterFlow') || !geometry.hasAttribute('waterCourse'))
  ) {
    throw new Error(`Flowing water material ${options.name} cannot bake without flow geometry data`)
  }

  const bounds = materialBakeBounds(geometry)
  const size = planMaterialBakeSize(bounds, profile.pixelsPerMetre ?? WATER_BAKE_PIXELS_PER_METRE)
  const nodes = buildWaterMaterialNodes(options, {
    position: positionGeometry.xz,
    depth: attribute<'float'>('waterDepth', 'float'),
    shoreDistance: options.shoreFade ? attribute<'float'>('shoreDistance', 'float') : undefined,
    flow: options.flow
      ? {
          tangent: attribute<'vec2'>('waterFlow', 'vec2'),
          course: attribute<'vec2'>('waterCourse', 'vec2'),
        }
      : undefined,
    phase: float(WATER_BAKE_PHASE_SECONDS),
    far: float(0),
  })
  const tangentNormal = vec3(nodes.normal.x, nodes.normal.z, nodes.normal.y)
  const encodedColor = sRGBTransferOETF(nodes.color) as Node<'vec3'>
  const result = await bakeMaterialChannels({
    geometry,
    bounds,
    size,
    channels: [
      {
        name: `${options.name}-base-coverage`,
        colorSpace: SRGBColorSpace,
        outputNode: vec4(encodedColor, nodes.opacity ?? 1),
      },
      {
        name: `${options.name}-tangent-normal`,
        clearColor: [0.5, 0.5, 1],
        clearAlpha: 1,
        colorSpace: NoColorSpace,
        outputNode: vec4(tangentNormal.mul(0.5).add(0.5), 1),
      },
      {
        name: `${options.name}-roughness`,
        colorSpace: NoColorSpace,
        outputNode: vec4(1, nodes.roughness, 0, 1),
        clearColor: [1, 1, 0],
        clearAlpha: 1,
      },
    ],
  })
  const base = result.channels.get(`${options.name}-base-coverage`)
  const normal = result.channels.get(`${options.name}-tangent-normal`)
  const roughness = result.channels.get(`${options.name}-roughness`)
  if (!base || !normal || !roughness) {
    for (const channel of result.channels.values()) channel.texture.dispose()
    throw new Error(`Water material ${options.name} omitted a required baked channel`)
  }

  const baseTexture = base.texture
  const normalTexture = normal.texture
  const roughnessTexture = roughness.texture

  let material: MeshPhysicalMaterial
  try {
    applyPlanarBakeUvs(geometry, bounds)
    material = new MeshPhysicalMaterial({
      color: '#ffffff',
      depthWrite: !options.opacity,
      ior: 1.333,
      map: baseTexture,
      metalness: 0,
      normalMap: normalTexture,
      roughness: 1,
      roughnessMap: roughnessTexture,
      transparent: Boolean(options.opacity),
    })
    material.name = `${options.name}-baked`
  } catch (cause) {
    baseTexture.dispose()
    normalTexture.dispose()
    roughnessTexture.dispose()
    throw new Error(`Unable to create portable water material ${options.name}`, { cause })
  }
  material.addEventListener('dispose', () => {
    baseTexture.dispose()
    normalTexture.dispose()
    roughnessTexture.dispose()
  })
  return {
    material,
    bounds,
    width: result.width,
    height: result.height,
    backend: result.backend,
    pixelsPerMeter: size.pixelsPerMeter,
    phaseSeconds: WATER_BAKE_PHASE_SECONDS,
    tileSize: MATERIAL_BAKE_TILE_SIZE,
  }
}
