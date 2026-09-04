import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three'
import type { Material } from 'three'
import { getPresentationMaterial } from './presentation-material'
import type { PresentationSurface } from './presentation-material'

export type HousePrimitive = 'box' | 'cylinder' | 'tapered-cylinder' | 'cone' | 'gable' | 'hip' | 'gambrel' | 'gable-end' | 'gambrel-end'
const geometries = new Map<HousePrimitive, BufferGeometry>()
const NO_RAYCAST = () => undefined
export function cloneContextMaterial(source: Material): Material {
  const material = source.clone()
  // Three r185 NodeMaterial.copy omits the inherited alphaTest accessor.
  // Losing it turns shared leaf cards into opaque rectangles.
  material.alphaTest = source.alphaTest
  return material
}

class ContextInstancedMesh extends InstancedMesh {
  private readonly ownedGeometry: BufferGeometry
  private readonly ownedMaterials: Material[]
  private disposed = false

  constructor(geometry: BufferGeometry, material: Material | Material[], capacity: number) {
    const ownedGeometry = geometry.clone()
    const ownedMaterial = Array.isArray(material)
      ? material.map(cloneContextMaterial)
      : cloneContextMaterial(material)
    super(ownedGeometry, ownedMaterial, capacity)
    this.ownedGeometry = ownedGeometry
    this.ownedMaterials = Array.isArray(ownedMaterial) ? ownedMaterial : [ownedMaterial]
  }

  override dispose(): void {
    if (this.disposed) return
    this.disposed = true
    super.dispose()
    for (const material of this.ownedMaterials) material.dispose()
    this.ownedGeometry.dispose()
  }
}

/**
 * Creates an instance batch with per-mesh geometry attributes and material
 * state. Source geometry, materials, and their textures remain shared; calling
 * dispose releases only the clones and instance-specific GPU resources.
 */
export function createContextInstances(
  geometry: BufferGeometry,
  material: Material | Material[],
  capacity: number,
): InstancedMesh {
  return new ContextInstancedMesh(geometry, material, capacity)
}

function instanceCapacity(count: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, count)))
}

function roofGeometry(kind: Exclude<HousePrimitive, 'box' | 'cylinder' | 'tapered-cylinder' | 'cone'>): BufferGeometry {
  // Unit roof: eaves at y=0, ridge at y=1; widths/depths span [-.5,.5].
  const positions: number[] = []
  const triangle = (a: readonly number[], b: readonly number[], c: readonly number[]) => positions.push(...a, ...b, ...c)
  if (kind === 'hip') {
    const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5]
    const r0 = [0, 1, -0.25], r1 = [0, 1, 0.25]
    triangle(a, r0, b); triangle(d, c, r1)
    triangle(a, d, r1); triangle(a, r1, r0)
    triangle(b, r0, r1); triangle(b, r1, c)
  } else {
    const gambrel = kind.startsWith('gambrel')
    const profile = gambrel ? [[-0.5, 0], [-0.26, 0.68], [0, 1], [0.26, 0.68], [0.5, 0]] : [[-0.5, 0], [0, 1], [0.5, 0]]
    if (kind.endsWith('-end')) {
      for (const z of [-0.5, 0.5]) {
        for (let i = 0; i < profile.length - 1; i += 1) {
          const a = [profile[i]![0]!, profile[i]![1]!, z], b = [profile[i + 1]![0]!, profile[i + 1]![1]!, z], c = [0, 0, z]
          if (z > 0) triangle(c, b, a); else triangle(c, a, b)
        }
      }
    } else {
      for (let i = 0; i < profile.length - 1; i += 1) {
        const a = [profile[i]![0]!, profile[i]![1]!, -0.5], b = [profile[i + 1]![0]!, profile[i + 1]![1]!, -0.5]
        const c = [b[0]!, b[1]!, 0.5], d = [a[0]!, a[1]!, 0.5]
        triangle(a, d, b); triangle(b, d, c)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function primitiveGeometry(kind: HousePrimitive): BufferGeometry {
  const cached = geometries.get(kind)
  if (cached) return cached
  const geometry = kind === 'box' ? new BoxGeometry(1, 1, 1)
    : kind === 'cylinder' ? new CylinderGeometry(0.5, 0.5, 1, 12)
    : kind === 'tapered-cylinder' ? new CylinderGeometry(0.36, 0.5, 1, 12)
    : kind === 'cone' ? new ConeGeometry(0.5, 1, 12)
    : roofGeometry(kind)
  geometries.set(kind, geometry)
  return geometry
}

type Batch = { kind: HousePrimitive; surface: PresentationSurface; matrices: number[]; colors: number[] }

/** One submission per primitive/surface, independent of palette or house dimensions. */
export class PrimitiveInstances {
  private readonly batches = new Map<string, Batch>()
  private readonly color = new Color()

  add(kind: HousePrimitive, surface: PresentationSurface, color: string, matrix: Matrix4): void {
    const key = `${kind}:${surface}`
    let batch = this.batches.get(key)
    if (!batch) {
      batch = { kind, surface, matrices: [], colors: [] }
      this.batches.set(key, batch)
    }
    batch.matrices.push(...matrix.elements)
    this.color.set(color)
    batch.colors.push(this.color.r, this.color.g, this.color.b)
  }

  build(name: string, root = new Group()): Group {
    root.name = name
    const previous = new Map(
      root.children
        .filter((child): child is InstancedMesh => child instanceof InstancedMesh)
        .map((child) => [child.name, child]),
    )
    const matrix = new Matrix4()
    let triangles = 0
    for (const [key, batch] of this.batches) {
      const geometry = primitiveGeometry(batch.kind)
      const count = batch.matrices.length / 16
      const meshName = `${name}-${key}`
      let mesh = previous.get(meshName)
      previous.delete(meshName)
      if (!mesh || mesh.instanceMatrix.count < count) {
        if (mesh) {
          root.remove(mesh)
          mesh.dispose()
        }
        mesh = createContextInstances(
          geometry,
          getPresentationMaterial(batch.surface),
          instanceCapacity(count),
        )
        mesh.name = meshName
        mesh.raycast = NO_RAYCAST
        // Context is not a contributor to the editor's shadow-map budget.
        mesh.castShadow = false
        mesh.receiveShadow = true
        root.add(mesh)
      }
      mesh.count = count
      let facadeSize: InstancedBufferAttribute | undefined
      if (batch.surface === 'facade') {
        facadeSize = mesh.geometry.getAttribute('facadeSize') as InstancedBufferAttribute | undefined
        if (!facadeSize) {
          facadeSize = new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3)
          mesh.geometry.setAttribute('facadeSize', facadeSize)
        }
      }
      for (let i = 0; i < count; i += 1) {
        matrix.fromArray(batch.matrices, i * 16)
        mesh.setMatrixAt(i, matrix)
        if (facadeSize) {
          const e = matrix.elements
          facadeSize.setXYZ(i, Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!), Math.hypot(e[8]!, e[9]!, e[10]!))
        }
        this.color.fromArray(batch.colors, i * 3)
        mesh.setColorAt(i, this.color)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (facadeSize) facadeSize.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      triangles += (geometry.index?.count ?? geometry.attributes.position!.count) / 3 * count
    }
    for (const mesh of previous.values()) {
      root.remove(mesh)
      mesh.dispose()
    }
    root.userData = { drawCallCount: root.children.length, visibleTriangleCount: triangles }
    return root
  }
}

/** Shared prototypes have a fixed session owner; roots own cloned render state. */
export function disposePrimitiveInstances(root: Group): void {
  root.traverse((object) => { if (object instanceof InstancedMesh) object.dispose() })
  root.clear()
}
