'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Sphere,
  Vector3,
} from 'three'
import type { Point2 } from './frontages'
import { polygonCentroid } from './exterior-terrain'
import { PresentationBasicMaterial } from './presentation-material'
import { seededRange, seededUnit } from './seeded-random'

export const DISTANT_BIRD_COUNT = 12
export const DISTANT_BIRD_TRIANGLES = 11
const TWO_PI = Math.PI * 2
const TERRAIN_PATH_SAMPLES = 128
const TERRAIN_SAMPLE_MARGIN = 6
const BIRD_LOCAL_RADIUS = 1.65
const NO_RAYCAST = () => undefined

type Vec3 = [number, number, number]

export type DistantBirdFlight = Readonly<{
  center: readonly [number, number]
  radii: readonly [number, number]
  angularVelocity: number
  phase: number
  duration: number
  direction: -1 | 1
  pathCosine: number
  pathSine: number
  altitude: number
  verticalAmplitude: number
  verticalPhase: number
  scale: number
  bank: number
  bankPhase: number
  wingbeats: number
  glideCycles: number
  glidePhase: number
  wingPhase: number
  minimumClearance: number
  formation: Readonly<{
    rank: number
    side: -1 | 0 | 1
    lateral: number
    driftPhase: number
  }> | null
}>

export type DistantBirdFlightPlan = Readonly<{
  birds: readonly DistantBirdFlight[]
  bounds: Readonly<{
    min: readonly [number, number, number]
    max: readonly [number, number, number]
    center: readonly [number, number, number]
    radius: number
  }>
}>

export type DistantBirdPose = {
  position: Vec3
  rotation: Vec3
  wingLift: number
  scale: number
}

export type DistantBirdUpdateContext = Readonly<{
  matrix: Matrix4
  position: Vector3
  rotation: Euler
  quaternion: Quaternion
  scale: Vector3
  morphSource: Mesh
  pose: DistantBirdPose
}>

export type BuildDistantBirdFlightPlanOptions = Readonly<{
  boundary: readonly Point2[]
  heightAt: (x: number, z: number) => number
  seed?: string
}>

function routePoint(
  center: readonly [number, number],
  radii: readonly [number, number],
  rotation: number,
  theta: number,
): readonly [number, number] {
  const localX = Math.cos(theta) * radii[0]
  const localZ = Math.sin(theta) * radii[1]
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return [center[0] + localX * cosine - localZ * sine, center[1] + localX * sine + localZ * cosine]
}

function peakTerrainAlongRoute(
  center: readonly [number, number],
  radii: readonly [number, number],
  rotation: number,
  heightAt: (x: number, z: number) => number,
  halfWidth = 0,
): number {
  let peak = 0
  const cosine = Math.cos(rotation),
    sine = Math.sin(rotation)
  for (let sample = 0; sample < TERRAIN_PATH_SAMPLES; sample += 1) {
    const theta = (sample / TERRAIN_PATH_SAMPLES) * TWO_PI
    const [x, z] = routePoint(center, radii, rotation, theta)
    const dx = -Math.sin(theta) * radii[0] * cosine - Math.cos(theta) * radii[1] * sine
    const dz = -Math.sin(theta) * radii[0] * sine + Math.cos(theta) * radii[1] * cosine
    const length = Math.hypot(dx, dz)
    for (let side = halfWidth > 0 ? -1 : 0; side <= (halfWidth > 0 ? 1 : 0); side++) {
      const height = heightAt(
        x + (dz / length) * halfWidth * side,
        z - (dx / length) * halfWidth * side,
      )
      if (Number.isFinite(height)) peak = Math.max(peak, height)
    }
  }
  return peak
}

function rotatedEllipseExtents(
  radii: readonly [number, number],
  rotation: number,
): readonly [number, number] {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return [
    Math.hypot(radii[0] * cosine, radii[1] * sine),
    Math.hypot(radii[0] * sine, radii[1] * cosine),
  ]
}

/** Deterministic, terrain-aware paths. No route sampling occurs after construction. */
export function buildDistantBirdFlightPlan({
  boundary,
  heightAt,
  seed = 'pascal-suburbs',
}: BuildDistantBirdFlightPlanOptions): DistantBirdFlightPlan {
  const landscapeCenter = polygonCentroid(boundary)
  const birds: DistantBirdFlight[] = []
  const minimum: Vec3 = [Infinity, Infinity, Infinity]
  const maximum: Vec3 = [-Infinity, -Infinity, -Infinity]
  const flockCount = 7 + Math.floor(seededUnit(seed, 'bird-flock:count') * 3)
  const spacing = seededRange(seed, 'bird-flock:spacing', 3.4, 4)
  const trailing = seededRange(seed, 'bird-flock:trailing', 3, 3.8)
  const flockHalfWidth = Math.ceil((flockCount - 1) / 2) * spacing + 0.4

  for (let index = 0; index < DISTANT_BIRD_COUNT; index += 1) {
    const domain = `distant-bird:${index}`
    const leader = index > 0 && index < flockCount ? birds[0]! : null
    let bird: DistantBirdFlight
    if (leader) {
      const rank = Math.ceil(index / 2)
      const side = index % 2 === 1 ? -1 : 1
      const speed =
        (TWO_PI * Math.sqrt((leader.radii[0] ** 2 + leader.radii[1] ** 2) / 2)) / leader.duration
      const lag = (rank * trailing) / speed + (side === 1 ? 0.065 : 0)
      bird = {
        ...leader,
        // Delayed leader path, not a rigid translated V: turns reach each row later.
        phase: leader.phase - leader.angularVelocity * lag,
        altitude: leader.altitude + seededRange(seed, `${domain}:height-offset`, -0.22, 0.22),
        scale: leader.scale * seededRange(seed, `${domain}:scale`, 0.95, 1.05),
        wingPhase: seededRange(seed, `${domain}:wing-phase`, 0, TWO_PI),
        glidePhase: leader.glidePhase + seededRange(seed, `${domain}:glide-phase`, -0.35, 0.35),
        formation: {
          rank,
          side,
          lateral: side * (rank * spacing + seededRange(seed, `${domain}:spacing`, -0.12, 0.12)),
          driftPhase: seededRange(seed, `${domain}:drift`, 0, TWO_PI),
        },
      }
    } else {
      const center: readonly [number, number] = [
        landscapeCenter[0] + seededRange(seed, `${domain}:center-x`, -24, 24),
        landscapeCenter[1] + seededRange(seed, `${domain}:center-z`, -24, 24),
      ]
      const radiusX = seededRange(seed, `${domain}:radius-x`, 125, 205)
      const radii: readonly [number, number] = [
        radiusX,
        radiusX * seededRange(seed, `${domain}:radius-z`, 0.58, 0.82),
      ]
      const pathRotation = seededRange(seed, `${domain}:rotation`, -Math.PI, Math.PI)
      const scale = seededRange(seed, `${domain}:scale`, 0.9, 1.25)
      const verticalAmplitude = seededRange(seed, `${domain}:vertical-amplitude`, 1.5, 4.5)
      const minimumClearance = seededRange(seed, `${domain}:clearance`, 28, 42)
      const terrainPeak = peakTerrainAlongRoute(
        center,
        radii,
        pathRotation,
        heightAt,
        index === 0 ? flockHalfWidth : 0,
      )
      const altitude =
        terrainPeak +
        TERRAIN_SAMPLE_MARGIN +
        minimumClearance +
        verticalAmplitude +
        BIRD_LOCAL_RADIUS * scale
      const duration = seededRange(seed, `${domain}:duration`, 38, 58)
      const direction = seededUnit(seed, `${domain}:direction`) < 0.5 ? -1 : 1
      bird = {
        center,
        radii,
        phase: seededRange(seed, `${domain}:phase`, 0, TWO_PI),
        duration,
        angularVelocity: (direction * TWO_PI) / duration,
        direction,
        altitude,
        pathCosine: Math.cos(pathRotation),
        pathSine: Math.sin(pathRotation),
        verticalAmplitude,
        verticalPhase: seededRange(seed, `${domain}:vertical-phase`, 0, TWO_PI),
        scale,
        bank: seededRange(seed, `${domain}:bank`, 0.13, 0.25),
        bankPhase: seededRange(seed, `${domain}:bank-phase`, 0, TWO_PI),
        wingbeats: Math.floor(seededRange(seed, `${domain}:wingbeats`, 72, 97)),
        glideCycles: Math.floor(seededRange(seed, `${domain}:glide-cycles`, 3, 6)),
        glidePhase: seededRange(seed, `${domain}:glide-phase`, 0, TWO_PI),
        wingPhase: seededRange(seed, `${domain}:wing-phase`, 0, TWO_PI),
        minimumClearance,
        formation: index === 0 ? { rank: 0, side: 0, lateral: 0, driftPhase: 0 } : null,
      }
    }
    birds.push(bird)

    const [extentX, extentZ] = rotatedEllipseExtents(
      bird.radii,
      Math.atan2(bird.pathSine, bird.pathCosine),
    )
    const silhouetteRadius = BIRD_LOCAL_RADIUS * bird.scale
    const lateralExtent = bird.formation?.rank ? Math.abs(bird.formation.lateral) + 0.22 : 0
    minimum[0] = Math.min(minimum[0], bird.center[0] - extentX - lateralExtent - silhouetteRadius)
    minimum[1] = Math.min(minimum[1], bird.altitude - bird.verticalAmplitude - silhouetteRadius)
    minimum[2] = Math.min(minimum[2], bird.center[1] - extentZ - lateralExtent - silhouetteRadius)
    maximum[0] = Math.max(maximum[0], bird.center[0] + extentX + lateralExtent + silhouetteRadius)
    maximum[1] = Math.max(maximum[1], bird.altitude + bird.verticalAmplitude + silhouetteRadius)
    maximum[2] = Math.max(maximum[2], bird.center[1] + extentZ + lateralExtent + silhouetteRadius)
  }

  const center: Vec3 = [
    (minimum[0] + maximum[0]) / 2,
    (minimum[1] + maximum[1]) / 2,
    (minimum[2] + maximum[2]) / 2,
  ]
  const radius =
    Math.hypot(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]) / 2
  return { birds, bounds: { min: minimum, max: maximum, center, radius } }
}

function smoothstep(start: number, end: number, value: number): number {
  const normalized = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return normalized * normalized * (3 - 2 * normalized)
}

/** Seek one bird to an absolute time; supplying a target keeps render updates allocation-free. */
export function evaluateDistantBirdFlight(
  bird: DistantBirdFlight,
  time: number,
  target: DistantBirdPose = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    wingLift: 0.5,
    scale: bird.scale,
  },
): DistantBirdPose {
  const safeTime = Number.isFinite(time) ? time : 0
  const angularVelocity = bird.angularVelocity
  const theta = bird.phase + safeTime * angularVelocity
  const cosineTheta = Math.cos(theta)
  const sineTheta = Math.sin(theta)
  const cosineRotation = bird.pathCosine
  const sineRotation = bird.pathSine
  const localX = cosineTheta * bird.radii[0]
  const localZ = sineTheta * bird.radii[1]
  let dx =
    (-sineTheta * bird.radii[0] * cosineRotation - cosineTheta * bird.radii[1] * sineRotation) *
    angularVelocity
  let dz =
    (-sineTheta * bird.radii[0] * sineRotation + cosineTheta * bird.radii[1] * cosineRotation) *
    angularVelocity
  const verticalAngle = theta * 2 + bird.verticalPhase
  const dy = Math.cos(verticalAngle) * bird.verticalAmplitude * 2 * angularVelocity
  target.position[0] = bird.center[0] + localX * cosineRotation - localZ * sineRotation
  target.position[1] = bird.altitude + Math.sin(verticalAngle) * bird.verticalAmplitude
  target.position[2] = bird.center[1] + localX * sineRotation + localZ * cosineRotation
  if (bird.formation?.rank) {
    const driftAngle = theta * 3 + bird.formation.driftPhase
    const lateral = bird.formation.lateral + Math.sin(driftAngle) * 0.22
    const speed = Math.hypot(dx, dz),
      rightX = dz / speed,
      rightZ = -dx / speed
    target.position[0] += rightX * lateral
    target.position[2] += rightZ * lateral
    const ddx = (-localX * cosineRotation + localZ * sineRotation) * angularVelocity ** 2
    const ddz = (-localX * sineRotation - localZ * cosineRotation) * angularVelocity ** 2
    const turnRate = (dz * ddx - dx * ddz) / speed ** 2
    const lateralVelocity = Math.cos(driftAngle) * 0.66 * angularVelocity
    dx += rightX * lateralVelocity + rightZ * turnRate * lateral
    dz += rightZ * lateralVelocity - rightX * turnRate * lateral
  }
  target.rotation[0] = -Math.atan2(dy, Math.hypot(dx, dz))
  target.rotation[1] = Math.atan2(dx, dz)
  target.rotation[2] =
    -bird.direction * bird.bank * (0.82 + Math.sin(theta + bird.bankPhase) * 0.18)
  const beatEnvelope = smoothstep(-0.2, 0.4, Math.sin(theta * bird.glideCycles + bird.glidePhase))
  target.wingLift = Math.max(
    0.04,
    Math.min(1, 0.56 + Math.sin(theta * bird.wingbeats + bird.wingPhase) * beatEnvelope * 0.44),
  )
  target.scale = bird.scale
  return target
}

function addTriangle(
  base: number[],
  raised: number[],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  wing: boolean,
): void {
  for (const [x, z] of [a, b, c]) {
    const flex = wing ? Math.max(0, Math.min(1, (Math.abs(x) - 0.08) / 1.37)) : 0
    base.push(x, -0.22 * flex, z)
    raised.push(0, 0.64 * flex, 0)
  }
}

/** Eleven opaque triangles: one original low-poly silhouette and one wing morph. */
export function createDistantBirdGeometry(): BufferGeometry {
  const base: number[] = []
  const raised: number[] = []
  const triangle = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    wing = false,
  ) => addTriangle(base, raised, a, b, c, wing)

  triangle([0, 0.82], [-0.18, 0.12], [0.18, 0.12])
  triangle([-0.18, 0.12], [-0.13, -0.36], [0.18, 0.12])
  triangle([-0.13, -0.36], [0.13, -0.36], [0.18, 0.12])
  triangle([0, -0.3], [-0.13, -0.32], [-0.36, -0.78])
  triangle([0, -0.3], [0.36, -0.78], [0.13, -0.32])
  triangle([-0.1, 0.12], [-0.63, 0.13], [-0.5, -0.28], true)
  triangle([-0.63, 0.13], [-1.45, -0.08], [-0.5, -0.28], true)
  triangle([-0.1, 0.12], [-0.5, -0.28], [-0.09, -0.3], true)
  triangle([0.1, 0.12], [0.5, -0.28], [0.63, 0.13], true)
  triangle([0.63, 0.13], [0.5, -0.28], [1.45, -0.08], true)
  triangle([0.1, 0.12], [0.09, -0.3], [0.5, -0.28], true)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(base, 3))
  geometry.morphAttributes.position = [new Float32BufferAttribute(raised, 3)]
  // Relative deltas keep the base influence constant for every instance.
  geometry.morphTargetsRelative = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = 'environment-distant-bird-silhouette'
  return geometry
}

export function createDistantBirdUpdateContext(mesh: InstancedMesh): DistantBirdUpdateContext {
  const morphSource = new Mesh(mesh.geometry, mesh.material)
  morphSource.morphTargetInfluences = [0]
  return {
    matrix: new Matrix4(),
    position: new Vector3(),
    rotation: new Euler(0, 0, 0, 'YXZ'),
    quaternion: new Quaternion(),
    scale: new Vector3(),
    morphSource,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0], wingLift: 0.5, scale: 1 },
  }
}

/** Absolute-time update seam used by both the component and fixed-time GPU smoke proofs. */
export function updateDistantBirdInstances(
  mesh: InstancedMesh,
  plan: DistantBirdFlightPlan,
  time: number,
  context: DistantBirdUpdateContext = createDistantBirdUpdateContext(mesh),
): void {
  mesh.count = plan.birds.length
  for (let index = 0; index < plan.birds.length; index += 1) {
    const pose = evaluateDistantBirdFlight(plan.birds[index]!, time, context.pose)
    context.position.fromArray(pose.position)
    context.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], 'YXZ')
    context.quaternion.setFromEuler(context.rotation)
    context.scale.setScalar(pose.scale)
    mesh.setMatrixAt(
      index,
      context.matrix.compose(context.position, context.quaternion, context.scale),
    )
    context.morphSource.morphTargetInfluences![0] = pose.wingLift
    mesh.setMorphAt(index, context.morphSource)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true
}

/** The returned mesh owns its geometry, material, instance buffers and morph texture. */
export function createDistantBirdInstances(plan: DistantBirdFlightPlan): InstancedMesh {
  const geometry = createDistantBirdGeometry()
  const material = new PresentationBasicMaterial({ color: '#354047', side: DoubleSide })
  material.name = 'environment-distant-bird-material'
  const mesh = new InstancedMesh(geometry, material, plan.birds.length)
  mesh.name = 'environment-distant-bird-instances'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.raycast = NO_RAYCAST
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.boundingBox = new Box3(
    new Vector3().fromArray(plan.bounds.min),
    new Vector3().fromArray(plan.bounds.max),
  )
  mesh.boundingSphere = new Sphere(new Vector3().fromArray(plan.bounds.center), plan.bounds.radius)
  mesh.userData = {
    birdCount: plan.birds.length,
    drawCallCount: 1,
    trianglesPerBird: DISTANT_BIRD_TRIANGLES,
    visibleTriangleCount: plan.birds.length * DISTANT_BIRD_TRIANGLES,
    pascalExport: 'strip',
  }
  updateDistantBirdInstances(mesh, plan, 0)
  return mesh
}

export function disposeDistantBirdInstances(mesh: InstancedMesh): void {
  mesh.dispose()
  mesh.geometry.dispose()
  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) material.dispose()
  } else {
    mesh.material.dispose()
  }
}

export function DistantBirds({
  boundary,
  heightAt,
  seed,
  moving,
}: {
  boundary: readonly Point2[]
  heightAt: (x: number, z: number) => number
  seed: string
  moving: boolean
}) {
  const plan = useMemo(
    () => buildDistantBirdFlightPlan({ boundary, heightAt, seed }),
    [boundary, heightAt, seed],
  )
  const mesh = useMemo(() => createDistantBirdInstances(plan), [plan])
  const context = useMemo(() => createDistantBirdUpdateContext(mesh), [mesh])
  const elapsed = useRef(0)
  const getThree = useThree((state) => state.get)

  useLayoutEffect(() => {
    elapsed.current = 0
    // Effect replay retains the mesh, but dispose clears its morph texture.
    if (mesh.morphTexture === null) updateDistantBirdInstances(mesh, plan, 0, context)
    return () => disposeDistantBirdInstances(mesh)
  }, [mesh, plan, context])
  useEffect(() => {
    // FrameLimiter advances `never` hosts; only demand canvases need a kick.
    const state = getThree()
    if (moving && state.frameloop === 'demand') state.invalidate()
  }, [getThree, moving])
  useFrame((state, delta) => {
    if (!moving) return
    elapsed.current += Math.min(delta, 0.1)
    // Chain demand renders only while motion is active. A false `moving`
    // leaves the component-local elapsed time and the last matrices untouched.
    updateDistantBirdInstances(mesh, plan, elapsed.current, context)
    if (state.frameloop === 'demand') state.invalidate()
  })

  return <primitive object={mesh} dispose={null} />
}
