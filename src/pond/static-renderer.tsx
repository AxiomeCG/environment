'use client'

import {
  useScene,
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { InstancedMesh, type Material, type Object3D } from 'three'
import { buildPondGeometry } from './geometry'
import { disposePondKoiMotion, updatePondKoiMotion } from './koi-motion'
import { POND_KIND, type PondNode } from './schema'

export default function PondStaticRenderer({ nodes }: { nodes: PondNode[] }) {
  const sceneNodes = useScene((state) => state.nodes)
  const renderPaused = useViewer((state) => state.renderPaused)
  return (
    <>
      {nodes.map((node) => (
        <PondStaticNode
          key={node.id}
          node={node}
          sceneNodes={sceneNodes}
          renderPaused={renderPaused}
        />
      ))}
    </>
  )
}

function PondStaticNode({
  node,
  sceneNodes,
  renderPaused,
}: {
  node: PondNode
  sceneNodes: Readonly<Record<string, AnyNode>>
  renderPaused: boolean
}) {
  const elapsed = useRef(0)
  const getThree = useThree((state) => state.get)
  const geometry = useMemo(
    () => buildPondGeometry(node, createGeometryContext(node, sceneNodes)),
    [node, sceneNodes],
  )
  useEffect(() => {
    elapsed.current = 0
    return () => {
      disposePondKoiMotion(geometry)
      disposeObjectResources(geometry)
    }
  }, [geometry])
  useEffect(() => {
    if (!renderPaused && node.visible !== false) {
      const state = getThree()
      if (state.frameloop === 'demand') state.invalidate()
    }
  }, [getThree, node.visible, renderPaused])
  useFrame((state, delta) => {
    if (renderPaused || node.visible === false) return
    elapsed.current += Math.min(delta, 0.1)
    if (
      updatePondKoiMotion(geometry, elapsed.current)
      && state.frameloop === 'demand'
    ) {
      state.invalidate()
    }
  })
  return <primitive object={geometry} visible={node.visible !== false} dispose={null} />
}

function createGeometryContext(
  node: PondNode,
  nodes: Readonly<Record<string, AnyNode>>,
): GeometryContext {
  const parent = node.parentId ? nodes[node.parentId] ?? null : null
  const siblings = Object.values(nodes).filter(
    (candidate) =>
      String(candidate.id) !== node.id
      && candidate.parentId === node.parentId
      && (candidate.type as string) === POND_KIND,
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
