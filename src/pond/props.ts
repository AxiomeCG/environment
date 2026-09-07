import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { pondSurfaceDepthAt, type PondSurface } from './basin'
import {
  attachPondKoiMotion,
  bindPondKoiInstances,
  createPondKoiMotion,
  koiFootprintFitsSurface,
} from './koi-motion'
import type { PondProp } from './schema'

const MAX_POND_PROPS = 128
const MAX_KOI = 32
const MIN_LILY_DEPTH = 0.015
const MAX_PROP_SCALE = 2.5
const KOI_COLORS = ['#e98532', '#efe4cf', '#d5a238'] as const

type PropPlacement = {
  prop: PondProp
  matrix: Matrix4
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  colorIndex: number
  flowered: boolean
}

/**
 * Water-only placement predicate shared by the renderer and authoring actions.
 * It checks the actual yawed footprint, not only the prop's center, and scales
 * the koi depth requirement with its body height.
 */
export function pondPropFitsSurface(surface: PondSurface, prop: PondProp): boolean {
  if (
    surface.level === null
    || surface.positions.length === 0
    || !Number.isFinite(prop.position[0])
    || !Number.isFinite(prop.position[1])
    || !Number.isFinite(prop.scale)
    || prop.scale <= 0
  ) {
    return false
  }
  const scale = Math.min(MAX_PROP_SCALE, Math.max(0.2, prop.scale))
  const yaw = Number.isFinite(prop.yaw) ? prop.yaw : 0
  if (prop.kind === 'koi') {
    return koiFootprintFitsSurface(
      surface,
      prop.position[0],
      prop.position[1],
      yaw,
      scale,
    )
  }
  if (pondSurfaceDepthAt(surface, prop.position[0], prop.position[1]) < MIN_LILY_DEPTH) {
    return false
  }
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)

  const radius = 0.3 * scale
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + yaw
    const x = prop.position[0] + Math.cos(angle) * radius
    const z = prop.position[1] - Math.sin(angle) * radius
    if (pondSurfaceDepthAt(surface, x, z) < MIN_LILY_DEPTH) return false
  }
  return true
}

/** Applies schema-independent water checks so corrupt or legacy props cannot escape the pond. */
export function resolveRenderablePondProps(
  props: readonly PondProp[],
  surface: PondSurface,
): PropPlacement[] {
  if (surface.level === null || surface.positions.length === 0) return []

  const accepted: PropPlacement[] = []
  let koiCount = 0
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)

  for (const prop of props.slice(0, MAX_POND_PROPS)) {
    const x = prop.position[0]
    const z = prop.position[1]
    if (!pondPropFitsSurface(surface, prop)) continue
    const depth = pondSurfaceDepthAt(surface, prop.position[0], prop.position[1])
    if (prop.kind === 'koi') {
      if (koiCount >= MAX_KOI) continue
      koiCount += 1
    }

    const propScale = Math.min(MAX_PROP_SCALE, Math.max(0.2, prop.scale))
    const y = prop.kind === 'water-lily'
      ? surface.level + 0.018
      : surface.level - Math.min(depth * 0.45, Math.max(0.065, propScale * 0.1))
    position.set(x, y, z)
    const yaw = Number.isFinite(prop.yaw) ? prop.yaw : 0
    rotation.setFromAxisAngle(up, yaw)
    scale.setScalar(propScale)
    const hash = hashString(prop.id)
    accepted.push({
      prop,
      matrix: new Matrix4().compose(position, rotation, scale),
      x,
      y,
      z,
      yaw,
      scale: propScale,
      colorIndex: hash % KOI_COLORS.length,
      flowered: hash % 3 === 0,
    })
  }
  return accepted
}

export function buildPondPropGeometry(
  props: readonly PondProp[],
  surface: PondSurface,
  portable = false,
): Group {
  const group = new Group()
  group.name = portable ? 'Pond props' : 'environment-pond-props'
  const placements = resolveRenderablePondProps(props, surface)
  const lilies = placements.filter(({ prop }) => prop.kind === 'water-lily')
  const koi = placements.filter(({ prop }) => prop.kind === 'koi')
  if (lilies.length > 0) addLilyGeometry(group, lilies, portable)
  if (koi.length > 0) addKoiGeometry(group, koi, surface, portable)
  return group
}

function addLilyGeometry(group: Group, placements: readonly PropPlacement[], portable: boolean): void {
  const padGeometry = createLilyPadGeometry()
  const padMaterial = new MeshStandardMaterial({
    color: '#3f8449',
    metalness: 0,
    roughness: 0.78,
    side: DoubleSide,
  })
  addPlacedMesh(group, 'Pond lily pads', padGeometry, padMaterial, placements, portable)

  const flowers = placements.filter(({ flowered }) => flowered)
  if (flowers.length === 0) return
  const petalGeometry = createFlowerPetalGeometry()
  const petalMaterial = new MeshStandardMaterial({
    color: '#f0b9ca',
    metalness: 0,
    roughness: 0.7,
    flatShading: true,
  })
  addPlacedMesh(group, 'Pond lily flowers', petalGeometry, petalMaterial, flowers, portable)
  const flowerCenterGeometry = new SphereGeometry(0.027, 6, 3)
  flowerCenterGeometry.translate(0, 0.054, 0)
  const flowerCenterMaterial = new MeshStandardMaterial({
    color: '#e9b33d',
    metalness: 0,
    roughness: 0.72,
    flatShading: true,
  })
  addPlacedMesh(
    group,
    'Pond lily flower centers',
    flowerCenterGeometry,
    flowerCenterMaterial,
    flowers,
    portable,
  )
}

function addKoiGeometry(
  group: Group,
  placements: readonly PropPlacement[],
  surface: PondSurface,
  portable: boolean,
): void {
  const motion = portable
    ? null
    : createPondKoiMotion(
      surface,
      placements.map((placement) => ({
        id: placement.prop.id,
        position: [placement.x, placement.z],
        yaw: placement.yaw,
        scale: placement.scale,
        y: placement.y,
      })),
    )
  const allFishIndices = placements.map((_, index) => index)
  const bodyGeometry = new SphereGeometry(1, 8, 5)
  bodyGeometry.scale(0.32, 0.085, 0.125)
  const tailGeometry = createKoiTailGeometry()

  for (let colorIndex = 0; colorIndex < KOI_COLORS.length; colorIndex += 1) {
    const colored: PropPlacement[] = []
    const fishIndices: number[] = []
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]
      if (!placement || placement.colorIndex !== colorIndex) continue
      colored.push(placement)
      fishIndices.push(index)
    }
    if (colored.length === 0) continue
    const bodyMaterial = new MeshStandardMaterial({
      color: KOI_COLORS[colorIndex],
      metalness: 0,
      roughness: 0.62,
      flatShading: true,
    })
    const bodies = addPlacedMesh(
      group,
      `Pond koi bodies ${colorIndex + 1}`,
      bodyGeometry.clone(),
      bodyMaterial,
      colored,
      portable,
    )
    if (motion && bodies) bindPondKoiInstances(motion, bodies, fishIndices)
    const tailMaterial = new MeshStandardMaterial({
      color: KOI_COLORS[colorIndex],
      metalness: 0,
      roughness: 0.68,
      side: DoubleSide,
      flatShading: true,
    })
    const tails = addPlacedMesh(
      group,
      `Pond koi tails ${colorIndex + 1}`,
      tailGeometry.clone(),
      tailMaterial,
      colored,
      portable,
    )
    if (motion && tails) bindPondKoiInstances(motion, tails, fishIndices, true)
  }
  bodyGeometry.dispose()
  tailGeometry.dispose()

  const markingGeometry = new SphereGeometry(1, 6, 3)
  markingGeometry.scale(0.085, 0.018, 0.055)
  markingGeometry.translate(0.06, 0.078, 0.025)
  const markingMaterial = new MeshStandardMaterial({
    color: '#f6eee0',
    metalness: 0,
    roughness: 0.66,
    flatShading: true,
  })
  const markings = addPlacedMesh(
    group,
    'Pond koi markings',
    markingGeometry,
    markingMaterial,
    placements,
    portable,
  )
  if (motion && markings) bindPondKoiInstances(motion, markings, allFishIndices)

  const eyeGeometry = new SphereGeometry(0.018, 5, 3)
  eyeGeometry.translate(0.245, 0.052, 0)
  const eyeMaterial = new MeshStandardMaterial({
    color: '#30261f',
    metalness: 0,
    roughness: 0.8,
    flatShading: true,
  })
  const headMarks = addPlacedMesh(
    group,
    'Pond koi head marks',
    eyeGeometry,
    eyeMaterial,
    placements,
    portable,
  )
  if (motion && headMarks) bindPondKoiInstances(motion, headMarks, allFishIndices)
  if (motion) attachPondKoiMotion(group, motion)
}

function addPlacedMesh(
  group: Group,
  name: string,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  placements: readonly PropPlacement[],
  portable: boolean,
): InstancedMesh | null {
  if (portable) {
    const transformed = placements.map(({ matrix }) => {
      const clone = geometry.clone()
      clone.applyMatrix4(matrix)
      return clone
    })
    const merged = mergeGeometries(transformed, false)
    for (const clone of transformed) clone.dispose()
    geometry.dispose()
    if (!merged) {
      material.dispose()
      return null
    }
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    const mesh = new Mesh(merged, material)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    return null
  }

  const instances = new InstancedMesh(geometry, material, placements.length)
  instances.name = name
  instances.castShadow = false
  instances.receiveShadow = false
  placements.forEach(({ matrix }, index) => instances.setMatrixAt(index, matrix))
  instances.instanceMatrix.needsUpdate = true
  material.addEventListener('dispose', () => instances.dispose())
  group.add(instances)
  return instances
}

function createLilyPadGeometry(): ShapeGeometry {
  const shape = new Shape()
  const radius = 0.3
  const notchHalfAngle = 0.38
  shape.moveTo(0, 0)
  for (let index = 0; index <= 12; index += 1) {
    const angle = notchHalfAngle + ((Math.PI * 2 - notchHalfAngle * 2) * index) / 12
    shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  shape.closePath()
  const geometry = new ShapeGeometry(shape, 1)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function createFlowerPetalGeometry(): BufferGeometry {
  const petals: BufferGeometry[] = []
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2
    const petal = new SphereGeometry(1, 6, 3)
    petal.scale(0.058, 0.014, 0.028)
    petal.rotateY(-angle)
    petal.translate(Math.cos(angle) * 0.047, 0.048, Math.sin(angle) * 0.047)
    petals.push(petal)
  }
  const merged = mergeGeometries(petals, false) ?? new BufferGeometry()
  for (const petal of petals) petal.dispose()
  return merged
}

function createKoiTailGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([
      -0.25, 0, 0,
      -0.48, 0.015, 0.17,
      -0.4, 0.02, 0,
      -0.25, 0, 0,
      -0.4, 0.02, 0,
      -0.48, 0.015, -0.17,
    ], 3),
  )
  geometry.computeVertexNormals()
  return geometry
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
