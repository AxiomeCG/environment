'use client'

import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attribute, cameraViewMatrix, frontFacing, select, texture, uv, vec2, vec3 } from 'three/tsl'
import { DISTANT_TREE_TILE_SIZE, DISTANT_TREE_VARIANTS, DISTANT_TREE_VIEWS, getDistantTreeAtlas } from './distant-tree-atlas'
import type { HorizonFoliagePlan } from './horizon-foliage'
import { PresentationMaterial } from './presentation-material'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'
import { seededRange } from './seeded-random'

const materials = new Map<boolean, PresentationMaterial>()
const first = new PlaneGeometry(0.85, 1).translate(0, 0.5, 0)
first.setAttribute('cardView', new Float32BufferAttribute(new Float32Array(first.getAttribute('position').count), 1))
const second = first.clone().rotateY(Math.PI / 2)
second.setAttribute('cardView', new Float32BufferAttribute(new Float32Array(second.getAttribute('position').count).fill(1), 1))
const geometry = mergeGeometries([first, second], false)!
first.dispose(); second.dispose()
const UP = new Vector3(0, 1, 0)
const NO_RAYCAST = () => undefined

function canopyMaterial(pine: boolean): PresentationMaterial {
  const cached = materials.get(pine)
  if (cached) return cached

  // Opaque alpha-tested crossed cards: four triangles per tree, no sorted
  // transparency, capture render targets, animation, or per-frame billboarding.
  const atlas = getDistantTreeAtlas(pine)
  const treeParams = attribute<'vec4'>('treeParams', 'vec4')
  const cardView = attribute<'float'>('cardView', 'float')
  const cardUv = uv()
  const atlasView = select(frontFacing, cardView, cardView.add(2))
  const mirroredU = select(frontFacing, cardUv.x, cardUv.x.oneMinus())
  const atlasUv = vec2(
    treeParams.z.div(DISTANT_TREE_VARIANTS),
    atlasView.div(DISTANT_TREE_VIEWS),
  ).add(
    vec2(mirroredU, cardUv.y).mul(vec2(
      (DISTANT_TREE_TILE_SIZE - 1) / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VARIANTS),
      (DISTANT_TREE_TILE_SIZE - 1) / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VIEWS),
    )),
  ).add(vec2(
    0.5 / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VARIANTS),
    0.5 / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VIEWS),
  ))
  const colorSample = texture(atlas.color, atlasUv)
  const sampledNormal = texture(atlas.normal, atlasUv).rgb.mul(2).sub(1)
  const widthCorrectedNormal = vec3(
    sampledNormal.x.div(treeParams.w),
    sampledNormal.y,
    sampledNormal.z.div(treeParams.w),
  )
  const worldNormal = vec3(
    widthCorrectedNormal.x.mul(treeParams.x).add(widthCorrectedNormal.z.mul(treeParams.y)),
    widthCorrectedNormal.y,
    widthCorrectedNormal.z.mul(treeParams.x).sub(widthCorrectedNormal.x.mul(treeParams.y)),
  ).normalize()

  const material = new PresentationMaterial({ side: DoubleSide, roughness: 1 })
  material.colorNode = colorSample.rgb
  material.maskNode = colorSample.a.greaterThan(0.4)
  material.normalNode = worldNormal.transformDirection(cameraViewMatrix)
  materials.set(pine, material)
  return material
}

export function buildDistantTreeInstances(
  plans: readonly HorizonFoliagePlan[],
  root = new Group(),
): Group {
  root.name = 'environment-distant-forest-impostors'
  const previous = new Map(
    root.children
      .filter((child): child is InstancedMesh => child instanceof InstancedMesh)
      .map((child) => [child.name, child]),
  )
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), color = new Color()
  for (const pine of [false, true]) {
    const placements = plans.filter((plan) => (plan.species === 'pine') === pine)
    if (!placements.length) continue
    const meshName = `environment-distant-forest-${pine ? 'pine' : 'deciduous'}`
    let mesh = previous.get(meshName)
    previous.delete(meshName)
    if (!mesh || mesh.instanceMatrix.count < placements.length) {
      if (mesh) {
        root.remove(mesh)
        mesh.dispose()
      }
      const capacity = 2 ** Math.ceil(Math.log2(placements.length))
      mesh = createContextInstances(geometry, canopyMaterial(pine), capacity)
      mesh.geometry.setAttribute('treeParams', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4))
      mesh.name = meshName
      mesh.raycast = NO_RAYCAST
      root.add(mesh)
    }
    mesh.count = placements.length
    const treeParams = mesh.geometry.getAttribute('treeParams') as InstancedBufferAttribute
    for (let i = 0; i < placements.length; i += 1) {
      const plan = placements[i]!
      const variationDomain = `${plan.position[0]}:${plan.position[2]}`
      const variant = Math.floor(seededRange(plan.id, `${variationDomain}:atlas-variant`, 0, DISTANT_TREE_VARIANTS))
      const widthScale = seededRange(plan.id, `${variationDomain}:width-scale`, 0.86, 1.14)
      mesh.setMatrixAt(i, matrix.compose(
        position.fromArray(plan.position),
        rotation.setFromAxisAngle(UP, plan.rotationY),
        scale.set(plan.height * widthScale, plan.height, plan.height * widthScale),
      ))
      mesh.setColorAt(i, color.set(plan.leafColor))
      treeParams.setXYZW(i, Math.cos(plan.rotationY), Math.sin(plan.rotationY), variant, widthScale)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    treeParams.needsUpdate = true
    mesh.computeBoundingSphere()
  }
  for (const mesh of previous.values()) {
    root.remove(mesh)
    mesh.dispose()
  }
  root.userData = { treeCount: plans.length, drawCallCount: root.children.length, visibleTriangleCount: plans.length * 4 }
  return root
}

export function DistantTrees({ plans }: { plans: readonly HorizonFoliagePlan[] }) {
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    buildDistantTreeInstances(plans, root)
    invalidate()
  }, [root, plans, invalidate])
  useEffect(() => () => { disposePrimitiveInstances(root) }, [root])
  return <primitive object={root} dispose={null} />
}
