'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Material, Object3D } from 'three'
import { replaceGeometryContext, type ReplaceResolve, useReplaceResolve } from '../bake-replace-context'
import { buildGrassFieldGeometry } from './geometry'
import type { GrassFieldNode } from './schema'
import { updateGrassTileLod } from './render/grass-tiles'

export default function GroundCoverStaticRenderer({
  nodes,
  resolve,
}: {
  nodes: GrassFieldNode[]
  resolve?: ReplaceResolve
}) {
  const lookup = useReplaceResolve(resolve)
  return (
    <>
      {nodes.map((node) => (
        <GroundCoverStaticNode key={node.id} node={node} resolve={lookup} />
      ))}
    </>
  )
}

function GroundCoverStaticNode({
  node,
  resolve,
}: {
  node: GrassFieldNode
  resolve: ReplaceResolve
}) {
  const geometry = useMemo(
    () => buildGrassFieldGeometry(node, replaceGeometryContext(node, resolve)),
    [node, resolve],
  )

  useEffect(() => () => disposeObjectResources(geometry), [geometry])
  useFrame(({ camera, size, gl }) => {
    updateGrassTileLod(geometry, camera, size.height * gl.getPixelRatio())
  })

  return (
    <primitive
      object={geometry}
      position={node.position}
      rotation={node.rotation}
      visible={node.visible !== false}
    />
  )
}



function disposeObjectResources(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void }
      material?: Material | Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : []
    for (const material of objectMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}
