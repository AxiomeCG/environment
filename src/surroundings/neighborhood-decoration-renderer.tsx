'use client'

import { type MaterialSchema } from '@pascal-app/core'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import {
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  createMaterial,
  useGLTFKTX2,
} from '@pascal-app/viewer'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  BufferGeometry,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type {
  CatalogPropPlan,
  FencePlan,
  MailboxPlan,
  NeighborhoodCatalogAssetId,
  NeighborhoodDecorationPlan,
  PavingKind,
  PavingPlan,
  StreetLightPlan,
} from './neighborhood-decoration'

// ez-tree touches `document` at import time; load the tree renderer lazily so
// the plan grammar and this module stay importable under SSR and Bun tests.
const NeighborhoodTrees = lazy(() =>
  import('./neighborhood-trees').then((module) => ({ default: module.NeighborhoodTrees })),
)

const NO_RAYCAST = () => undefined
const UNIT_SCALE = new Vector3(1, 1, 1)
const UP = new Vector3(0, 1, 0)
const REQUIRED_CATALOG_ASSET_IDS = ['bush', 'hydrant', 'tesla'] as const
// Paving sits just above the lot lawn (0.03) and below the sidewalk (0.055).
const PAVING_SURFACE: Readonly<Record<PavingKind, { color: string; elevation: number; thickness: number }>> = {
  driveway: { color: '#8d8b86', elevation: 0.045, thickness: 0.04 },
  path: { color: '#a7a39a', elevation: 0.045, thickness: 0.04 },
  patio: { color: '#a19a90', elevation: 0.05, thickness: 0.045 },
}

const CATALOG_ASSETS = REQUIRED_CATALOG_ASSET_IDS.map((id) => {
  const asset = CATALOG_ITEMS.find((candidate) => candidate.id === id)
  if (!asset) throw new Error(`Missing Pascal catalog asset: ${id}`)
  return {
    id,
    src: asset.src,
    offset: asset.offset ?? [0, 0, 0],
    rotation: asset.rotation ?? [0, 0, 0],
    scale: asset.scale ?? [1, 1, 1],
  }
})

function customMaterial(
  color: string,
  roughness: number,
  metalness = 0,
): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color,
      roughness,
      metalness,
      opacity: 1,
      transparent: false,
      side: 'front',
    },
  }
}

function placementMatrix(position: readonly [number, number], rotationY: number): Matrix4 {
  return new Matrix4().compose(
    new Vector3(position[0], 0, position[1]),
    new Quaternion().setFromAxisAngle(UP, rotationY),
    UNIT_SCALE,
  )
}

let fenceWallGeometry: BufferGeometry | undefined
let fenceWallMaterial: Material | undefined

function getFenceWallGeometry(): BufferGeometry {
  fenceWallGeometry ??= createColumnBoxGeometry(1, 1, 1, 0.015)
  return fenceWallGeometry
}

function getFenceWallMaterial(): Material {
  fenceWallMaterial ??= createMaterial(customMaterial('#ffffff', 0.9))
  return fenceWallMaterial
}

/**
 * Neighbor boundaries are presentation LOD, not editable fence assemblies.
 * One painted unit wall is scaled per run and instanced for the whole ring.
 */
const PRESENTATION_INSTANCE_CAPACITY = 64

function updateFenceInstances(root: Group, plans: readonly FencePlan[]): void {
  let instances = root.children[0] as InstancedMesh | undefined
  const capacity = instances?.userData.capacity as number | undefined
  if (!instances || (capacity ?? 0) < plans.length) {
    if (instances) {
      root.remove(instances)
      instances.dispose()
    }
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length)
    instances = new InstancedMesh(
      getFenceWallGeometry(),
      getFenceWallMaterial(),
      nextCapacity,
    )
    instances.name = 'environment-neighborhood-painted-boundary-instances'
    instances.castShadow = true
    instances.receiveShadow = true
    instances.raycast = NO_RAYCAST
    instances.frustumCulled = false
    instances.userData.capacity = nextCapacity
    root.add(instances)
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const tint = new Color()
  plans.forEach((plan, index) => {
    const thickness = plan.style === 'rail' ? 0.065 : plan.style === 'slat' ? 0.075 : 0.09
    position.set(plan.position[0], plan.height / 2, plan.position[1])
    quaternion.setFromAxisAngle(UP, plan.rotationY)
    scale.set(plan.length, plan.height, thickness)
    matrix.compose(position, quaternion, scale)
    instances.setMatrixAt(index, matrix)
    instances.setColorAt(index, tint.set(plan.color))
  })
  instances.count = plans.length
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  root.userData = {
    drawCallCount: plans.length === 0 ? 0 : 1,
    fenceCount: plans.length,
    prototypeCount: plans.length === 0 ? 0 : 1,
  }
}

/**
 * Neighbor boundaries are presentation LOD, not editable fence assemblies.
 * One painted unit wall is scaled per run and instanced for the whole ring.
 */
export function buildFenceInstances(plans: readonly FencePlan[]): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-fences'
  updateFenceInstances(root, plans)
  return root
}

function translated(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  geometry.applyMatrix4(new Matrix4().makeTranslation(x, y, z))
  return geometry
}

function buildStreetLightGeometry(): BufferGeometry {
  const parts = [
    translated(createColumnCylinderGeometry({
      height: 4.7,
      radiusBottom: 0.075,
      radiusTop: 0.055,
      segments: 12,
    }), 0, 2.35, 0),
    translated(createColumnCylinderGeometry({
      height: 0.18,
      radiusBottom: 0.18,
      radiusTop: 0.15,
      segments: 12,
    }), 0, 0.09, 0),
    translated(createColumnBoxGeometry(0.95, 0.075, 0.075, 0.025), 0.43, 4.62, 0),
    translated(createColumnBoxGeometry(0.48, 0.11, 0.24, 0.035), 0.88, 4.55, 0),
  ]
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry()
  for (const part of parts) part.dispose()
  return merged
}
let streetLightGeometry: BufferGeometry | undefined
let streetLightMaterial: Material | undefined

function getStreetLightGeometry(): BufferGeometry {
  streetLightGeometry ??= buildStreetLightGeometry()
  return streetLightGeometry
}

function getStreetLightMaterial(): Material {
  streetLightMaterial ??= createMaterial(customMaterial('#343b3d', 0.58, 0.38))
  return streetLightMaterial
}


function updateStreetLightInstances(root: Group, plans: readonly StreetLightPlan[]): void {
  let instances = root.children[0] as InstancedMesh | undefined
  const capacity = instances?.userData.capacity as number | undefined
  if (!instances || (capacity ?? 0) < plans.length) {
    if (instances) {
      root.remove(instances)
      instances.dispose()
    }
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length)
    instances = new InstancedMesh(
      getStreetLightGeometry(),
      getStreetLightMaterial(),
      nextCapacity,
    )
    instances.name = 'pascal-column-street-light-instances'
    instances.castShadow = true
    instances.receiveShadow = true
    instances.raycast = NO_RAYCAST
    instances.frustumCulled = false
    instances.userData.capacity = nextCapacity
    root.add(instances)
  }
  plans.forEach((plan, index) => {
    instances.setMatrixAt(index, placementMatrix(plan.position, plan.rotationY))
  })
  instances.count = plans.length
  instances.instanceMatrix.needsUpdate = true
  instances.userData = {
    capacity: capacity ?? Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length),
    instanceCount: plans.length,
    roadClass: 'primary-road',
  }
  root.userData = {
    drawCallCount: plans.length === 0 ? 0 : 1,
    streetLightCount: plans.length,
  }
}

function buildStreetLightInstances(plans: readonly StreetLightPlan[]): Group {
  const root = new Group()
  root.name = 'environment-streetscape-street-lights'
  updateStreetLightInstances(root, plans)
  return root
}

function disposeOwnedInstances(root: Group, disposeGeometry = true): void {
  root.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return
    if (disposeGeometry) object.geometry.dispose()
    object.dispose()
  })
  root.clear()
}
const PAVING_KINDS = ['driveway', 'path', 'patio'] as const satisfies readonly PavingKind[]
const pavingMaterials = new Map<PavingKind, Material>()
let pavingUnitGeometry: BufferGeometry | undefined

function getPavingGeometry(): BufferGeometry {
  pavingUnitGeometry ??= createColumnBoxGeometry(1, 1, 1, 0.01)
  return pavingUnitGeometry
}

function getPavingMaterial(kind: PavingKind): Material {
  const cached = pavingMaterials.get(kind)
  if (cached) return cached
  const material = createMaterial(customMaterial(PAVING_SURFACE[kind].color, 0.94))
  pavingMaterials.set(kind, material)
  return material
}

function updatePavingInstances(root: Group, plans: readonly PavingPlan[]): void {
  const byKind = new Map<PavingKind, PavingPlan[]>()
  for (const plan of plans) {
    const group = byKind.get(plan.kind)
    if (group) group.push(plan)
    else byKind.set(plan.kind, [plan])
  }

  let drawCallCount = 0
  for (const kind of PAVING_KINDS) {
    const kindPlans = byKind.get(kind) ?? []
    let instances = root.children.find(
      (child) => child.userData.kind === kind,
    ) as InstancedMesh | undefined
    const capacity = instances?.userData.capacity as number | undefined
    if (!instances || (capacity ?? 0) < kindPlans.length) {
      if (instances) {
        root.remove(instances)
        instances.dispose()
      }
      const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, kindPlans.length)
      instances = new InstancedMesh(
        getPavingGeometry(),
        getPavingMaterial(kind),
        nextCapacity,
      )
      instances.name = `pascal-slab-${kind}-instances`
      instances.receiveShadow = true
      instances.raycast = NO_RAYCAST
      instances.frustumCulled = false
      instances.userData = { capacity: nextCapacity, kind }
      root.add(instances)
    }

    const matrix = new Matrix4()
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    const surface = PAVING_SURFACE[kind]
    kindPlans.forEach((plan, index) => {
      const first = plan.polygon[0]!
      const second = plan.polygon[1]!
      const third = plan.polygon[2]!
      const acrossX = second[0] - first[0]
      const acrossZ = second[1] - first[1]
      const width = Math.hypot(acrossX, acrossZ)
      const depth = Math.hypot(third[0] - second[0], third[1] - second[1])
      const centerX = plan.polygon.reduce((sum, point) => sum + point[0], 0)
        / plan.polygon.length
      const centerZ = plan.polygon.reduce((sum, point) => sum + point[1], 0)
        / plan.polygon.length
      position.set(centerX, surface.elevation - surface.thickness / 2, centerZ)
      quaternion.setFromAxisAngle(UP, Math.atan2(-acrossZ, acrossX))
      scale.set(width, surface.thickness, depth)
      matrix.compose(position, quaternion, scale)
      instances.setMatrixAt(index, matrix)
    })
    instances.count = kindPlans.length
    instances.instanceMatrix.needsUpdate = true
    instances.userData = {
      capacity: instances.instanceMatrix.count,
      kind,
      slabCount: kindPlans.length,
    }
    if (kindPlans.length > 0) drawCallCount += 1
  }
  root.userData = { drawCallCount, pavingCount: plans.length }
}

/**
 * Rectangular drives, paths, and patios share one unit slab geometry. Only
 * their instance transforms change when the road network changes.
 */
export function buildPavingMeshes(plans: readonly PavingPlan[]): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-paving'
  updatePavingInstances(root, plans)
  return root
}

function buildMailboxGeometry(): BufferGeometry {
  const parts = [
    translated(createColumnBoxGeometry(0.09, 1.05, 0.09, 0.012), 0, 0.525, 0),
    translated(createColumnBoxGeometry(0.5, 0.24, 0.22, 0.03), 0.12, 1.2, 0),
  ]
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry()
  for (const part of parts) part.dispose()
  return merged
}
let mailboxGeometry: BufferGeometry | undefined
let mailboxMaterial: Material | undefined

function getMailboxGeometry(): BufferGeometry {
  mailboxGeometry ??= buildMailboxGeometry()
  return mailboxGeometry
}

function getMailboxMaterial(): Material {
  mailboxMaterial ??= createMaterial(customMaterial('#3d3f42', 0.62, 0.3))
  return mailboxMaterial
}


function updateMailboxInstances(root: Group, plans: readonly MailboxPlan[]): void {
  let instances = root.children[0] as InstancedMesh | undefined
  const capacity = instances?.userData.capacity as number | undefined
  if (!instances || (capacity ?? 0) < plans.length) {
    if (instances) {
      root.remove(instances)
      instances.dispose()
    }
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length)
    instances = new InstancedMesh(
      getMailboxGeometry(),
      getMailboxMaterial(),
      nextCapacity,
    )
    instances.name = 'pascal-column-mailbox-instances'
    instances.castShadow = true
    instances.receiveShadow = true
    instances.raycast = NO_RAYCAST
    instances.frustumCulled = false
    instances.userData.capacity = nextCapacity
    root.add(instances)
  }
  plans.forEach((plan, index) => {
    instances.setMatrixAt(index, placementMatrix(plan.position, plan.rotationY))
  })
  instances.count = plans.length
  instances.instanceMatrix.needsUpdate = true
  instances.userData = {
    capacity: instances.instanceMatrix.count,
    instanceCount: plans.length,
  }
  root.userData = {
    drawCallCount: plans.length === 0 ? 0 : 1,
    mailboxCount: plans.length,
  }
}

export function buildMailboxInstances(plans: readonly MailboxPlan[]): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-mailboxes'
  updateMailboxInstances(root, plans)
  return root
}
type CatalogMeshTemplate = {
  geometry: BufferGeometry
  material: Material | Material[]
  matrixWorld: Matrix4
}

type CatalogPoolEntry = {
  assetTransform: Matrix4
  capacity: number
  instances: InstancedMesh[]
  templates: CatalogMeshTemplate[]
}

const catalogInstancePools = new WeakMap<
  Group,
  Map<NeighborhoodCatalogAssetId, CatalogPoolEntry>
>()

function createCatalogMeshes(
  root: Group,
  assetId: NeighborhoodCatalogAssetId,
  templates: readonly CatalogMeshTemplate[],
  capacity: number,
): InstancedMesh[] {
  return templates.map((template) => {
    const instances = new InstancedMesh(
      template.geometry,
      template.material,
      capacity,
    )
    instances.name = `pascal-catalog-${assetId}-instances`
    instances.castShadow = true
    instances.receiveShadow = true
    instances.raycast = NO_RAYCAST
    instances.frustumCulled = false
    instances.count = 0
    root.add(instances)
    return instances
  })
}

function createCatalogInstancePool(
  gltfs: readonly { scene: Group }[],
): Group {
  const root = new Group()
  root.name = 'environment-pascal-catalog-props'
  const entries = new Map<NeighborhoodCatalogAssetId, CatalogPoolEntry>()
  CATALOG_ASSETS.forEach((asset, assetIndex) => {
    const gltf = gltfs[assetIndex]
    if (!gltf) return
    gltf.scene.updateMatrixWorld(true)
    const templates: CatalogMeshTemplate[] = []
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      templates.push({
        geometry: object.geometry,
        material: object.material as Material | Material[],
        matrixWorld: object.matrixWorld.clone(),
      })
    })
    const capacity = PRESENTATION_INSTANCE_CAPACITY
    entries.set(asset.id, {
      assetTransform: new Matrix4().compose(
        new Vector3(...asset.offset),
        new Quaternion().setFromEuler(new Euler(...asset.rotation)),
        new Vector3(...asset.scale),
      ),
      capacity,
      instances: createCatalogMeshes(root, asset.id, templates, capacity),
      templates,
    })
  })
  catalogInstancePools.set(root, entries)
  return root
}

function updateCatalogInstancePool(root: Group, plans: readonly CatalogPropPlan[]): void {
  const entries = catalogInstancePools.get(root)
  if (!entries) return
  const plansByAsset = new Map<NeighborhoodCatalogAssetId, CatalogPropPlan[]>()
  for (const plan of plans) {
    const matchingPlans = plansByAsset.get(plan.assetId)
    if (matchingPlans) matchingPlans.push(plan)
    else plansByAsset.set(plan.assetId, [plan])
  }

  let drawCallCount = 0
  const rootTransform = new Matrix4()
  const combined = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  for (const asset of CATALOG_ASSETS) {
    const matchingPlans = plansByAsset.get(asset.id) ?? []
    const entry = entries.get(asset.id)
    if (!entry) continue
    if (entry.capacity < matchingPlans.length) {
      for (const mesh of entry.instances) {
        root.remove(mesh)
        mesh.dispose()
      }
      entry.capacity = matchingPlans.length
      entry.instances = createCatalogMeshes(
        root,
        asset.id,
        entry.templates,
        entry.capacity,
      )
    }
    entry.instances.forEach((instances, templateIndex) => {
      matchingPlans.forEach((plan, instanceIndex) => {
        position.set(plan.position[0], 0, plan.position[1])
        quaternion.setFromAxisAngle(UP, plan.rotationY)
        scale.setScalar(plan.scale)
        rootTransform.compose(position, quaternion, scale)
        combined.copy(rootTransform)
          .multiply(entry.assetTransform)
          .multiply(entry.templates[templateIndex]!.matrixWorld)
        instances.setMatrixAt(instanceIndex, combined)
      })
      instances.count = matchingPlans.length
      instances.instanceMatrix.needsUpdate = true
      instances.userData = {
        assetId: asset.id,
        instanceCount: matchingPlans.length,
      }
      if (matchingPlans.length > 0) drawCallCount += 1
    })
  }
  root.userData = { catalogPropCount: plans.length, drawCallCount }
}

function disposeCatalogInstancePool(root: Group): void {
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose()
  })
  root.clear()
  catalogInstancePools.delete(root)
}

function CatalogInstances({ plans }: { plans: readonly CatalogPropPlan[] }) {
  const bush = useGLTFKTX2(CATALOG_ASSETS[0]!.src) as unknown as { scene: Group }
  const hydrant = useGLTFKTX2(CATALOG_ASSETS[1]!.src) as unknown as { scene: Group }
  const car = useGLTFKTX2(CATALOG_ASSETS[2]!.src) as unknown as { scene: Group }
  const gltfs = useMemo(() => [bush, hydrant, car] as const, [bush, hydrant, car])
  const instances = useMemo(() => createCatalogInstancePool(gltfs), [gltfs])

  useLayoutEffect(() => {
    updateCatalogInstancePool(instances, plans)
  }, [instances, plans])
  useEffect(() => () => {
    disposeCatalogInstancePool(instances)
  }, [instances])

  return <primitive object={instances} />
}

export function NeighborhoodDecorations({
  plan,
}: {
  plan: NeighborhoodDecorationPlan
}) {
  const fences = useMemo(() => buildFenceInstances([]), [])
  const streetLights = useMemo(() => buildStreetLightInstances([]), [])
  const paving = useMemo(() => buildPavingMeshes([]), [])
  const mailboxes = useMemo(() => buildMailboxInstances([]), [])

  useLayoutEffect(() => {
    updateFenceInstances(fences, plan.fences)
    updateStreetLightInstances(streetLights, plan.streetLights)
    updatePavingInstances(paving, plan.paving)
    updateMailboxInstances(mailboxes, plan.mailboxes)
  }, [fences, mailboxes, paving, plan, streetLights])
  useEffect(() => () => {
    disposeOwnedInstances(fences, false)
    disposeOwnedInstances(streetLights, false)
    disposeOwnedInstances(mailboxes, false)
    disposeOwnedInstances(paving, false)
  }, [fences, streetLights, mailboxes, paving])

  return (
    <group name="environment-neighborhood-decorations">
      <primitive object={fences} />
      <primitive object={streetLights} />
      <primitive object={paving} />
      <primitive object={mailboxes} />
      <Suspense fallback={null}>
        <NeighborhoodTrees plans={plan.trees} />
      </Suspense>
      <Suspense fallback={null}>
        <CatalogInstances plans={plan.catalogProps} />
      </Suspense>
    </group>
  )
}
