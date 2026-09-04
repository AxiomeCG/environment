'use client'

import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Group, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three'
import type { BoulderPlan } from './third-ring'
import { applyRoadSurfaceDetail, PresentationMaterial } from './presentation-material'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'

// Four normalized, closed, faceted prototypes; scale and yaw vary per instance.
const geometries = Array.from({ length: 4 }, (_, variant) => {
  const geometry = new IcosahedronGeometry(0.5, 1)
  const positions = geometry.attributes.position!
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index)
    const bulge = 1 + Math.sin(x * 8 + z * 5 + variant * 2.1) * 0.2 + Math.cos(y * 11 - x * 4 + variant) * 0.12
    positions.setXYZ(index, x * bulge + y * 0.12, y * bulge, z * bulge)
  }
  geometry.computeBoundingBox()
  const size = geometry.boundingBox!.getSize(new Vector3())
  geometry.center().scale(1 / size.x, 1 / size.y, 1 / size.z)
  geometry.computeVertexNormals()
  return geometry
})
const material = new PresentationMaterial({ roughness: 1, flatShading: true })
applyRoadSurfaceDetail(material)
const UP = new Vector3(0, 1, 0)
const NO_RAYCAST = () => undefined

export function buildBoulderInstances(plans: readonly BoulderPlan[]): Group {
  const root = new Group()
  root.name = 'environment-boulders'
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), color = new Color()
  let triangles = 0
  for (let variant = 0; variant < geometries.length; variant += 1) {
    const placements = plans.filter((plan) => plan.variant === variant)
    if (!placements.length) continue
    const geometry = geometries[variant]!
    const mesh = createContextInstances(geometry, material, placements.length)
    mesh.raycast = NO_RAYCAST
    for (let index = 0; index < placements.length; index += 1) {
      const plan = placements[index]!
      mesh.setMatrixAt(index, matrix.compose(position.fromArray(plan.position), rotation.setFromAxisAngle(UP, plan.rotationY), scale.fromArray(plan.dimensions)))
      mesh.setColorAt(index, color.set(plan.color).multiplyScalar(0.88 + (index % 5) * 0.045))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    mesh.computeBoundingSphere()
    root.add(mesh)
    triangles += geometry.attributes.position!.count / 3 * placements.length
  }
  root.userData = { boulderCount: plans.length, drawCallCount: root.children.length, visibleTriangleCount: triangles }
  return root
}

export function Boulders({ plans }: { plans: readonly BoulderPlan[] }) {
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    const next = buildBoulderInstances(plans)
    disposePrimitiveInstances(root)
    root.name = next.name
    if (next.children.length) root.add(...[...next.children])
    root.userData = next.userData
    invalidate()
  }, [root, plans, invalidate])
  useEffect(() => () => disposePrimitiveInstances(root), [root])
  return <primitive object={root} dispose={null} />
}
