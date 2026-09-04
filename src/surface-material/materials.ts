import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three'
import * as TSL from 'three/tsl'
import type { Node } from 'three/webgpu'
import desertBaseColor from '../assets/surface-materials/desert-ground-basecolor.webp'
import desertNormal from '../assets/surface-materials/desert-ground-normal.webp'
import desertArm from '../assets/surface-materials/desert-ground-arm.webp'
import floweredGrassBaseColor from '../assets/surface-materials/flowered-grass-basecolor.webp'
import floweredGrassNormal from '../assets/surface-materials/flowered-grass-normal.webp'
import floweredGrassArm from '../assets/surface-materials/flowered-grass-arm.webp'
import roadBaseColor from '../assets/surface-materials/road-path-basecolor.webp'
import roadNormal from '../assets/surface-materials/road-path-normal.webp'
import roadArm from '../assets/surface-materials/road-path-arm.webp'
import pavedRoadBaseColor from '../assets/surface-materials/paved-road-basecolor.webp'
import pavedRoadNormal from '../assets/surface-materials/paved-road-normal.webp'
import pavedRoadArm from '../assets/surface-materials/paved-road-arm.webp'
import type { SurfaceMaterialId } from './material-types'

const {
  dFdx,
  dFdy,
  floor,
  fract,
  hash,
  max,
  mix,
  normalMap,
  smoothstep,
  texture,
  vec2,
  vec3,
} = TSL
const SURFACE_MATERIAL_WORLD_SCALE = 2
type TextureGradients = readonly [Node<'vec2'>, Node<'vec2'>]

export type SurfaceMaterialTextureSet = {
  baseColor: Texture
  normal: Texture
  arm: Texture
  worldScale: number
}

export type SurfaceMaterialNodes = {
  color: Node<'vec3'>
  ao: Node<'float'>
  normal: Node<'vec3'>
  roughness: Node<'float'>
  coverage: Node<'float'>
}

export type SurfaceUnderlayColorNodes = {
  color: Node<'vec3'>
  coverage: Node<'float'>
}

type SurfacePaintFieldTopology = {
  origin: readonly [number, number]
  spacing: number
  cols: number
  rows: number
}

type SurfaceBlendNodes = {
  grass: Node<'float'>
  road: Node<'float'>
  desert: Node<'float'>
  paved: Node<'float'>
  coverage: Node<'float'>
}

export const SURFACE_MATERIAL_PRESENTATION: ReadonlyArray<{
  id: SurfaceMaterialId
  label: string
  description: string
  preview: string
}> = [
  {
    id: 'flowered-grass',
    label: 'Flowered grass',
    description: 'Soft meadow turf with restrained wildflowers.',
    preview: assetUrl(floweredGrassBaseColor),
  },
  {
    id: 'road-path',
    label: 'Road path',
    description: 'Compacted earth and fine aggregate.',
    preview: assetUrl(roadBaseColor),
  },
  {
    id: 'desert-ground',
    label: 'Desert ground',
    description: 'Wind-shaped sand with sparse pebbles.',
    preview: assetUrl(desertBaseColor),
  },
  {
    id: 'paved-road',
    label: 'Paved road',
    description: 'Irregular weathered stone paving.',
    preview: assetUrl(pavedRoadBaseColor),
  },
]

let textureSets: Record<SurfaceMaterialId, SurfaceMaterialTextureSet> | null = null

export function getSurfaceMaterialTextureSets(): Record<
  SurfaceMaterialId,
  SurfaceMaterialTextureSet
> {
  if (textureSets) return textureSets
  const loader = new TextureLoader()
  textureSets = {
    'flowered-grass': loadSet(
      loader,
      floweredGrassBaseColor,
      floweredGrassNormal,
      floweredGrassArm,
    ),
    'road-path': loadSet(loader, roadBaseColor, roadNormal, roadArm),
    'desert-ground': loadSet(loader, desertBaseColor, desertNormal, desertArm),
    'paved-road': loadSet(loader, pavedRoadBaseColor, pavedRoadNormal, pavedRoadArm),
  }
  return textureSets
}

export type PresentationAlbedos = Readonly<{
  grass: Texture
  sand: Texture
  soil: Texture
  paved: Texture
}>
let presentationAlbedos: Promise<PresentationAlbedos> | null = null

/** Reuse bundled source art without loading twelve full-resolution PBR maps.
 * Four 512px albedos with mipmaps occupy approximately 5.3 MiB in RGBA8. */
export function loadPresentationAlbedos(): Promise<PresentationAlbedos> {
  if (presentationAlbedos) return presentationAlbedos
  const loader = new TextureLoader()
  presentationAlbedos = (async () => {
    const results = await Promise.allSettled(
      [
        floweredGrassBaseColor,
        desertBaseColor,
        roadBaseColor,
        pavedRoadBaseColor,
      ].map(async (asset) => {
        const loaded: Texture = await loader.loadAsync(assetUrl(asset))
        try {
          const image = loaded.image as HTMLImageElement
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 512 / Math.max(image.width, image.height))
          canvas.width = Math.round(image.width * scale)
          canvas.height = Math.round(image.height * scale)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Unable to resize surroundings albedo')
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          return configureTexture(new CanvasTexture(canvas), SRGBColorSpace)
        } finally { loaded.dispose() }
      }),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose()
      presentationAlbedos = null
      throw failure.reason
    }
    const textures = results.map((result) => (result as PromiseFulfilledResult<Texture>).value)
    return {
      grass: textures[0]!,
      sand: textures[1]!,
      soil: textures[2]!,
      paved: textures[3]!,
    }
  })()
  return presentationAlbedos
}

/** Samples the four authored surface albedos with their normal world scale and
 * the same stochastic tiling used by editable Surface materials. */
export function samplePresentationSurfaceAlbedos(
  albedos: PresentationAlbedos,
  weights: Node<'vec4'>,
  sitePosition: Node<'vec2'>,
  textureSize: number | Node<'float'>,
  gradients: TextureGradients,
): Node<'vec3'> {
  const scale = typeof textureSize === 'number'
    ? SURFACE_MATERIAL_WORLD_SCALE * (textureSize / 100)
    : textureSize.mul(SURFACE_MATERIAL_WORLD_SCALE / 100)
  const uv = sitePosition.div(scale)
  const scaledGradients: TextureGradients = [
    gradients[0].div(scale), gradients[1].div(scale),
  ]
  return TSL.Fn(() => {
    const color = vec3(0).toVar()
    TSL.If(weights.r.greaterThan(0), () => {
      color.addAssign(stochasticSample(albedos.grass, uv, uv, scaledGradients).rgb.mul(weights.r))
    })
    TSL.If(weights.g.greaterThan(0), () => {
      color.addAssign(stochasticSample(albedos.soil, uv, uv, scaledGradients).rgb.mul(weights.g))
    })
    TSL.If(weights.b.greaterThan(0), () => {
      color.addAssign(stochasticSample(albedos.sand, uv, uv, scaledGradients).rgb.mul(weights.b))
    })
    TSL.If(weights.a.greaterThan(0), () => {
      color.addAssign(stochasticSample(albedos.paved, uv, uv, scaledGradients).rgb.mul(weights.a))
    })
    return color
  })()
}

export function buildSurfaceMaterialNodes(
  sitePosition: Node<'vec2'>,
  blendTexture: Texture,
  field: SurfacePaintFieldTopology,
  textureSize: number,
): SurfaceMaterialNodes {
  const sets = getSurfaceMaterialTextureSets()
  const blend = buildSurfaceBlendNodes(sitePosition, blendTexture, field)
  const grassSet = sampleTextureSet(sets['flowered-grass'], sitePosition, textureSize)
  const roadSet = sampleTextureSet(sets['road-path'], sitePosition, textureSize)
  const desertSet = sampleTextureSet(sets['desert-ground'], sitePosition, textureSize)
  const pavedSet = sampleTextureSet(sets['paved-road'], sitePosition, textureSize)

  return {
    color: grassSet.color
      .mul(blend.grass)
      .add(roadSet.color.mul(blend.road))
      .add(desertSet.color.mul(blend.desert))
      .add(pavedSet.color.mul(blend.paved)),
    ao: grassSet.ao
      .mul(blend.grass)
      .add(roadSet.ao.mul(blend.road))
      .add(desertSet.ao.mul(blend.desert))
      .add(pavedSet.ao.mul(blend.paved)),
    // The source sets encode DirectX-style (-Y) tangent-space normals.
    normal: normalMap(
      grassSet.normal
        .mul(blend.grass)
        .add(roadSet.normal.mul(blend.road))
        .add(desertSet.normal.mul(blend.desert))
        .add(pavedSet.normal.mul(blend.paved)),
      vec2(0.55, -0.55),
    ) as unknown as Node<'vec3'>,
    roughness: grassSet.roughness
      .mul(blend.grass)
      .add(roadSet.roughness.mul(blend.road))
      .add(desertSet.roughness.mul(blend.desert))
      .add(pavedSet.roughness.mul(blend.paved)),
    coverage: blend.coverage,
  }
}

export function buildSurfaceUnderlayColorNodes(
  sitePosition: Node<'vec2'>,
  blendTexture: Texture,
  field: SurfacePaintFieldTopology,
  textureSize: number,
  derivativePosition: Node<'vec2'> = sitePosition,
): SurfaceUnderlayColorNodes {
  const sets = getSurfaceMaterialTextureSets()
  const blend = buildSurfaceBlendNodes(sitePosition, blendTexture, field)
  return {
    color: sampleBaseColor(
      sets['flowered-grass'],
      sitePosition,
      textureSize,
      derivativePosition,
    )
      .mul(blend.grass)
      .add(
        sampleBaseColor(
          sets['road-path'],
          sitePosition,
          textureSize,
          derivativePosition,
        ).mul(blend.road),
      )
      .add(
        sampleBaseColor(
          sets['desert-ground'],
          sitePosition,
          textureSize,
          derivativePosition,
        ).mul(blend.desert),
      )
      .add(
        sampleBaseColor(
          sets['paved-road'],
          sitePosition,
          textureSize,
          derivativePosition,
        ).mul(blend.paved),
      ),
    coverage: blend.coverage,
  }
}

function buildSurfaceBlendNodes(
  sitePosition: Node<'vec2'>,
  blendTexture: Texture,
  field: SurfacePaintFieldTopology,
): SurfaceBlendNodes {
  const blendSize = vec2(
    Math.max((field.cols - 1) * field.spacing, field.spacing),
    Math.max((field.rows - 1) * field.spacing, field.spacing),
  )
  const blendUv = sitePosition
    .sub(vec2(field.origin[0], field.origin[1]))
    .div(blendSize)
  const paint = texture(blendTexture, blendUv)
  const unpremultiplied = paint.rgb.div(max(paint.a, 1 / 255))
  const pavedWeight = max(
    unpremultiplied.dot(vec3(1)).sub(1).mul(0.5),
    0,
  )
  const grassWeight = max(unpremultiplied.r.sub(pavedWeight), 0)
  const roadWeight = max(unpremultiplied.g.sub(pavedWeight), 0)
  const desertWeight = max(unpremultiplied.b.sub(pavedWeight), 0)
  const weightTotal = max(
    grassWeight.add(roadWeight).add(desertWeight).add(pavedWeight),
    1 / 255,
  )
  return {
    grass: grassWeight.div(weightTotal),
    road: roadWeight.div(weightTotal),
    desert: desertWeight.div(weightTotal),
    paved: pavedWeight.div(weightTotal),
    coverage: paint.a,
  }
}

function sampleBaseColor(
  set: SurfaceMaterialTextureSet,
  sitePosition: Node<'vec2'>,
  textureSize: number,
  derivativePosition: Node<'vec2'> = sitePosition,
): Node<'vec3'> {
  return sampleBaseColorTexture(
    set.baseColor,
    set.worldScale,
    sitePosition,
    textureSize,
    derivativePosition,
  )
}

function sampleBaseColorTexture(
  map: Texture,
  worldScale: number,
  sitePosition: Node<'vec2'>,
  textureSize: number | Node<'float'>,
  derivativePosition: Node<'vec2'>,
): Node<'vec3'> {
  const scale = typeof textureSize === 'number'
    ? worldScale * (textureSize / 100)
    : textureSize.mul(worldScale / 100)
  const uv = sitePosition.div(scale)
  const derivativeUv = derivativePosition.div(scale)
  return stochasticSample(map, uv, derivativeUv).rgb
}

function sampleTextureSet(
  set: SurfaceMaterialTextureSet,
  sitePosition: Node<'vec2'>,
  textureSize: number,
): {
  color: Node<'vec3'>
  normal: Node<'vec3'>
  roughness: Node<'float'>
  ao: Node<'float'>
} {
  const uv = sitePosition.div(set.worldScale * (textureSize / 100))
  const arm = stochasticSample(set.arm, uv)
  return {
    color: sampleBaseColor(set, sitePosition, textureSize),
    normal: stochasticSample(set.normal, uv).rgb,
    roughness: arm.g,
    ao: arm.r,
  }
}

export function stochasticSample(
  map: Texture,
  uv: Node<'vec2'>,
  derivativeUv: Node<'vec2'> = uv,
  gradients?: TextureGradients,
): Node<'vec4'> {
  const cell = floor(uv)
  const local = fract(uv)
  const blend = (
    smoothstep as unknown as (min: number, max: number, value: Node<'vec2'>) => Node<'vec2'>
  )(0.2, 0.8, local)
  const dx = gradients?.[0] ?? dFdx(derivativeUv)
  const dy = gradients?.[1] ?? dFdy(derivativeUv)
  const topLeft = sampleCell(map, uv, cell, dx, dy)
  const topRight = sampleCell(map, uv, cell.add(vec2(1, 0)), dx, dy)
  const bottomLeft = sampleCell(map, uv, cell.add(vec2(0, 1)), dx, dy)
  const bottomRight = sampleCell(map, uv, cell.add(vec2(1, 1)), dx, dy)
  return mix(
    mix(topLeft, topRight, blend.x),
    mix(bottomLeft, bottomRight, blend.x),
    blend.y,
  ) as Node<'vec4'>
}

function sampleCell(
  map: Texture,
  uv: Node<'vec2'>,
  cell: Node<'vec2'>,
  gradientX: Node<'vec2'>,
  gradientY: Node<'vec2'>,
): Node<'vec4'> {
  // Float-to-uint conversion saturates negative cells to zero in WGSL.
  // Preserve their signed bits before mixing coordinates, in every quadrant.
  const seed = cell.x.toInt().toUint().mul(TSL.uint(73856093))
    .bitXor(cell.y.toInt().toUint().mul(TSL.uint(19349663)))
  const offset = vec2(hash(seed), hash(seed.bitXor(TSL.uint(0x9e3779b9))))
  const sampleUv = uv.sub(cell).add(offset)
  const sampleNode = texture(map, sampleUv) as Node<'vec4'> & {
    grad: (x: Node<'vec2'>, y: Node<'vec2'>) => Node<'vec4'>
  }
  return sampleNode.grad(gradientX, gradientY)
}

function loadSet(
  loader: TextureLoader,
  baseColorAsset: string | { src: string },
  normalAsset: string | { src: string },
  armAsset: string | { src: string },
): SurfaceMaterialTextureSet {
  return {
    baseColor: loadTexture(loader, baseColorAsset, SRGBColorSpace),
    normal: loadTexture(loader, normalAsset, NoColorSpace),
    arm: loadTexture(loader, armAsset, NoColorSpace),
    worldScale: SURFACE_MATERIAL_WORLD_SCALE,
  }
}

function loadTexture(
  loader: TextureLoader,
  asset: string | { src: string },
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
): Texture {
  return configureTexture(loader.load(assetUrl(asset)), colorSpace)
}

function configureTexture(
  loaded: Texture,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
): Texture {
  loaded.colorSpace = colorSpace
  loaded.wrapS = RepeatWrapping
  loaded.wrapT = RepeatWrapping
  loaded.magFilter = LinearFilter
  loaded.minFilter = LinearMipmapLinearFilter
  loaded.generateMipmaps = true
  return loaded
}

function assetUrl(asset: string | { src: string }): string {
  return typeof asset === 'string' ? asset : asset.src
}
