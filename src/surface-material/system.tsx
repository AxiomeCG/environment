'use client'

import {
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  type SceneApi,
  useLiveTerrain,
} from '@pascal-app/core'
import { useEffect } from 'react'
import type { Object3D } from 'three'
import { sitesWithChangedTerrainNodes } from '../terrain-nodes'
import { changedGrassObstacleSiteIds } from '../ground-cover/obstacle-adapter'
import { updateSurfaceMaterialObstacles, updateSurfaceMaterialTerrain } from './geometry'
import { SURFACE_MATERIAL_KIND } from './schema'
import { groundCoversOf, surfaceTileChangesRedraw } from './tile-refresh'

export type SurfaceSiteChange = {
  id: string
  boundaryChanged: boolean
  terrainChanged: boolean
}

export function surfaceSiteChanges(
  currentNodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
  changedIds?: Iterable<string>,
): SurfaceSiteChange[] {
  const changes: SurfaceSiteChange[] = []
  // Ground the host keeps in nodes (terrain tiles, breaks) moves without touching the Site.
  const reshaped = sitesWithChangedTerrainNodes(currentNodes, previousNodes, changedIds)
  for (const node of Object.values(currentNodes)) {
    if ((node.type as string) !== SURFACE_MATERIAL_KIND) continue
    const previousNode = previousNodes[node.id]
    if (!previousNode) continue
    const currentParentId = node.parentId as AnyNodeId | null
    const previousParentId = previousNode.parentId as AnyNodeId | null
    const currentSite = currentParentId ? currentNodes[currentParentId] : undefined
    const previousSite = previousParentId ? previousNodes[previousParentId] : undefined
    if (
      currentParentId !== previousParentId ||
      currentSite?.type !== 'site' ||
      previousSite?.type !== 'site'
    ) {
      changes.push({ id: node.id, boundaryChanged: true, terrainChanged: false })
      continue
    }
    const boundaryChanged = currentSite.polygon !== previousSite.polygon
    const terrainChanged =
      currentSite.terrain !== previousSite.terrain || reshaped.has(currentSite.id)
    if (boundaryChanged || terrainChanged) {
      changes.push({ id: node.id, boundaryChanged, terrainChanged })
    }
  }
  return changes
}

export default function SurfaceMaterialSystem({ sceneApi }: { sceneApi: SceneApi }) {
  useEffect(() => {
    const unsubscribeScene = sceneApi.subscribeNodes?.((currentNodes, previousNodes, changedIds) => {
      // A stroke commits only paint tiles; the Surface they paint redraws from them, and so does
      // the surface each Ground cover draws beneath its grass.
      const redraw = surfaceTileChangesRedraw(currentNodes, previousNodes, changedIds)
      for (const id of [
        ...redraw.surfaces,
        ...groundCoversOf(currentNodes, redraw.rebuildGroundCoverOf),
      ]) {
        sceneApi.markDirty(id as AnyNodeId)
      }
      // What owns the ground cuts the sheet out: a pool placed on it, a slab, a rock.
      const ownerSites = changedGrassObstacleSiteIds(currentNodes, previousNodes)
      if (ownerSites.size > 0) {
        for (const candidate of Object.values(currentNodes)) {
          if (
            (candidate.type as string) !== SURFACE_MATERIAL_KIND ||
            !ownerSites.has(candidate.parentId as string)
          ) {
            continue
          }
          const site = currentNodes[candidate.parentId as AnyNodeId]
          if (
            site?.type !== 'site' ||
            !updateSurfaceMaterialObstacles(candidate, site, currentNodes)
          ) {
            sceneApi.markDirty(candidate.id as AnyNodeId)
          }
        }
      }
      for (const change of surfaceSiteChanges(currentNodes, previousNodes, changedIds)) {
        const node = currentNodes[change.id as AnyNodeId]
        const site = node?.parentId
          ? currentNodes[node.parentId as AnyNodeId]
          : undefined
        const root = sceneRegistry.nodes.get(change.id) as Object3D | undefined
        if (
          !change.boundaryChanged &&
          change.terrainChanged &&
          site?.type === 'site' &&
          root &&
          updateSurfaceMaterialTerrain(root, site)
        ) {
          continue
        }
        sceneApi.markDirty(change.id as AnyNodeId)
      }
    })

    const unsubscribeLiveTerrain = useLiveTerrain.subscribe((current, previous) => {
      const siteIds = new Set([
        ...current.strokes.keys(),
        ...current.remoteStrokes.keys(),
        ...previous.strokes.keys(),
        ...previous.remoteStrokes.keys(),
      ])
      const changedSiteIds = new Set<string>()
      for (const siteId of siteIds) {
        const currentField =
          current.strokes.get(siteId)?.field ?? current.remoteStrokes.get(siteId)?.field
        const previousField =
          previous.strokes.get(siteId)?.field ?? previous.remoteStrokes.get(siteId)?.field
        if (currentField !== previousField) changedSiteIds.add(siteId)
      }
      if (changedSiteIds.size === 0) return

      const nodes = sceneApi.nodes()
      for (const node of Object.values(nodes)) {
        if (
          (node.type as string) !== SURFACE_MATERIAL_KIND ||
          !changedSiteIds.has(node.parentId as string)
        ) {
          continue
        }
        const site = nodes[node.parentId as AnyNodeId]
        const root = sceneRegistry.nodes.get(node.id) as Object3D | undefined
        if (site?.type !== 'site' || !root || !updateSurfaceMaterialTerrain(root, site)) {
          sceneApi.markDirty(node.id)
        }
      }
    })

    return () => {
      unsubscribeScene?.()
      unsubscribeLiveTerrain()
    }
  }, [sceneApi])

  return null
}
