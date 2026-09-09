'use client'

// EZ-Tree loads texture images at module scope; callers lazy-load this client boundary.
import { Tree } from '@dgreenheck/ez-tree'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Box3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { BufferGeometry } from 'three'
import {
  NEIGHBORHOOD_TREE_BUDGET,
  type TreePlan,
  type TreeSpecies,
} from './neighborhood-decoration'
import type { HorizonFoliagePlan, HorizonFoliageSpecies } from './horizon-foliage'
import { PresentationMaterial } from './presentation-material'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'

type Species = TreeSpecies | HorizonFoliageSpecies
type Placement = {
  species: Species
  position: readonly [number, number, number]
  rotationY: number
  height: number
  leafColor: string
  crownAspect?: number
  whitening?: number
}
type Variant = {
  parts: { geometry: BufferGeometry; material: PresentationMaterial; leaves: boolean }[]
  height: number
}
// Prototype geometry and materials are session-owned; rebuilt roots dispose
// only their instance buffers so every neighborhood remount reuses this pool.
const variants = new Map<Species, Variant>()
const PRESETS: Record<Species, string> = {
  oak: 'Oak Medium',
  ash: 'Ash Medium',
  pine: 'Pine Medium',
  aspen: 'Aspen Medium',
  bush: 'Bush 3',
}
const SEEDS: Record<Species, number> = { oak: 21, ash: 55, pine: 89, aspen: 34, bush: 13 }
export const NEIGHBORHOOD_TREE_PROTOTYPE_CAP = 5
export const FLAT_TREE_HEIGHT_AT = () => 0
const EMPTY_HORIZON_PLANS: readonly HorizonFoliagePlan[] = []
const UP = new Vector3(0, 1, 0)
const WHITE = new Color('#ffffff')
const NO_RAYCAST = () => undefined

function getVariant(species: Species): Variant {
  const cached = variants.get(species)
  if (cached) return cached
  const tree = new Tree()
  tree.loadPreset(PRESETS[species])
  tree.options.seed = SEEDS[species] + 4_093
  // Keep each species' growth grammar, but stop at structural branches: these
  // are context trees, not botanical close-ups. Larger leaf clusters replace
  // terminal twigs without thinning the planted neighborhood.
  tree.options.branch.levels = Math.min(tree.options.branch.levels, 2)
  // Pine crowns are many first-order whorls, not recursively branching oaks.
  const crownBranches = species === 'pine' ? 32 : 5
  tree.options.branch.children[0] = Math.min(tree.options.branch.children[0], crownBranches)
  tree.options.branch.children[1] = Math.min(tree.options.branch.children[1], 2)
  for (const level of [0, 1, 2, 3] as const) {
    tree.options.branch.sections[level] = Math.min(
      tree.options.branch.sections[level],
      level === 0 ? 5 : level === 1 ? 3 : 2,
    )
    tree.options.branch.segments[level] = Math.min(
      tree.options.branch.segments[level],
      level === 0 ? 5 : level === 1 ? 4 : 3,
    )
  }
  tree.options.leaves.count = Math.min(tree.options.leaves.count, species === 'pine' ? 8 : 6)
  tree.options.leaves.size *= species === 'pine' ? 3.2 : 2.8
  tree.generate()
  const bounds = new Box3().setFromObject(tree)
  const parts: Variant['parts'] = []
  tree.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const source = Array.isArray(child.material) ? child.material[0] : child.material
    if (!(source instanceof MeshPhongMaterial)) return
    child.updateMatrix()
    const geometry = child.geometry
    geometry.applyMatrix4(child.matrix)
    const leaves = source.name === 'leaves'
    const material = new PresentationMaterial({
      map: source.map,
      alphaMap: source.alphaMap,
      color: source.color,
      side: source.side,
      alphaTest: source.alphaTest,
      transparent: false,
      depthWrite: true,
      roughness: 1,
      metalness: 0,
    })
    material.name = leaves ? 'surroundings-eztree-leaves' : 'surroundings-eztree-bark'
    parts.push({ geometry, material, leaves })
    source.dispose()
  })
  const variant = { parts, height: Math.max(0.001, bounds.max.y - bounds.min.y) }
  variants.set(species, variant)
  return variant
}

function buildInstances(plans: readonly Placement[], root = new Group()): Group {
  const startedAt = performance.now()
  root.name = 'environment-neighborhood-trees'
  const buckets = new Map<string, Placement[]>()
  for (const child of root.children) if (child instanceof InstancedMesh) child.count = 0
  for (const plan of plans) {
    const key = plan.species
    const bucket = buckets.get(key)
    if (bucket) bucket.push(plan)
    else buckets.set(key, [plan])
  }
  const matrix = new Matrix4(),
    position = new Vector3(),
    rotation = new Quaternion(),
    scale = new Vector3(),
    color = new Color()
  let triangles = 0,
    bytes = 0,
    drawCalls = 0
  for (const placements of buckets.values()) {
    const { species } = placements[0]!
    const variant = getVariant(species)
    for (const part of variant.parts) {
      const partName = `eztree-${species}-${part.leaves ? 'leaves' : 'branches'}`
      let mesh = root.children.find((child) => child.name === partName) as InstancedMesh | undefined
      if (!mesh || mesh.instanceMatrix.count < placements.length) {
        if (mesh) {
          root.remove(mesh)
          mesh.dispose()
        }
        mesh = createContextInstances(
          part.geometry,
          part.material,
          Math.max(NEIGHBORHOOD_TREE_BUDGET, placements.length),
        )
        mesh.name = partName
        root.add(mesh)
      }
      mesh.count = placements.length
      drawCalls += 1
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = -20
      mesh.raycast = NO_RAYCAST
      for (let i = 0; i < placements.length; i += 1) {
        const plan = placements[i]!
        const heightScale = plan.height / variant.height
        const aspect = plan.crownAspect ?? 1
        scale.set(heightScale * aspect, heightScale, heightScale / aspect)
        mesh.setMatrixAt(
          i,
          matrix.compose(
            position.fromArray(plan.position),
            rotation.setFromAxisAngle(UP, plan.rotationY),
            scale,
          ),
        )
        if (part.leaves) {
          mesh.setColorAt(i, color.set(plan.leafColor).lerp(WHITE, plan.whitening ?? 0.38))
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      triangles +=
        ((part.geometry.index?.count ?? part.geometry.attributes.position!.count) / 3) *
        placements.length
      bytes +=
        mesh.instanceMatrix.array.byteLength +
        (mesh.instanceColor?.array.byteLength ?? 0) +
        (part.geometry.index?.array.byteLength ?? 0)
      for (const attribute of Object.values(part.geometry.attributes))
        bytes += attribute.array.byteLength
    }
  }
  root.userData = {
    drawCallCount: drawCalls,
    treeCount: plans.length,
    instanceCount: plans.length,
    variantCount: buckets.size,
    prototypePoolCap: NEIGHBORHOOD_TREE_PROTOTYPE_CAP,
    visibleTriangleCount: triangles,
    ownedBufferBytes: bytes,
    buildTimeMs: performance.now() - startedAt,
  }
  return root
}

export function buildTreeInstances(
  plans: readonly TreePlan[],
  heightAt: (x: number, z: number) => number = FLAT_TREE_HEIGHT_AT,
  root = new Group(),
  horizonPlans: readonly HorizonFoliagePlan[] = EMPTY_HORIZON_PLANS,
): Group {
  const placements: Placement[] = plans.map((plan) => {
    const crownAspect = 0.88 + ((Math.abs(plan.seed * 37) % 17) / 16) * 0.24
    return {
      ...plan,
      crownAspect,
      position: [
        plan.position[0],
        heightAt(plan.position[0], plan.position[1]),
        plan.position[1],
      ] as const,
    }
  })
  for (const plan of horizonPlans) {
    placements.push({ ...plan, whitening: 0.65 })
  }
  return buildInstances(placements, root)
}
export function NeighborhoodTrees({
  plans,
  horizonPlans = EMPTY_HORIZON_PLANS,
  heightAt = FLAT_TREE_HEIGHT_AT,
}: {
  plans: readonly TreePlan[]
  horizonPlans?: readonly HorizonFoliagePlan[]
  heightAt?: (x: number, z: number) => number
}) {
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    buildTreeInstances(plans, heightAt, root, horizonPlans)
    invalidate()
  }, [root, plans, horizonPlans, heightAt, invalidate])
  useEffect(
    () => () => {
      disposePrimitiveInstances(root)
    },
    [root],
  )
  return <primitive object={root} dispose={null} />
}
