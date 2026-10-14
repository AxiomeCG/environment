import { type HeightPatch, type TerrainField } from '@pascal-app/core'
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
import { queueTerrainAttributeUpdate, terrainPatchBounds, type TerrainPatchBounds } from '../terrain-patch'
import { buildBladeGeometry } from './blade-geometry'
import { plantingDensityAt, samplePlantingTerrain, type PlantingTerrainSample } from '../../planting-terrain'
import { setPlantingRotation, writePlantingMatrix } from '../../planting-transform'

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
const scratchScale = new Vector3()
const runtimes = new WeakMap<Object3D, InternalGrassTilesRuntime>()

export type GrassTileOptions = {
  /** Replays the same bounded population on each call; no per-frame sampling. */
  candidates?: (visitor: GrassCandidateVisitor) => void
  tileSize?: number
  maxHeightScale?: number
  maxObstacleBendStrength?: number
  sampleTerrain?: (x: number, z: number) => PlantingTerrainSample
  candidatesApplyTerrainDensity?: boolean
}

export type GrassTileLod = 'full' | 'mid' | 'far'

export type GrassTileAttributes = {
  readonly root: InstancedBufferAttribute
  readonly terrainNormal: InstancedBufferAttribute
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
  readonly baseTransforms: Float64Array
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
    counts[index] = (counts[index] ?? 0) + 1
  })

  const buildDataByGridIndex: Array<TileBuildData | undefined> = new Array(counts.length)
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0
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
      options.sampleTerrain ?? ((x, z) => samplePlantingTerrain(terrain, x, z)),
      options.candidatesApplyTerrainDensity ?? false,
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
  const patchBounds = terrain && patch ? terrainPatchBounds(terrain, patch, 2) : null
  if (patch && !patchBounds) return true
  for (const tile of runtime.tiles) updateGrassTile(tile, runtime, terrain, patchBounds)
  return true
}

function updateGrassTile(
  tile: InternalGrassTileRuntime,
  runtime: InternalGrassTilesRuntime,
  terrain: TerrainField | null,
  patchBounds: TerrainPatchBounds | null,
): void {
  const { rootBounds } = tile
  if (patchBounds && (
    rootBounds.max.x < patchBounds.minX || rootBounds.min.x > patchBounds.maxX ||
    rootBounds.max.z < patchBounds.minZ || rootBounds.min.z > patchBounds.maxZ
  )) return
  const roots = tile.attributes.root.array as Float32Array
  const matrix = new Matrix4()
  let minY = patchBounds ? rootBounds.min.y : Infinity
  let maxY = patchBounds ? rootBounds.max.y : -Infinity
  const changes = createTerrainChangeRanges()
  for (let index = 0; index < tile.candidateCount; index += 1) {
    const rootOffset = index * 3
    const x = roots[rootOffset] ?? 0
    const z = roots[rootOffset + 2] ?? 0
    if (!isInPatch(x, z, patchBounds)) continue
    const sample = samplePlantingTerrain(terrain, x, z)
    const y = Math.fround(sample.heightM)
    if (updateGrassTerrainNormal(tile.attributes.terrainNormal, index, sample.normal)) {
      includeRange(changes.normal, rootOffset, rootOffset + 2)
    }
    if (roots[rootOffset + 1] !== y) {
      roots[rootOffset + 1] = y
      includeRange(changes.root, rootOffset + 1, rootOffset + 1)
    }
    updateGrassDensityThreshold(tile, index, sample, changes)
    if (updateGrassInstanceMatrix(tile, index, sample, matrix)) {
      includeRange(changes.matrix, index * 16, index * 16 + 15)
    }
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  flushGrassTileChanges(tile, changes)
  if (patchBounds && changes.root[0] > changes.root[1] && changes.matrix[0] > changes.matrix[1]) return
  rootBounds.min.y = minY
  rootBounds.max.y = maxY
  updateTileBounds(tile, runtime.maxBladeHeight, runtime.radialPadding)
}

type TerrainChangeRange = [number, number]
type TerrainChangeRanges = {
  root: TerrainChangeRange
  matrix: TerrainChangeRange
  threshold: TerrainChangeRange
  normal: TerrainChangeRange
}

function createTerrainChangeRanges(): TerrainChangeRanges {
  const emptyRange: TerrainChangeRange = [Infinity, -1]
  return {
    root: [...emptyRange],
    matrix: [...emptyRange],
    threshold: [...emptyRange],
    normal: [...emptyRange],
  }
}

function isInPatch(
  x: number,
  z: number,
  bounds: TerrainPatchBounds | null,
): boolean {
  return !bounds || (
    x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
  )
}

function includeRange(range: TerrainChangeRange, first: number, last: number): void {
  range[0] = Math.min(range[0], first)
  range[1] = Math.max(range[1], last)
}

function updateGrassDensityThreshold(
  tile: InternalGrassTileRuntime,
  index: number,
  sample: PlantingTerrainSample,
  changes: TerrainChangeRanges,
): void {
  const threshold = Math.fround(terrainDensityThreshold(tile.baseTransforms[index * 4 + 3] ?? 0, sample))
  if (tile.attributes.densityThreshold.getX(index) === threshold) return
  tile.attributes.densityThreshold.setX(index, threshold)
  includeRange(changes.threshold, index, index)
}

function flushGrassTileChanges(
  tile: InternalGrassTileRuntime,
  changes: TerrainChangeRanges,
): void {
  const { root, matrix, threshold, normal } = changes
  if (root[0] <= root[1]) queueTerrainAttributeUpdate(tile.attributes.root, root[0], root[1] - root[0] + 1)
  if (matrix[0] <= matrix[1]) queueTerrainAttributeUpdate(tile.full.instanceMatrix, matrix[0], matrix[1] - matrix[0] + 1)
  if (threshold[0] <= threshold[1]) queueTerrainAttributeUpdate(tile.attributes.densityThreshold, threshold[0], threshold[1] - threshold[0] + 1)
  if (normal[0] <= normal[1]) queueTerrainAttributeUpdate(tile.attributes.terrainNormal, normal[0], normal[1] - normal[0] + 1)
}

function terrainDensityThreshold(threshold: number, sample: PlantingTerrainSample): number {
  const density = plantingDensityAt(sample, 'grass')
  return density === 0 ? 2 : threshold / density
}

function updateGrassTerrainNormal(
  attribute: InstancedBufferAttribute,
  index: number,
  normal: readonly [number, number, number],
): boolean {
  const x = Math.fround(normal[0])
  const y = Math.fround(normal[1])
  const z = Math.fround(normal[2])
  if (attribute.getX(index) === x && attribute.getY(index) === y && attribute.getZ(index) === z) {
    return false
  }
  attribute.setXYZ(index, x, y, z)
  return true
}

function updateGrassInstanceMatrix(
  tile: InternalGrassTileRuntime,
  index: number,
  sample: PlantingTerrainSample,
  matrix: Matrix4,
): boolean {
  const offset = index * 4
  const yaw = tile.baseTransforms[offset] ?? 0
  const width = tile.baseTransforms[offset + 1] ?? 0
  const height = tile.baseTransforms[offset + 2] ?? 0
  setPlantingRotation(matrix, sample.normal, yaw)
  scratchScale.set(width, height, width)
  matrix.scale(scratchScale)
  matrix.setPosition(tile.attributes.root.getX(index), sample.heightM, tile.attributes.root.getZ(index))
  return writePlantingMatrix(tile.full.instanceMatrix.array as Float32Array, index * 16, matrix)
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
    if (child + 1 < end && (ranks[child] ?? 0) < (ranks[child + 1] ?? 0)) child += 1
    if ((ranks[root] ?? 0) >= (ranks[child] ?? 0)) return
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
  const rank = ranks[first] ?? 0
  ranks[first] = ranks[second] ?? 0
  ranks[second] = rank
  const firstOffset = first * CANDIDATE_STRIDE
  const secondOffset = second * CANDIDATE_STRIDE
  for (let component = 0; component < CANDIDATE_STRIDE; component += 1) {
    const value = values[firstOffset + component] ?? 0
    values[firstOffset + component] = values[secondOffset + component] ?? 0
    values[secondOffset + component] = value
  }
}

function buildTile(
  node: GrassBladeDimensions,
  data: TileBuildData,
  material: Material,
  maxBladeHeight: number,
  radialPadding: number,
  sampleTerrain: (x: number, z: number) => PlantingTerrainSample,
  candidatesApplyTerrainDensity: boolean,
): InternalGrassTileRuntime {
  const count = data.ranks.length
  const buffers = buildTileBuffers(node, data, count, sampleTerrain, candidatesApplyTerrainDensity)
  const attributes = buildTileAttributes(buffers)
  const meshes = createTileMeshes(node, material, attributes, buffers.matrices, count)
  const { full, mid, far, tileGroup, fullCount, midCount, farCount } = meshes
  const { min, max, baseTransforms } = buffers
  const tile: InternalGrassTileRuntime = {
    tileX: data.tileX, tileZ: data.tileZ, candidateCount: count,
    fullCount, midCount, farCount, full, mid, far, attributes,
    bounds: new Box3(), sphere: new Sphere(), lod: null,
    projectedBladePixels: 0, group: tileGroup,
    rootBounds: new Box3(min, max), baseTransforms,
  }
  updateTileBounds(tile, maxBladeHeight, radialPadding)
  return tile
}

type TileBuffers = {
  roots: Float32Array
  terrainNormals: Float32Array
  thresholds: Float32Array
  tints: Float32Array
  surfaceSampleBases: Float32Array
  matrices: Float32Array
  baseTransforms: Float64Array
  min: Vector3
  max: Vector3
}

function buildTileBuffers(
  node: GrassBladeDimensions,
  data: TileBuildData,
  count: number,
  sampleTerrain: (x: number, z: number) => PlantingTerrainSample,
  candidatesApplyTerrainDensity: boolean,
): TileBuffers {
  const buffers: TileBuffers = {
    roots: new Float32Array(count * 3),
    terrainNormals: new Float32Array(count * 3),
    thresholds: new Float32Array(count),
    tints: new Float32Array(count),
    surfaceSampleBases: new Float32Array(count * 2),
    matrices: new Float32Array(count * 16),
    baseTransforms: new Float64Array(count * 4),
    min: new Vector3(Infinity, Infinity, Infinity),
    max: new Vector3(-Infinity, -Infinity, -Infinity),
  }
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  for (let index = 0; index < count; index += 1) {
    fillTileInstance(node, data, index, sampleTerrain, candidatesApplyTerrainDensity, buffers, matrix, position, scale)
  }
  return buffers
}

function fillTileInstance(
  node: GrassBladeDimensions,
  data: TileBuildData,
  index: number,
  sampleTerrain: (x: number, z: number) => PlantingTerrainSample,
  candidatesApplyTerrainDensity: boolean,
  buffers: TileBuffers,
  matrix: Matrix4,
  position: Vector3,
  scale: Vector3,
): void {
  const sourceOffset = index * CANDIDATE_STRIDE
  const x = data.values[sourceOffset] ?? 0
  const z = data.values[sourceOffset + 2] ?? 0
  const yaw = data.values[sourceOffset + 3] ?? 0
  const widthFactor = data.values[sourceOffset + 4] ?? 0
  const heightFactor = data.values[sourceOffset + 5] ?? 0
  const scaledWidth = node.bladeWidth * widthFactor
  const height = node.bladeHeight * heightFactor
  const sample = sampleTerrain(x, z)
  const rootOffset = index * 3
  buffers.roots[rootOffset] = x
  buffers.roots[rootOffset + 1] = sample.heightM
  buffers.roots[rootOffset + 2] = z
  buffers.terrainNormals.set(sample.normal, rootOffset)
  const threshold = data.values[sourceOffset + 6] ?? 0
  buffers.thresholds[index] = candidatesApplyTerrainDensity
    ? threshold : terrainDensityThreshold(threshold, sample)
  buffers.tints[index] = data.values[sourceOffset + 7] ?? 0
  buffers.surfaceSampleBases[index * 2] = Math.cos(yaw) * scaledWidth
  buffers.surfaceSampleBases[index * 2 + 1] = Math.sin(yaw) * scaledWidth
  buffers.baseTransforms.set([yaw, scaledWidth, height, threshold], index * 4)
  position.set(x, sample.heightM, z)
  scale.set(scaledWidth, height, scaledWidth)
  setPlantingRotation(matrix, sample.normal, yaw)
  matrix.scale(scale)
  matrix.setPosition(position)
  matrix.toArray(buffers.matrices, index * 16)
  buffers.min.set(Math.min(buffers.min.x, x), Math.min(buffers.min.y, sample.heightM), Math.min(buffers.min.z, z))
  buffers.max.set(Math.max(buffers.max.x, x), Math.max(buffers.max.y, sample.heightM), Math.max(buffers.max.z, z))
}

function buildTileAttributes(buffers: TileBuffers): GrassTileAttributes {
  return {
    root: new InstancedBufferAttribute(buffers.roots, 3).setUsage(DynamicDrawUsage),
    terrainNormal: new InstancedBufferAttribute(buffers.terrainNormals, 3).setUsage(DynamicDrawUsage),
    densityThreshold: new InstancedBufferAttribute(buffers.thresholds, 1).setUsage(DynamicDrawUsage),
    tintVariation: new InstancedBufferAttribute(buffers.tints, 1),
    surfaceSampleBasis: new InstancedBufferAttribute(buffers.surfaceSampleBases, 2),
  }
}

function createTileMeshes(
  node: GrassBladeDimensions,
  material: Material,
  attributes: GrassTileAttributes,
  matrices: Float32Array,
  count: number,
): {
  full: InstancedMesh
  mid: InstancedMesh
  far: InstancedMesh
  tileGroup: Group
  fullCount: number
  midCount: number
  farCount: number
} {
  const instanceMatrix = new InstancedBufferAttribute(matrices, 16).setUsage(DynamicDrawUsage)
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
  return { full, mid, far, tileGroup, fullCount, midCount, farCount }
}

function reducedCount(candidateCount: number, ratio: number): number {
  return candidateCount === 0 ? 0 : Math.max(1, Math.ceil(candidateCount * ratio))
}

function addInstanceAttributes(
  geometry: BufferGeometry,
  attributes: GrassTileAttributes,
): void {
  geometry.setAttribute('grassRoot', attributes.root)
  geometry.setAttribute('grassTerrainNormal', attributes.terrainNormal)
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
