import {
  Box3,
  DynamicDrawUsage,
  type InstancedMesh,
  Matrix4,
  type Object3D,
  Quaternion,
  Sphere,
  Vector3,
} from 'three'
import { pondSurfaceDepthAt, type PondSurface } from './basin'

const TAU = Math.PI * 2
const ROUTE_SAMPLES = 96
const MOTION_ANGLE_SAMPLES = 5
const STATIONARY_ANGLE_SAMPLES = 9
const MIN_KOI_DEPTH = 0.2
const SWIM_CLEARANCE_SCALE = 1.05
const SWIM_CLEARANCE_MARGIN = 0.12
const SWIM_CLEARANCE_DEPTH = 0.015
const PLACEMENT_FOOTPRINT = [
  [0.31, 0],
  [0.18, 0.115],
  [0, 0.14],
  [-0.28, 0.15],
  [-0.48, 0.17],
  [-0.48, -0.17],
  [-0.28, -0.15],
  [0, -0.14],
  [0.18, -0.115],
] as const
const BODY_FOOTPRINT = [
  [0.34, 0],
  [0.24, 0.1],
  [0.14, 0.15],
  [-0.06, 0.16],
  [-0.25, 0.14],
  [-0.25, -0.14],
  [-0.06, -0.16],
  [0.14, -0.15],
  [0.24, -0.1],
] as const
const TAIL_FOOTPRINT = [
  [-0.25, 0],
  [-0.365, 0.085],
  [-0.48, 0.17],
  [-0.44, 0.085],
  [-0.4, 0],
  [-0.44, -0.085],
  [-0.48, -0.17],
  [-0.365, -0.085],
] as const
const STATIC_AMPLITUDES = [
  [0.05, 0.38],
  [0.04, 0.26],
  [0.025, 0.14],
  [0, 0.07],
  [0, 0],
] as const
const ROUTE_RADIUS_FACTORS = [1, 0.72, 0.5, 0.34, 0.22] as const
const UP = new Vector3(0, 1, 0)

export type PondKoiInput = {
  id: string
  position: readonly [number, number]
  yaw: number
  scale: number
  y: number
}

export type PondKoiRoute = {
  id: string
  moving: boolean
  anchorX: number
  anchorZ: number
  centerX: number
  centerZ: number
  axisX: number
  axisZ: number
  sideX: number
  sideZ: number
  radiusAlong: number
  radiusAcross: number
  phase: number
  direction: 1 | -1
  angularSpeed: number
  baseYaw: number
  y: number
  scale: number
  bodySwayAmplitude: number
  bodySwayFrequency: number
  bodyPhase: number
  tailAmplitude: number
  tailFrequency: number
  tailPhase: number
}

export type PondKoiMotionPlan = {
  fish: readonly PondKoiRoute[]
  bounds: {
    min: readonly [number, number, number]
    max: readonly [number, number, number]
  }
}

export type PondKoiPose = {
  position: readonly [number, number, number]
  yaw: number
  tailAngle: number
}

type DepthSampler = (x: number, z: number) => number

type KoiMeshBinding = {
  mesh: InstancedMesh
  fishIndices: Uint8Array
  tail: boolean
}

export type PondKoiMotion = {
  readonly plan: PondKoiMotionPlan
  readonly bodyMatrices: Matrix4[]
  readonly tailMatrices: Matrix4[]
  readonly bindings: KoiMeshBinding[]
  readonly context: KoiUpdateContext
  readonly active: boolean
  attachmentRoot: Object3D | null
  lastTime: number
}

type KoiUpdateContext = {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
  pivotToOrigin: Matrix4
  tailRotation: Matrix4
  pivotFromOrigin: Matrix4
  pose: { yaw: number; tailAngle: number }
}

type ResolvedMotion = {
  motion: PondKoiMotion | null
  childCount: number
  firstChild: Object3D | undefined
  lastChild: Object3D | undefined
}

const attachedMotions = new WeakMap<Object3D, PondKoiMotion>()
const resolvedMotions = new WeakMap<Object3D, ResolvedMotion>()

/** Checks the persisted, unanimated koi footprint against the exact wet surface. */
export function koiFootprintFitsSurface(
  surface: PondSurface,
  x: number,
  z: number,
  yaw: number,
  scale: number,
): boolean {
  const minimumDepth = Math.max(MIN_KOI_DEPTH, scale * 0.22)
  const sampleDepth = (sampleX: number, sampleZ: number) =>
    pondSurfaceDepthAt(surface, sampleX, sampleZ)
  if (sampleDepth(x, z) < minimumDepth) return false
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  for (const point of PLACEMENT_FOOTPRINT) {
    if (!localPointIsWet(
      sampleDepth,
      x,
      z,
      cosine,
      sine,
      point[0],
      point[1],
      scale,
      minimumDepth,
    )) return false
  }
  return true
}

/** Builds all bounded routes once; frame updates never inspect the pond triangulation. */
export function buildPondKoiMotionPlan(
  surface: PondSurface,
  inputs: readonly PondKoiInput[],
): PondKoiMotionPlan {
  const sampleDepth = createSurfaceDepthSampler(surface)
  const fish = inputs.map((input) => buildRoute(surface, sampleDepth, input))
  const bounds = new Box3()
  const minimum = new Vector3()
  const maximum = new Vector3()

  for (const route of fish) {
    const routeRadius = route.moving ? route.radiusAlong + route.radiusAcross : 0
    const footprintRadius = route.scale * 0.56
    const horizontalRadius = routeRadius + footprintRadius
    minimum.set(
      route.moving ? route.centerX - horizontalRadius : route.anchorX - footprintRadius,
      route.y - route.scale * 0.1,
      route.moving ? route.centerZ - horizontalRadius : route.anchorZ - footprintRadius,
    )
    maximum.set(
      route.moving ? route.centerX + horizontalRadius : route.anchorX + footprintRadius,
      route.y + route.scale * 0.1,
      route.moving ? route.centerZ + horizontalRadius : route.anchorZ + footprintRadius,
    )
    bounds.expandByPoint(minimum)
    bounds.expandByPoint(maximum)
  }

  if (bounds.isEmpty()) {
    bounds.min.set(0, 0, 0)
    bounds.max.set(0, 0, 0)
  }
  return {
    fish,
    bounds: {
      min: [bounds.min.x, bounds.min.y, bounds.min.z],
      max: [bounds.max.x, bounds.max.y, bounds.max.z],
    },
  }
}

export function createPondKoiMotion(
  surface: PondSurface,
  inputs: readonly PondKoiInput[],
): PondKoiMotion {
  const plan = buildPondKoiMotionPlan(surface, inputs)
  return {
    plan,
    bodyMatrices: plan.fish.map(() => new Matrix4()),
    tailMatrices: plan.fish.map(() => new Matrix4()),
    bindings: [],
    context: {
      position: new Vector3(),
      rotation: new Quaternion(),
      scale: new Vector3(),
      pivotToOrigin: new Matrix4().makeTranslation(-0.25, 0, 0),
      tailRotation: new Matrix4(),
      pivotFromOrigin: new Matrix4().makeTranslation(0.25, 0, 0),
      pose: { yaw: 0, tailAngle: 0 },
    },
    active: plan.fish.some(
      (route) => route.moving || route.bodySwayAmplitude > 0 || route.tailAmplitude > 0,
    ),
    attachmentRoot: null,
    lastTime: Number.NaN,
  }
}

export function bindPondKoiInstances(
  motion: PondKoiMotion,
  mesh: InstancedMesh,
  fishIndices: readonly number[],
  tail = false,
): void {
  if (fishIndices.length !== mesh.count) {
    throw new Error('Pond koi instance binding must identify every mesh instance')
  }
  const indices = Uint8Array.from(fishIndices)
  motion.bindings.push({ mesh, fishIndices: indices, tail })
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.boundingBox = new Box3(
    new Vector3().fromArray(motion.plan.bounds.min),
    new Vector3().fromArray(motion.plan.bounds.max),
  )
  mesh.boundingSphere = new Sphere()
  mesh.boundingBox.getBoundingSphere(mesh.boundingSphere)
}

export function attachPondKoiMotion(root: Object3D, motion: PondKoiMotion): void {
  motion.attachmentRoot = root
  attachedMotions.set(root, motion)
  resolvedMotions.set(root, {
    motion,
    childCount: root.children.length,
    firstChild: root.children[0],
    lastChild: root.children[root.children.length - 1],
  })
  updateMotion(motion, 0)
}

/**
 * Updates every synchronized body, marking and tail instance under a pond root.
 * Returns true when the root contains koi that need another frame.
 */
export function updatePondKoiMotion(root: Object3D, elapsedSeconds: number): boolean {
  const motion = resolveMotion(root)
  if (!motion) return false
  const time = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0
  if (motion.lastTime !== time) updateMotion(motion, time)
  return motion.active
}

/** Drops the root lookup cache; Three.js mesh resources remain owned by the pond renderer. */
export function disposePondKoiMotion(root: Object3D): void {
  resolvedMotions.delete(root)
}

export function evaluatePondKoiPose(route: PondKoiRoute, elapsedSeconds: number): PondKoiPose {
  const position = new Vector3()
  const pose = { yaw: 0, tailAngle: 0 }
  evaluateRoute(route, elapsedSeconds, position, pose)
  return {
    position: [position.x, position.y, position.z],
    yaw: pose.yaw,
    tailAngle: pose.tailAngle,
  }
}

/** Exact test/debug predicate for the animated body and pivoted tail at one time. */
export function pondKoiPoseFitsSurface(
  surface: PondSurface,
  route: PondKoiRoute,
  elapsedSeconds: number,
): boolean {
  const position = new Vector3()
  const pose = { yaw: 0, tailAngle: 0 }
  evaluateRoute(route, elapsedSeconds, position, pose)
  return footprintFits(
    (x, z) => pondSurfaceDepthAt(surface, x, z),
    position.x,
    position.z,
    pose.yaw,
    route.scale,
    pose.tailAngle,
    Math.max(MIN_KOI_DEPTH, route.scale * 0.22),
  )
}

function buildRoute(
  surface: PondSurface,
  sampleDepth: DepthSampler,
  input: PondKoiInput,
): PondKoiRoute {
  const phase = seededRange(input.id, 'route-phase', 0, TAU)
  const direction: 1 | -1 = seededUnit(input.id, 'route-direction') < 0.5 ? -1 : 1
  const ratio = seededRange(input.id, 'route-aspect', 0.62, 0.9)
  const maximumRadius = Math.min(1.6, Math.max(0.34, Math.sqrt(surface.area) * 0.19))
    * seededRange(input.id, 'route-radius', 0.78, 1.08)
  const bodySwayAmplitude = seededRange(input.id, 'body-sway', 0.035, 0.055)
  const tailAmplitude = seededRange(input.id, 'tail-amplitude', 0.3, 0.4)
  const route = baseRoute(input, phase, direction, bodySwayAmplitude, tailAmplitude)

  for (const factor of ROUTE_RADIUS_FACTORS) {
    const radiusAlong = maximumRadius * factor
    const radiusAcross = radiusAlong * ratio
    setEllipse(route, input, radiusAlong, radiusAcross)
    if (routeFits(sampleDepth, route)) return route
  }

  route.moving = false
  route.centerX = input.position[0]
  route.centerZ = input.position[1]
  route.radiusAlong = 0
  route.radiusAcross = 0
  for (const [bodyAmplitude, stationaryTailAmplitude] of STATIC_AMPLITUDES) {
    route.bodySwayAmplitude = bodyAmplitude
    route.tailAmplitude = stationaryTailAmplitude
    if (stationaryPoseFits(sampleDepth, route)) return route
  }
  return route
}

function baseRoute(
  input: PondKoiInput,
  phase: number,
  direction: 1 | -1,
  bodySwayAmplitude: number,
  tailAmplitude: number,
): PondKoiRoute {
  return {
    id: input.id,
    moving: true,
    anchorX: input.position[0],
    anchorZ: input.position[1],
    centerX: input.position[0],
    centerZ: input.position[1],
    axisX: 1,
    axisZ: 0,
    sideX: 0,
    sideZ: 1,
    radiusAlong: 0,
    radiusAcross: 0,
    phase,
    direction,
    angularSpeed: seededRange(input.id, 'route-speed', 0.15, 0.25),
    baseYaw: input.yaw,
    y: input.y,
    scale: input.scale,
    bodySwayAmplitude,
    bodySwayFrequency: seededRange(input.id, 'body-frequency', 1.25, 1.8),
    bodyPhase: seededRange(input.id, 'body-phase', 0, TAU),
    tailAmplitude,
    tailFrequency: seededRange(input.id, 'tail-frequency', 2.4, 3.4),
    tailPhase: seededRange(input.id, 'tail-phase', 0, TAU),
  }
}

function setEllipse(
  route: PondKoiRoute,
  input: PondKoiInput,
  radiusAlong: number,
  radiusAcross: number,
): void {
  const localVelocityX = -radiusAlong * Math.sin(route.phase) * route.direction
  const localVelocityZ = radiusAcross * Math.cos(route.phase) * route.direction
  const localHeading = Math.atan2(localVelocityZ, localVelocityX)
  const worldHeading = -input.yaw
  const axisHeading = worldHeading - localHeading
  route.axisX = Math.cos(axisHeading)
  route.axisZ = Math.sin(axisHeading)
  route.sideX = -route.axisZ
  route.sideZ = route.axisX
  route.radiusAlong = radiusAlong
  route.radiusAcross = radiusAcross
  route.centerX = input.position[0]
    - route.axisX * radiusAlong * Math.cos(route.phase)
    - route.sideX * radiusAcross * Math.sin(route.phase)
  route.centerZ = input.position[1]
    - route.axisZ * radiusAlong * Math.cos(route.phase)
    - route.sideZ * radiusAcross * Math.sin(route.phase)
}

function routeFits(sampleDepth: DepthSampler, route: PondKoiRoute): boolean {
  const minimumDepth = Math.max(MIN_KOI_DEPTH, route.scale * 0.22) + SWIM_CLEARANCE_DEPTH
  for (let sample = 0; sample < ROUTE_SAMPLES; sample += 1) {
    const theta = route.phase + route.direction * TAU * sample / ROUTE_SAMPLES
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    const x = route.centerX
      + route.axisX * route.radiusAlong * cosine
      + route.sideX * route.radiusAcross * sine
    const z = route.centerZ
      + route.axisZ * route.radiusAlong * cosine
      + route.sideZ * route.radiusAcross * sine
    const dx = route.direction * (
      -route.axisX * route.radiusAlong * sine
      + route.sideX * route.radiusAcross * cosine
    )
    const dz = route.direction * (
      -route.axisZ * route.radiusAlong * sine
      + route.sideZ * route.radiusAcross * cosine
    )
    const tangentYaw = Math.atan2(-dz, dx)
    for (let swaySample = 0; swaySample < MOTION_ANGLE_SAMPLES; swaySample += 1) {
      const sway = -route.bodySwayAmplitude
        + route.bodySwayAmplitude * 2 * swaySample / (MOTION_ANGLE_SAMPLES - 1)
      for (let tailSample = 0; tailSample < MOTION_ANGLE_SAMPLES; tailSample += 1) {
        const tail = -route.tailAmplitude
          + route.tailAmplitude * 2 * tailSample / (MOTION_ANGLE_SAMPLES - 1)
        if (!footprintFits(
          sampleDepth,
          x,
          z,
          tangentYaw + sway,
          route.scale * SWIM_CLEARANCE_SCALE + SWIM_CLEARANCE_MARGIN,
          tail,
          minimumDepth,
        )) return false
      }
    }
  }
  return true
}

function stationaryPoseFits(sampleDepth: DepthSampler, route: PondKoiRoute): boolean {
  const animated = route.bodySwayAmplitude > 0 || route.tailAmplitude > 0
  const minimumDepth = Math.max(MIN_KOI_DEPTH, route.scale * 0.22)
    + (animated ? 0.005 : 0)
  const fitScale = route.scale * (animated ? 1.02 : 1) + (animated ? 0.03 : 0)
  for (let swaySample = 0; swaySample < STATIONARY_ANGLE_SAMPLES; swaySample += 1) {
    const sway = -route.bodySwayAmplitude
      + route.bodySwayAmplitude * 2 * swaySample / (STATIONARY_ANGLE_SAMPLES - 1)
    for (let tailSample = 0; tailSample < STATIONARY_ANGLE_SAMPLES; tailSample += 1) {
      const tail = -route.tailAmplitude
        + route.tailAmplitude * 2 * tailSample / (STATIONARY_ANGLE_SAMPLES - 1)
      if (!footprintFits(
        sampleDepth,
        route.anchorX,
        route.anchorZ,
        route.baseYaw + sway,
        fitScale,
        tail,
        minimumDepth,
      )) return false
    }
  }
  return true
}

function footprintFits(
  sampleDepth: DepthSampler,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  tailAngle: number,
  minimumDepth: number,
): boolean {
  if (sampleDepth(x, z) < minimumDepth) return false
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  for (const point of BODY_FOOTPRINT) {
    if (!localPointIsWet(sampleDepth, x, z, cosine, sine, point[0], point[1], scale, minimumDepth)) {
      return false
    }
  }
  const tailCosine = Math.cos(tailAngle)
  const tailSine = Math.sin(tailAngle)
  for (const point of TAIL_FOOTPRINT) {
    const pivotX = point[0] + 0.25
    const rotatedX = -0.25 + pivotX * tailCosine + point[1] * tailSine
    const rotatedZ = -pivotX * tailSine + point[1] * tailCosine
    if (!localPointIsWet(sampleDepth, x, z, cosine, sine, rotatedX, rotatedZ, scale, minimumDepth)) {
      return false
    }
  }
  return true
}

function localPointIsWet(
  sampleDepth: DepthSampler,
  x: number,
  z: number,
  cosine: number,
  sine: number,
  localX: number,
  localZ: number,
  scale: number,
  minimumDepth: number,
): boolean {
  const worldX = x + (localX * cosine + localZ * sine) * scale
  const worldZ = z + (-localX * sine + localZ * cosine) * scale
  return sampleDepth(worldX, worldZ) >= minimumDepth
}

function evaluateRoute(
  route: PondKoiRoute,
  elapsedSeconds: number,
  position: Vector3,
  pose: { yaw: number; tailAngle: number },
): void {
  const time = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0
  let tangentYaw = route.baseYaw
  if (route.moving) {
    const theta = route.phase + route.direction * route.angularSpeed * time
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    position.set(
      route.centerX
        + route.axisX * route.radiusAlong * cosine
        + route.sideX * route.radiusAcross * sine,
      route.y,
      route.centerZ
        + route.axisZ * route.radiusAlong * cosine
        + route.sideZ * route.radiusAcross * sine,
    )
    const dx = route.direction * (
      -route.axisX * route.radiusAlong * sine
      + route.sideX * route.radiusAcross * cosine
    )
    const dz = route.direction * (
      -route.axisZ * route.radiusAlong * sine
      + route.sideZ * route.radiusAcross * cosine
    )
    tangentYaw = Math.atan2(-dz, dx)
  } else {
    position.set(route.anchorX, route.y, route.anchorZ)
  }
  pose.yaw = tangentYaw
    + Math.sin(time * route.bodySwayFrequency + route.bodyPhase) * route.bodySwayAmplitude
  pose.tailAngle = Math.sin(time * route.tailFrequency + route.tailPhase) * route.tailAmplitude
}

function updateMotion(motion: PondKoiMotion, elapsedSeconds: number): void {
  const context = motion.context
  for (let index = 0; index < motion.plan.fish.length; index += 1) {
    const route = motion.plan.fish[index]
    const bodyMatrix = motion.bodyMatrices[index]
    const tailMatrix = motion.tailMatrices[index]
    if (!route || !bodyMatrix || !tailMatrix) continue
    evaluateRoute(route, elapsedSeconds, context.position, context.pose)
    context.rotation.setFromAxisAngle(UP, context.pose.yaw)
    context.scale.setScalar(route.scale)
    bodyMatrix.compose(context.position, context.rotation, context.scale)
    context.tailRotation.makeRotationY(context.pose.tailAngle)
    tailMatrix.copy(bodyMatrix)
      .multiply(context.pivotToOrigin)
      .multiply(context.tailRotation)
      .multiply(context.pivotFromOrigin)
  }

  for (let bindingIndex = 0; bindingIndex < motion.bindings.length; bindingIndex += 1) {
    const binding = motion.bindings[bindingIndex]
    if (!binding) continue
    const matrices = binding.tail ? motion.tailMatrices : motion.bodyMatrices
    for (let index = 0; index < binding.fishIndices.length; index += 1) {
      const matrix = matrices[binding.fishIndices[index] ?? -1]
      if (matrix) binding.mesh.setMatrixAt(index, matrix)
    }
    binding.mesh.instanceMatrix.needsUpdate = true
  }
  motion.lastTime = elapsedSeconds
}

function resolveMotion(root: Object3D): PondKoiMotion | null {
  const cached = resolvedMotions.get(root)
  if (cached) {
    if (cached.motion) {
      let ancestor = cached.motion.attachmentRoot
      while (ancestor) {
        if (ancestor === root) return cached.motion
        ancestor = ancestor.parent
      }
    } else if (
      cached.childCount === root.children.length
      && cached.firstChild === root.children[0]
      && cached.lastChild === root.children[root.children.length - 1]
    ) {
      return null
    }
  }

  let motion = attachedMotions.get(root) ?? null
  if (!motion) {
    root.traverse((object) => {
      if (!motion) motion = attachedMotions.get(object) ?? null
    })
  }
  resolvedMotions.set(root, {
    motion,
    childCount: root.children.length,
    firstChild: root.children[0],
    lastChild: root.children[root.children.length - 1],
  })
  return motion
}

function createSurfaceDepthSampler(surface: PondSurface): DepthSampler {
  const triangleCount = Math.floor(surface.positions.length / 9)
  if (triangleCount === 0) return () => 0
  let minimumX = Number.POSITIVE_INFINITY
  let minimumZ = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  let maximumZ = Number.NEGATIVE_INFINITY
  for (let offset = 0; offset < surface.positions.length; offset += 3) {
    const x = surface.positions[offset]
    const z = surface.positions[offset + 2]
    if (x === undefined || z === undefined) continue
    minimumX = Math.min(minimumX, x)
    minimumZ = Math.min(minimumZ, z)
    maximumX = Math.max(maximumX, x)
    maximumZ = Math.max(maximumZ, z)
  }
  const extentX = Math.max(1e-6, maximumX - minimumX)
  const extentZ = Math.max(1e-6, maximumZ - minimumZ)
  const baseResolution = Math.min(64, Math.max(4, Math.ceil(Math.sqrt(triangleCount))))
  const aspect = Math.sqrt(extentX / extentZ)
  const columns = Math.min(64, Math.max(1, Math.round(baseResolution * aspect)))
  const rows = Math.min(64, Math.max(1, Math.round(baseResolution / aspect)))
  const buckets: number[][] = Array.from({ length: columns * rows }, () => [])

  const columnAt = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor((x - minimumX) / extentX * columns)))
  const rowAt = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - minimumZ) / extentZ * rows)))
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 9
    const ax = surface.positions[offset] ?? 0
    const az = surface.positions[offset + 2] ?? 0
    const bx = surface.positions[offset + 3] ?? 0
    const bz = surface.positions[offset + 5] ?? 0
    const cx = surface.positions[offset + 6] ?? 0
    const cz = surface.positions[offset + 8] ?? 0
    const firstColumn = columnAt(Math.min(ax, bx, cx))
    const lastColumn = columnAt(Math.max(ax, bx, cx))
    const firstRow = rowAt(Math.min(az, bz, cz))
    const lastRow = rowAt(Math.max(az, bz, cz))
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        buckets[row * columns + column]?.push(triangle)
      }
    }
  }

  return (x: number, z: number): number => {
    if (x < minimumX || x > maximumX || z < minimumZ || z > maximumZ) return 0
    const candidates = buckets[rowAt(z) * columns + columnAt(x)]
    if (!candidates) return 0
    let deepest = 0
    for (const triangle of candidates) {
      const offset = triangle * 9
      const ax = surface.positions[offset] ?? 0
      const az = surface.positions[offset + 2] ?? 0
      const bx = surface.positions[offset + 3] ?? 0
      const bz = surface.positions[offset + 5] ?? 0
      const cx = surface.positions[offset + 6] ?? 0
      const cz = surface.positions[offset + 8] ?? 0
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(denominator) <= 1e-8) continue
      const firstWeight = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator
      const secondWeight = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator
      const thirdWeight = 1 - firstWeight - secondWeight
      if (firstWeight < -1e-8 || secondWeight < -1e-8 || thirdWeight < -1e-8) continue
      const depthOffset = triangle * 3
      deepest = Math.max(
        deepest,
        (surface.depths[depthOffset] ?? 0) * firstWeight
          + (surface.depths[depthOffset + 1] ?? 0) * secondWeight
          + (surface.depths[depthOffset + 2] ?? 0) * thirdWeight,
      )
    }
    return Math.max(0, deepest)
  }
}

function seededRange(id: string, domain: string, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * seededUnit(id, domain)
}

function seededUnit(id: string, domain: string): number {
  let hash = 2166136261
  const value = `${domain}:${id}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}
