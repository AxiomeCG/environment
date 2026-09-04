import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
} from 'three'
import { texture, uniform } from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import { paintAt } from '../ground-cover/paint-field'
import {
  writeSurfaceMaterialWeights,
  type SurfaceMaterialField,
} from '../surface-material/field'

const LOOKUP_SIZE = 256
const EXTERIOR_BLEND_WIDTH = 6
const BYTE_MAX = 255

type Point2 = readonly [number, number]
type NearestBoundaryPoint = { x: number; z: number; distance: number }

type PropertySurfaceRuntime = {
  readonly weights: Uint8Array
  readonly influence: Uint8Array
  readonly weightsTexture: DataTexture
  readonly influenceTexture: DataTexture
  readonly origin: UniformNode<'vec2', Vector2>
  readonly extent: UniformNode<'vec2', Vector2>
  readonly textureSize: UniformNode<'float', number>
  disposed: boolean
}

export type PropertySurfaceTransition = {
  update(
    boundary: readonly Point2[],
    field: SurfaceMaterialField | null,
    textureSize: number,
  ): void
  dispose(): void
}

export type PropertySurfaceTransitionNodes = {
  /** Premultiplied by paint coverage so filtering preserves painted/terrain blends. */
  readonly weights: Node<'vec4'>
  readonly coverage: Node<'float'>
  readonly influence: Node<'float'>
  readonly textureSize: Node<'float'>
}

const runtimes = new WeakMap<PropertySurfaceTransition, PropertySurfaceRuntime>()

export function createPropertySurfaceTransition(): PropertySurfaceTransition {
  const weights = new Uint8Array(LOOKUP_SIZE * LOOKUP_SIZE * 4)
  const influence = new Uint8Array(LOOKUP_SIZE * LOOKUP_SIZE * 2)
  const runtime: PropertySurfaceRuntime = {
    weights,
    influence,
    weightsTexture: createLookupTexture(
      weights,
      RGBAFormat,
      'property-surface-material-weights',
    ),
    influenceTexture: createLookupTexture(
      influence,
      RGFormat,
      'property-surface-influence',
    ),
    origin: uniform(new Vector2(0, 0)),
    extent: uniform(new Vector2(1, 1)),
    textureSize: uniform(100),
    disposed: false,
  }

  const transition: PropertySurfaceTransition = {
    update(boundary, field, textureSize) {
      if (runtime.disposed) throw new Error('Cannot update a disposed property surface transition')
      updateLookup(runtime, boundary, field)
      runtime.textureSize.value = Number.isFinite(textureSize) && textureSize > 0
        ? textureSize
        : 100
    },
    dispose() {
      if (runtime.disposed) return
      runtime.disposed = true
      runtime.weightsTexture.dispose()
      runtime.influenceTexture.dispose()
      runtimes.delete(transition)
    },
  }
  runtimes.set(transition, runtime)
  return transition
}

/** Builds the fixed shader inputs backed by a transition's reusable LUTs. */
export function buildPropertySurfaceTransitionNodes(
  transition: PropertySurfaceTransition,
  worldPosition: Node<'vec2'>,
): PropertySurfaceTransitionNodes {
  const runtime = runtimes.get(transition)
  if (!runtime || runtime.disposed) {
    throw new Error('Cannot sample a disposed property surface transition')
  }
  const uv = worldPosition.sub(runtime.origin).div(runtime.extent)
  const weights = texture(runtime.weightsTexture, uv) as Node<'vec4'>
  const transitionSample = texture(runtime.influenceTexture, uv)
  return {
    weights,
    coverage: transitionSample.g,
    influence: transitionSample.r,
    textureSize: runtime.textureSize,
  }
}

function createLookupTexture(
  data: Uint8Array,
  format: typeof RGBAFormat | typeof RGFormat,
  name: string,
): DataTexture {
  const lookup = new DataTexture(
    data,
    LOOKUP_SIZE,
    LOOKUP_SIZE,
    format,
    UnsignedByteType,
  )
  lookup.name = name
  lookup.colorSpace = NoColorSpace
  lookup.flipY = false
  lookup.generateMipmaps = false
  lookup.magFilter = LinearFilter
  lookup.minFilter = LinearFilter
  lookup.wrapS = ClampToEdgeWrapping
  lookup.wrapT = ClampToEdgeWrapping
  lookup.needsUpdate = true
  return lookup
}

function updateLookup(
  runtime: PropertySurfaceRuntime,
  boundary: readonly Point2[],
  field: SurfaceMaterialField | null,
): void {
  runtime.weights.fill(0)
  runtime.influence.fill(0)

  if (!field || !isUsableBoundary(boundary)) {
    runtime.origin.value.set(0, 0)
    runtime.extent.value.set(1, 1)
    markLookupsDirty(runtime)
    return
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of boundary) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  minX -= EXTERIOR_BLEND_WIDTH
  maxX += EXTERIOR_BLEND_WIDTH
  minZ -= EXTERIOR_BLEND_WIDTH
  maxZ += EXTERIOR_BLEND_WIDTH

  const width = Math.max(maxX - minX, Number.EPSILON)
  const depth = Math.max(maxZ - minZ, Number.EPSILON)
  runtime.origin.value.set(minX, minZ)
  runtime.extent.value.set(width, depth)

  const weights: [number, number, number, number] = [0, 0, 0, 0]
  const nearest: NearestBoundaryPoint = { x: 0, z: 0, distance: 0 }
  for (let row = 1; row < LOOKUP_SIZE - 1; row += 1) {
    const z = minZ + (row / (LOOKUP_SIZE - 1)) * depth
    for (let column = 1; column < LOOKUP_SIZE - 1; column += 1) {
      const x = minX + (column / (LOOKUP_SIZE - 1)) * width
      const inside = pointInPolygon(boundary, x, z)
      writeNearestBoundaryPoint(boundary, x, z, nearest)
      const distance = inside ? 0 : nearest.distance
      if (distance >= EXTERIOR_BLEND_WIDTH) continue
      const pixelIndex = row * LOOKUP_SIZE + column
      const weightsOffset = pixelIndex * 4
      const influenceOffset = pixelIndex * 2
      runtime.influence[influenceOffset] = Math.round(
        smoothstep(EXTERIOR_BLEND_WIDTH, 0, distance) * BYTE_MAX,
      )

      const paint = paintAt(field, nearest.x, nearest.z)
      if (paint.a <= Number.EPSILON) continue
      writeSurfaceMaterialWeights(paint, weights)
      const coverage = Math.min(1, paint.a)
      runtime.weights[weightsOffset] = Math.round(weights[0] * coverage * BYTE_MAX)
      runtime.weights[weightsOffset + 1] = Math.round(weights[1] * coverage * BYTE_MAX)
      runtime.weights[weightsOffset + 2] = Math.round(weights[2] * coverage * BYTE_MAX)
      runtime.weights[weightsOffset + 3] = Math.round(weights[3] * coverage * BYTE_MAX)
      runtime.influence[influenceOffset + 1] = Math.round(coverage * BYTE_MAX)
    }
  }
  markLookupsDirty(runtime)
}

function markLookupsDirty(runtime: PropertySurfaceRuntime): void {
  runtime.weightsTexture.needsUpdate = true
  runtime.influenceTexture.needsUpdate = true
}

function isUsableBoundary(boundary: readonly Point2[]): boolean {
  return boundary.length >= 3
    && boundary.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function writeNearestBoundaryPoint(
  boundary: readonly Point2[],
  x: number,
  z: number,
  output: NearestBoundaryPoint,
): void {
  let nearestX = boundary[0]![0]
  let nearestZ = boundary[0]![1]
  let squaredDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!
    const end = boundary[(index + 1) % boundary.length]!
    const edgeX = end[0] - start[0]
    const edgeZ = end[1] - start[1]
    const edgeLengthSquared = edgeX * edgeX + edgeZ * edgeZ
    const along = edgeLengthSquared > Number.EPSILON
      ? Math.max(0, Math.min(1, ((x - start[0]) * edgeX + (z - start[1]) * edgeZ) / edgeLengthSquared))
      : 0
    const candidateX = start[0] + edgeX * along
    const candidateZ = start[1] + edgeZ * along
    const deltaX = x - candidateX
    const deltaZ = z - candidateZ
    const candidateDistance = deltaX * deltaX + deltaZ * deltaZ
    if (candidateDistance >= squaredDistance) continue
    squaredDistance = candidateDistance
    nearestX = candidateX
    nearestZ = candidateZ
  }
  output.x = nearestX
  output.z = nearestZ
  output.distance = Math.sqrt(squaredDistance)
}

function pointInPolygon(boundary: readonly Point2[], x: number, z: number): boolean {
  let inside = false
  for (
    let currentIndex = 0, previousIndex = boundary.length - 1;
    currentIndex < boundary.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = boundary[currentIndex]!
    const previous = boundary[previousIndex]!
    if (
      (current[1] > z) !== (previous[1] > z)
      && x < (previous[0] - current[0]) * (z - current[1])
        / (previous[1] - current[1]) + current[0]
    ) inside = !inside
  }
  return inside
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return normalized * normalized * (3 - 2 * normalized)
}
