import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import {
  abs,
  attribute,
  cameraPosition,
  dFdx,
  dFdy,
  float as tslFloat,
  floor,
  Fn,
  fract,
  hash,
  If,
  instanceIndex,
  materialColor,
  max,
  mix,
  normalGeometry,
  normalWorldGeometry,
  positionGeometry,
  positionWorld,
  smoothstep,
  step,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu'
import type { Node, NodeBuilder } from 'three/webgpu'
import {
  samplePresentationSurfaceAlbedos,
  stochasticSample,
  type PresentationAlbedos,
} from '../surface-material/materials'
import {
  SURFACE_MATERIAL_AVERAGE_COLOR,
  type SurfaceMaterialId,
} from '../surface-material/material-types'
import type { LandscapeRegion } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'
import { polygonCentroid } from './exterior-terrain'
import type { Point2 } from './frontages'
import { seededRange } from './seeded-random'
import {
  buildPropertySurfaceTransitionNodes,
  type PropertySurfaceTransition,
} from './property-surface'
import { SURROUNDINGS_NIGHT_FACTOR } from './night-lighting'

export type PresentationSurface = 'paint' | 'roof' | 'ground' | 'facade' | 'window-lit'

// A fixed, tiny texture set; neither a house palette nor a seed allocates a material.
const materials = new Map<PresentationSurface, MeshStandardNodeMaterial>()
const textures = new Map<PresentationSurface, DataTexture>()
const HAZE_COLOR = new Color('#b6c6ca')
const NIGHT_HAZE_COLOR = new Color('#091425')
const WINDOW_LIGHT_COLOR = new Color('#ffd99a')
const WINDOW_LIGHT_ALT_COLOR = new Color('#ffc274')

// Shaded output only: no extra pass and no changes to authored scene materials.
function withHaze(outputNode: Node): Node<'vec4'> {
  const distance = positionWorld.sub(cameraPosition).length()
  const haze = smoothstep(160, 720, distance).mul(mix(0.55, 0.36, SURROUNDINGS_NIGHT_FACTOR))
  const hazeColor = mix(
    vec3(HAZE_COLOR.r, HAZE_COLOR.g, HAZE_COLOR.b),
    vec3(NIGHT_HAZE_COLOR.r, NIGHT_HAZE_COLOR.g, NIGHT_HAZE_COLOR.b),
    SURROUNDINGS_NIGHT_FACTOR,
  )
  const shaded = outputNode as Node<'vec4'>
  return vec4(mix(shaded.rgb, hazeColor, haze), shaded.a)
}

export class PresentationMaterial extends MeshStandardNodeMaterial {
  setupOutput(builder: NodeBuilder, outputNode: Node): Node {
    return super.setupOutput(builder, builder.fogNode ? outputNode : withHaze(outputNode))
  }
}

export class PresentationPhysicalMaterial extends MeshPhysicalNodeMaterial {
  setupOutput(builder: NodeBuilder, outputNode: Node): Node {
    return super.setupOutput(builder, builder.fogNode ? outputNode : withHaze(outputNode))
  }
}

export class PresentationBasicMaterial extends MeshBasicNodeMaterial {
  setupOutput(builder: NodeBuilder, outputNode: Node): Node {
    return super.setupOutput(builder, builder.fogNode ? outputNode : withHaze(outputNode))
  }
}

export function getPresentationSurfaceTexture(surface: PresentationSurface): DataTexture {
  const cached = textures.get(surface)
  if (cached) return cached
  const size = 64
  const data = new Uint8Array(size * size * 4)
  let seed = 71237
  const noise = new ImprovedNoise()
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      let value = 222 + (seed >>> 28)
      if (surface === 'roof' && (y % 16 === 0 || (x + (Math.floor(y / 16) % 2) * 8) % 32 === 0))
        value -= 38
      if (surface === 'paint' && y % 16 === 0) value -= 17
      if (surface === 'ground') {
        const u = x / (size - 1),
          v = y / (size - 1)
        // Seamless low-frequency soil variation, reused at unrelated world scales.
        const n =
          noise.noise(u * 4, v * 4, 13) * (1 - u) * (1 - v) +
          noise.noise((u - 1) * 4, v * 4, 13) * u * (1 - v) +
          noise.noise(u * 4, (v - 1) * 4, 13) * (1 - u) * v +
          noise.noise((u - 1) * 4, (v - 1) * 4, 13) * u * v
        value = 168 + Math.round(n * 115) + (seed >>> 29)
      }
      const offset = (y * size + x) * 4
      data[offset] = data[offset + 1] = data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const map = new DataTexture(data, size, size, RGBAFormat)
  map.name = `surroundings-${surface}-detail`
  map.wrapS = map.wrapT = RepeatWrapping
  map.magFilter = LinearFilter
  map.minFilter = LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.needsUpdate = true
  textures.set(surface, map)
  return map
}

export function getPresentationMaterial(surface: PresentationSurface): MeshStandardNodeMaterial {
  const cached = materials.get(surface)
  if (cached) return cached
  const material = new PresentationMaterial({
    color: surface === 'ground' ? '#7f9268' : '#ffffff',
    roughness: 0.94,
    metalness: 0,
  })
  material.name = `surroundings-${surface}`
  const coordinates =
    surface === 'paint' || surface === 'facade' || surface === 'window-lit'
      ? vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).mul(0.65)
      : positionWorld.xz.mul(surface === 'roof' ? 0.42 : 0.12)
  const detailSurface = surface === 'facade' || surface === 'window-lit' ? 'paint' : surface
  const detail = texture(getPresentationSurfaceTexture(detailSurface), coordinates).r
  if (surface === 'ground') {
    const world = positionWorld.xz
    const rotated = vec2(
      world.x.mul(0.8).sub(world.y.mul(0.6)),
      world.x.mul(0.6).add(world.y.mul(0.8)),
    )
    const macro = texture(
      getPresentationSurfaceTexture('ground'),
      rotated.mul(0.007).add(vec2(0.37, 0.61)),
    ).r
    const broadTint = mix(vec3(0.86, 0.9, 0.76), vec3(1.07, 1.02, 0.88), macro)
    material.colorNode = (materialColor as unknown as Node<'vec3'>)
      .mul(broadTint)
      .mul(detail.mul(0.16).add(0.88))
  } else if (surface === 'facade') {
    // Window bays remain part of the opaque facade batch. Stable instance/cell
    // hashes light only a subset without adding geometry or material variants.
    const size = attribute<'vec3'>('facadeSize', 'vec3')
    const point = positionGeometry.add(0.5).mul(size)
    const horizontal = mix(point.x, point.z, step(0.5, abs(normalGeometry.x)))
    const column = floor(horizontal.div(3.6))
    const storey = floor(point.y.div(3.4))
    const u = fract(horizontal.div(3.6)),
      v = fract(point.y.div(3.4))
    const glazing = step(0.14, u)
      .mul(step(u, 0.86))
      .mul(step(0.22, v))
      .mul(step(v, 0.8))
      .mul(step(abs(normalGeometry.y), 0.5))
      .mul(step(0.3, point.y))
      .mul(step(point.y, size.y.sub(0.3)))
    const sectionSeed = tslFloat(instanceIndex).mul(191.37)
    const occupied = step(0.18, hash(sectionSeed.add(17.1)))
    const windowSeed = hash(sectionSeed.add(column.mul(37.7)).add(storey.mul(91.3)))
    const lit = glazing.mul(occupied).mul(step(0.47, windowSeed)).mul(SURROUNDINGS_NIGHT_FACTOR)
    const wall = (materialColor as unknown as Node<'vec3'>).mul(detail.mul(0.2).add(0.82))
    const warm = mix(
      vec3(WINDOW_LIGHT_COLOR.r, WINDOW_LIGHT_COLOR.g, WINDOW_LIGHT_COLOR.b),
      vec3(WINDOW_LIGHT_ALT_COLOR.r, WINDOW_LIGHT_ALT_COLOR.g, WINDOW_LIGHT_ALT_COLOR.b),
      step(0.5, hash(sectionSeed.add(column.mul(59.9)).add(storey.mul(13.7)).add(991.3))),
    )
    material.colorNode = mix(wall, vec3(0.15, 0.23, 0.26), glazing)
    material.roughnessNode = mix(0.94, 0.38, glazing)
    material.emissiveNode = warm.mul(lit).mul(2.6)
  } else if (surface === 'window-lit') {
    // At day this is the same dark, painted glazing as before; only the shared
    // night uniform changes roughness and emissive output.
    material.colorNode = (materialColor as unknown as Node<'vec3'>).mul(detail.mul(0.3).add(0.77))
    material.roughnessNode = mix(0.94, 0.42, SURROUNDINGS_NIGHT_FACTOR)
    material.emissiveNode = vec3(WINDOW_LIGHT_COLOR.r, WINDOW_LIGHT_COLOR.g, WINDOW_LIGHT_COLOR.b)
      .mul(SURROUNDINGS_NIGHT_FACTOR)
      .mul(2.8)
  } else {
    material.colorNode = (materialColor as unknown as Node<'vec3'>).mul(detail.mul(0.3).add(0.77))
  }
  materials.set(surface, material)
  return material
}

/** Share the ground's tiny noise map; no per-road texture, normal map or pass. */
export function applyRoadSurfaceDetail(material: PresentationMaterial): void {
  const map = getPresentationSurfaceTexture('ground')
  const aggregate = texture(map, positionWorld.xz.mul(0.83)).r
  const weathering = texture(
    map,
    vec2(positionWorld.x.add(positionWorld.z.mul(0.31)), positionWorld.z).mul(0.023),
  ).r
  material.colorNode = (materialColor as unknown as Node<'vec3'>)
    .mul(aggregate.mul(0.08).add(0.94))
    .mul(weathering.mul(0.14).add(0.91))
}

function averageSurfaceColor(material: SurfaceMaterialId): Node<'vec3'> {
  const source = SURFACE_MATERIAL_AVERAGE_COLOR[material]
  const color = new Color().setRGB(source[0], source[1], source[2], SRGBColorSpace)
  return vec3(color.r, color.g, color.b)
}

function tintFromWeights(weights: Node<'vec4'>): Node<'vec3'> {
  return averageSurfaceColor('flowered-grass')
    .mul(weights.r)
    .add(averageSurfaceColor('road-path').mul(weights.g))
    .add(averageSurfaceColor('desert-ground').mul(weights.b))
    .add(averageSurfaceColor('paved-road').mul(weights.a))
}

/** One terrain pass: reused albedos, slope/height biomes, and field coverage. */
export function createLandscapeGroundMaterial(
  region: LandscapeRegion,
  coverage: { texture: Texture; origin: readonly [number, number]; width: number; depth: number },
  albedos: PresentationAlbedos | null,
  boundary: readonly Point2[],
  seed: string,
  propertyTransition?: PropertySurfaceTransition,
): PresentationMaterial {
  const material = new PresentationMaterial({ roughness: 0.96 })
  const { palette } = region
  const tint = (hex: string) => {
    const color = new Color(hex)
    return vec3(color.r, color.g, color.b)
  }
  const world = positionWorld.xz
  // Rotate and offset the shared noise domain, not the texture resource.
  const angle = seededRange(seed, 'terrain-material:rotation', -Math.PI, Math.PI)
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const variation = vec2(
    world.x.mul(cos).sub(world.y.mul(sin)),
    world.x.mul(sin).add(world.y.mul(cos)),
  )
    .add(
      vec2(
        seededRange(seed, 'terrain-material:offset-x', -2048, 2048),
        seededRange(seed, 'terrain-material:offset-z', -2048, 2048),
      ),
    )
    .toVar()
  const center = polygonCentroid(boundary)
  let siteRadius = 0
  for (const point of boundary)
    siteRadius = Math.max(siteRadius, Math.hypot(point[0] - center[0], point[1] - center[1]))
  const nearDetail = smoothstep(
    siteRadius + 32,
    siteRadius + 96,
    world.sub(vec2(...center)).length(),
  ).oneMinus()
  // Reuse the Surface sampler: adjacent stochastic cells blend continuously,
  // with explicit gradients retaining stable mip selection across the offsets.
  const noise = getPresentationSurfaceTexture('ground')
  const detail = stochasticSample(noise, variation.mul(0.12)).r
  const macro = stochasticSample(noise, variation.mul(0.007)).r.mul(0.24).add(0.87)
  const grass = albedos
    ? stochasticSample(albedos.grass, variation.mul(0.5)).rgb
    : tint(palette.grass).mul(detail)
  const sand = albedos
    ? stochasticSample(albedos.sand, variation.mul(0.11)).rgb
    : tint(palette.sand).mul(detail)
  const soil = albedos
    ? stochasticSample(albedos.soil, variation.mul(0.5)).rgb
    : tint(palette.stone).mul(detail)
  // Only the high tail of the noise exposes soil; dry lawns stay grass-dominant.
  const patchScale = seededRange(seed, 'terrain-material:patch-scale', 0.02, 0.032)
  const earthPatches = smoothstep(0.7, 0.83, stochasticSample(noise, variation.mul(patchScale)).r)
    .mul(nearDetail)
    .mul(0.22)
  const ground = mix(
    mix(grass, soil, earthPatches),
    tint(palette.grass),
    mix(0.45, 0.12, nearDetail),
  )
  // Water sits four metres below the parcel. Keep sand on its low banks,
  // rather than tinting every zero-height neighborhood as a beach.
  const shore =
    region.coast || region.river
      ? smoothstep(SEA_LEVEL + 0.5, SEA_LEVEL + 2.5, positionWorld.y).oneMinus()
      : 0
  const rock = max(
    smoothstep(0.12, 0.42, abs(normalWorldGeometry.y).oneMinus()),
    smoothstep(45, 120, positionWorld.y).mul(0.65),
  )
  const field = texture(
    coverage.texture,
    world.sub(vec2(...coverage.origin)).div(vec2(coverage.width, coverage.depth)),
  )
  const wheat = tint('#bba152').mul(
    grass
      .dot(vec3(0.2126, 0.7152, 0.0722))
      .mul(0.8)
      .add(0.55),
  )
  const planting = mix(
    mix(mix(ground, wheat, field.r), ground.mul(0.88), field.g),
    ground.mul(0.94),
    field.b,
  )
  const biome = mix(
    mix(planting, mix(soil, tint(palette.stone), 0.55), rock),
    mix(sand, tint(palette.sand), 0.5),
    shore,
  )
  const regionalColor = biome.mul(macro)
  if (propertyTransition) {
    const edge = buildPropertySurfaceTransitionNodes(propertyTransition, world)
    material.colorNode = Fn(() => {
      // Derivatives must be evaluated outside the varying boundary/material branches.
      const dx = dFdx(world).toVar()
      const dy = dFdy(world).toVar()
      const color = regionalColor.toVar()
      If(edge.influence.mul(edge.coverage).greaterThan(0), () => {
        const paintedColor = albedos
          ? samplePresentationSurfaceAlbedos(albedos, edge.weights, world, edge.textureSize, [
              dx,
              dy,
            ])
          : tintFromWeights(edge.weights)
        const edgeColor = regionalColor.mul(edge.coverage.oneMinus()).add(paintedColor)
        color.assign(mix(regionalColor, edgeColor, edge.influence))
      })
      return color
    })()
  } else {
    material.colorNode = regionalColor
  }
  material.name = 'surroundings-regional-terrain'
  return material
}
