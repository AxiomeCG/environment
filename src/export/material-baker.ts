import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  type BufferGeometry,
  type ColorSpace,
} from 'three'
import type { Node } from 'three/webgpu'
import { Mesh, MeshBasicNodeMaterial, RenderTarget, WebGPURenderer } from 'three/webgpu'

export const MATERIAL_BAKE_TILE_SIZE = 512
export const MATERIAL_BAKE_MAX_EDGE = 2048
export const MATERIAL_BAKE_MAX_PIXELS = MATERIAL_BAKE_MAX_EDGE * MATERIAL_BAKE_MAX_EDGE

export type MaterialBakeBounds = Readonly<{
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}>

export type MaterialBakeSize = Readonly<{
  width: number
  height: number
  pixelsPerMeter: number
}>

export type MaterialBakeChannel = Readonly<{
  name: string
  colorSpace: ColorSpace
  outputNode: Node<'vec4'>
  clearColor?: readonly [number, number, number]
  clearAlpha?: number
}>

export type BakedMaterialChannel = Readonly<{
  name: string
  texture: CanvasTexture
  pixels: Uint8ClampedArray<ArrayBuffer>
}>

export type MaterialBakeResult = Readonly<{
  width: number
  height: number
  backend: 'webgpu' | 'webgl2'
  channels: ReadonlyMap<string, BakedMaterialChannel>
}>

export function materialBakeBounds(geometry: BufferGeometry): MaterialBakeBounds {
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) throw new Error('Material bake geometry has no finite bounds')
  const result = {
    minX: bounds.min.x,
    minZ: bounds.min.z,
    maxX: bounds.max.x,
    maxZ: bounds.max.z,
  }
  if (
    !Number.isFinite(result.minX) ||
    !Number.isFinite(result.minZ) ||
    !Number.isFinite(result.maxX) ||
    !Number.isFinite(result.maxZ) ||
    result.maxX <= result.minX ||
    result.maxZ <= result.minZ
  ) {
    throw new Error('Material bake geometry has empty or non-finite XZ bounds')
  }
  return result
}

export function planMaterialBakeSize(
  bounds: MaterialBakeBounds,
  pixelsPerMeter: number,
  options: Readonly<{ maxEdge?: number }> = {},
): MaterialBakeSize {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
    throw new Error('Material bake pixels-per-metre must be finite and positive')
  }
  const maxEdge = options.maxEdge ?? MATERIAL_BAKE_MAX_EDGE
  if (!Number.isSafeInteger(maxEdge) || maxEdge <= 0) {
    throw new Error('Material bake maximum edge must be a positive safe integer')
  }
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * pixelsPerMeter))
  const height = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) * pixelsPerMeter))
  if (width > maxEdge || height > maxEdge || width * height > maxEdge * maxEdge) {
    throw new Error(
      `Material bake requires ${width}x${height} pixels at ${pixelsPerMeter.toFixed(2)} px/m; ` +
        `the deterministic export limit is ${maxEdge}x${maxEdge}`,
    )
  }
  return { width, height, pixelsPerMeter }
}

export function applyPlanarBakeUvs(geometry: BufferGeometry, bounds: MaterialBakeBounds): void {
  const positions = geometry.getAttribute('position')
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxZ - bounds.minZ
  const uvs = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index += 1) {
    uvs[index * 2] = (positions.getX(index) - bounds.minX) / width
    uvs[index * 2 + 1] = (positions.getZ(index) - bounds.minZ) / height
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv1', new Float32BufferAttribute(uvs.slice(), 2))
}

export async function bakeMaterialChannels({
  geometry,
  bounds,
  size,
  channels,
}: {
  geometry: BufferGeometry
  bounds: MaterialBakeBounds
  size: MaterialBakeSize
  channels: readonly MaterialBakeChannel[]
}): Promise<MaterialBakeResult> {
  if (channels.length === 0) throw new Error('Material bake requires at least one output channel')
  const names = new Set<string>()
  for (const channel of channels) {
    if (names.has(channel.name)) throw new Error(`Duplicate material bake channel: ${channel.name}`)
    names.add(channel.name)
  }
  if (typeof document === 'undefined') {
    throw new Error('Material baking requires a browser document and GPU-backed canvas')
  }

  const canvas = document.createElement('canvas')
  canvas.width = MATERIAL_BAKE_TILE_SIZE
  canvas.height = MATERIAL_BAKE_TILE_SIZE
  const renderer = new WebGPURenderer({
    alpha: true,
    antialias: false,
    canvas,
    depth: false,
    stencil: false,
  })
  try {
    await renderer.init()
  } catch (cause) {
    renderer.dispose()
    throw new Error('Unable to initialize WebGPU or its WebGL2 fallback for material baking', {
      cause,
    })
  }

  const backend = renderer.backend as unknown as {
    device?: unknown
    isWebGPUBackend?: boolean
    isWebGLBackend?: boolean
    constructor?: { name?: string }
  }
  const backendName: MaterialBakeResult['backend'] =
    backend.device || backend.isWebGPUBackend || backend.constructor?.name === 'WebGPUBackend'
      ? 'webgpu'
      : backend.isWebGLBackend || backend.constructor?.name === 'WebGLBackend'
        ? 'webgl2'
        : (() => {
            renderer.dispose()
            throw new Error('Material baking initialized an unsupported renderer backend')
          })()

  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = NoToneMapping
  renderer.setSize(MATERIAL_BAKE_TILE_SIZE, MATERIAL_BAKE_TILE_SIZE, false)
  const target = new RenderTarget(1, 1, {
    depthBuffer: false,
    format: RGBAFormat,
    stencilBuffer: false,
    type: UnsignedByteType,
  })
  target.texture.colorSpace = NoColorSpace
  target.texture.generateMipmaps = false
  const material = new MeshBasicNodeMaterial({
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    transparent: false,
  })
  const mesh = new Mesh(geometry, material)
  const scene = new Scene()
  scene.add(mesh)

  const centerX = (bounds.minX + bounds.maxX) * 0.5
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5
  geometry.computeBoundingBox()
  const geometryBounds = geometry.boundingBox!
  const cameraHeight = geometryBounds.max.y + 1
  const cameraDepth = Math.max(2, geometryBounds.max.y - geometryBounds.min.y + 2)
  const camera = new OrthographicCamera(
    -(bounds.maxX - bounds.minX) * 0.5,
    (bounds.maxX - bounds.minX) * 0.5,
    (bounds.maxZ - bounds.minZ) * 0.5,
    -(bounds.maxZ - bounds.minZ) * 0.5,
    0.1,
    cameraDepth,
  )
  camera.position.set(centerX, cameraHeight, centerZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(centerX, geometryBounds.min.y - 1, centerZ)
  camera.updateMatrixWorld()

  const clearColor = new Color()
  const baked = new Map<string, BakedMaterialChannel>()
  try {
    for (const channel of channels) {
      const channelClear = channel.clearColor
      clearColor.setRGB(channelClear?.[0] ?? 0, channelClear?.[1] ?? 0, channelClear?.[2] ?? 0)
      renderer.setClearColor(clearColor, channel.clearAlpha ?? 0)
      material.outputNode = channel.outputNode
      material.needsUpdate = true
      const pixels = new Uint8ClampedArray(size.width * size.height * 4)
      for (let tileY = 0; tileY < size.height; tileY += MATERIAL_BAKE_TILE_SIZE) {
        const tileHeight = Math.min(MATERIAL_BAKE_TILE_SIZE, size.height - tileY)
        for (let tileX = 0; tileX < size.width; tileX += MATERIAL_BAKE_TILE_SIZE) {
          const tileWidth = Math.min(MATERIAL_BAKE_TILE_SIZE, size.width - tileX)
          target.setSize(tileWidth, tileHeight)
          camera.setViewOffset(size.width, size.height, tileX, tileY, tileWidth, tileHeight)
          renderer.setRenderTarget(target)
          renderer.clear()
          renderer.render(scene, camera)
          renderer.setRenderTarget(null)
          await Promise.resolve()
          const raw = (await renderer.readRenderTargetPixelsAsync(
            target,
            0,
            0,
            tileWidth,
            tileHeight,
          )) as Uint8Array<ArrayBuffer>
          const tile = normalizeMaterialReadback(raw, tileWidth, tileHeight, backendName)
          for (let row = 0; row < tileHeight; row += 1) {
            const sourceStart = row * tileWidth * 4
            const destinationStart = ((tileY + row) * size.width + tileX) * 4
            pixels.set(tile.subarray(sourceStart, sourceStart + tileWidth * 4), destinationStart)
          }
        }
      }
      camera.clearViewOffset()
      const texture = createEmbeddedCanvasTexture(
        pixels,
        size.width,
        size.height,
        channel.colorSpace,
        channel.name,
      )
      baked.set(channel.name, { name: channel.name, texture, pixels })
    }
  } catch (cause) {
    for (const channel of baked.values()) channel.texture.dispose()
    throw new Error('GPU material-channel bake failed', { cause })
  } finally {
    renderer.setRenderTarget(null)
    scene.remove(mesh)
    material.dispose()
    target.dispose()
    renderer.dispose()
  }

  return {
    width: size.width,
    height: size.height,
    backend: backendName,
    channels: baked,
  }
}

export function normalizeMaterialReadback(
  pixels: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  backend: MaterialBakeResult['backend'],
): Uint8ClampedArray<ArrayBuffer> {
  const bytesPerRow = width * 4
  const tightLength = bytesPerRow * height
  if (backend === 'webgpu') {
    if (pixels.byteLength === tightLength) {
      return new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, tightLength).slice()
    }
    const paddedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256
    const requiredBytes = paddedBytesPerRow * (height - 1) + bytesPerRow
    if (pixels.byteLength < requiredBytes) {
      throw new Error(
        `WebGPU material readback returned ${pixels.byteLength} bytes; expected at least ${requiredBytes}`,
      )
    }
    const tight = new Uint8ClampedArray(tightLength)
    for (let row = 0; row < height; row += 1) {
      tight.set(
        pixels.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + bytesPerRow),
        row * bytesPerRow,
      )
    }
    return tight
  }
  if (pixels.byteLength < tightLength) {
    throw new Error(
      `WebGL2 material readback returned ${pixels.byteLength} bytes; expected ${tightLength}`,
    )
  }
  const tight = new Uint8ClampedArray(tightLength)
  for (let row = 0; row < height; row += 1) {
    const sourceStart = (height - 1 - row) * bytesPerRow
    tight.set(pixels.subarray(sourceStart, sourceStart + bytesPerRow), row * bytesPerRow)
  }
  return tight
}

function createEmbeddedCanvasTexture(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  colorSpace: ColorSpace,
  name: string,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error(`Unable to create canvas for baked ${name} material channel`)
  context.putImageData(new ImageData(pixels, width, height), 0, 0)
  const texture = new CanvasTexture(canvas)
  texture.name = name
  texture.colorSpace = colorSpace
  texture.flipY = true
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
