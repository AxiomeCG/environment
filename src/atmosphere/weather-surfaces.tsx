'use client'

import { nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { BATCHED_LAYER, SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  FrontSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhysicalNodeMaterial,
  type Material,
  type Object3D,
  type UniformNode,
} from 'three/webgpu'
import * as TSL from 'three/tsl'

const DISCOVERY_INTERVAL_MILLISECONDS = 500
const NO_RAYCAST = () => undefined
const STRUCTURE_SURFACE_ROLES: Readonly<Record<string, true>> = {
  floor: true,
  roof: true,
  wall: true,
}
const SURROUNDINGS_SURFACE_ROOTS: Readonly<Record<string, true>> = {
  'environment-neighborhood-paving': true,
  'environment-river-bridges': true,
  'environment-streetscape-roads': true,
  'environment-third-ring': true,
  'surroundings-house-neighborhood': true,
}

type SurfaceMesh = Mesh & {
  geometry: Mesh['geometry']
  material: Material | Material[]
}

type SurfaceOverlay = Mesh | InstancedMesh

type WeatherSurfaceResources = {
  root: Group
  material: MeshPhysicalNodeMaterial
  rain: UniformNode<'float', number>
  snow: UniformNode<'float', number>
  overlays: Map<SurfaceMesh, SurfaceOverlay>
}

function createWeatherSurfaceMaterial(
  rain: UniformNode<'float', number>,
  snow: UniformNode<'float', number>,
): MeshPhysicalNodeMaterial {
  const upward = TSL.smoothstep(0.22, 0.68, TSL.normalWorldGeometry.y)
  const snowSurface = TSL.Fn(() => {
    const result = TSL.vec4(0.95, 0.98, 1, 0).toVar()
    TSL.If(snow.greaterThan(0.001), () => {
      const domain = TSL.vec2(
        TSL.positionWorld.x.mul(0.83).add(TSL.positionWorld.z.mul(0.56)),
        TSL.positionWorld.z.mul(0.83).sub(TSL.positionWorld.x.mul(0.56)),
      )
      const warp = TSL.vec2(
        TSL.mx_noise_float(domain.mul(0.022)),
        TSL.mx_noise_float(domain.mul(0.022).add(TSL.vec2(37.1, -53.7))),
      ).mul(6)
      const broadNoise = TSL.mx_noise_float(domain.add(warp).mul(0.063)).mul(0.5).add(0.5)
      const detail = TSL.mx_noise_float(
        domain.add(warp.mul(0.3)).mul(0.33).add(TSL.vec2(19.7, 43.1)),
      )
        .mul(0.5)
        .add(0.5)
      const breakup = broadNoise.mul(0.88).add(detail.mul(0.12))
      const edge = TSL.float(0.82).sub(snow.mul(0.78))
      const patch = TSL.smoothstep(edge.sub(0.12), edge.add(0.08), breakup)
      const tone = TSL.mix(TSL.vec3(0.9, 0.94, 0.97), TSL.vec3(0.98, 0.99, 1), detail)
      result.assign(TSL.vec4(tone, upward.mul(snow).mul(patch)))
    })
    return result
  })()
  const snowCoverage = snowSurface.a
  const snowDominance = TSL.smoothstep(0.015, 0.16, snowCoverage)
  const rainCoverage = upward.mul(rain).mul(snowDominance.oneMinus())
  const opacity = snowCoverage.mul(0.98).add(rainCoverage.mul(0.34)).clamp(0, 0.98)
  const snowTone = snowSurface.rgb

  const material = new MeshPhysicalNodeMaterial({
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: FrontSide,
    transparent: true,
  })
  material.name = 'environment-weather-surface-material'
  material.colorNode = TSL.mix(TSL.vec3(0.018, 0.027, 0.034), snowTone, snowDominance)
  material.opacityNode = opacity
  material.maskNode = opacity.greaterThan(0.003)
  material.metalnessNode = TSL.float(0)
  material.roughnessNode = TSL.mix(0.14, 0.94, snowDominance)
  material.clearcoatNode = rainCoverage
  material.clearcoatRoughnessNode = TSL.float(0.07)
  material.envMapIntensity = 1.35
  return material
}

function createWeatherSurfaceResources(): WeatherSurfaceResources {
  const rain = TSL.uniform(0)
  const snow = TSL.uniform(0)
  const root = new Group()
  root.name = 'environment-weather-surfaces'
  root.userData = {
    pascalExport: 'strip',
    effect: 'ground-and-structure weather overlays',
  }
  return {
    root,
    material: createWeatherSurfaceMaterial(rain, snow),
    rain,
    snow,
    overlays: new Map(),
  }
}

function isMaterialVisible(material: Material | Material[]): boolean {
  if (!Array.isArray(material)) return material.visible
  for (const entry of material) {
    if (entry.visible) return true
  }
  return false
}

function isDrawableSurface(object: Object3D, presentation = false): object is SurfaceMesh {
  if (!(object instanceof Mesh)) return false
  if (object.name === 'cutout') return false
  if (!object.layers.isEnabled(SCENE_LAYER) && !object.layers.isEnabled(BATCHED_LAYER)) {
    return false
  }
  if (
    (!presentation && object.userData.pascalExport === 'strip') ||
    object.userData.__weatherSurfaceOverlay
  ) {
    return false
  }
  const geometry = object.geometry
  return Boolean(
    geometry?.getAttribute('position') &&
      geometry.getAttribute('normal') &&
      isMaterialVisible(object.material as Material | Material[]),
  )
}

function collectMeshSubtree(
  object: Object3D,
  identityRoots: ReadonlySet<Object3D>,
  result: Set<SurfaceMesh>,
  stopAtIdentityRoots: boolean,
): void {
  if (stopAtIdentityRoots && identityRoots.has(object)) return
  if (isDrawableSurface(object, !stopAtIdentityRoots)) result.add(object)
  for (const child of object.children) {
    collectMeshSubtree(child, identityRoots, result, stopAtIdentityRoots)
  }
}

function collectSemanticSurfaces(result: Set<SurfaceMesh>): Set<Object3D> {
  const identityRoots = new Set<Object3D>()
  for (const object of sceneRegistry.nodes.values()) identityRoots.add(object)

  const nodes = useScene.getState().nodes
  for (const [id, object] of sceneRegistry.nodes) {
    const node = nodes[id]
    if (!node) continue
    const definition = nodeRegistry.get(node.type)
    const eligible =
      node.type === 'site' ||
      (definition?.category === 'structure' &&
        definition.surfaceRole !== undefined &&
        STRUCTURE_SURFACE_ROLES[definition.surfaceRole] === true)
    if (!eligible) continue
    if (isDrawableSurface(object)) result.add(object)
    for (const child of object.children) {
      collectMeshSubtree(child, identityRoots, result, true)
    }
  }
  return identityRoots
}

function collectPresentationSurfaces(
  scene: Object3D,
  identityRoots: ReadonlySet<Object3D>,
  result: Set<SurfaceMesh>,
): void {
  scene.traverse((object) => {
    if (
      object.name === 'environment-exterior-ground' ||
      object.name === 'grass-field-ground' ||
      object.name === 'wall-batch'
    ) {
      if (isDrawableSurface(object, true)) result.add(object)
      return
    }
    if (SURROUNDINGS_SURFACE_ROOTS[object.name] === true) {
      collectMeshSubtree(object, identityRoots, result, false)
    }
  })
}

function createSurfaceOverlay(
  source: SurfaceMesh,
  material: MeshPhysicalNodeMaterial,
): SurfaceOverlay {
  let overlay: SurfaceOverlay
  if (source instanceof InstancedMesh) {
    const instances = new InstancedMesh(source.geometry, material, 0)
    instances.instanceMatrix = source.instanceMatrix
    instances.count = source.count
    instances.boundingBox = source.boundingBox
    instances.boundingSphere = source.boundingSphere
    overlay = instances
  } else {
    overlay = new Mesh(source.geometry, material)
  }
  overlay.name = `environment-weather-surface-overlay:${source.name || 'unnamed-mesh'}`
  overlay.matrixAutoUpdate = false
  overlay.castShadow = false
  overlay.receiveShadow = true
  overlay.raycast = NO_RAYCAST
  overlay.renderOrder = source.renderOrder + 1
  overlay.userData = {
    pascalExport: 'strip',
    __weatherSurfaceOverlay: true,
    sourceName: source.name,
    sourceUuid: source.uuid,
  }
  return overlay
}

function removeOverlay(resources: WeatherSurfaceResources, source: SurfaceMesh): void {
  const overlay = resources.overlays.get(source)
  if (!overlay) return
  resources.root.remove(overlay)
  if (overlay instanceof InstancedMesh) overlay.dispose()
  resources.overlays.delete(source)
}

function refreshSurfaceOverlays(resources: WeatherSurfaceResources, scene: Object3D): void {
  const discovered = new Set<SurfaceMesh>()
  const identityRoots = collectSemanticSurfaces(discovered)
  collectPresentationSurfaces(scene, identityRoots, discovered)

  for (const source of resources.overlays.keys()) {
    if (!discovered.has(source)) removeOverlay(resources, source)
  }
  for (const source of discovered) {
    if (resources.overlays.has(source)) continue
    const overlay = createSurfaceOverlay(source, resources.material)
    resources.overlays.set(source, overlay)
    resources.root.add(overlay)
  }
}

function isAttachedAndVisible(source: Object3D, scene: Object3D): boolean {
  let current: Object3D | null = source
  while (current) {
    if (!current.visible) return false
    if (current === scene) return true
    current = current.parent
  }
  return false
}

function syncSurfaceOverlays(resources: WeatherSurfaceResources, scene: Object3D): void {
  for (const [source, overlay] of resources.overlays) {
    const geometry = source.geometry
    const visible = Boolean(
      geometry.getAttribute('position') &&
        geometry.getAttribute('normal') &&
        isAttachedAndVisible(source, scene) &&
        isMaterialVisible(source.material),
    )
    overlay.visible = visible
    if (!visible) continue

    source.updateWorldMatrix(true, false)
    overlay.matrix.copy(source.matrixWorld)
    overlay.layers.mask = source.layers.mask
    overlay.renderOrder = source.renderOrder + 1
    overlay.geometry = geometry
    overlay.frustumCulled = source.frustumCulled

    if (source instanceof InstancedMesh && overlay instanceof InstancedMesh) {
      overlay.instanceMatrix = source.instanceMatrix
      overlay.count = source.count
      overlay.boundingBox = source.boundingBox
      overlay.boundingSphere = source.boundingSphere
    }
  }
}

function clearSurfaceOverlays(resources: WeatherSurfaceResources): void {
  for (const source of resources.overlays.keys()) removeOverlay(resources, source)
}

function disposeWeatherSurfaceResources(resources: WeatherSurfaceResources): void {
  clearSurfaceOverlays(resources)
  resources.material.dispose()
  resources.root.clear()
}

export function WeatherSurfaces({ rain, snow }: { rain: number; snow: number }) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const geometryRevision = useViewer((state) => state.geometryRevision)
  const resources = useMemo(createWeatherSurfaceResources, [])
  const active = rain > 0 || snow > 0

  useLayoutEffect(() => {
    resources.rain.value = rain
    resources.snow.value = snow
    resources.root.visible = active
    invalidate()
  }, [active, invalidate, rain, resources, snow])

  useLayoutEffect(() => {
    if (active) {
      refreshSurfaceOverlays(resources, scene)
      syncSurfaceOverlays(resources, scene)
    } else {
      clearSurfaceOverlays(resources)
    }
    invalidate()
  }, [active, geometryRevision, invalidate, resources, scene])

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => {
      refreshSurfaceOverlays(resources, scene)
      syncSurfaceOverlays(resources, scene)
      invalidate()
    }, DISCOVERY_INTERVAL_MILLISECONDS)
    return () => window.clearInterval(interval)
  }, [active, invalidate, resources, scene])

  useEffect(() => () => disposeWeatherSurfaceResources(resources), [resources])

  useFrame(() => {
    if (active) syncSurfaceOverlays(resources, scene)
  }, 3)

  return <primitive object={resources.root} dispose={null} />
}
