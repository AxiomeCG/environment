import { surfaceHeightAt, type HeightPatch, type TerrainField } from '@pascal-app/core'
import {
  Box3,
  BufferGeometry,
  Camera,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  type Object3D,
  Matrix4,
  Sphere,
  Vector3,
} from 'three'
import type { SiteBounds } from '../paint-field'
import { visitGrassCandidates, type GrassBladeDimensions, type GrassCandidateVisitor } from '../scatter'
import { queueTerrainAttributeUpdate, terrainPatchBounds } from '../terrain-patch'
import { buildBladeGeometry } from './blade-geometry'

export const GRASS_TILE_SIZE = 8
export const GRASS_LOD_FULL_PIXELS = 12
export const GRASS_LOD_MID_PIXELS = 4
export const GRASS_LOD_FULL_INSTANCE_RATIO = 1
export const GRASS_LOD_MID_INSTANCE_RATIO = 0.5
export const GRASS_LOD_FAR_INSTANCE_RATIO = 0.25

const FULL_LOD_ENTER_PIXELS = GRASS_LOD_FULL_PIXELS * (7 / 6)
const FULL_LOD_EXIT_PIXELS = GRASS_LOD_FULL_PIXELS * (5 / 6)
const MID_LOD_ENTER_PIXELS = GRASS_LOD_MID_PIXELS * 1.25
const MID_LOD_EXIT_PIXELS = GRASS_LOD_MID_PIXELS * 0.75
const CANDIDATE_STRIDE = 8
const MAX_OBSTACLE_BEND_STRENGTH = 2
const runtimes = new WeakMap<Object3D, InternalGrassTilesRuntime>()

export type GrassTileOptions = {
  /** Replays the same bounded population on each call; no per-frame sampling. */
  candidates?: (visitor: GrassCandidateVisitor) => void
  tileSize?: number
  maxHeightScale?: number
  maxObstacleBendStrength?: number
}

export type GrassTileLod = 'full' | 'mid' | 'far'

export type GrassTileAttributes = {
  readonly root: InstancedBufferAttribute
  readonly densityThreshold: InstancedBufferAttribute
  readonly tintVariation: InstancedBufferAttribute
  readonly surfaceSampleBasis: InstancedBufferAttribute
}

export type GrassTileRuntime = {
  readonly tileX: number
  readonly tileZ: number
  readonly candidateCount: number
  readonly fullCount: number
  readonly midCount: number
  readonly farCount: number
  readonly full: InstancedMesh
  readonly mid: InstancedMesh
  readonly far: InstancedMesh
  readonly attributes: GrassTileAttributes
  readonly bounds: Box3
  readonly sphere: Sphere
  lod: GrassTileLod | null
  projectedBladePixels: number
}

export type GrassTilesRuntime = {
  readonly tiles: readonly GrassTileRuntime[]
  readonly maxBladeHeight: number
  readonly radialPadding: number
}

type TileBuildData = {
  readonly tileX: number
  readonly tileZ: number
  readonly values: Float32Array
  readonly ranks: Uint32Array
  offset: number
}

type InternalGrassTileRuntime = GrassTileRuntime & {
  readonly group: Group
  readonly rootBounds: Box3
}

type InternalGrassTilesRuntime = GrassTilesRuntime & {
  readonly tiles: readonly InternalGrassTileRuntime[]
  readonly scratchCenter: Vector3
}

export function getGrassTilesRuntime(group: Object3D): GrassTilesRuntime | null {
  return getInternalRuntime(group)
}

export function visitGrassTiles(
  group: Object3D,
  visitor: (tile: GrassTileRuntime) => void,
): boolean {
  const runtime = getInternalRuntime(group)
  if (!runtime) return false
  for (const tile of runtime.tiles) visitor(tile)
  return true
}

export function visitGrassTileMeshes(
  group: Object3D,
  visitor: (mesh: InstancedMesh, tile: GrassTileRuntime, lod: GrassTileLod) => void,
): boolean {
  return visitGrassTiles(group, (tile) => {
    visitor(tile.full, tile, 'full')
    visitor(tile.mid, tile, 'mid')
    visitor(tile.far, tile, 'far')
  })
}

export function createGrassTiles(
  node: GrassBladeDimensions,
  boundary: ReadonlyArray<readonly [number, number]>,
  bounds: SiteBounds,
  terrain: TerrainField | null,
  material: Material,
  options: GrassTileOptions = {},
): Group {
  const group = new Group()
  group.name = 'grass-field-tiles'
  const grid = createTileGrid(bounds, options.tileSize ?? GRASS_TILE_SIZE)
  const counts = new Uint32Array(grid.columns * grid.rows)
  const visit = options.candidates ?? ((visitor: GrassCandidateVisitor) =>
    visitGrassCandidates(node, boundary, bounds, terrain, visitor))

  visit((x, _y, z) => {
    const index = tileIndexAt(grid, x, z)
    counts[index] = counts[index]! + 1
  })

  const buildDataByGridIndex: Array<TileBuildData | undefined> = new Array(counts.length)
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index]!
    if (count === 0) continue
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    buildDataByGridIndex[index] = {
      tileX: grid.minTileX + column,
      tileZ: grid.minTileZ + row,
      values: new Float32Array(count * CANDIDATE_STRIDE),
      ranks: new Uint32Array(count),
      offset: 0,
    }
  }

  let candidateOrdinal = 0
  visit(
    (x, y, z, yaw, widthFactor, heightFactor, densityThreshold, tint) => {
      const data = buildDataByGridIndex[tileIndexAt(grid, x, z)]
      if (!data) return
      const index = data.offset
      const offset = index * CANDIDATE_STRIDE
      data.values[offset] = x
      data.values[offset + 1] = y
      data.values[offset + 2] = z
      data.values[offset + 3] = yaw
      data.values[offset + 4] = widthFactor
      data.values[offset + 5] = heightFactor
      data.values[offset + 6] = densityThreshold
      data.values[offset + 7] = tint
      data.ranks[index] = permuteUint32(candidateOrdinal)
      data.offset += 1
      candidateOrdinal += 1
    },
  )

  const heightVariation = (node.bladeHeightVariation ?? 20) / 100
  const widthVariation = (node.bladeWidthVariation ?? 20) / 100
  const maxBladeHeight = node.bladeHeight * (1 + heightVariation) * (options.maxHeightScale ?? 2)
  const maxHalfWidth = node.bladeWidth * (1 + widthVariation) * 0.625
  const radialPadding =
    maxBladeHeight + maxHalfWidth + (options.maxObstacleBendStrength ?? MAX_OBSTACLE_BEND_STRENGTH)
  const tiles: InternalGrassTileRuntime[] = []

  for (const data of buildDataByGridIndex) {
    if (!data) continue
    sortCandidatesByRank(data.values, data.ranks)
    const tile = buildTile(
      node,
      data,
      material,
      maxBladeHeight,
      radialPadding,
    )
    tiles.push(tile)
    group.add(tile.group)
  }

  const runtime: InternalGrassTilesRuntime = {
    tiles,
    maxBladeHeight,
    radialPadding,
    scratchCenter: new Vector3(),
  }
  runtimes.set(group, runtime)
  return group
}

export function updateGrassTileTerrain(
  group: Object3D,
  terrain: TerrainField | null,
  patch?: HeightPatch,
): boolean {
  const runtime = getInternalRuntime(group)
  if (!runtime) return false
  const patchBounds = terrain && patch ? terrainPatchBounds(terrain, patch) : null
  if (patch && !patchBounds) return true

  for (const tile of runtime.tiles) {
    const { rootBounds } = tile
    if (patchBounds && (
      rootBounds.max.x < patchBounds.minX || rootBounds.min.x > patchBounds.maxX ||
      rootBounds.max.z < patchBounds.minZ || rootBounds.min.z > patchBounds.maxZ
    )) continue

    const roots = tile.attributes.root.array as Float32Array
    const matrices = tile.full.instanceMatrix.array as Float32Array
    let minY = patchBounds ? rootBounds.min.y : Infinity
    let maxY = patchBounds ? rootBounds.max.y : -Infinity
    let firstRoot = Infinity
    let lastRoot = -1
    let firstMatrix = Infinity
    let lastMatrix = -1

    for (let index = 0; index < tile.candidateCount; index += 1) {
      const rootOffset = index * 3
      const x = roots[rootOffset]!
      const z = roots[rootOffset + 2]!
      if (patchBounds && (
        x < patchBounds.minX || x > patchBounds.maxX ||
        z < patchBounds.minZ || z > patchBounds.maxZ
      )) continue

      const y = terrain ? Math.fround(surfaceHeightAt(terrain, x, z)) : 0
      if (roots[rootOffset + 1] !== y) {
        roots[rootOffset + 1] = y
        firstRoot = Math.min(firstRoot, rootOffset + 1)
        lastRoot = rootOffset + 1
      }
      const matrixOffset = index * 16 + 13
      if (matrices[matrixOffset] !== y) {
        matrices[matrixOffset] = y
        firstMatrix = Math.min(firstMatrix, matrixOffset)
        lastMatrix = matrixOffset
      }
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }

    if (firstRoot <= lastRoot) {
      queueTerrainAttributeUpdate(tile.attributes.root, firstRoot, lastRoot - firstRoot + 1)
    }
    if (firstMatrix <= lastMatrix) {
      queueTerrainAttributeUpdate(tile.full.instanceMatrix, firstMatrix, lastMatrix - firstMatrix + 1)
    }
    if (patchBounds && firstRoot > lastRoot && firstMatrix > lastMatrix) continue

    rootBounds.min.y = minY
    rootBounds.max.y = maxY
    updateTileBounds(tile, runtime.maxBladeHeight, runtime.radialPadding)
  }

  return true
}

export function updateGrassTileLod(
  group: Object3D,
  camera: Camera,
  viewportHeight: number,
): void {
  const runtime = getInternalRuntime(group)
  if (!runtime) return

  camera.updateWorldMatrix(true, false)
  group.updateWorldMatrix(true, true)
  const projectionScale = Math.abs(camera.projectionMatrix.elements[5])
  const isOrthographic = (camera as Camera & { isOrthographicCamera?: boolean })
    .isOrthographicCamera === true
  const validViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0

  for (const tile of runtime.tiles) {
    const center = runtime.scratchCenter
      .copy(tile.sphere.center)
      .applyMatrix4(tile.full.matrixWorld)
      .applyMatrix4(camera.matrixWorldInverse)
    const worldScale = tile.full.matrixWorld.getMaxScaleOnAxis()
    const worldBladeHeight = runtime.maxBladeHeight * worldScale
    const worldRadius = tile.sphere.radius * worldScale
    const depth = Math.max(1e-4, -center.z - worldRadius)
    const pixels =
      worldBladeHeight *
      projectionScale *
      validViewportHeight *
      0.5 *
      (isOrthographic ? 1 : 1 / depth)
    tile.projectedBladePixels = pixels
    applyTileLod(tile, chooseLod(tile.lod, pixels))
  }
}

function getInternalRuntime(group: Object3D): InternalGrassTilesRuntime | null {
  const tiles = runtimes.get(group) ?? runtimes.get(group.getObjectByName('grass-field-tiles') ?? group)
  return tiles ?? null
}

type TileGrid = {
  readonly minTileX: number
  readonly minTileZ: number
  readonly columns: number
  readonly rows: number
  readonly tileSize: number
}

function createTileGrid(bounds: SiteBounds, tileSize: number): TileGrid {
  const minTileX = Math.floor(bounds.minX / tileSize)
  const minTileZ = Math.floor(bounds.minZ / tileSize)
  const maxTileX = Math.ceil(bounds.maxX / tileSize)
  const maxTileZ = Math.ceil(bounds.maxZ / tileSize)
  return {
    minTileX,
    minTileZ,
    tileSize,
    columns: Math.max(0, maxTileX - minTileX),
    rows: Math.max(0, maxTileZ - minTileZ),
  }
}

function tileIndexAt(
  grid: TileGrid,
  x: number,
  z: number,
): number {
  const column = Math.min(
    grid.columns - 1,
    Math.max(0, Math.floor(x / grid.tileSize) - grid.minTileX),
  )
  const row = Math.min(
    grid.rows - 1,
    Math.max(0, Math.floor(z / grid.tileSize) - grid.minTileZ),
  )
  return row * grid.columns + column
}

function permuteUint32(value: number): number {
  let result = value >>> 0
  result ^= result >>> 16
  result = Math.imul(result, 0x7feb352d)
  result ^= result >>> 15
  result = Math.imul(result, 0x846ca68b)
  result ^= result >>> 16
  return result >>> 0
}

function sortCandidatesByRank(values: Float32Array, ranks: Uint32Array): void {
  const count = ranks.length
  for (let start = Math.floor(count / 2) - 1; start >= 0; start -= 1) {
    siftDown(values, ranks, start, count)
  }
  for (let end = count - 1; end > 0; end -= 1) {
    swapCandidates(values, ranks, 0, end)
    siftDown(values, ranks, 0, end)
  }
}

function siftDown(
  values: Float32Array,
  ranks: Uint32Array,
  start: number,
  end: number,
): void {
  let root = start
  while (root * 2 + 1 < end) {
    let child = root * 2 + 1
    if (child + 1 < end && ranks[child]! < ranks[child + 1]!) child += 1
    if (ranks[root]! >= ranks[child]!) return
    swapCandidates(values, ranks, root, child)
    root = child
  }
}

function swapCandidates(
  values: Float32Array,
  ranks: Uint32Array,
  first: number,
  second: number,
): void {
  const rank = ranks[first]!
  ranks[first] = ranks[second]!
  ranks[second] = rank
  const firstOffset = first * CANDIDATE_STRIDE
  const secondOffset = second * CANDIDATE_STRIDE
  for (let component = 0; component < CANDIDATE_STRIDE; component += 1) {
    const value = values[firstOffset + component]!
    values[firstOffset + component] = values[secondOffset + component]!
    values[secondOffset + component] = value
  }
}

function buildTile(
  node: GrassBladeDimensions,
  data: TileBuildData,
  material: Material,
  maxBladeHeight: number,
  radialPadding: number,
): InternalGrassTileRuntime {
  const count = data.ranks.length
  const roots = new Float32Array(count * 3)
  const thresholds = new Float32Array(count)
  const tints = new Float32Array(count)
  const surfaceSampleBases = new Float32Array(count * 2)
  const matrices = new Float32Array(count * 16)
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)

  for (let index = 0; index < count; index += 1) {
    const sourceOffset = index * CANDIDATE_STRIDE
    const x = data.values[sourceOffset]!
    const y = data.values[sourceOffset + 1]!
    const z = data.values[sourceOffset + 2]!
    const yaw = data.values[sourceOffset + 3]!
    const widthFactor = data.values[sourceOffset + 4]!
    const heightFactor = data.values[sourceOffset + 5]!
    const scaledWidth = node.bladeWidth * widthFactor
    roots[index * 3] = x
    roots[index * 3 + 1] = y
    roots[index * 3 + 2] = z
    thresholds[index] = data.values[sourceOffset + 6]!
    tints[index] = data.values[sourceOffset + 7]!
    surfaceSampleBases[index * 2] = Math.cos(yaw) * scaledWidth
    surfaceSampleBases[index * 2 + 1] = Math.sin(yaw) * scaledWidth
    position.set(x, y, z)
    scale.set(scaledWidth, node.bladeHeight * heightFactor, scaledWidth)
    matrix.makeRotationY(yaw)
    matrix.scale(scale)
    matrix.setPosition(position)
    matrix.toArray(matrices, index * 16)
    min.x = Math.min(min.x, x)
    min.y = Math.min(min.y, y)
    min.z = Math.min(min.z, z)
    max.x = Math.max(max.x, x)
    max.y = Math.max(max.y, y)
    max.z = Math.max(max.z, z)
  }

  const attributes: GrassTileAttributes = {
    root: new InstancedBufferAttribute(roots, 3).setUsage(DynamicDrawUsage),
    densityThreshold: new InstancedBufferAttribute(thresholds, 1),
    tintVariation: new InstancedBufferAttribute(tints, 1),
    surfaceSampleBasis: new InstancedBufferAttribute(surfaceSampleBases, 2),
  }
  const instanceMatrix = new InstancedBufferAttribute(matrices, 16).setUsage(
    DynamicDrawUsage,
  )
  const fullGeometry = buildBladeGeometry({
    width: node.bladeWidth,
    height: node.bladeHeight,
  })
  const { midGeometry, farGeometry } = buildReducedBladeGeometries()
  addInstanceAttributes(fullGeometry, attributes)
  addInstanceAttributes(midGeometry, attributes)
  addInstanceAttributes(farGeometry, attributes)

  const full = new InstancedMesh(fullGeometry, material, 0)
  const mid = new InstancedMesh(midGeometry, material, 0)
  const far = new InstancedMesh(farGeometry, material, 0)
  full.instanceMatrix = instanceMatrix
  mid.instanceMatrix = instanceMatrix
  far.instanceMatrix = instanceMatrix
  full.name = 'grass-field-blade'
  mid.name = 'grass-field-blade'
  far.name = 'grass-field-blade'
  fullGeometry.addEventListener('dispose', () => {
    full.dispose()
    mid.dispose()
    far.dispose()
  })

  const fullCount = count
  const midCount = reducedCount(count, GRASS_LOD_MID_INSTANCE_RATIO)
  const farCount = reducedCount(count, GRASS_LOD_FAR_INSTANCE_RATIO)
  full.count = fullCount
  mid.count = midCount
  far.count = farCount
  full.visible = true
  mid.visible = false
  far.visible = false

  const tileGroup = new Group()
  tileGroup.name = 'grass-field-tile'
  tileGroup.add(full, mid, far)
  const tile: InternalGrassTileRuntime = {
    tileX: data.tileX,
    tileZ: data.tileZ,
    candidateCount: count,
    fullCount,
    midCount,
    farCount,
    full,
    mid,
    far,
    attributes,
    bounds: new Box3(),
    sphere: new Sphere(),
    lod: null,
    projectedBladePixels: 0,
    group: tileGroup,
    rootBounds: new Box3(min, max),
  }
  updateTileBounds(tile, maxBladeHeight, radialPadding)
  return tile
}

function reducedCount(candidateCount: number, ratio: number): number {
  return candidateCount === 0 ? 0 : Math.max(1, Math.ceil(candidateCount * ratio))
}

function addInstanceAttributes(
  geometry: BufferGeometry,
  attributes: GrassTileAttributes,
): void {
  geometry.setAttribute('grassRoot', attributes.root)
  geometry.setAttribute('grassDensityThreshold', attributes.densityThreshold)
  geometry.setAttribute('grassTintVariation', attributes.tintVariation)
  geometry.setAttribute('grassSurfaceSampleBasis', attributes.surfaceSampleBasis)
}

function buildReducedBladeGeometries(): {
  readonly midGeometry: BufferGeometry
  readonly farGeometry: BufferGeometry
} {
  const positions = new Float32Array([
    -0.625, 0, 0,
    0.625, 0, 0,
    0, 1, 0,
    0, 0, -0.625,
    0, 0, 0.625,
    0, 1, 0,
  ])
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    -1, 0, 0,
    -1, 0, 0,
    -1, 0, 0,
  ])
  const midGeometry = new BufferGeometry()
  midGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  midGeometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  const farGeometry = new BufferGeometry()
  farGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(positions.subarray(0, 9), 3),
  )
  farGeometry.setAttribute(
    'normal',
    new Float32BufferAttribute(normals.subarray(0, 9), 3),
  )
  return { midGeometry, farGeometry }
}

function updateTileBounds(
  tile: InternalGrassTileRuntime,
  maxBladeHeight: number,
  radialPadding: number,
): void {
  const { min, max } = tile.rootBounds
  tile.bounds.min.set(min.x - radialPadding, min.y, min.z - radialPadding)
  tile.bounds.max.set(max.x + radialPadding, max.y + maxBladeHeight, max.z + radialPadding)
  tile.bounds.getBoundingSphere(tile.sphere)
  for (const mesh of [tile.full, tile.mid, tile.far]) {
    if (mesh.boundingBox) mesh.boundingBox.copy(tile.bounds)
    else mesh.boundingBox = tile.bounds.clone()
    if (mesh.boundingSphere) mesh.boundingSphere.copy(tile.sphere)
    else mesh.boundingSphere = tile.sphere.clone()
  }
}

function chooseLod(current: GrassTileLod | null, pixels: number): GrassTileLod {
  if (current === null) {
    if (pixels >= GRASS_LOD_FULL_PIXELS) return 'full'
    if (pixels >= GRASS_LOD_MID_PIXELS) return 'mid'
    return 'far'
  }
  if (current === 'full') {
    if (pixels < MID_LOD_EXIT_PIXELS) return 'far'
    if (pixels < FULL_LOD_EXIT_PIXELS) return 'mid'
    return 'full'
  }
  if (current === 'mid') {
    if (pixels >= FULL_LOD_ENTER_PIXELS) return 'full'
    if (pixels < MID_LOD_EXIT_PIXELS) return 'far'
    return 'mid'
  }
  if (pixels >= FULL_LOD_ENTER_PIXELS) return 'full'
  if (pixels >= MID_LOD_ENTER_PIXELS) return 'mid'
  return 'far'
}

function applyTileLod(tile: InternalGrassTileRuntime, lod: GrassTileLod): void {
  tile.lod = lod
  tile.full.visible = lod === 'full'
  tile.mid.visible = lod === 'mid'
  tile.far.visible = lod === 'far'
}
