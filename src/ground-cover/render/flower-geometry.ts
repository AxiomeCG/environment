import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  type Object3D,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as TSL from 'three/tsl'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { grassWindBend } from '../../wind-node'
import { FLOWER_KINDS, type FlowerKind, type FlowerPlacement } from '../flower-scatter'

const MAX_BAKED_FLOWER_VERTICES = 65_535
const STEM_COLOR = new Color('#31552b')
const LEAF_COLOR = new Color('#3f6b35')
const DAISY_PETAL_COLOR = new Color('#f3efe1')
const DAISY_CENTER_COLOR = new Color('#d5a52b')
const CUP_PETAL_COLOR = new Color('#cf3f38')
const CUP_CENTER_COLOR = new Color('#492b31')
const SPIKE_COLORS = [new Color('#73549a'), new Color('#a274aa')] as const
const FLOWER_HEIGHTS: Readonly<Record<FlowerKind, number>> = {
  daisy: 0.3,
  cup: 0.37,
  spike: 0.4,
}
const noRaycast: InstancedMesh['raycast'] = () => undefined
const runtimes = new WeakMap<Object3D, FlowerBatchRuntime>()

type FlowerBatch = {
  mesh: InstancedMesh
  roots: InstancedBufferAttribute
}

type FlowerBatchRuntime = {
  batches: FlowerBatch[]
}

/** Returns a fresh, caller-owned low-poly flower geometry. */
export function createFlowerGeometry(kind: FlowerKind): BufferGeometry {
  const height = FLOWER_HEIGHTS[kind]
  const parts = [createStem(height)]
  if (kind === 'daisy') addDaisyBloom(parts, height)
  else if (kind === 'cup') addCupBloom(parts, height)
  else addSpikeBloom(parts, height)

  const prepared = parts.map(({ color, geometry }) => preparePart(geometry, color, height))
  const merged = mergeGeometries(prepared, false)
  for (const geometry of prepared) geometry.dispose()
  for (const part of parts) part.geometry.dispose()
  if (!merged) throw new Error(`Unable to build ${kind} flower geometry`)
  const indexed = mergeVertices(merged)
  merged.dispose()
  indexed.computeBoundingBox()
  indexed.computeBoundingSphere()
  return indexed
}

export function createAnimatedFlowerBatches(
  placements: readonly FlowerPlacement[],
  windInfluence: Node<'float'>,
): Group {
  const group = new Group()
  group.name = 'grass-field-flowers'
  if (placements.length === 0) return group

  const material = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  })
  const flowerRoot = TSL.attribute<'vec3'>('flowerRoot', 'vec3')
  const flowerProgress = TSL.attribute<'float'>('flowerProgress', 'float')
  const rootRelativePosition = TSL.positionLocal.sub(flowerRoot)
  const displacement = grassWindBend(flowerRoot, windInfluence)
    .mul(rootRelativePosition.y)
    .mul(flowerProgress.mul(flowerProgress))
  material.positionNode = flowerRoot.add(rootRelativePosition.add(displacement))

  const batches: FlowerBatch[] = []
  for (const kind of FLOWER_KINDS) {
    const kindPlacements = placements.filter((placement) => placement.kind === kind)
    if (kindPlacements.length === 0) continue
    const geometry = createFlowerGeometry(kind)
    const roots = new InstancedBufferAttribute(
      new Float32Array(kindPlacements.length * 3),
      3,
    ).setUsage(DynamicDrawUsage)
    geometry.setAttribute('flowerRoot', roots)
    const matrices = new Float32Array(kindPlacements.length * 16)
    const matrix = new Matrix4()
    const scale = new Vector3()

    for (let index = 0; index < kindPlacements.length; index += 1) {
      const placement = kindPlacements[index]!
      roots.setXYZ(index, ...placement.position)
      matrix.makeRotationY(placement.rotationY)
      scale.setScalar(placement.scale)
      matrix.scale(scale)
      matrix.setPosition(...placement.position)
      matrix.toArray(matrices, index * 16)
    }

    const mesh = new InstancedMesh(geometry, material, kindPlacements.length)
    mesh.instanceMatrix = new InstancedBufferAttribute(matrices, 16).setUsage(DynamicDrawUsage)
    geometry.addEventListener('dispose', () => {
      mesh.dispose()
    })
    mesh.name = `grass-field-flower-${kind}`
    mesh.raycast = noRaycast
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    group.add(mesh)
    batches.push({ mesh, roots })
  }

  runtimes.set(group, { batches })
  return group
}

export function updateFlowerBatchTerrain(root: Object3D, terrain: TerrainField | null): boolean {
  const runtime = flowerRuntime(root)
  if (!runtime) return false

  for (const { mesh, roots } of runtime.batches) {
    const rootValues = roots.array as Float32Array
    const matrices = mesh.instanceMatrix.array as Float32Array
    for (let index = 0; index < roots.count; index += 1) {
      const offset = index * 3
      const x = rootValues[offset]!
      const z = rootValues[offset + 2]!
      const y = terrain ? surfaceHeightAt(terrain, x, z) : 0
      rootValues[offset + 1] = y
      matrices[index * 16 + 13] = y
    }
    roots.needsUpdate = true
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
  }
  return true
}

/** Disposes every geometry and shared material owned by a flower batch group. */
export function disposeFlowerBatches(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of objectMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  runtimes.delete(root)
}

export function createBakedFlowerBatches(placements: readonly FlowerPlacement[]): Group {
  const group = new Group()
  group.name = 'grass-field-static-flowers'
  if (placements.length === 0) return group

  const material = new MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  })

  for (const kind of FLOWER_KINDS) {
    const kindPlacements = placements.filter((placement) => placement.kind === kind)
    if (kindPlacements.length === 0) continue
    const source = createFlowerGeometry(kind)
    const sourcePositions = source.getAttribute('position')
    const sourceNormals = source.getAttribute('normal')
    const sourceColors = source.getAttribute('color')
    const sourceIndices = source.getIndex()
    if (!sourceIndices) {
      source.dispose()
      throw new Error(`Expected indexed ${kind} flower geometry`)
    }
    const flowersPerChunk = Math.max(
      1,
      Math.floor(MAX_BAKED_FLOWER_VERTICES / sourcePositions.count),
    )

    for (
      let placementOffset = 0, chunkIndex = 0;
      placementOffset < kindPlacements.length;
      placementOffset += flowersPerChunk, chunkIndex += 1
    ) {
      const count = Math.min(flowersPerChunk, kindPlacements.length - placementOffset)
      const positions = new Float32Array(count * sourcePositions.count * 3)
      const normals = new Float32Array(count * sourceNormals.count * 3)
      const colors = new Float32Array(count * sourceColors.count * 3)
      const indices = new Uint16Array(count * sourceIndices.count)

      for (let localIndex = 0; localIndex < count; localIndex += 1) {
        const placement = kindPlacements[placementOffset + localIndex]!
        const cosine = Math.cos(placement.rotationY)
        const sine = Math.sin(placement.rotationY)
        const vertexOffset = localIndex * sourcePositions.count
        const indexOffset = localIndex * sourceIndices.count
        for (let index = 0; index < sourceIndices.count; index += 1) {
          indices[indexOffset + index] = sourceIndices.getX(index) + vertexOffset
        }
        for (let vertexIndex = 0; vertexIndex < sourcePositions.count; vertexIndex += 1) {
          const outputOffset = (localIndex * sourcePositions.count + vertexIndex) * 3
          const localX = sourcePositions.getX(vertexIndex) * placement.scale
          const localY = sourcePositions.getY(vertexIndex) * placement.scale
          const localZ = sourcePositions.getZ(vertexIndex) * placement.scale
          positions[outputOffset] = placement.position[0] + cosine * localX + sine * localZ
          positions[outputOffset + 1] = placement.position[1] + localY
          positions[outputOffset + 2] = placement.position[2] - sine * localX + cosine * localZ

          const normalX = sourceNormals.getX(vertexIndex)
          const normalZ = sourceNormals.getZ(vertexIndex)
          normals[outputOffset] = cosine * normalX + sine * normalZ
          normals[outputOffset + 1] = sourceNormals.getY(vertexIndex)
          normals[outputOffset + 2] = -sine * normalX + cosine * normalZ
          colors[outputOffset] = sourceColors.getX(vertexIndex)
          colors[outputOffset + 1] = sourceColors.getY(vertexIndex)
          colors[outputOffset + 2] = sourceColors.getZ(vertexIndex)
        }
      }

      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new BufferAttribute(normals, 3))
      geometry.setAttribute('color', new BufferAttribute(colors, 3))
      geometry.setIndex(new BufferAttribute(indices, 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      const mesh = new Mesh(geometry, material)
      mesh.name =
        chunkIndex === 0
          ? `grass-field-static-flowers-${kind}`
          : `grass-field-static-flowers-${kind}-${chunkIndex + 1}`
      group.add(mesh)
    }
    source.dispose()
  }

  return group
}

function flowerRuntime(root: Object3D): FlowerBatchRuntime | null {
  const flowerGroup = root.getObjectByName('grass-field-flowers') ?? root
  return runtimes.get(root) ?? runtimes.get(flowerGroup) ?? null
}

type FlowerPart = {
  geometry: BufferGeometry
  color: Color
}

function createStem(height: number): FlowerPart {
  const geometry = new CylinderGeometry(0.006, 0.01, height * 0.96, 5, 1)
  geometry.translate(0, height * 0.48, 0)
  return { geometry, color: STEM_COLOR }
}

function addDaisyBloom(parts: FlowerPart[], height: number): void {
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const petal = new CircleGeometry(0.032, 4)
    petal.scale(0.58, 1.45, 1)
    petal.rotateX(-Math.PI / 2)
    petal.rotateY(angle)
    petal.translate(Math.sin(angle) * 0.033, height, Math.cos(angle) * 0.033)
    parts.push({ geometry: petal, color: DAISY_PETAL_COLOR })
  }
  const center = new CylinderGeometry(0.024, 0.027, 0.014, 8, 1)
  center.translate(0, height + 0.008, 0)
  parts.push({ geometry: center, color: DAISY_CENTER_COLOR })
  parts.push(createLeaf(height, 0.48, 0.7))
}

function addCupBloom(parts: FlowerPart[], height: number): void {
  const cup = new CylinderGeometry(0.054, 0.026, 0.065, 7, 1, true)
  cup.translate(0, height - 0.025, 0)
  parts.push({ geometry: cup, color: CUP_PETAL_COLOR })
  const center = new OctahedronGeometry(0.018, 0)
  center.scale(1, 0.65, 1)
  center.translate(0, height + 0.012, 0)
  parts.push({ geometry: center, color: CUP_CENTER_COLOR })
  parts.push(createLeaf(height, 0.42, -0.85))
}

function addSpikeBloom(parts: FlowerPart[], height: number): void {
  for (let index = 0; index < 7; index += 1) {
    const angle = index * 2.4
    const radius = 0.018 + (index % 2) * 0.006
    const blossom = new OctahedronGeometry(0.026, 0)
    blossom.scale(1, 0.8, 1)
    blossom.translate(
      Math.cos(angle) * radius,
      height * (0.63 + index * 0.055),
      Math.sin(angle) * radius,
    )
    parts.push({ geometry: blossom, color: SPIKE_COLORS[index % 2]! })
  }
  parts.push(createLeaf(height, 0.38, 1.1))
}

function createLeaf(height: number, heightFactor: number, angle: number): FlowerPart {
  const geometry = new CircleGeometry(0.04, 3)
  geometry.scale(0.45, 1.15, 1)
  geometry.rotateZ(-0.75)
  geometry.rotateY(angle)
  geometry.translate(Math.cos(angle) * 0.018, height * heightFactor, Math.sin(angle) * 0.018)
  return { geometry, color: LEAF_COLOR }
}

function preparePart(source: BufferGeometry, color: Color, height: number): BufferGeometry {
  const geometry = source.getIndex() ? source.toNonIndexed() : source.clone()
  geometry.deleteAttribute('uv')
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  const progress = new Float32Array(positions.count)
  for (let index = 0; index < positions.count; index += 1) {
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    progress[index] = Math.min(1, Math.max(0, positions.getY(index) / height))
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setAttribute('flowerProgress', new Float32BufferAttribute(progress, 1))
  return geometry
}
