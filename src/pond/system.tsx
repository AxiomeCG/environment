'use client'

import {
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTerrain,
  useScene,
  type AnyNode,
  type AnyNodeId,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { disposePondKoiMotion, updatePondKoiMotion } from './koi-motion'
import { POND_KIND } from './schema'

type RegisteredPondRoot = {
  id: string
  root: Object3D
}

export type PondSiteChange = {
  id: string
  boundaryChanged: boolean
  terrainChanged: boolean
}

export function pondSiteChanges(
  currentNodes: Record<string, AnyNode>,
  previousNodes: Record<string, AnyNode>,
): PondSiteChange[] {
  const changes: PondSiteChange[] = []
  for (const node of Object.values(currentNodes)) {
    if ((node.type as string) !== POND_KIND) continue
    const previousNode = previousNodes[node.id]
    if (!previousNode) continue
    const currentParentId = node.parentId as AnyNodeId | null
    const previousParentId = previousNode.parentId as AnyNodeId | null
    const currentSite = currentParentId ? currentNodes[currentParentId] : undefined
    const previousSite = previousParentId ? previousNodes[previousParentId] : undefined
    if (
      currentParentId !== previousParentId
      || currentSite?.type !== 'site'
      || previousSite?.type !== 'site'
    ) {
      changes.push({ id: node.id, boundaryChanged: true, terrainChanged: true })
      continue
    }
    const boundaryChanged = currentSite.polygon !== previousSite.polygon
    const terrainChanged = currentSite.terrain !== previousSite.terrain
    if (boundaryChanged || terrainChanged) {
      changes.push({ id: node.id, boundaryChanged, terrainChanged })
    }
  }
  return changes
}

export default function PondSystem() {
  const elapsed = useRef(0)
  const registeredRoots = useRef<RegisteredPondRoot[]>([])
  const registryRevision = useRef(-1)
  const renderPaused = useViewer((state) => state.renderPaused)
  const getThree = useThree((state) => state.get)
  useEffect(() => {
    const unsubscribeScene = useScene.subscribe((current, previous) => {
      for (const change of pondSiteChanges(current.nodes, previous.nodes)) {
        current.markDirty(change.id as AnyNodeId)
      }

      const changedPondSites = new Set<string>()
      const nodeIds = new Set([
        ...Object.keys(current.nodes),
        ...Object.keys(previous.nodes),
      ])
      for (const nodeId of nodeIds) {
        const currentNode = current.nodes[nodeId as AnyNodeId]
        const previousNode = previous.nodes[nodeId as AnyNodeId]
        if (currentNode === previousNode) continue
        if (currentNode && (currentNode.type as string) === POND_KIND && currentNode.parentId) {
          changedPondSites.add(currentNode.parentId as string)
        }
        if (previousNode && (previousNode.type as string) === POND_KIND && previousNode.parentId) {
          changedPondSites.add(previousNode.parentId as string)
        }
      }
      markPondsOfSites(changedPondSites)
    })

    const unsubscribeTerrain = useLiveTerrain.subscribe((current, previous) => {
      const siteIds = new Set([
        ...current.strokes.keys(),
        ...current.remoteStrokes.keys(),
        ...previous.strokes.keys(),
        ...previous.remoteStrokes.keys(),
      ])
      const changedSiteIds = new Set<string>()
      for (const siteId of siteIds) {
        const currentField = current.strokes.get(siteId)?.field
          ?? current.remoteStrokes.get(siteId)?.field
        const previousField = previous.strokes.get(siteId)?.field
          ?? previous.remoteStrokes.get(siteId)?.field
        if (currentField !== previousField) changedSiteIds.add(siteId)
      }
      markPondsOfSites(changedSiteIds)
    })

    const unsubscribeBoundary = useLiveNodeOverrides.subscribe((current, previous) => {
      const siteIds = new Set([...current.overrides.keys(), ...previous.overrides.keys()])
      const changedSiteIds = new Set<string>()
      for (const siteId of siteIds) {
        const currentPolygon = current.overrides.get(siteId)?.polygon
        const previousPolygon = previous.overrides.get(siteId)?.polygon
        if (currentPolygon !== previousPolygon) changedSiteIds.add(siteId)
      }
      markPondsOfSites(changedSiteIds)
    })

    return () => {
      for (let index = 0; index < registeredRoots.current.length; index += 1) {
        const entry = registeredRoots.current[index]
        if (entry) disposePondKoiMotion(entry.root)
      }
      registeredRoots.current.length = 0
      unsubscribeScene()
      unsubscribeTerrain()
      unsubscribeBoundary()
    }
  }, [])

  useEffect(() => {
    if (!renderPaused) {
      const state = getThree()
      if (state.frameloop === 'demand') state.invalidate()
    }
  }, [getThree, renderPaused])

  useFrame((state, delta) => {
    if (renderPaused) return
    elapsed.current += Math.min(delta, 0.1)
    const roots = registeredRoots.current
    if (registryRevision.current !== sceneRegistry.revision) {
      for (let index = 0; index < roots.length; index += 1) {
        const entry = roots[index]
        if (entry) disposePondKoiMotion(entry.root)
      }
      roots.length = 0
      const registeredByType = sceneRegistry.byType as Record<
        string,
        Set<string> | undefined
      >
      const pondIds = registeredByType[POND_KIND]
      if (pondIds) {
        for (const id of pondIds) {
          const root = sceneRegistry.nodes.get(id)
          if (root) roots.push({ id, root })
        }
      }
      registryRevision.current = sceneRegistry.revision
    }

    let moving = false
    let pendingBuild = false
    const scene = useScene.getState()
    const nodes = scene.nodes
    for (let index = 0; index < roots.length; index += 1) {
      const entry = roots[index]
      if (!entry) continue
      const node = nodes[entry.id as AnyNodeId]
      if (scene.dirtyNodes.has(entry.id as AnyNodeId)) pendingBuild = true
      if (
        node?.visible !== false
        && updatePondKoiMotion(entry.root, elapsed.current)
      ) {
        moving = true
      }
    }
    if ((moving || pendingBuild) && state.frameloop === 'demand') state.invalidate()
  })

  return null
}

function markPondsOfSites(siteIds: ReadonlySet<string>): void {
  if (siteIds.size === 0) return
  const scene = useScene.getState()
  for (const node of Object.values(scene.nodes)) {
    if ((node.type as string) === POND_KIND && siteIds.has(node.parentId as string)) {
      scene.markDirty(node.id)
    }
  }
}
