'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type SiteNode,
  sceneRegistry,
  type SceneApi,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { changedPaintTileTargets } from '../paint-tiles/compose'
import { lotGroundsEqual } from '../paint-tiles/lot-ground'
import {
  updateGrassFieldObstacles,
  updateGrassFieldTerrain,
  updateGrassFieldUniforms,
} from './geometry'
import { changedGrassObstacleSiteIds, siteHasWaterObstacles } from './obstacle-adapter'
import { updateGrassTileLod } from './render/grass-tiles'
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
  const flowersEnabled = (previous.flowerDensity ?? 0) > 0 || (current.flowerDensity ?? 0) > 0
  return (
    previous.id === current.id &&
    previous.parentId === current.parentId &&
    previous.bladeWidth === current.bladeWidth &&
    previous.bladeWidthVariation === current.bladeWidthVariation &&
    previous.bladeHeight === current.bladeHeight &&
    previous.bladeHeightVariation === current.bladeHeightVariation &&
    (previous.flowerDensity ?? 0) === (current.flowerDensity ?? 0) &&
    (!flowersEnabled || previous.density === current.density) &&
    grassPaintMapsEqual(previous.paintMap, current.paintMap) &&
    grassPaintMapsEqual(previous.heightMap, current.heightMap) &&
    (previous.unpaintedCoverage ?? 1) === (current.unpaintedCoverage ?? 1) &&
    lotGroundsEqual(previous.lotGround, current.lotGround)
  )
}
export type GrassFieldSiteChange = {
  id: string
  boundaryChanged: boolean
  terrainChanged: boolean
}

export function grassFieldSiteChanges(
  currentNodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
): GrassFieldSiteChange[] {
  const changes: GrassFieldSiteChange[] = []

  for (const node of Object.values(currentNodes)) {
    if ((node.type as string) !== GRASS_FIELD_KIND) continue

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
      changes.push({
        id: node.id,
        boundaryChanged: true,
        terrainChanged: false,
      })
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

export default function GrassFieldSystem({ sceneApi }: { sceneApi: SceneApi }) {
  const previousNodesRef = useRef(new Map<string, GrassFieldNode>())

  useEffect(() => {
    const deferredObstacleSites = new Set<string>()
    const unsubscribeScene = sceneApi.subscribeNodes?.((currentNodes, previousNodes, changedIds) => {
      // A stroke commits only paint tiles; the Ground cover they paint redraws from them.
      for (const targetId of changedPaintTileTargets(currentNodes, previousNodes, changedIds)) {
        if ((currentNodes[targetId as AnyNodeId]?.type as string) === GRASS_FIELD_KIND) {
          sceneApi.markDirty(targetId as AnyNodeId)
        }
      }
      const changes = grassFieldSiteChanges(currentNodes, previousNodes)
      for (const change of changes) {
        const node = currentNodes[change.id as AnyNodeId]
        const site = node?.parentId ? currentNodes[node.parentId as AnyNodeId] : undefined
        const group = sceneRegistry.nodes.get(change.id)
        // A sculpt commit is published before live.end(); reconcile once the live field is gone.
        if (
          !change.boundaryChanged &&
          change.terrainChanged &&
          site?.type === 'site' &&
          useLiveTerrain.getState().fieldOf(site.id)
        ) continue
        if (
          !change.boundaryChanged &&
          change.terrainChanged &&
          site?.type === 'site' &&
          group &&
          updateGrassFieldTerrain(group, site)
        ) {
          // Root/normal updates preserve batches, but species also depend on slope/aspect.
          if (((node as unknown as GrassFieldNode).flowerDensity ?? 0) > 0) {
            sceneApi.markDirty(change.id as AnyNodeId)
          }
          continue
        }
        sceneApi.markDirty(change.id as AnyNodeId)
      }
      const obstacleSiteIds = changedGrassObstacleSiteIds(currentNodes, previousNodes)
      if (obstacleSiteIds.size > 0) {
        for (const candidate of Object.values(currentNodes)) {
          if (
            (candidate.type as string) !== GRASS_FIELD_KIND ||
            !obstacleSiteIds.has(candidate.parentId as string)
          ) {
            continue
          }
          const field = candidate as unknown as GrassFieldNode
          const site = field.parentId ? currentNodes[field.parentId as AnyNodeId] : undefined
          if (site?.type === 'site' && useLiveTerrain.getState().fieldOf(site.id)) {
            deferredObstacleSites.add(site.id)
            continue
          }
          if (
            (field.flowerDensity ?? 0) > 0 ||
            site?.type !== 'site' ||
            !updateGrassFieldObstacles(field, site, currentNodes)
          ) {
            sceneApi.markDirty(field.id as AnyNodeId)
          }
        }
      }
    })

    const unsubscribeLiveTerrain = useLiveTerrain.subscribe((current, previous) => {
      const siteIds = new Set([
        ...current.strokes.keys(),
        ...current.remoteStrokes.keys(),
        ...previous.strokes.keys(),
        ...previous.remoteStrokes.keys(),
      ])
      const nodes = sceneApi.nodes()
      for (const siteId of siteIds) {
        const local = current.strokes.get(siteId)
        const previousLocal = previous.strokes.get(siteId)
        const remote = current.remoteStrokes.get(siteId)
        const previousRemote = previous.remoteStrokes.get(siteId)
        const active = local ?? remote
        const previousActive = previousLocal ?? previousRemote
        if (active?.field === previousActive?.field) continue

        // A replacement source can differ outside lastPatch; only continuous strokes are local.
        const continuous = local
          ? previousLocal?.snapshot === local.snapshot
          : !previousLocal && remote && previousRemote?.sourceId === remote.sourceId
        const patch = continuous ? active?.lastPatch ?? undefined : undefined
        const hasWater = siteHasWaterObstacles(siteId, nodes)
        if (active && hasWater) deferredObstacleSites.add(siteId)
        const reconcileObstacles = !active && (hasWater || deferredObstacleSites.has(siteId))

        for (const node of Object.values(nodes)) {
          if ((node.type as string) !== GRASS_FIELD_KIND || node.parentId !== siteId) continue

          const site = nodes[siteId as AnyNodeId]
          const group = sceneRegistry.nodes.get(node.id)
          let rebuild = site?.type !== 'site' || !group ||
            !updateGrassFieldTerrain(group, site as SiteNode, patch)

          // Roots preview in place; slope/aspect-dependent species settle on release/cancel,
          // including sites without water. Never reallocate flower batches for each dab.
          const field = node as unknown as GrassFieldNode
          if (!active && (field.flowerDensity ?? 0) > 0) {
            rebuild = true
          } else if (reconcileObstacles && site?.type === 'site' && !rebuild) {
            rebuild = !updateGrassFieldObstacles(field, site, nodes)
          }
          if (rebuild) sceneApi.markDirty(node.id)
        }
        if (!active) deferredObstacleSites.delete(siteId)
      }
    })

    const previousNodes = previousNodesRef.current
    return () => {
      unsubscribeScene?.()
      unsubscribeLiveTerrain()
      deferredObstacleSites.clear()
      previousNodes.clear()
    }
  }, [sceneApi])

  useFrame(({ camera, size, gl }) => {
    const { clearDirty, dirtyNodes } = useScene.getState()
    const nodes = sceneApi.nodes()
    const previousNodes = previousNodesRef.current
    const registeredByType = sceneRegistry.byType as Record<string, Set<string> | undefined>
    const fieldIds = registeredByType[GRASS_FIELD_KIND]
    if (!fieldIds) return

    for (const id of fieldIds) {
      const node = nodes[id as AnyNodeId]
      if (!node || (node.type as string) !== GRASS_FIELD_KIND) continue
      const current = node as unknown as GrassFieldNode
      const previous = previousNodes.get(id)
      const group = sceneRegistry.nodes.get(id)
      if (group) updateGrassTileLod(group, camera, size.height * gl.getPixelRatio())

      if (!previous) {
        previousNodes.set(id, current)
        continue
      }
      if (!dirtyNodes.has(id as AnyNodeId) || previous === current) continue

      previousNodes.set(id, current)
      if (!group || !updateGrassFieldUniforms(group, current)) continue
      if (grassFieldGeometryInputsEqual(previous, current)) clearDirty(id as AnyNodeId)
    }

    for (const id of previousNodes.keys()) {
      if (!nodes[id as AnyNodeId]) previousNodes.delete(id)
    }
  }, 1)

  return null
}
