'use client'

import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, DataTexture, DoubleSide, Group, InstancedBufferAttribute, LinearFilter, Matrix4, Quaternion, RGFormat, Vector3 } from 'three'
import { attribute, clamp, float as tslFloat, materialColor, mix, positionGeometry, positionLocal } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { buildBladeGeometry } from '../ground-cover/render/blade-geometry'
import { mulberry32 } from '../variant-utils'
import { grassWindPosition } from '../wind-node'
import { PresentationMaterial } from './presentation-material'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'
import { THIRD_RING_BUDGET, type FieldPatch } from './third-ring'

const bladeGeometry = buildBladeGeometry({ width: 1, height: 1 })
// Distant fields need crossed silhouettes, not the near-field blade's bend rows.
bladeGeometry.setIndex([0, 1, 6, 7, 8, 13])
const bladeMaterial = new PresentationMaterial({ side: DoubleSide, roughness: 1 })
const tip = clamp(positionGeometry.y, 0, 1)
bladeMaterial.positionNode = grassWindPosition(positionLocal, positionLocal.y.sub(attribute('fieldRootY', 'float')), tip.mul(tip), tslFloat(0.7))
bladeMaterial.colorNode = (materialColor as unknown as Node<'vec3'>).mul(mix(0.72, 1.18, tip))
const UP = new Vector3(0, 1, 0)
const NO_RAYCAST = () => undefined

function fieldCoverage(x: number, z: number, patch: FieldPatch, cosine: number, sine: number): number {
  const dx = x - patch.center[0], dz = z - patch.center[1]
  const u = (dx * cosine - dz * sine) * 2 / patch.width
  const v = (dx * sine + dz * cosine) * 2 / patch.depth
  if (patch.kind === 'wheat') return Math.max(0, Math.min(1, (1 - Math.max(Math.abs(u), Math.abs(v))) * 8))
  return Math.max(0, Math.min(1, (1 - u * u - v * v) * 4))
}

/** A tiny coverage map tints the existing terrain instead of overlapping ground planes. */
export function buildFieldCoverageTexture(plans: readonly FieldPatch[]) {
  const resolution = plans.length ? 256 : 1
  let minX = 0, minZ = 0, maxX = 1, maxZ = 1
  if (plans.length) {
    minX = minZ = Infinity; maxX = maxZ = -Infinity
    for (const patch of plans) {
      const radius = Math.hypot(patch.width, patch.depth) / 2 + 8
      minX = Math.min(minX, patch.center[0] - radius); maxX = Math.max(maxX, patch.center[0] + radius)
      minZ = Math.min(minZ, patch.center[1] - radius); maxZ = Math.max(maxZ, patch.center[1] + radius)
    }
  }
  const width = maxX - minX, depth = maxZ - minZ
  const data = new Uint8Array(resolution * resolution * 2)
  for (const patch of plans) {
    const cosine = Math.cos(patch.rotationY), sine = Math.sin(patch.rotationY)
    const radius = Math.hypot(patch.width, patch.depth) / 2
    const firstX = Math.max(0, Math.floor((patch.center[0] - radius - minX) / width * resolution))
    const lastX = Math.min(resolution - 1, Math.ceil((patch.center[0] + radius - minX) / width * resolution))
    const firstZ = Math.max(0, Math.floor((patch.center[1] - radius - minZ) / depth * resolution))
    const lastZ = Math.min(resolution - 1, Math.ceil((patch.center[1] + radius - minZ) / depth * resolution))
    for (let row = firstZ; row <= lastZ; row += 1) for (let column = firstX; column <= lastX; column += 1) {
      const coverage = fieldCoverage(minX + (column + 0.5) / resolution * width, minZ + (row + 0.5) / resolution * depth, patch, cosine, sine)
      const offset = (row * resolution + column) * 2 + (patch.kind === 'wheat' ? 0 : 1)
      data[offset] = Math.max(data[offset]!, Math.round(coverage * 255))
    }
  }
  const texture = new DataTexture(data, resolution, resolution, RGFormat)
  texture.magFilter = texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, origin: [minX, minZ] as const, width, depth }
}

export function buildFieldVegetationInstances(plans: readonly FieldPatch[], heightAt: (x: number, z: number) => number): Group {
  const root = new Group()
  root.name = 'environment-field-vegetation'
  const capacity = Math.min(THIRD_RING_BUDGET.fieldBlades, plans.length * 1024)
  if (!capacity) { root.userData = { drawCallCount: 0, bladeCount: 0, visibleTriangleCount: 0 }; return root }
  const mesh = createContextInstances(bladeGeometry, bladeMaterial, capacity)
  const rootY = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  mesh.geometry.setAttribute('fieldRootY', rootY)
  mesh.raycast = NO_RAYCAST
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), color = new Color()
  let count = 0
  for (const patch of plans) {
    const random = mulberry32(patch.seed)
    const cosine = Math.cos(patch.rotationY), sine = Math.sin(patch.rotationY)
    const baseColor = new Color(patch.kind === 'wheat' ? '#bba152' : '#6e864a')
    for (let row = 0; row < 32 && count < capacity; row += 1) for (let column = 0; column < 32 && count < capacity; column += 1) {
      const jitter = patch.kind === 'wheat' ? 0.22 : 0.9
      const u = ((column + 0.5 + (random() - 0.5) * jitter) / 32 - 0.5) * patch.width
      const v = ((row + 0.5 + (random() - 0.5) * jitter) / 32 - 0.5) * patch.depth
      const x = patch.center[0] + cosine * u + sine * v, z = patch.center[1] - sine * u + cosine * v
      if (random() > fieldCoverage(x, z, patch, cosine, sine)) continue
      const y = heightAt(x, z)
      if (!Number.isFinite(y) || y < 0) continue
      const height = patch.kind === 'wheat' ? 1.15 + random() * 0.55 : 0.7 + random() * 0.65
      const width = patch.kind === 'wheat' ? 0.25 + random() * 0.16 : 0.45 + random() * 0.3
      mesh.setMatrixAt(count, matrix.compose(position.set(x, y, z), rotation.setFromAxisAngle(UP, random() * Math.PI * 2), scale.set(width, height, width)))
      mesh.setColorAt(count, color.copy(baseColor).multiplyScalar(0.88 + random() * 0.22))
      rootY.setX(count, y)
      count += 1
    }
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  rootY.needsUpdate = true
  mesh.computeBoundingBox(); mesh.computeBoundingSphere()
  mesh.boundingBox?.expandByScalar(1)
  if (mesh.boundingSphere) mesh.boundingSphere.radius += 1
  if (count) root.add(mesh); else mesh.dispose()
  root.userData = { drawCallCount: count ? 1 : 0, bladeCount: count, visibleTriangleCount: count * bladeGeometry.index!.count / 3, ownedInstanceBytes: capacity * 80 }
  return root
}

export function FieldVegetation({ plans, heightAt }: { plans: readonly FieldPatch[]; heightAt: (x: number, z: number) => number }) {
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    const next = buildFieldVegetationInstances(plans, heightAt)
    disposePrimitiveInstances(root)
    root.name = next.name
    if (next.children.length) root.add(...[...next.children])
    root.userData = next.userData
    invalidate()
  }, [root, plans, heightAt, invalidate])
  useEffect(() => () => disposePrimitiveInstances(root), [root])
  return <primitive object={root} dispose={null} />
}
