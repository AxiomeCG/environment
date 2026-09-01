'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { updateGrassFieldUniforms } from './geometry'
import type { GrassFieldNode } from './schema'

const GRASS_FIELD_KIND = 'environment:ground-cover'

function grassPaintMapsEqual(
  previous: GrassFieldNode['paintMap'],
  current: GrassFieldNode['paintMap'],
): boolean {
  if (previous === current) return true
  if (!previous || !current) return false
  return (
    previous.origin[0] === current.origin[0] &&
    previous.origin[1] === current.origin[1] &&
    previous.spacing === current.spacing &&
    previous.cols === current.cols &&
    previous.rows === current.rows &&
    previous.values === current.values
  )
}

export function grassFieldGeometryInputsEqual(
  previous: GrassFieldNode,
  current: GrassFieldNode,
): boolean {
  return (
    previous.id === current.id &&
    previous.parentId === current.parentId &&
    previous.bladeWidth === current.bladeWidth &&
    previous.bladeWidthVariation === current.bladeWidthVariation &&
    previous.bladeHeight === current.bladeHeight &&
    previous.bladeHeightVariation === current.bladeHeightVariation &&
    grassPaintMapsEqual(previous.paintMap, current.paintMap)
  )
}

export default function GrassFieldSystem() {
  const previousNodesRef = useRef(new Map<string, GrassFieldNode>())

  useEffect(() => {
    const previousNodes = previousNodesRef.current
    return () => previousNodes.clear()
  }, [])

  useFrame(() => {
    const { clearDirty, dirtyNodes, nodes } = useScene.getState()
    const previousNodes = previousNodesRef.current
    const registeredByType = sceneRegistry.byType as Record<string, Set<string> | undefined>
    const fieldIds = registeredByType[GRASS_FIELD_KIND]
    if (!fieldIds) return

    for (const id of fieldIds) {
      const node = nodes[id as AnyNodeId]
      if (!node || (node.type as string) !== GRASS_FIELD_KIND) continue
      const current = node as unknown as GrassFieldNode
      const previous = previousNodes.get(id)

      if (!previous) {
        previousNodes.set(id, current)
        continue
      }
      if (!dirtyNodes.has(id as AnyNodeId) || previous === current) continue

      previousNodes.set(id, current)
      const group = sceneRegistry.nodes.get(id)
      if (!group || !updateGrassFieldUniforms(group, current)) continue
      if (grassFieldGeometryInputsEqual(previous, current)) clearDirty(id as AnyNodeId)
    }

    for (const id of previousNodes.keys()) {
      if (!nodes[id as AnyNodeId]) previousNodes.delete(id)
    }
  }, 1)

  return null
}
