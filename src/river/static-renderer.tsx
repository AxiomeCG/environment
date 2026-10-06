'use client'

import {
  getEffectiveNode,
  useLiveNodeOverrides,
  useLiveTerrain,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { InstancedMesh, type Material, type Object3D } from 'three'
import { replaceGeometryContext, type ReplaceResolve, useReplaceResolve } from '../bake-replace-context'
import { buildRiverGeometry } from './geometry'
import { RIVER_KIND, type RiverNode } from './schema'

export default function RiverStaticRenderer({
  nodes,
  resolve,
}: {
  nodes: RiverNode[]
  resolve?: ReplaceResolve
}) {
  const lookup = useReplaceResolve(resolve)
  return (
    <>
      {nodes.map((node) => (
        <RiverStaticNode key={node.id} node={node} resolve={lookup} />
      ))}
    </>
  )
}

function RiverStaticNode({
  node,
  resolve,
}: {
  node: RiverNode
  resolve: ReplaceResolve
}) {
  const override = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const liveTerrain = useLiveTerrain((state) => node.parentId ? state.fieldOf(node.parentId) : null)
  const geometry = useMemo(
    () => buildRiverGeometry(getEffectiveNode(node), replaceGeometryContext(node, resolve, RIVER_KIND)),
    [node, resolve, override, liveTerrain],
  )
  useEffect(() => () => disposeObjectResources(geometry), [geometry])
  return <primitive object={geometry} visible={node.visible !== false} dispose={null} />
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
