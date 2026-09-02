'use client'

import {
  useScene,
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import type { Material, Object3D } from 'three'
import { buildSurfaceMaterialGeometry } from './geometry'
import type { SurfaceMaterialNode } from './schema'

export default function SurfaceMaterialStaticRenderer({
  nodes,
}: {
  nodes: SurfaceMaterialNode[]
}) {
  const sceneNodes = useScene((state) => state.nodes)
  return (
    <>
      {nodes.map((node) => (
        <SurfaceMaterialStaticNode key={node.id} node={node} sceneNodes={sceneNodes} />
      ))}
    </>
  )
}

function SurfaceMaterialStaticNode({
  node,
  sceneNodes,
}: {
  node: SurfaceMaterialNode
  sceneNodes: Readonly<Record<string, AnyNode>>
}) {
  const geometry = useMemo(
    () => buildSurfaceMaterialGeometry(node, createGeometryContext(node, sceneNodes)),
    [node, sceneNodes],
  )

  useEffect(() => () => disposeObjectResources(geometry), [geometry])

  return (
    <primitive
      object={geometry}
      position={node.position}
      rotation={node.rotation}
      visible={node.visible !== false}
    />
  )
}

function createGeometryContext(
  node: SurfaceMaterialNode,
  nodes: Readonly<Record<string, AnyNode>>,
): GeometryContext {
  const parent = node.parentId ? nodes[node.parentId] ?? null : null
  return {
    parent,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
  }
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
