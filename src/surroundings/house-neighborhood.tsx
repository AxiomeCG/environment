import { useThree } from '@react-three/fiber'
import {
  DoorNode,
  getRoofWallFaceFrame,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WindowNode,
  type DoorNode as DoorNodeType,
  type MaterialSchema,
  type RoofSegmentNode as RoofSegmentNodeType,
  type WindowNode as WindowNodeType,
} from '@pascal-app/core'
import {
  buildDoorPreviewMesh,
  buildWindowPreviewMesh,
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  createMaterial,
  generateRoofSegmentGeometry,
  generateSlabGeometry,
  getRoofMaterialArray,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  BufferGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  houseBodyFrame,
  houseGarageOffset,
  type HouseFacadeSide,
  type HouseOpening,
  type HousePlan,
} from './neighborhood'

const FOUNDATION_HEIGHT = 0.18
const WALL_THICKNESS = 0.14
const OPENING_SURFACE_OFFSET = WALL_THICKNESS / 2 + 0.015
const NO_RAYCAST = () => undefined
const SLAB_CONTEXT = { siblingSlabs: [], walls: [] }
const UP = new Vector3(0, 1, 0)
const UNIT_SCALE = new Vector3(1, 1, 1)


export type HouseNeighborhoodProps = Readonly<{
  plans: readonly HousePlan[]
}>

type OpeningPrimitive = Readonly<{
  node: DoorNodeType | WindowNodeType
  side: HouseFacadeSide
}>

type OpeningMaterials = Readonly<{
  panel: Material
  frame: Material
  glass: Material
  hardware: Material
}>

type PorchDimensions = Readonly<{
  width: number
  depth: number
  eaveHeight: number
  pitch: number
}>

function customMaterial(
  color: string,
  roughness: number,
  metalness = 0,
  opacity = 1,
): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color,
      roughness,
      metalness,
      opacity,
      transparent: opacity < 1,
      side: 'front',
    },
  }
}

function rotationYFromPlan(plan: HousePlan): number {
  return Math.atan2(plan.front[0], plan.front[1])
}

function openingFaceSpan(plan: HousePlan, side: HouseFacadeSide): number {
  return side === 'front' || side === 'back' ? houseBodyFrame(plan).width : plan.depth
}

function windowTypeFor(plan: HousePlan): WindowNodeType['windowType'] {
  if (plan.style === 'cottage') return 'casement'
  if (plan.style === 'farmhouse') return 'double-hung'
  return 'fixed'
}

function doorSegmentsFor(plan: HousePlan) {
  if (plan.style === 'pavilion') {
    return [
      { type: 'glass' as const, heightRatio: 0.72, columnRatios: [1] },
      { type: 'panel' as const, heightRatio: 0.28, columnRatios: [1] },
    ]
  }
  if (plan.style === 'farmhouse') {
    return [
      { type: 'glass' as const, heightRatio: 0.34, columnRatios: [1, 1, 1] },
      { type: 'panel' as const, heightRatio: 0.66, columnRatios: [1, 1] },
    ]
  }
  return [
    { type: 'glass' as const, heightRatio: 0.3, columnRatios: [1, 1] },
    { type: 'panel' as const, heightRatio: 0.7, columnRatios: [1] },
  ]
}

function createOpeningPrimitive(
  plan: HousePlan,
  houseIndex: number,
  segmentId: string,
  side: HouseFacadeSide,
  opening: HouseOpening,
  openingIndex: number,
): OpeningPrimitive {
  const u = openingFaceSpan(plan, side) / 2 + opening.offset
  const position: [number, number, number] = [
    u,
    opening.bottom + opening.height / 2,
    0,
  ]
  const suffix = `${houseIndex}_${side}_${openingIndex}`

  if (opening.kind === 'door') {
    return {
      side,
      node: DoorNode.parse({
        id: `door_environment_house_${suffix}`,
        parentId: segmentId,
        roofSegmentId: segmentId,
        roofFace: side,
        position,
        side: 'front',
        width: opening.width,
        height: opening.height,
        doorType: 'hinged',
        hingesSide: opening.offset < 0 ? 'left' : 'right',
        openingShape: plan.style === 'cottage' ? 'rounded' : 'rectangle',
        cornerRadius: plan.style === 'cottage' ? 0.09 : 0,
        frameThickness: 0.07,
        frameDepth: WALL_THICKNESS,
        segments: doorSegmentsFor(plan),
      }),
    }
  }

  return {
    side,
    node: WindowNode.parse({
      id: `window_environment_house_${suffix}`,
      parentId: segmentId,
      roofSegmentId: segmentId,
      roofFace: side,
      position,
      side: 'front',
      width: opening.width,
      height: opening.height,
      windowType: windowTypeFor(plan),
      casementStyle: plan.style === 'cottage' ? 'french' : 'single',
      columnRatios: plan.style === 'farmhouse' ? [1] : [1, 1],
      rowRatios: [1],
      frameThickness: plan.style === 'pavilion' ? 0.055 : 0.07,
      frameDepth: WALL_THICKNESS,
      columnDividerThickness: 0.045,
      rowDividerThickness: 0.045,
      sill: plan.style !== 'pavilion',
      sillDepth: 0.12,
      sillThickness: 0.035,
    }),
  }
}

function createMainRoofSegment(
  plan: HousePlan,
  houseIndex: number,
  roofId: string,
  segmentId: string,
): { segment: RoofSegmentNodeType; openings: OpeningPrimitive[] } {
  const openings = plan.facades.flatMap((facade) =>
    facade.openings.map((opening, openingIndex) =>
      createOpeningPrimitive(plan, houseIndex, segmentId, facade.side, opening, openingIndex)))
  const body = houseBodyFrame(plan)
  const segment = RoofSegmentNode.parse({
    id: segmentId,
    parentId: roofId,
    position: [body.offset, FOUNDATION_HEIGHT, 0],
    roofType: plan.roof.kind,
    width: body.width,
    depth: plan.depth,
    wallHeight: plan.wallHeight,
    pitch: plan.roof.pitchDegrees,
    wallThickness: WALL_THICKNESS,
    deckThickness: 0.1,
    overhang: plan.roof.overhang,
    shingleThickness: 0.045,
    gambrelLowerWidthRatio: 0.48,
    gambrelLowerHeightRatio: 0.62,
    children: openings.map(({ node }) => node.id),
  })
  return { segment, openings }
}

function createOpeningMaterials(plan: HousePlan): OpeningMaterials {
  return {
    panel: createMaterial(customMaterial(plan.palette.door, 0.76)),
    frame: createMaterial(customMaterial(plan.palette.trim, 0.82)),
    glass: createMaterial(customMaterial(plan.palette.glass, 0.18, 0.05, 0.58)),
    hardware: createMaterial(customMaterial(plan.palette.accent, 0.3, 0.62)),
  }
}

function addOpeningMesh(
  house: Group,
  geometry: BufferGeometry,
  material: Material,
  name: string,
  castsShadow: boolean,
): void {
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = castsShadow
  mesh.receiveShadow = castsShadow
  mesh.raycast = NO_RAYCAST
  house.add(mesh)
}

function addOpeningVisuals(
  house: Group,
  segment: RoofSegmentNodeType,
  openings: readonly OpeningPrimitive[],
  materials: OpeningMaterials,
): void {
  const source = new Group()
  for (const { node, side } of openings) {
    const frame = getRoofWallFaceFrame(segment, side)
    const host = new Group()
    host.position.set(
      frame.origin[0] + segment.position[0],
      frame.origin[1] + segment.position[1],
      frame.origin[2] + segment.position[2],
    )
    host.rotation.y = frame.yaw + segment.rotation
    const visual = node.type === 'door'
      ? buildDoorPreviewMesh(node)
      : buildWindowPreviewMesh(node)
    visual.position.z += OPENING_SURFACE_OFFSET
    host.add(visual)
    source.add(host)
  }

  source.updateMatrixWorld(true)
  const bySlot = new Map<keyof OpeningMaterials, BufferGeometry[]>()
  const sourceGeometries = new Set<BufferGeometry>()
  source.traverse((child) => {
    if (!(child instanceof Mesh)) return
    sourceGeometries.add(child.geometry)
    const slot = child.userData.slotId as keyof OpeningMaterials | undefined
    if (!slot || !(slot in materials) || !child.visible) return
    const geometry = child.geometry.index
      ? child.geometry.toNonIndexed()
      : child.geometry.clone()
    geometry.applyMatrix4(child.matrixWorld)
    const geometries = bySlot.get(slot) ?? []
    geometries.push(geometry)
    bySlot.set(slot, geometries)
  })

  for (const [slot, geometries] of bySlot) {
    const merged = mergeGeometries(geometries, false)
    if (merged) {
      for (const geometry of geometries) geometry.dispose()
      addOpeningMesh(
        house,
        merged,
        materials[slot],
        `pascal-opening-batch-${slot}`,
        slot !== 'glass',
      )
      continue
    }
    for (const geometry of geometries) {
      addOpeningMesh(
        house,
        geometry,
        materials[slot],
        `pascal-opening-${slot}`,
        slot !== 'glass',
      )
    }
  }

  for (const geometry of sourceGeometries) geometry.dispose()
  source.clear()
}

function addSlab(
  house: Group,
  id: string,
  name: string,
  polygon: [number, number][],
  elevation: number,
  thickness: number,
  material: Material,
): void {
  const node = SlabNode.parse({ id, polygon, elevation, thickness })
  const mesh = new Mesh(generateSlabGeometry(node, SLAB_CONTEXT), material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.raycast = NO_RAYCAST
  house.add(mesh)
}

function porchDimensions(plan: HousePlan): PorchDimensions {
  const { width } = houseBodyFrame(plan)
  if (plan.style === 'farmhouse') {
    return {
      width: Math.min(width - 0.7, width * 0.82),
      depth: 1.55,
      eaveHeight: 2.48,
      pitch: 14,
    }
  }
  if (plan.style === 'pavilion') {
    return {
      width: Math.min(width - 1, 4.8),
      depth: 1.45,
      eaveHeight: 2.42,
      pitch: 8,
    }
  }
  return {
    width: Math.min(width - 0.8, 2.75),
    depth: 1.28,
    eaveHeight: 2.36,
    pitch: 18,
  }
}

/**
 * Attached garage presentation LOD. Unlike an authored roof segment, the
 * off-site wing is three reusable painted boxes: wall volume, shallow shed
 * roof, and door panel. This keeps the door visible and avoids rebuilding
 * roof-wall CSG whenever a frontage changes.
 */
function addGarageWing(
  house: Group,
  plan: HousePlan,
  houseIndex: number,
  roofMaterial: Material,
  wallMaterial: Material,
  doorMaterial: Material,
  foundationMaterial: Material,
): void {
  const offset = houseGarageOffset(plan)
  const garage = plan.garage
  if (!offset || !garage) return

  const wall = new Mesh(
    createColumnBoxGeometry(garage.width, garage.wallHeight, garage.depth, 0.045),
    wallMaterial,
  )
  wall.name = 'pascal-column-garage-wall-volume'
  wall.position.set(
    offset[0],
    FOUNDATION_HEIGHT + garage.wallHeight / 2,
    offset[1],
  )
  wall.castShadow = true
  wall.receiveShadow = true
  wall.raycast = NO_RAYCAST
  house.add(wall)

  const pitch = 9 * Math.PI / 180
  const roofDepth = garage.depth + 0.6
  const roof = new Mesh(
    createColumnBoxGeometry(garage.width + 0.6, 0.13, roofDepth, 0.025),
    roofMaterial,
  )
  roof.name = 'pascal-column-garage-shed-roof'
  roof.position.set(
    offset[0],
    FOUNDATION_HEIGHT + garage.wallHeight + Math.tan(pitch) * roofDepth / 2,
    offset[1],
  )
  // Local +Z is the street-facing side; positive X rotation lowers that edge.
  roof.rotation.x = pitch
  roof.castShadow = true
  roof.receiveShadow = true
  roof.raycast = NO_RAYCAST
  house.add(roof)

  const door = new Mesh(
    createColumnBoxGeometry(garage.door.width, garage.door.height, 0.08, 0.025),
    doorMaterial,
  )
  door.name = 'pascal-column-garage-door'
  door.position.set(
    offset[0],
    FOUNDATION_HEIGHT + garage.door.height / 2,
    offset[1] + garage.depth / 2 + 0.06,
  )
  door.castShadow = true
  door.receiveShadow = true
  door.raycast = NO_RAYCAST
  house.add(door)

  const halfWidth = garage.width / 2 + 0.12
  const halfDepth = garage.depth / 2 + 0.12
  addSlab(
    house,
    `slab_environment_garage_${houseIndex}`,
    'pascal-slab-garage',
    [
      [offset[0] - halfWidth, offset[1] - halfDepth],
      [offset[0] + halfWidth, offset[1] - halfDepth],
      [offset[0] + halfWidth, offset[1] + halfDepth],
      [offset[0] - halfWidth, offset[1] + halfDepth],
    ],
    FOUNDATION_HEIGHT,
    FOUNDATION_HEIGHT,
    foundationMaterial,
  )
}

function addPorch(
  house: Group,
  plan: HousePlan,
  houseIndex: number,
  roofMaterials: Material[],
  foundationMaterial: Material,
  postMaterial: Material,
): void {
  const door = plan.facades
    .find(({ side }) => side === 'front')
    ?.openings.find(({ kind }) => kind === 'door')
  if (!door) return

  const porch = porchDimensions(plan)
  const centerX = houseBodyFrame(plan).offset + door.offset
  const backZ = plan.depth / 2 - 0.12
  const frontZ = backZ + porch.depth
  const centerZ = (backZ + frontZ) / 2
  addSlab(
    house,
    `slab_environment_porch_${houseIndex}`,
    'pascal-slab-porch',
    [
      [centerX - porch.width / 2, backZ],
      [centerX + porch.width / 2, backZ],
      [centerX + porch.width / 2, frontZ],
      [centerX - porch.width / 2, frontZ],
    ],
    FOUNDATION_HEIGHT + 0.04,
    0.14,
    foundationMaterial,
  )

  const stepDepth = 0.42
  const stepWidth = Math.min(1.65, porch.width * 0.62)
  addSlab(
    house,
    `slab_environment_step_${houseIndex}`,
    'pascal-slab-entry-step',
    [
      [centerX - stepWidth / 2, frontZ - 0.03],
      [centerX + stepWidth / 2, frontZ - 0.03],
      [centerX + stepWidth / 2, frontZ + stepDepth],
      [centerX - stepWidth / 2, frontZ + stepDepth],
    ],
    0.11,
    0.11,
    foundationMaterial,
  )

  const canopy = RoofSegmentNode.parse({
    id: `rseg_environment_porch_${houseIndex}`,
    position: [centerX, 0, centerZ],
    roofType: 'shed',
    width: porch.width,
    depth: porch.depth,
    wallHeight: porch.eaveHeight,
    pitch: porch.pitch,
    wallThickness: 0.08,
    deckThickness: 0.08,
    overhang: 0.2,
    shingleThickness: 0.035,
  })
  const canopyMesh = new Mesh(generateRoofSegmentGeometry(canopy), roofMaterials)
  canopyMesh.name = 'pascal-roof-segment-porch'
  canopyMesh.position.fromArray(canopy.position)
  canopyMesh.rotation.y = canopy.rotation
  canopyMesh.castShadow = true
  canopyMesh.receiveShadow = true
  canopyMesh.raycast = NO_RAYCAST
  house.add(canopyMesh)

  const postHeight = porch.eaveHeight - FOUNDATION_HEIGHT - 0.08
  const postGeometry = plan.style === 'cottage'
    ? createColumnCylinderGeometry({
        height: postHeight,
        radiusBottom: 0.105,
        radiusTop: 0.085,
        segments: 12,
      })
    : createColumnBoxGeometry(
        plan.style === 'farmhouse' ? 0.14 : 0.11,
        postHeight,
        plan.style === 'farmhouse' ? 0.14 : 0.11,
        0.025,
      )
  const postZ = frontZ - 0.19
  const postInset = plan.style === 'farmhouse' ? 0.28 : 0.22
  for (const sign of [-1, 1] as const) {
    const post = new Mesh(postGeometry, postMaterial)
    post.name = 'pascal-column-porch-post'
    post.position.set(
      centerX + sign * (porch.width / 2 - postInset),
      FOUNDATION_HEIGHT + postHeight / 2,
      postZ,
    )
    post.castShadow = true
    post.receiveShadow = true
    post.raycast = NO_RAYCAST
    house.add(post)
  }
}

function buildPascalHouse(plan: HousePlan, houseIndex: number): Group {
  const roofId = `roof_environment_house_${houseIndex}`
  const segmentId = `rseg_environment_house_${houseIndex}`
  const { segment, openings } = createMainRoofSegment(
    plan,
    houseIndex,
    roofId,
    segmentId,
  )
  const roof = RoofNode.parse({
    id: roofId,
    children: [segment.id],
    topMaterial: customMaterial(plan.palette.roof, 0.9),
    edgeMaterial: customMaterial(plan.palette.wall, 0.92),
    wallMaterial: customMaterial(plan.palette.trim, 0.86),
  })

  const house = new Group()
  house.name = `pascal-house-${plan.style}`
  house.userData.pascalPrimitiveKinds = {
    column: 2,
    door: openings.filter(({ node }) => node.type === 'door').length + (plan.garage ? 1 : 0),
    roofSegment: plan.garage ? 3 : 2,
    slab: plan.garage ? 4 : 3,
    window: openings.filter(({ node }) => node.type === 'window').length,
  }

  const roofMaterials = getRoofMaterialArray(roof) ?? [
    createMaterial(customMaterial(plan.palette.wall, 0.92)),
    createMaterial(customMaterial(plan.palette.trim, 0.86)),
    createMaterial(customMaterial(plan.palette.trim, 0.86)),
    createMaterial(customMaterial(plan.palette.roof, 0.9)),
  ]
  const shell = new Mesh(generateRoofSegmentGeometry(segment), roofMaterials)
  shell.name = 'pascal-roof-segment-house-shell'
  shell.position.fromArray(segment.position)
  shell.rotation.y = segment.rotation
  shell.castShadow = true
  shell.receiveShadow = true
  shell.raycast = NO_RAYCAST
  house.add(shell)

  const foundationMaterial = createMaterial(customMaterial(plan.palette.foundation, 0.96))
  const body = houseBodyFrame(plan)
  const halfWidth = body.width / 2 + 0.12
  const halfDepth = plan.depth / 2 + 0.12
  addSlab(
    house,
    `slab_environment_foundation_${houseIndex}`,
    'pascal-slab-foundation',
    [
      [body.offset - halfWidth, -halfDepth],
      [body.offset + halfWidth, -halfDepth],
      [body.offset + halfWidth, halfDepth],
      [body.offset - halfWidth, halfDepth],
    ],
    FOUNDATION_HEIGHT,
    FOUNDATION_HEIGHT,
    foundationMaterial,
  )

  const openingMaterials = createOpeningMaterials(plan)
  addOpeningVisuals(house, segment, openings, openingMaterials)
  addPorch(
    house,
    plan,
    houseIndex,
    roofMaterials,
    foundationMaterial,
    openingMaterials.frame,
  )
  const garageWallMaterial = createMaterial(customMaterial(plan.palette.wall, 0.9))
  addGarageWing(
    house,
    plan,
    houseIndex,
    roofMaterials[3] ?? roofMaterials[0] ?? garageWallMaterial,
    garageWallMaterial,
    openingMaterials.panel,
    foundationMaterial,
  )

  return house
}

type MeshTemplateBucket = {
  geometry: BufferGeometry
  material: Material | Material[]
  castShadow: boolean
  receiveShadow: boolean
  meshes: Mesh[]
}
type HousePrototype = {
  buckets: MeshTemplateBucket[]
  logicalMeshCount: number
}

const housePrototypeCache = new Map<string, HousePrototype>()

function housePrototypeKey(plan: HousePlan): string {
  return JSON.stringify({
    facades: plan.facades,
    palette: plan.palette,
    roof: plan.roof,
    storeys: plan.storeys,
    style: plan.style,
    garage: plan.garage,
    variant: plan.variant,
    wallHeight: plan.wallHeight,
    width: plan.width,
    depth: plan.depth,
  })
}

function collectMeshBuckets(prototype: Group): MeshTemplateBucket[] {
  const buckets: MeshTemplateBucket[] = []
  prototype.updateMatrixWorld(true)
  prototype.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const bucket = buckets.find((candidate) =>
      candidate.geometry === object.geometry
      && candidate.material === object.material
      && candidate.castShadow === object.castShadow
      && candidate.receiveShadow === object.receiveShadow)
    if (bucket) {
      bucket.meshes.push(object)
      return
    }
    buckets.push({
      geometry: object.geometry,
      material: object.material,
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow,
      meshes: [object],
    })
  })
  return buckets
}

function getHousePrototype(
  key: string,
  representative: HousePlan,
): HousePrototype {
  const cached = housePrototypeCache.get(key)
  if (cached) return cached

  const prototype = buildPascalHouse(representative, housePrototypeCache.size)
  const buckets = collectMeshBuckets(prototype)
  const value = {
    buckets,
    logicalMeshCount: buckets.reduce(
      (count, bucket) => count + bucket.meshes.length,
      0,
    ),
  }
  housePrototypeCache.set(key, value)
  prototype.clear()
  return value
}

function housePlanRevision(plans: readonly HousePlan[]): string {
  return plans.map((plan) => [
    plan.id,
    plan.center[0],
    plan.center[1],
    plan.front[0],
    plan.front[1],
    housePrototypeKey(plan),
  ].join(':')).join('|')
}

export function buildPascalHouseInstances(plans: readonly HousePlan[]): Group {
  const root = new Group()
  root.name = 'surroundings-house-neighborhood'
  const plansByPrototype = new Map<string, HousePlan[]>()
  for (const plan of plans) {
    const key = housePrototypeKey(plan)
    const matchingPlans = plansByPrototype.get(key)
    if (matchingPlans) matchingPlans.push(plan)
    else plansByPrototype.set(key, [plan])
  }

  let drawCallCount = 0
  let logicalMeshCount = 0
  for (const [prototypeKey, matchingPlans] of plansByPrototype) {
    const representative = matchingPlans[0]!
    const prototype = getHousePrototype(prototypeKey, representative)
    prototype.buckets.forEach((bucket) => {
      const instances = new InstancedMesh(
        bucket.geometry,
        bucket.material,
        bucket.meshes.length * matchingPlans.length,
      )
      instances.name = `pascal-house-instances-${representative.style}-v${representative.variant}`
      instances.castShadow = bucket.castShadow
      instances.receiveShadow = bucket.receiveShadow
      instances.raycast = NO_RAYCAST

      let instanceIndex = 0
      const placement = new Matrix4()
      const combined = new Matrix4()
      const quaternion = new Quaternion()
      const position = new Vector3()
      for (const plan of matchingPlans) {
        position.set(plan.center[0], 0, plan.center[1])
        quaternion.setFromAxisAngle(UP, rotationYFromPlan(plan))
        placement.compose(position, quaternion, UNIT_SCALE)
        for (const mesh of bucket.meshes) {
          combined.multiplyMatrices(placement, mesh.matrixWorld)
          instances.setMatrixAt(instanceIndex, combined)
          instanceIndex += 1
        }
      }
      instances.instanceMatrix.needsUpdate = true
      instances.computeBoundingSphere()
      root.add(instances)
      drawCallCount += 1
      logicalMeshCount += instanceIndex
    })
  }
  root.userData = {
    drawCallCount,
    houseCount: plans.length,
    logicalMeshCount,
    prototypeCount: plansByPrototype.size,
  }
  return root
}

function disposeInstanceChildren(root: Group): void {
  root.traverse((object) => {
    if (object !== root && object instanceof InstancedMesh) object.dispose()
  })
  root.clear()
}

export function updatePascalHouseInstances(
  root: Group,
  plans: readonly HousePlan[],
): void {
  const next = buildPascalHouseInstances(plans)
  const children = [...next.children]

  disposeInstanceChildren(root)
  root.add(...children)
  root.userData = next.userData
}

function disposePascalHouseInstances(root: Group): void {
  root.removeFromParent()
  disposeInstanceChildren(root)
}

export function HouseNeighborhood({ plans }: HouseNeighborhoodProps) {
  const instances = useMemo(() => {
    const root = new Group()
    root.name = 'surroundings-house-neighborhood'
    return root
  }, [])
  const revision = housePlanRevision(plans)
  const invalidate = useThree((state) => state.invalidate)

  useLayoutEffect(() => {
    updatePascalHouseInstances(instances, plans)
    invalidate()
  }, [instances, invalidate, plans, revision])
  useEffect(() => () => {
    disposePascalHouseInstances(instances)
  }, [instances])

  return <primitive object={instances} />
}
