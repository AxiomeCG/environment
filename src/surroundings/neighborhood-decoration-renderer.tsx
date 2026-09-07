'use client'

import { type MaterialSchema } from '@pascal-app/core'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import {
  createMaterial,
  useGLTFKTX2,
} from '@pascal-app/viewer'
import { Suspense, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { array, attribute, cameraPosition, positionGeometry, positionLocal, positionWorld, smoothstep, vec3, vertexIndex } from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
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
import { createContextInstances } from './primitive-instances'
import { SURROUNDINGS_NIGHT_FACTOR } from './night-lighting'
import { PresentationMaterial } from './presentation-material'
import {
  buildFencePresentationMembers,
  createMailboxPresentationGeometry,
  createParkedCarPresentationGeometry,
  createStreetLightPresentationGeometry,
  type StreetscapeGeometryPair,
} from './streetscape-prop-geometry'
import { seededUnit } from './seeded-random'


const NO_RAYCAST = () => undefined
const UNIT_SCALE = new Vector3(1, 1, 1)
const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const REQUIRED_CATALOG_ASSET_IDS = ['hydrant'] as const
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

export type HeightAt = (x: number, z: number) => number
export const FLAT_HEIGHT_AT: HeightAt = () => 0

function groundHeight(heightAt: HeightAt, x: number, z: number): number {
  const height = heightAt(x, z)
  return Number.isFinite(height) ? height : 0
}

function setPlacementMatrix(
  matrix: Matrix4,
  translation: Vector3,
  quaternion: Quaternion,
  position: readonly [number, number],
  rotationY: number,
  heightAt: HeightAt,
): Matrix4 {
  translation.set(
    position[0],
    groundHeight(heightAt, position[0], position[1]),
    position[1],
  )
  quaternion.setFromAxisAngle(UP, rotationY)
  return matrix.compose(translation, quaternion, UNIT_SCALE)
}

let fenceMemberGeometry: BufferGeometry | undefined
let fenceMaterial: Material | undefined

function getFenceMemberGeometry(): BufferGeometry {
  fenceMemberGeometry ??= new BoxGeometry(1, 1, 1)
  return fenceMemberGeometry
}

function getFenceMaterial(): Material {
  fenceMaterial ??= createMaterial(customMaterial('#ffffff', 0.86))
  return fenceMaterial
}

/**
 * Streetscape's timber gate board/rail/stile language reduced to one shared
 * painted member primitive and one draw call for the neighborhood ring.
 */
const PRESENTATION_INSTANCE_CAPACITY = 64
const SHRUB_LOBES = [
  { position: [0, 0.7, 0], scale: [1.05, 0.92, 0.86] },
  { position: [-0.68, 0.52, 0.02], scale: [0.78, 0.7, 0.7] },
  { position: [0.68, 0.54, -0.02], scale: [0.78, 0.72, 0.7] },
  { position: [-0.22, 0.45, 0.42], scale: [0.74, 0.62, 0.72] },
  { position: [0.24, 0.5, -0.38], scale: [0.72, 0.65, 0.7] },
  { position: [-0.5, 0.42, -0.34], scale: [0.68, 0.58, 0.66] },
  { position: [0.52, 0.43, 0.32], scale: [0.69, 0.59, 0.67] },
] as const
const SHRUB_COLORS = ['#58784d', '#668557', '#4f7047', '#718e5e'] as const
let shrubGeometry: BufferGeometry | undefined
let shrubMaterial: Material | undefined

function getShrubGeometry(): BufferGeometry {
  if (shrubGeometry) return shrubGeometry
  const parts = SHRUB_LOBES.map(({ position, scale }) => {
    const geometry = new IcosahedronGeometry(0.75, 0)
    geometry.scale(scale[0], scale[1], scale[2])
    geometry.translate(position[0], position[1], position[2])
    return geometry
  })
  shrubGeometry = mergeGeometries(parts, false) ?? new BufferGeometry()
  for (const part of parts) part.dispose()
  return shrubGeometry
}

function getShrubMaterial(): Material {
  shrubMaterial ??= createMaterial(customMaterial('#ffffff', 1))
  return shrubMaterial
}

function updateShrubInstances(
  root: Group,
  plans: readonly CatalogPropPlan[],
  heightAt: HeightAt,
): void {
  const shrubPlans = plans.filter(({ assetId }) => assetId === 'bush')
  let instances = root.children[0] as InstancedMesh | undefined
  const capacity = instances?.userData.capacity as number | undefined
  if (!instances || (capacity ?? 0) < shrubPlans.length) {
    if (instances) {
      root.remove(instances)
      instances.dispose()
    }
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, shrubPlans.length)
    instances = createContextInstances(getShrubGeometry(), getShrubMaterial(), nextCapacity)
    instances.name = 'environment-neighborhood-shrub-instances'
    instances.castShadow = true
    instances.receiveShadow = true
    instances.raycast = NO_RAYCAST
    instances.frustumCulled = true
    instances.userData.capacity = nextCapacity
    root.add(instances)
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const tint = new Color()
  shrubPlans.forEach((plan, index) => {
    position.set(
      plan.position[0],
      groundHeight(heightAt, plan.position[0], plan.position[1]) + 0.03,
      plan.position[1],
    )
    quaternion.setFromAxisAngle(UP, plan.rotationY)
    scale.setScalar(plan.scale)
    matrix.compose(position, quaternion, scale)
    instances.setMatrixAt(index, matrix)
    const colorIndex = Math.floor(seededUnit('pascal-shrub', plan.id) * SHRUB_COLORS.length)
    instances.setColorAt(index, tint.set(SHRUB_COLORS[colorIndex] ?? SHRUB_COLORS[0]))
  })
  instances.count = shrubPlans.length
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.computeBoundingSphere()
  instances.userData = {
    capacity: instances.instanceMatrix.count,
    instanceCount: shrubPlans.length,
  }
  root.userData = {
    drawCallCount: shrubPlans.length === 0 ? 0 : 1,
    instanceCount: shrubPlans.length,
    lobeCount: SHRUB_LOBES.length,
  }
}

export function buildShrubInstances(
  plans: readonly CatalogPropPlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-shrubs'
  updateShrubInstances(root, plans, heightAt)
  return root
}

const PARKED_CAR_COLORS = ['#e8e8e5', '#3f5267', '#8c3530', '#55585b'] as const
let parkedCarGeometry: StreetscapeGeometryPair | undefined
let parkedCarBodyMaterial: Material | undefined
let parkedCarAccentMaterial: Material | undefined

function updateParkedCarInstances(
  root: Group,
  plans: readonly CatalogPropPlan[],
  heightAt: HeightAt,
): void {
  const carPlans = plans.filter(({ assetId }) => assetId === 'parked-car')
  parkedCarGeometry ??= createParkedCarPresentationGeometry()
  parkedCarBodyMaterial ??= createMaterial(customMaterial('#ffffff', 0.38, 0.12))
  if (!parkedCarAccentMaterial) {
    const material = new MeshStandardNodeMaterial({ color: '#ffffff', vertexColors: true })
    const surface = attribute<'vec2'>('carSurface', 'vec2')
    material.roughnessNode = surface.x
    material.metalnessNode = surface.y
    parkedCarAccentMaterial = material
  }
  let instances = root.children as InstancedMesh[]
  const capacity = instances[0]?.userData.capacity as number | undefined
  if (instances.length !== 2 || (capacity ?? 0) < carPlans.length) {
    for (const mesh of instances) mesh.dispose()
    root.clear()
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, carPlans.length)
    const body = createContextInstances(
      parkedCarGeometry.body,
      parkedCarBodyMaterial,
      nextCapacity,
    )
    body.name = 'environment-generic-parked-car-body-instances'
    body.castShadow = true
    body.receiveShadow = true
    body.raycast = NO_RAYCAST
    body.userData = { capacity: nextCapacity, part: 'body' }
    const accent = createContextInstances(
      parkedCarGeometry.accent,
      parkedCarAccentMaterial,
      nextCapacity,
    )
    accent.name = 'environment-generic-parked-car-glass-tyre-instances'
    accent.castShadow = true
    accent.receiveShadow = true
    accent.raycast = NO_RAYCAST
    accent.userData = { capacity: nextCapacity, part: 'glass-tyre' }
    root.add(body, accent)
    instances = [body, accent]
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const tint = new Color()
  carPlans.forEach((plan, index) => {
    position.set(
      plan.position[0],
      groundHeight(heightAt, plan.position[0], plan.position[1]),
      plan.position[1],
    )
    quaternion.setFromAxisAngle(UP, plan.rotationY)
    scale.setScalar(plan.scale)
    matrix.compose(position, quaternion, scale)
    for (const mesh of instances) mesh.setMatrixAt(index, matrix)
    const colorIndex = Math.floor(
      seededUnit('pascal-parked-car', plan.id) * PARKED_CAR_COLORS.length,
    )
    instances[0]!.setColorAt(
      index,
      tint.set(PARKED_CAR_COLORS[colorIndex] ?? PARKED_CAR_COLORS[0]),
    )
  })
  for (const mesh of instances) {
    mesh.count = carPlans.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.userData = {
      capacity: mesh.instanceMatrix.count,
      instanceCount: carPlans.length,
      part: mesh.userData.part,
    }
  }
  if (instances[0]!.instanceColor) instances[0]!.instanceColor.needsUpdate = true
  const prototypeTriangleCount = (
    (parkedCarGeometry.body.index?.count
      ?? parkedCarGeometry.body.getAttribute('position').count)
    + (parkedCarGeometry.accent.index?.count
      ?? parkedCarGeometry.accent.getAttribute('position').count)
  ) / 3
  root.userData = {
    drawCallCount: carPlans.length === 0 ? 0 : 2,
    instanceCount: carPlans.length,
    prototypeTriangleCount,
    visibleTriangleCount: prototypeTriangleCount * carPlans.length,
  }
}

export function buildParkedCarInstances(
  plans: readonly CatalogPropPlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-generic-parked-cars'
  updateParkedCarInstances(root, plans, heightAt)
  return root
}

function updateFenceInstances(
  root: Group,
  plans: readonly FencePlan[],
  heightAt: HeightAt,
): void {
  const members = plans.flatMap((plan) => (
    buildFencePresentationMembers(plan.style, plan.length, plan.height)
      .map((member) => ({ member, plan }))
  ))
  let instances = root.children[0] as InstancedMesh | undefined
  const capacity = instances?.userData.capacity as number | undefined
  if (!instances || (capacity ?? 0) < members.length) {
    if (instances) {
      root.remove(instances)
      instances.dispose()
    }
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, members.length)
    instances = createContextInstances(
      getFenceMemberGeometry(),
      getFenceMaterial(),
      nextCapacity,
    )
    instances.name = 'environment-neighborhood-timber-fence-members'
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
  const yaw = new Quaternion()
  const roll = new Quaternion()
  const scale = new Vector3()
  const tint = new Color()
  members.forEach(({ member, plan }, index) => {
    const directionX = Math.cos(plan.rotationY)
    const directionZ = -Math.sin(plan.rotationY)
    const centerX = plan.position[0] + directionX * member.x
    const centerZ = plan.position[1] + directionZ * member.x
    const followsGrade = member.width > 0.3
    const halfWidth = followsGrade ? member.width / 2 : 0
    const startHeight = groundHeight(
      heightAt,
      centerX - directionX * halfWidth,
      centerZ - directionZ * halfWidth,
    )
    const endHeight = groundHeight(
      heightAt,
      centerX + directionX * halfWidth,
      centerZ + directionZ * halfWidth,
    )
    const gradeAngle = followsGrade
      ? Math.atan2(endHeight - startHeight, member.width)
      : 0
    position.set(centerX, (startHeight + endHeight) / 2 + member.y, centerZ)
    yaw.setFromAxisAngle(UP, plan.rotationY)
    roll.setFromAxisAngle(FORWARD, gradeAngle)
    quaternion.copy(yaw).multiply(roll)
    scale.set(member.width, member.height, member.depth)
    matrix.compose(position, quaternion, scale)
    instances.setMatrixAt(index, matrix)
    instances.setColorAt(index, tint.set(plan.color))
  })
  instances.count = members.length
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.userData = {
    capacity: instances.instanceMatrix.count,
    instanceCount: members.length,
  }
  root.userData = {
    drawCallCount: members.length === 0 ? 0 : 1,
    fenceCount: plans.length,
    memberCount: members.length,
    prototypeCount: members.length === 0 ? 0 : 1,
  }
}

/**
 * Painted fence runs use the pinned Streetscape timber-gate silhouette while
 * retaining one shared primitive/material batch.
 */
export function buildFenceInstances(
  plans: readonly FencePlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-fences'
  updateFenceInstances(root, plans, heightAt)
  return root
}


const STREET_LIGHT_HEAD_LOCAL_X = 1.65
const STREET_LIGHT_POOL_LENGTH = 9
const STREET_LIGHT_POOL_WIDTH = 5.8
// Clear collector asphalt and paint, including the terrain drape offset.
const STREET_LIGHT_POOL_GROUND_OFFSET = 0.28
let streetLightGeometry: StreetscapeGeometryPair | undefined
let streetLightPoolGeometry: PlaneGeometry | undefined
let streetLightBodyMaterial: Material | undefined
let streetLightLensMaterial: PresentationMaterial | undefined
let streetLightPoolMaterial: MeshBasicNodeMaterial | undefined

function getStreetLightLensMaterial(): PresentationMaterial {
  if (streetLightLensMaterial) return streetLightLensMaterial
  const material = new PresentationMaterial({
    color: '#cbd2d4',
    metalness: 0.08,
    roughness: 0.2,
  })
  const light = new Color('#ffd088')
  material.name = 'surroundings-street-light-lens'
  material.emissiveNode = vec3(light.r, light.g, light.b)
    .mul(SURROUNDINGS_NIGHT_FACTOR).mul(5)
  streetLightLensMaterial = material
  return material
}

function getStreetLightPoolGeometry(): PlaneGeometry {
  streetLightPoolGeometry ??= new PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2)
  return streetLightPoolGeometry
}

function getStreetLightPoolMaterial(): MeshBasicNodeMaterial {
  if (streetLightPoolMaterial) return streetLightPoolMaterial
  const heights0 = attribute<'vec3'>('lightPoolHeights0', 'vec3')
  const heights1 = attribute<'vec3'>('lightPoolHeights1', 'vec3')
  const heights2 = attribute<'vec3'>('lightPoolHeights2', 'vec3')
  const ground = array([
    heights0.x, heights0.y, heights0.z,
    heights1.x, heights1.y, heights1.z,
    heights2.x, heights2.y, heights2.z,
  ])
  const radius = positionGeometry.xz.mul(2).length()
  const feather = smoothstep(0.12, 1.12, radius).oneMinus()
  const cameraFade = smoothstep(120, 240, positionWorld.sub(cameraPosition).length()).oneMinus()
  const opacity = feather.mul(cameraFade).mul(SURROUNDINGS_NIGHT_FACTOR).mul(0.22)
  const light = new Color('#ffc96f')
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -2,
  })
  material.name = 'surroundings-street-light-ground-pools'
  material.colorNode = vec3(light.r, light.g, light.b)
  material.opacityNode = opacity
  material.maskNode = opacity.greaterThan(0.002)
  // NodeMaterial applies instancing before positionNode: retain that transform.
  material.positionNode = positionLocal.add(vec3(
    0,
    ground.element(vertexIndex) as Node<'float'>,
    0,
  ))
  streetLightPoolMaterial = material
  return material
}

function updateStreetLightInstances(
  root: Group,
  plans: readonly StreetLightPlan[],
  heightAt: HeightAt,
): void {
  streetLightGeometry ??= createStreetLightPresentationGeometry()
  streetLightBodyMaterial ??= createMaterial(customMaterial('#30373b', 0.38, 0.68))
  const lensMaterial = getStreetLightLensMaterial()
  let instances = root.children as InstancedMesh[]
  const capacity = instances[0]?.userData.capacity as number | undefined
  if (instances.length !== 3 || (capacity ?? 0) < plans.length) {
    for (const mesh of instances) mesh.dispose()
    root.clear()
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length)
    const body = createContextInstances(
      streetLightGeometry.body,
      streetLightBodyMaterial,
      nextCapacity,
    )
    body.name = 'streetscape-roadway-led-body-instances'
    body.castShadow = true
    body.receiveShadow = true
    body.raycast = NO_RAYCAST
    body.frustumCulled = false
    body.userData = { capacity: nextCapacity, part: 'body' }
    const lens = createContextInstances(
      streetLightGeometry.accent,
      lensMaterial,
      nextCapacity,
    )
    lens.name = 'streetscape-roadway-led-optic-instances'
    lens.receiveShadow = true
    lens.raycast = NO_RAYCAST
    lens.frustumCulled = false
    lens.userData = { capacity: nextCapacity, part: 'optic' }
    const pool = createContextInstances(
      getStreetLightPoolGeometry(),
      getStreetLightPoolMaterial(),
      nextCapacity,
    )
    pool.name = 'streetscape-roadway-led-ground-pool-instances'
    pool.renderOrder = 1
    pool.raycast = NO_RAYCAST
    pool.userData = { capacity: nextCapacity, part: 'ground-pool' }
    for (const [name, size] of [
      ['lightPoolHeights0', 3],
      ['lightPoolHeights1', 3],
      ['lightPoolHeights2', 3],
    ] as const) {
      pool.geometry.setAttribute(
        name,
        new InstancedBufferAttribute(new Float32Array(nextCapacity * size), size),
      )
    }
    root.add(body, lens, pool)
    instances = [body, lens, pool]
  }

  const [body, lens, pool] = instances as [InstancedMesh, InstancedMesh, InstancedMesh]
  const matrix = new Matrix4()
  const translation = new Vector3()
  const quaternion = new Quaternion()
  const poolScale = new Vector3(STREET_LIGHT_POOL_LENGTH, 1, STREET_LIGHT_POOL_WIDTH)
  const poolVertices = getStreetLightPoolGeometry().getAttribute('position')
  const samples = new Float32Array(poolVertices.count)
  const heightRows = [0, 1, 2].map((row) =>
    pool.geometry.getAttribute(`lightPoolHeights${row}`) as InstancedBufferAttribute)
  let verticalMargin = 0
  plans.forEach((plan, index) => {
    setPlacementMatrix(
      matrix,
      translation,
      quaternion,
      plan.position,
      plan.rotationY,
      heightAt,
    )
    body.setMatrixAt(index, matrix)
    lens.setMatrixAt(index, matrix)

    const cosine = Math.cos(plan.rotationY)
    const sine = Math.sin(plan.rotationY)
    const centerX = plan.position[0] + cosine * STREET_LIGHT_HEAD_LOCAL_X
    const centerZ = plan.position[1] - sine * STREET_LIGHT_HEAD_LOCAL_X
    const baseY = groundHeight(heightAt, centerX, centerZ)
    for (let vertex = 0; vertex < poolVertices.count; vertex += 1) {
      const localX = poolVertices.getX(vertex) * STREET_LIGHT_POOL_LENGTH
      const localZ = poolVertices.getZ(vertex) * STREET_LIGHT_POOL_WIDTH
      const sampleX = centerX + cosine * localX + sine * localZ
      const sampleZ = centerZ - sine * localX + cosine * localZ
      samples[vertex] = groundHeight(heightAt, sampleX, sampleZ)
        - baseY + STREET_LIGHT_POOL_GROUND_OFFSET
      verticalMargin = Math.max(verticalMargin, Math.abs(samples[vertex]!))
    }
    quaternion.setFromAxisAngle(UP, plan.rotationY)
    pool.setMatrixAt(index, matrix.compose(
      translation.set(centerX, baseY, centerZ),
      quaternion,
      poolScale,
    ))
    for (let row = 0; row < 3; row += 1) {
      heightRows[row]!.setXYZ(
        index,
        samples[row * 3]!,
        samples[row * 3 + 1]!,
        samples[row * 3 + 2]!,
      )
    }
  })
  for (const mesh of instances) {
    mesh.count = plans.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.userData = {
      capacity: mesh.instanceMatrix.count,
      instanceCount: plans.length,
      part: mesh.userData.part,
    }
  }
  for (const row of heightRows) row.needsUpdate = true
  pool.computeBoundingSphere()
  if (pool.boundingSphere) pool.boundingSphere.radius += verticalMargin
  root.userData = {
    drawCallCount: plans.length === 0 ? 0 : 3,
    groundPoolCount: plans.length,
    streetLightCount: plans.length,
  }
}

export function buildStreetLightInstances(
  plans: readonly StreetLightPlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-streetscape-street-lights'
  updateStreetLightInstances(root, plans, heightAt)
  return root
}

function disposeOwnedInstances(root: Group): void {
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose()
  })
  root.clear()
}
const PAVING_KINDS = ['driveway', 'path', 'patio'] as const satisfies readonly PavingKind[]
const pavingMaterials = new Map<PavingKind, Material>()
let pavingUnitGeometry: BufferGeometry | undefined

function getPavingGeometry(): BufferGeometry {
  pavingUnitGeometry ??= new BoxGeometry(1, 1, 1)
  return pavingUnitGeometry
}

function getPavingMaterial(kind: PavingKind): Material {
  const cached = pavingMaterials.get(kind)
  if (cached) return cached
  const material = createMaterial(customMaterial(PAVING_SURFACE[kind].color, 0.94))
  pavingMaterials.set(kind, material)
  return material
}
type PavingPiece = Readonly<{ polygon: PavingPlan['polygon'] }>
const MAX_PAVING_PIECE_SPAN = 2.5

function pavingPoint(plan: PavingPlan, across: number, along: number) {
  const [first, second, third, fourth] = plan.polygon
  if (!first || !second || !third || !fourth) return [0, 0] as const
  const nearX = first[0] + (second[0] - first[0]) * across
  const nearZ = first[1] + (second[1] - first[1]) * across
  const farX = fourth[0] + (third[0] - fourth[0]) * across
  const farZ = fourth[1] + (third[1] - fourth[1]) * across
  return [
    nearX + (farX - nearX) * along,
    nearZ + (farZ - nearZ) * along,
  ] as const
}

function subdividePaving(plan: PavingPlan): PavingPiece[] {
  const [first, second, third] = plan.polygon
  if (!first || !second || !third || plan.polygon.length !== 4) return [plan]
  const width = Math.hypot(second[0] - first[0], second[1] - first[1])
  const depth = Math.hypot(third[0] - second[0], third[1] - second[1])
  const acrossCount = Math.max(1, Math.ceil(width / MAX_PAVING_PIECE_SPAN))
  const alongCount = Math.max(1, Math.ceil(depth / MAX_PAVING_PIECE_SPAN))
  const pieces: PavingPiece[] = []
  for (let alongIndex = 0; alongIndex < alongCount; alongIndex += 1) {
    const alongStart = alongIndex / alongCount
    const alongEnd = (alongIndex + 1) / alongCount
    for (let acrossIndex = 0; acrossIndex < acrossCount; acrossIndex += 1) {
      const acrossStart = acrossIndex / acrossCount
      const acrossEnd = (acrossIndex + 1) / acrossCount
      pieces.push({
        polygon: [
          pavingPoint(plan, acrossStart, alongStart),
          pavingPoint(plan, acrossEnd, alongStart),
          pavingPoint(plan, acrossEnd, alongEnd),
          pavingPoint(plan, acrossStart, alongEnd),
        ],
      })
    }
  }
  return pieces
}


function updatePavingInstances(
  root: Group,
  plans: readonly PavingPlan[],
  heightAt: HeightAt,
): void {
  const byKind = new Map<PavingKind, PavingPiece[]>()
  for (const plan of plans) {
    const pieces = subdividePaving(plan)
    const group = byKind.get(plan.kind)
    if (group) group.push(...pieces)
    else byKind.set(plan.kind, pieces)
  }

  let drawCallCount = 0
  let slabCount = 0
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
      instances = createContextInstances(
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
    const rotation = new Matrix4()
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    const xAxis = new Vector3()
    const yAxis = new Vector3()
    const zAxis = new Vector3()
    const surface = PAVING_SURFACE[kind]
    kindPlans.forEach((plan, index) => {
      const first = plan.polygon[0]!
      const second = plan.polygon[1]!
      const third = plan.polygon[2]!
      const acrossX = second[0] - first[0]
      const acrossZ = second[1] - first[1]
      const depthX = third[0] - second[0]
      const depthZ = third[1] - second[1]
      const firstHeight = groundHeight(heightAt, first[0], first[1])
      const secondHeight = groundHeight(heightAt, second[0], second[1])
      const thirdHeight = groundHeight(heightAt, third[0], third[1])
      xAxis.set(acrossX, secondHeight - firstHeight, acrossZ)
      zAxis.set(depthX, thirdHeight - secondHeight, depthZ)
      const width = xAxis.length()
      xAxis.normalize()
      zAxis.addScaledVector(xAxis, -zAxis.dot(xAxis))
      const depth = zAxis.length()
      zAxis.normalize()
      yAxis.copy(zAxis).cross(xAxis).normalize()
      if (yAxis.dot(UP) < 0) {
        yAxis.negate()
        zAxis.negate()
      }
      zAxis.copy(xAxis).cross(yAxis).normalize()
      rotation.makeBasis(xAxis, yAxis, zAxis)
      quaternion.setFromRotationMatrix(rotation)
      const centerX = plan.polygon.reduce((sum, point) => sum + point[0], 0)
        / plan.polygon.length
      const centerZ = plan.polygon.reduce((sum, point) => sum + point[1], 0)
        / plan.polygon.length
      const centerHeight = plan.polygon.reduce(
        (sum, point) => sum + groundHeight(heightAt, point[0], point[1]),
        0,
      ) / plan.polygon.length
      position.set(
        centerX,
        centerHeight + surface.elevation - surface.thickness / 2,
        centerZ,
      )
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
    slabCount += kindPlans.length
  }
  root.userData = { drawCallCount, pavingCount: plans.length, slabCount }
}

/**
 * Rectangular drives, paths, and patios share one unit slab geometry. Pieces
 * stay below 2.5 m and sample all four corners to follow changing local grade.
 */
export function buildPavingMeshes(
  plans: readonly PavingPlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-paving'
  updatePavingInstances(root, plans, heightAt)
  return root
}

let mailboxGeometry: StreetscapeGeometryPair | undefined
let mailboxBodyMaterial: Material | undefined
let mailboxFlagMaterial: Material | undefined

function updateMailboxInstances(
  root: Group,
  plans: readonly MailboxPlan[],
  heightAt: HeightAt,
): void {
  mailboxGeometry ??= createMailboxPresentationGeometry()
  mailboxBodyMaterial ??= createMaterial(customMaterial('#17191a', 0.38, 0.58))
  mailboxFlagMaterial ??= createMaterial(customMaterial('#e23a31', 0.42, 0.18))
  let instances = root.children as InstancedMesh[]
  const capacity = instances[0]?.userData.capacity as number | undefined
  if (instances.length !== 2 || (capacity ?? 0) < plans.length) {
    for (const mesh of instances) mesh.dispose()
    root.clear()
    const nextCapacity = Math.max(PRESENTATION_INSTANCE_CAPACITY, plans.length)
    const body = createContextInstances(
      mailboxGeometry.body,
      mailboxBodyMaterial,
      nextCapacity,
    )
    body.name = 'streetscape-arched-mailbox-body-instances'
    body.castShadow = true
    body.receiveShadow = true
    body.raycast = NO_RAYCAST
    body.frustumCulled = false
    body.userData = { capacity: nextCapacity, part: 'body' }
    const flag = createContextInstances(
      mailboxGeometry.accent,
      mailboxFlagMaterial,
      nextCapacity,
    )
    flag.name = 'streetscape-raised-mailbox-flag-instances'
    flag.castShadow = true
    flag.receiveShadow = true
    flag.raycast = NO_RAYCAST
    flag.frustumCulled = false
    flag.userData = { capacity: nextCapacity, part: 'flag' }
    root.add(body, flag)
    instances = [body, flag]
  }
  const matrix = new Matrix4()
  const translation = new Vector3()
  const quaternion = new Quaternion()
  plans.forEach((plan, index) => {
    setPlacementMatrix(
      matrix,
      translation,
      quaternion,
      plan.position,
      plan.rotationY,
      heightAt,
    )
    for (const mesh of instances) mesh.setMatrixAt(index, matrix)
  })
  for (const mesh of instances) {
    mesh.count = plans.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.userData = {
      capacity: mesh.instanceMatrix.count,
      instanceCount: plans.length,
      part: mesh.userData.part,
    }
  }
  root.userData = {
    drawCallCount: plans.length === 0 ? 0 : 2,
    mailboxCount: plans.length,
  }
}

export function buildMailboxInstances(
  plans: readonly MailboxPlan[],
  heightAt: HeightAt = FLAT_HEIGHT_AT,
): Group {
  const root = new Group()
  root.name = 'environment-neighborhood-mailboxes'
  updateMailboxInstances(root, plans, heightAt)
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
    const instances = createContextInstances(
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

function updateCatalogInstancePool(
  root: Group,
  plans: readonly CatalogPropPlan[],
  heightAt: HeightAt,
): void {
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
        position.set(
          plan.position[0],
          groundHeight(heightAt, plan.position[0], plan.position[1]),
          plan.position[1],
        )
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

function CatalogInstances({
  heightAt,
  plans,
}: {
  heightAt: HeightAt
  plans: readonly CatalogPropPlan[]
}) {
  const hydrant = useGLTFKTX2(CATALOG_ASSETS[0]!.src) as unknown as { scene: Group }
  const gltfs = useMemo(() => [hydrant] as const, [hydrant])
  const instances = useMemo(() => createCatalogInstancePool(gltfs), [gltfs])

  useLayoutEffect(() => {
    updateCatalogInstancePool(instances, plans, heightAt)
  }, [heightAt, instances, plans])
  useEffect(() => () => {
    disposeCatalogInstancePool(instances)
  }, [instances])

  return <primitive object={instances} />
}

export function NeighborhoodDecorations({
  heightAt = FLAT_HEIGHT_AT,
  plan,
}: {
  heightAt?: HeightAt
  plan: NeighborhoodDecorationPlan
}) {
  const shrubs = useMemo(() => buildShrubInstances([]), [])
  const cars = useMemo(() => buildParkedCarInstances([]), [])
  const fences = useMemo(() => buildFenceInstances([]), [])
  const streetLights = useMemo(() => buildStreetLightInstances([]), [])
  const paving = useMemo(() => buildPavingMeshes([]), [])
  const mailboxes = useMemo(() => buildMailboxInstances([]), [])

  useLayoutEffect(() => {
    updateShrubInstances(shrubs, plan.catalogProps, heightAt)
    updateParkedCarInstances(cars, plan.catalogProps, heightAt)
    updateFenceInstances(fences, plan.fences, heightAt)
    updateStreetLightInstances(streetLights, plan.streetLights, heightAt)
    updatePavingInstances(paving, plan.paving, heightAt)
    updateMailboxInstances(mailboxes, plan.mailboxes, heightAt)
  }, [cars, fences, heightAt, mailboxes, paving, plan, shrubs, streetLights])
  useEffect(() => () => {
    disposeOwnedInstances(cars)
    disposeOwnedInstances(shrubs)
    disposeOwnedInstances(fences)
    disposeOwnedInstances(streetLights)
    disposeOwnedInstances(mailboxes)
    disposeOwnedInstances(paving)
  }, [cars, shrubs, fences, streetLights, mailboxes, paving])

  return (
    <group name="environment-neighborhood-decorations">
      <primitive object={shrubs} />
      <primitive object={cars} />
      <primitive object={fences} />
      <primitive object={streetLights} />
      <primitive object={paving} />
      <primitive object={mailboxes} />
      <Suspense fallback={null}>
        <CatalogInstances heightAt={heightAt} plans={plan.catalogProps} />
      </Suspense>
    </group>
  )
}
