'use client'

// ez-tree loads its inlined textures at module scope (needs `document`), so
// this module is only imported from the client-side surroundings layer and
// never from `index.ts` or any plan/grammar module.
import { Tree } from '@dgreenheck/ez-tree'
import { useEffect, useMemo } from 'react'
import {
  Box3,
  type BufferGeometry,
  type Color,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  type Side,
  type Texture,
  Vector3,
} from 'three'
import { Fn, float, instanceIndex, positionLocal, sin, time, uv } from 'three/tsl'
import { MeshStandardNodeMaterial, type Node, type NodeBuilder } from 'three/webgpu'
import { GLOBAL_WIND_STRENGTH } from '../wind-node'
import type { TreePlan, TreeSize, TreeSpecies } from './neighborhood-decoration'

const NO_RAYCAST = () => undefined
const UP = new Vector3(0, 1, 0)

// Same ez-tree preset names Nature's tree panel exposes (species × size).
const EZ_PRESET: Readonly<Record<TreeSpecies, Readonly<Record<TreeSize, string>>>> = {
  oak: { small: 'Oak Small', medium: 'Oak Medium', large: 'Oak Large' },
  ash: { small: 'Ash Small', medium: 'Ash Medium', large: 'Ash Large' },
  aspen: { small: 'Aspen Small', medium: 'Aspen Medium', large: 'Aspen Large' },
  pine: { small: 'Pine Small', medium: 'Pine Medium', large: 'Pine Large' },
}

// ── Leaf flutter: the same TSL vertex bend Nature bakes into its tree leaves ──
const LEAF_FREQUENCY = 1.2
const LEAF_STRENGTH = 0.3

const leafFlutter = Fn(() => {
  const p = positionLocal.toVar()
  const offset = float(instanceIndex).mul(0.7).add(p.x.add(p.z).mul(0.3))
  const t = time.mul(LEAF_FREQUENCY)
  const wave = sin(t.add(offset))
    .mul(0.5)
    .add(sin(t.mul(2).add(offset.mul(1.3))).mul(0.3))
    .add(sin(t.mul(5).add(offset.mul(1.5))).mul(0.2))
  const sway = uv().y.mul(LEAF_STRENGTH).mul(GLOBAL_WIND_STRENGTH).mul(wave)
  p.x.addAssign(sway)
  p.z.addAssign(sway)
  return p
})
const LEAF_FLUTTER = leafFlutter()

class WindNodeMaterial extends MeshStandardNodeMaterial {
  windNode: Node | null = null

  setupPosition(builder: NodeBuilder): Node {
    if (this.windNode !== null) positionLocal.assign(this.windNode)
    return super.setupPosition(builder)
  }

  customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|wind:${this.windNode ? this.windNode.id : 'none'}`
  }
}

type ClassicMaterial = Material & {
  map?: Texture | null
  alphaMap?: Texture | null
  color?: Color
  side?: Side
  alphaTest?: number
  opacity?: number
  transparent?: boolean
  depthWrite?: boolean
}

const materialCache = new WeakMap<Material, MeshStandardNodeMaterial>()

/** ez-tree emits classic materials; the editor renders through WebGPU node
 * materials, so rebuild each one carrying its texture/tint across. Only the
 * `leaves` material flutters. */
function toWindMaterial(material: Material): MeshStandardNodeMaterial {
  const cached = materialCache.get(material)
  if (cached) return cached
  const src = material as ClassicMaterial
  const node = new WindNodeMaterial({
    map: src.map ?? null,
    alphaMap: src.alphaMap ?? null,
    color: src.color,
    side: src.side,
    alphaTest: src.alphaTest ?? 0,
    transparent: src.transparent ?? false,
    opacity: src.opacity ?? 1,
    depthWrite: src.depthWrite ?? true,
    roughness: 1,
    metalness: 0,
  })
  if (material.name === 'leaves') node.windNode = LEAF_FLUTTER
  materialCache.set(material, node)
  return node
}

type TreeSubMesh = { geometry: BufferGeometry; material: Material }
type TreeVariant = { subMeshes: TreeSubMesh[]; naturalHeight: number }

const variantCache = new Map<string, TreeVariant>()

/** Tree shape is shared per species and size. Individual plans retain visual
 * variation through their seeded placement, rotation, and height. */
export function treeVariantKey(plan: Pick<TreePlan, 'species' | 'size'>): string {
  return `${plan.species}:${plan.size}`
}

/** Generate (once) the shared geometry for a species × size × seed. Retained
 * for the session like Nature's variant cache: `generate()` is heavy and the
 * neighborhood rebuilds on every frontage edit. */
function getVariant(plan: Pick<TreePlan, 'species' | 'size' | 'seed'>): TreeVariant {
  const key = treeVariantKey(plan)
  const cached = variantCache.get(key)
  if (cached) return cached

  const tree = new Tree()
  tree.loadPreset(EZ_PRESET[plan.species][plan.size])
  tree.options.seed = plan.seed
  tree.generate()

  const subMeshes: TreeSubMesh[] = []
  tree.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const geometry = child.geometry.clone()
    child.updateMatrix()
    geometry.applyMatrix4(child.matrix)
    const material = Array.isArray(child.material) ? child.material[0]! : child.material
    subMeshes.push({ geometry, material: toWindMaterial(material) })
  })
  const box = new Box3().setFromObject(tree)
  const variant = { subMeshes, naturalHeight: Math.max(0.001, box.max.y - box.min.y) }
  variantCache.set(key, variant)
  return variant
}

export function buildTreeInstances(plans: readonly TreePlan[]): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-trees'
  const byVariant = new Map<string, TreePlan[]>()
  for (const plan of plans) {
    const key = treeVariantKey(plan)
    const group = byVariant.get(key)
    if (group) group.push(plan)
    else byVariant.set(key, [plan])
  }

  let drawCallCount = 0
  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  for (const [key, variantPlans] of byVariant) {
    const variant = getVariant(variantPlans[0]!)
    variant.subMeshes.forEach((subMesh, subIndex) => {
      const instances = new InstancedMesh(
        subMesh.geometry,
        subMesh.material,
        variantPlans.length,
      )
      instances.name = `pascal-tree-${key}-${subMesh.material.name || subIndex}`
      instances.castShadow = true
      instances.receiveShadow = false
      instances.raycast = NO_RAYCAST
      variantPlans.forEach((plan, index) => {
        const factor = plan.height / variant.naturalHeight
        position.set(plan.position[0], 0, plan.position[1])
        quaternion.setFromAxisAngle(UP, plan.rotationY)
        scale.setScalar(factor)
        matrix.compose(position, quaternion, scale)
        instances.setMatrixAt(index, matrix)
      })
      instances.instanceMatrix.needsUpdate = true
      instances.computeBoundingSphere()
      instances.userData = { variantKey: key, instanceCount: variantPlans.length }
      root.add(instances)
      drawCallCount += 1
    })
  }
  root.userData = {
    drawCallCount,
    treeCount: plans.length,
    variantCount: byVariant.size,
  }
  return root
}

/** Dispose only the InstancedMesh wrappers: geometry and materials belong to
 * the session-long variant cache. */
function disposeTreeInstances(root: Group): void {
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose()
  })
  root.clear()
}

export function NeighborhoodTrees({ plans }: { plans: readonly TreePlan[] }) {
  const instances = useMemo(() => buildTreeInstances(plans), [plans])

  useEffect(() => () => {
    disposeTreeInstances(instances)
  }, [instances])

  return <primitive object={instances} />
}
