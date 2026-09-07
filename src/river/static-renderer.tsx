'use client'

import {
  getEffectiveNode,
  useLiveNodeOverrides,
  useLiveTerrain,
  useScene,
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { InstancedMesh, type Material, type Object3D } from 'three'
import { buildRiverGeometry } from './geometry'
import { RIVER_KIND, type RiverNode } from './schema'

export default function RiverStaticRenderer({ nodes }: { nodes: RiverNode[] }) {
  const sceneNodes = useScene((state) => state.nodes)
  return (
    <>
      {nodes.map((node) => (
        <RiverStaticNode key={node.id} node={node} sceneNodes={sceneNodes} />
      ))}
    </>
  )
}

function RiverStaticNode({
  node,
  sceneNodes,
}: {
  node: RiverNode
  sceneNodes: Readonly<Record<string, AnyNode>>
}) {
  const override = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const liveTerrain = useLiveTerrain((state) => node.parentId ? state.fieldOf(node.parentId) : null)
  const geometry = useMemo(
    () => buildRiverGeometry(getEffectiveNode(node), createGeometryContext(node, sceneNodes)),
    [node, sceneNodes, override, liveTerrain],
  )
  useEffect(() => () => disposeObjectResources(geometry), [geometry])
  return <primitive object={geometry} visible={node.visible !== false} dispose={null} />
}

function createGeometryContext(
  node: RiverNode,
  nodes: Readonly<Record<string, AnyNode>>,
): GeometryContext {
  const parent = node.parentId ? nodes[node.parentId] ?? null : null
  const siblings = Object.values(nodes).filter(
    (candidate) => (
      String(candidate.id) !== node.id
      && candidate.parentId === node.parentId
      && (candidate.type as string) === RIVER_KIND
    ),
  )
  return {
    parent,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings,
  }
}

function disposeObjectResources(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose()
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
