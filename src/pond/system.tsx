'use client'

import {
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTerrain,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
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
  currentNodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
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

export default function PondSystem({ sceneApi }: { sceneApi: SceneApi }) {
  const elapsed = useRef(0)
  const registeredRoots = useRef<RegisteredPondRoot[]>([])
  const registryRevision = useRef(-1)
  const renderPaused = useViewer((state) => state.renderPaused)
  const getThree = useThree((state) => state.get)
  useEffect(() => {
    const unsubscribeScene =
      sceneApi.subscribeNodes?.((currentNodes, previousNodes) => {
        for (const change of pondSiteChanges(currentNodes, previousNodes)) {
          sceneApi.markDirty(change.id as AnyNodeId)
        }

      const changedPondSites = new Set<string>()
      const nodeIds = new Set([
        ...Object.keys(currentNodes),
        ...Object.keys(previousNodes),
      ])
      for (const nodeId of nodeIds) {
        const currentNode = currentNodes[nodeId as AnyNodeId]
        const previousNode = previousNodes[nodeId as AnyNodeId]
        if (currentNode === previousNode) continue
        if (currentNode && (currentNode.type as string) === POND_KIND && currentNode.parentId) {
          changedPondSites.add(currentNode.parentId as string)
        }
        if (previousNode && (previousNode.type as string) === POND_KIND && previousNode.parentId) {
          changedPondSites.add(previousNode.parentId as string)
        }
      }
      markPondsOfSites(sceneApi, changedPondSites)
    }) ?? (() => {})

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
      markPondsOfSites(sceneApi, changedSiteIds)
    })

    const unsubscribeBoundary = useLiveNodeOverrides.subscribe((current, previous) => {
      const siteIds = new Set([...current.overrides.keys(), ...previous.overrides.keys()])
      const changedSiteIds = new Set<string>()
      for (const siteId of siteIds) {
        const currentPolygon = current.overrides.get(siteId)?.polygon
        const previousPolygon = previous.overrides.get(siteId)?.polygon
        if (currentPolygon !== previousPolygon) changedSiteIds.add(siteId)
      }
      markPondsOfSites(sceneApi, changedSiteIds)
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
  }, [sceneApi])

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
    const nodes = sceneApi.nodes()
    for (let index = 0; index < roots.length; index += 1) {
      const entry = roots[index]
      if (!entry) continue
      const node = nodes[entry.id as AnyNodeId]
      if (node?.visible !== false && updatePondKoiMotion(entry.root, elapsed.current)) {
        moving = true
      }
    }
    if (moving && state.frameloop === 'demand') state.invalidate()
  })

  return null
}

function markPondsOfSites(sceneApi: SceneApi, siteIds: ReadonlySet<string>): void {
  if (siteIds.size === 0) return
  for (const node of Object.values(sceneApi.nodes())) {
    if ((node.type as string) === POND_KIND && siteIds.has(node.parentId as string)) {
      sceneApi.markDirty(node.id)
    }
  }
}
