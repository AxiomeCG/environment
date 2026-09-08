'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Uint16BufferAttribute,
  Vector3,
  type Camera,
  type UniformNode,
} from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { WeatherSettings } from '../store'
import { useEnvironmentStore } from '../store'
import {
  acquireThunderAudioOwner,
  createThunderAudioOwner,
  isThunderAudioConsented,
  playThunderAfter,
  setThunderAudioOwnerEnabled,
  type ThunderAudioOwner,
} from './weather-audio'
import { createSnowFieldResources, disposeSnowFieldResources } from './snow'
import { getSceneWeatherSignal } from './weather-signal'
import { usePageVisible, useReducedMotionPreference } from './weather-preferences'

const DROP_COUNT = 1536
const RAIN_RADIUS = 18
const RAIN_HEIGHT = 24
const LIGHTNING_POINT_COUNT = 9
const FIRST_FLASH_MIN_SECONDS = 0.12
const FIRST_FLASH_SPAN_SECONDS = 0.08
const REPEAT_FLASH_MIN_SECONDS = 16
const REPEAT_FLASH_SPAN_SECONDS = 18
const FLASH_SECONDS = 0.48
const NO_RAYCAST = () => undefined

type RainUniforms = {
  intensity: UniformNode<'float', number>
  wind: UniformNode<'float', number>
}

type RainFieldResources = {
  mesh: InstancedMesh
  uniforms: RainUniforms
}

function createDropGeometry(): BufferGeometry {
  const halfWidth = 0.012
  const halfHeight = 0.58
  const positions = new Float32Array([
    -halfWidth,
    -halfHeight,
    0,
    halfWidth,
    -halfHeight,
    0,
    halfWidth,
    halfHeight,
    0,
    -halfWidth,
    -halfHeight,
    0,
    halfWidth,
    halfHeight,
    0,
    -halfWidth,
    halfHeight,
    0,
    0,
    -halfHeight,
    -halfWidth,
    0,
    -halfHeight,
    halfWidth,
    0,
    halfHeight,
    halfWidth,
    0,
    -halfHeight,
    -halfWidth,
    0,
    halfHeight,
    halfWidth,
    0,
    halfHeight,
    -halfWidth,
  ])
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

function createRainFieldResources(
  settings: Pick<WeatherSettings, 'rain' | 'wind'>,
): RainFieldResources {
  const intensity = TSL.uniform(settings.rain)
  const wind = TSL.uniform(settings.wind)
  const seed = TSL.float(TSL.instanceIndex)
  const phase = TSL.fract(
    TSL.time.mul(TSL.mix(0.42, 0.8, intensity)).add(TSL.hash(seed.mul(83.17).add(0.37))),
  )
  const randomX = TSL.hash(seed.mul(17.17).add(2.31))
    .sub(0.5)
    .mul(RAIN_RADIUS * 2)
  const randomZ = TSL.hash(seed.mul(47.73).add(8.93))
    .sub(0.5)
    .mul(RAIN_RADIUS * 2)
  const drift = wind.mul(phase).mul(4.2)
  const localX = TSL.positionGeometry.x.sub(TSL.positionGeometry.y.mul(wind).mul(0.36))
  const localZ = TSL.positionGeometry.z.sub(TSL.positionGeometry.y.mul(wind).mul(0.1))

  const material = new MeshBasicNodeMaterial({
    depthWrite: false,
    fog: true,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
  })
  material.name = 'environment-rain-material'
  material.colorNode = TSL.vec3(0.68, 0.82, 1)
  const visible = TSL.step(TSL.hash(seed.mul(113.9).add(21.7)), intensity)
  material.opacityNode = visible.mul(intensity.mul(0.34).add(0.09))
  material.maskNode = visible.greaterThan(0.5)
  material.positionNode = TSL.vec3(
    TSL.cameraPosition.x.add(randomX).add(drift).add(localX),
    TSL.cameraPosition.y
      .add(RAIN_HEIGHT * 0.5)
      .sub(phase.mul(RAIN_HEIGHT))
      .add(TSL.positionGeometry.y),
    TSL.cameraPosition.z.add(randomZ).add(drift.mul(0.28)).add(localZ),
  )

  const mesh = new InstancedMesh(createDropGeometry(), material, DROP_COUNT)
  mesh.name = 'environment-camera-rain'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.raycast = NO_RAYCAST
  mesh.userData = {
    pascalExport: 'strip',
    dropCapacity: DROP_COUNT,
    rainRadius: RAIN_RADIUS,
    rainHeight: RAIN_HEIGHT,
  }
  return { mesh, uniforms: { intensity, wind } }
}

function disposeRainFieldResources(resources: RainFieldResources): void {
  resources.mesh.dispose()
  resources.mesh.geometry.dispose()
  const material = resources.mesh.material
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose()
  } else {
    material.dispose()
  }
}

function RainField({ settings, active }: { settings: WeatherSettings; active: boolean }) {
  const resources = useMemo(
    () => createRainFieldResources(useEnvironmentStore.getState().weatherSettings),
    [],
  )
  const getThree = useThree((state) => state.get)

  useEffect(() => () => disposeRainFieldResources(resources), [resources])
  useEffect(() => {
    resources.uniforms.intensity.value = settings.rain
    resources.uniforms.wind.value = settings.wind
    resources.mesh.visible = active
    const state = getThree()
    if (state.frameloop === 'demand') state.invalidate()
  }, [active, getThree, resources, settings.rain, settings.wind])
  useFrame((state) => {
    if (active && state.frameloop === 'demand') state.invalidate()
  })

  return <primitive object={resources.mesh} dispose={null} />
}

type LightningResources = {
  bolt: Mesh<BufferGeometry, MeshBasicNodeMaterial>
  positions: Float32BufferAttribute
  pathX: Float32Array
}

function createLightningResources(): LightningResources {
  const geometry = new BufferGeometry()
  const positions = new Float32BufferAttribute(
    new Float32Array(LIGHTNING_POINT_COUNT * 2 * 3),
    3,
  ).setUsage(DynamicDrawUsage)
  const indices = new Uint16Array((LIGHTNING_POINT_COUNT - 1) * 6)
  for (let segment = 0; segment < LIGHTNING_POINT_COUNT - 1; segment += 1) {
    const vertex = segment * 2
    const offset = segment * 6
    indices[offset] = vertex
    indices[offset + 1] = vertex + 1
    indices[offset + 2] = vertex + 2
    indices[offset + 3] = vertex + 1
    indices[offset + 4] = vertex + 3
    indices[offset + 5] = vertex + 2
  }
  geometry.setAttribute('position', positions)
  geometry.setIndex(new Uint16BufferAttribute(indices, 1))
  const material = new MeshBasicNodeMaterial({
    color: '#e8f2ff',
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
  })
  material.name = 'environment-lightning-material'
  const bolt = new Mesh(geometry, material)
  bolt.name = 'environment-lightning-ribbon'
  bolt.frustumCulled = false
  bolt.raycast = NO_RAYCAST
  bolt.renderOrder = 1000
  bolt.visible = false
  bolt.userData = {
    pascalExport: 'strip',
    flashFadeSeconds: FLASH_SECONDS,
    firstFlashSeconds: [
      FIRST_FLASH_MIN_SECONDS,
      FIRST_FLASH_MIN_SECONDS + FIRST_FLASH_SPAN_SECONDS,
    ],
    repeatFlashSeconds: [
      REPEAT_FLASH_MIN_SECONDS,
      REPEAT_FLASH_MIN_SECONDS + REPEAT_FLASH_SPAN_SECONDS,
    ],
  }

  return { bolt, positions, pathX: new Float32Array(LIGHTNING_POINT_COUNT) }
}

function disposeLightningResources(resources: LightningResources): void {
  resources.bolt.geometry.dispose()
  resources.bolt.material.dispose()
}

function nextRandom(state: { value: number }): number {
  let value = state.value | 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.value = value
  return (value >>> 0) / 0x100000000
}

function placeLightningRibbon(
  resources: LightningResources,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  random: { value: number },
  forward: Vector3,
  right: Vector3,
): void {
  const safeHeight = Math.max(1, viewportHeight)
  const distance =
    camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera
      ? Math.max(camera.near + 0.5, Math.min(12, camera.far * 0.25))
      : 12
  let visibleHeight = 20
  let visibleWidth = (visibleHeight * Math.max(1, viewportWidth)) / safeHeight
  if (camera instanceof PerspectiveCamera) {
    visibleHeight = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom
    visibleWidth = visibleHeight * camera.aspect
  } else if (camera instanceof OrthographicCamera) {
    visibleHeight = Math.abs(camera.top - camera.bottom) / camera.zoom
    visibleWidth = Math.abs(camera.right - camera.left) / camera.zoom
  }

  camera.getWorldDirection(forward)
  right.set(1, 0, 0).applyQuaternion(camera.quaternion)
  resources.bolt.position
    .copy(camera.position)
    .addScaledVector(forward, distance)
    .addScaledVector(right, (nextRandom(random) - 0.5) * visibleWidth * 0.48)
  resources.bolt.quaternion.copy(camera.quaternion)

  const boltHeight = visibleHeight * 0.62
  const halfWidth = (visibleHeight / safeHeight) * 2.2
  const verticalStep = boltHeight / (LIGHTNING_POINT_COUNT - 1)
  let lateral = 0
  for (let index = 0; index < LIGHTNING_POINT_COUNT; index += 1) {
    if (index > 0) {
      lateral += (nextRandom(random) - 0.5) * visibleWidth * 0.055
      lateral = Math.max(-visibleWidth * 0.085, Math.min(visibleWidth * 0.085, lateral))
    }
    resources.pathX[index] = lateral
  }
  for (let index = 0; index < LIGHTNING_POINT_COUNT; index += 1) {
    const previous = Math.max(0, index - 1)
    const next = Math.min(LIGHTNING_POINT_COUNT - 1, index + 1)
    const tangentX = resources.pathX[next]! - resources.pathX[previous]!
    const tangentY = -(next - previous) * verticalStep
    const inverseLength = 1 / Math.max(0.0001, Math.hypot(tangentX, tangentY))
    const normalX = -tangentY * inverseLength * halfWidth
    const normalY = tangentX * inverseLength * halfWidth
    const x = resources.pathX[index]!
    const y = boltHeight * 0.5 - index * verticalStep
    resources.positions.setXYZ(index * 2, x + normalX, y + normalY, 0)
    resources.positions.setXYZ(index * 2 + 1, x - normalX, y - normalY, 0)
  }
  resources.positions.needsUpdate = true
}

function LightningFlash({
  active,
  audioOwner,
}: {
  active: boolean
  audioOwner: ThunderAudioOwner
}) {
  const getThree = useThree((state) => state.get)
  const scene = useThree((state) => state.scene)
  const signal = useMemo(() => getSceneWeatherSignal(scene), [scene])
  const resources = useMemo(createLightningResources, [])
  const timer = useRef<number | null>(null)
  const flashStarted = useRef(-1)
  const flashStrength = useRef(0)
  const random = useRef({ value: 0x4b7a70e9 })
  const direction = useRef(new Vector3())
  const right = useRef(new Vector3())

  useEffect(() => () => disposeLightningResources(resources), [resources])
  useEffect(() => {
    let cancelled = false
    signal.flash = 0
    const schedule = (first: boolean) => {
      const delaySeconds = first
        ? FIRST_FLASH_MIN_SECONDS + nextRandom(random.current) * FIRST_FLASH_SPAN_SECONDS
        : REPEAT_FLASH_MIN_SECONDS + nextRandom(random.current) * REPEAT_FLASH_SPAN_SECONDS
      timer.current = window.setTimeout(() => {
        if (cancelled) return
        const strength = 0.65 + nextRandom(random.current) * 0.35
        const state = getThree()
        placeLightningRibbon(
          resources,
          state.camera,
          state.size.width,
          state.size.height,
          random.current,
          direction.current,
          right.current,
        )
        resources.bolt.visible = true
        flashStarted.current = performance.now() / 1000
        flashStrength.current = strength
        signal.flash = strength
        if (
          useEnvironmentStore.getState().weatherSettings.thunderAudio &&
          isThunderAudioConsented()
        ) {
          playThunderAfter(audioOwner, 420 + nextRandom(random.current) * 980, strength)
        }
        if (state.frameloop === 'demand') state.invalidate()
        schedule(false)
      }, delaySeconds * 1000)
    }
    if (active) schedule(true)
    return () => {
      cancelled = true
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      flashStarted.current = -1
      flashStrength.current = 0
      signal.flash = 0
      resources.bolt.material.opacity = 0
      resources.bolt.visible = false
    }
  }, [active, audioOwner, getThree, resources, signal])

  useFrame((state) => {
    if (!active || flashStarted.current < 0) {
      signal.flash = 0
      return
    }
    const elapsed = performance.now() / 1000 - flashStarted.current
    const remaining = Math.max(0, 1 - elapsed / FLASH_SECONDS)
    const fade = remaining * remaining * (3 - 2 * remaining)
    const flash = Math.max(0, Math.min(1, flashStrength.current * fade))
    signal.flash = flash
    resources.bolt.material.opacity = 0.92 * flash
    if (remaining === 0) {
      flashStarted.current = -1
      resources.bolt.material.opacity = 0
      resources.bolt.visible = false
    } else if (state.frameloop === 'demand') {
      state.invalidate()
    }
  }, -3)

  return <primitive object={resources.bolt} dispose={null} />
}

function SnowField({ settings, active }: { settings: WeatherSettings; active: boolean }) {
  const resources = useMemo(
    () => createSnowFieldResources(useEnvironmentStore.getState().weatherSettings),
    [],
  )
  const getThree = useThree((state) => state.get)

  useEffect(() => () => disposeSnowFieldResources(resources), [resources])
  useEffect(() => {
    resources.uniforms.intensity.value = settings.snow
    resources.uniforms.wind.value = settings.wind
    resources.mesh.visible = active
    const state = getThree()
    if (state.frameloop === 'demand') state.invalidate()
  }, [active, getThree, resources, settings.snow, settings.wind])
  useFrame((state) => {
    if (active && state.frameloop === 'demand') state.invalidate()
  })

  return <primitive object={resources.mesh} dispose={null} />
}

export function WeatherLayer({ settings }: { settings: WeatherSettings }) {
  const reducedMotion = useReducedMotionPreference()
  const pageVisible = usePageVisible()
  const renderPaused = useViewer((state) => state.renderPaused)
  const active = pageVisible && !renderPaused && !reducedMotion
  const audioOwner = useMemo(createThunderAudioOwner, [])
  useEffect(() => acquireThunderAudioOwner(audioOwner), [audioOwner])

  useEffect(() => {
    setThunderAudioOwnerEnabled(audioOwner, active && settings.storm && settings.thunderAudio)
  }, [active, audioOwner, settings.storm, settings.thunderAudio])

  return (
    <group name="environment-weather" visible={active} userData={{ pascalExport: 'strip' }}>
      {settings.rain > 0 ? <RainField settings={settings} active={active} /> : null}
      {settings.snow > 0 ? <SnowField settings={settings} active={active} /> : null}
      {settings.storm ? <LightningFlash active={active} audioOwner={audioOwner} /> : null}
    </group>
  )
}
