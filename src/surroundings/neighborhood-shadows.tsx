'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Group, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { abs, array, attribute, cameraPosition, clamp, max, min, positionGeometry, positionLocal, positionWorld, select, sin, smoothstep, vec2, vec3, vertexIndex } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { createSolarState, updateSolarState } from '../atmosphere/solar'
import { useEnvironmentStore } from '../store'
import { houseBodyFrame, houseGarageOffset, type HousePlan } from './neighborhood'
import type { TreePlan } from './neighborhood-decoration'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'

const geometry = new PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2)
const UP = new Vector3(0, 1, 0)
const NO_RAYCAST = () => undefined
const GROUND_OFFSET = 0.035
const MAX_SHADOW_LENGTH = 24
let sharedMaterial: MeshBasicNodeMaterial | undefined

type ShadowLighting = Readonly<{ direction: readonly [number, number, number]; strength: number }>
type NeighborhoodShadowProps = Readonly<{
  houses: readonly HousePlan[]
  trees: readonly TreePlan[]
  heightAt: (x: number, z: number) => number
}>

function shadowMaterial(): MeshBasicNodeMaterial {
  if (sharedMaterial) return sharedMaterial
  const footprint = attribute<'vec4'>('shadowFootprint', 'vec4')
  const style = attribute<'vec4'>('shadowStyle', 'vec4')
  const halfSize = footprint.xy
  const offset = footprint.zw
  const extent = halfSize.add(abs(offset).mul(0.5)).add(style.z.mul(2))
  const point = positionGeometry.xz.mul(extent.mul(2)).add(offset.mul(0.5))
  const centered = abs(point.sub(offset.mul(0.5))).sub(halfSize.add(abs(offset).mul(0.5)))
  const perpendicular = select<'vec2'>(offset.length().greaterThan(0.001), vec2(offset.y.negate(), offset.x).div(max(offset.length(), 0.001)), vec2(1, 0))
  // Support planes of a rectangle swept along the sun vector form the exact
  // six-sided silhouette of a cheap building mass, including its ground contact.
  const boxDistance = max(max(centered.x, centered.y), abs(point.dot(perpendicular)).sub(halfSize.dot(abs(perpendicular))))
  const ellipsePoint = point.div(halfSize)
  const ellipseOffset = offset.div(halfSize)
  const along = clamp(ellipsePoint.dot(ellipseOffset).div(max(ellipseOffset.dot(ellipseOffset), 0.0001)), 0, 1)
  const treeDistance = ellipsePoint.sub(ellipseOffset.mul(along)).length().sub(1).mul(min(halfSize.x, halfSize.y))
  const distance = select(style.x.greaterThan(0.5), treeDistance, boxDistance)
  const feather = smoothstep(style.z.negate(), style.z, distance).oneMinus()
  const canopyBreakup = sin(point.x.mul(2.1).add(style.w)).mul(sin(point.y.mul(1.7).sub(style.w))).mul(0.1).add(0.9)
  const fade = smoothstep(180, 420, positionWorld.sub(cameraPosition).length()).oneMinus()
  const opacity = feather.mul(style.y).mul(select(style.x.greaterThan(0.5), canopyBreakup, 1)).mul(fade)
  const heights0 = attribute<'vec3'>('shadowHeights0', 'vec3')
  const heights1 = attribute<'vec3'>('shadowHeights1', 'vec3')
  const heights2 = attribute<'vec3'>('shadowHeights2', 'vec3')
  const ground = array([heights0.x, heights0.y, heights0.z, heights1.x, heights1.y, heights1.z, heights2.x, heights2.y, heights2.z])
  const material = new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  material.name = 'surroundings-soft-ground-shadows'
  // Black source-over blending is order independent between instances and only
  // darkens the existing ground. No shadow maps, texture captures, or blur pass.
  material.colorNode = vec3(0)
  material.opacityNode = opacity
  material.maskNode = opacity.greaterThan(0.003)
  // positionLocal already includes the instance transform; preserve it when draping.
  material.positionNode = positionLocal.add(vec3(0, ground.element(vertexIndex) as Node<'float'>, 0))
  sharedMaterial = material
  return material
}

export function buildNeighborhoodShadowInstances(
  { houses, trees, heightAt }: NeighborhoodShadowProps,
  lighting: ShadowLighting,
  root = new Group(),
): Group {
  root.name = 'environment-neighborhood-ground-shadows'
  const count = houses.reduce((total, house) => total + 1 + Number(Boolean(house.garage)), trees.length)
  let mesh = root.children[0] as InstancedMesh | undefined
  if (!count) {
    disposePrimitiveInstances(root)
    root.userData = { shadowCount: 0, drawCallCount: 0, visibleTriangleCount: 0 }
    return root
  }
  if (!mesh || mesh.instanceMatrix.count < count) {
    disposePrimitiveInstances(root)
    const capacity = 2 ** Math.ceil(Math.log2(count))
    mesh = createContextInstances(geometry, shadowMaterial(), capacity)
    mesh.name = 'environment-neighborhood-shadow-instances'
    mesh.raycast = NO_RAYCAST
    for (const [name, size] of [['shadowFootprint', 4], ['shadowStyle', 4], ['shadowHeights0', 3], ['shadowHeights1', 3], ['shadowHeights2', 3]] as const) {
      mesh.geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(capacity * size), size))
    }
    root.add(mesh)
  }
  const footprint = mesh.geometry.getAttribute('shadowFootprint') as InstancedBufferAttribute
  const style = mesh.geometry.getAttribute('shadowStyle') as InstancedBufferAttribute
  const heights = [0, 1, 2].map((row) => mesh!.geometry.getAttribute(`shadowHeights${row}`) as InstancedBufferAttribute)
  const vertices = geometry.getAttribute('position')
  const samples = new Float32Array(vertices.count)
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  const strength = Math.max(0, Math.min(1, lighting.strength))
  const denominator = Math.max(0.25, lighting.direction[1])
  const sunX = strength > 0 ? -lighting.direction[0] / denominator : 0
  const sunZ = strength > 0 ? -lighting.direction[2] / denominator : 0
  let index = 0, verticalMargin = 0
  const add = (x: number, z: number, yaw: number, halfWidth: number, halfDepth: number, castHeight: number, tree: boolean, seed: number) => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw)
    const lengthScale = Math.min(1, MAX_SHADOW_LENGTH / Math.max(0.001, Math.hypot(sunX, sunZ) * castHeight))
    const worldDx = sunX * castHeight * lengthScale, worldDz = sunZ * castHeight * lengthScale
    const dx = worldDx * cos - worldDz * sin, dz = worldDx * sin + worldDz * cos
    const softness = tree ? Math.max(0.45, Math.min(1.3, halfWidth * 0.28)) : 0.65
    const width = (halfWidth + Math.abs(dx) / 2 + softness * 2) * 2
    const depth = (halfDepth + Math.abs(dz) / 2 + softness * 2) * 2
    const centerX = x + worldDx / 2, centerZ = z + worldDz / 2
    const baseY = heightAt(centerX, centerZ)
    for (let vertex = 0; vertex < vertices.count; vertex += 1) {
      const localX = vertices.getX(vertex) * width, localZ = vertices.getZ(vertex) * depth
      const ground = heightAt(centerX + localX * cos + localZ * sin, centerZ - localX * sin + localZ * cos)
      samples[vertex] = ground - baseY + GROUND_OFFSET
      verticalMargin = Math.max(verticalMargin, Math.abs(samples[vertex]!))
    }
    mesh!.setMatrixAt(index, matrix.compose(position.set(centerX, baseY, centerZ), rotation.setFromAxisAngle(UP, yaw), scale.set(width, 1, depth)))
    footprint.setXYZW(index, halfWidth, halfDepth, dx, dz)
    style.setXYZW(index, Number(tree), tree ? 0.055 + strength * 0.19 : 0.1 + strength * 0.25, softness, seed)
    for (let row = 0; row < 3; row += 1) heights[row]!.setXYZ(index, samples[row * 3]!, samples[row * 3 + 1]!, samples[row * 3 + 2]!)
    index += 1
  }
  for (const house of houses) {
    const body = houseBodyFrame(house)
    const yaw = Math.atan2(house.front[0], house.front[1])
    const roofHeight = Math.tan(house.roof.pitchDegrees * Math.PI / 180) * body.width / 2
    add(house.center[0] + house.right[0] * body.offset, house.center[1] + house.right[1] * body.offset,
      yaw, body.width / 2 + house.roof.overhang, house.depth / 2 + house.roof.overhang,
      house.wallHeight + roofHeight * 0.65, false, 0)
    const garageOffset = houseGarageOffset(house)
    if (house.garage && garageOffset) {
      add(house.center[0] + house.right[0] * garageOffset[0] + house.front[0] * garageOffset[1],
        house.center[1] + house.right[1] * garageOffset[0] + house.front[1] * garageOffset[1], yaw,
        house.garage.width / 2 + 0.2, house.garage.depth / 2 + 0.2, house.garage.wallHeight + 0.5, false, 0)
    }
  }
  for (const tree of trees) {
    const ratio = tree.species === 'pine' || tree.species === 'aspen' ? 0.18 : 0.25
    const aspect = 0.88 + (Math.abs(tree.seed * 37) % 17) / 16 * 0.24
    const radius = Math.max(0.55, tree.height * ratio)
    add(tree.position[0], tree.position[1], tree.rotationY, radius * aspect, radius, tree.height * 0.6, true, tree.seed % 1024)
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  footprint.needsUpdate = style.needsUpdate = true
  for (const row of heights) row.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.boundingSphere!.radius += verticalMargin
  root.userData = { shadowCount: count, drawCallCount: 1, visibleTriangleCount: count * geometry.index!.count / 3 }
  return root
}

export function NeighborhoodShadows(props: NeighborhoodShadowProps) {
  const settings = useEnvironmentStore((state) => state.skySettings)
  const skyEnabled = useEnvironmentStore((state) => state.skyEnabled)
  const lighting = useMemo<ShadowLighting>(() => {
    const solar = createSolarState()
    updateSolarState(settings, solar)
    return {
      direction: [solar.sunDirection.x, solar.sunDirection.y, solar.sunDirection.z],
      strength: skyEnabled ? solar.sunVisibility * (1 - settings.cloudCoverage * 0.7) : 0,
    }
  }, [settings, skyEnabled])
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    buildNeighborhoodShadowInstances(props, lighting, root)
    invalidate()
  }, [props.houses, props.trees, props.heightAt, lighting, root, invalidate])
  useEffect(() => () => { disposePrimitiveInstances(root) }, [root])
  return <primitive object={root} dispose={null} />
}
