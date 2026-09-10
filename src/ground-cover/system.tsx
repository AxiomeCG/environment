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
    grassPaintMapsEqual(previous.heightMap, current.heightMap)
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
    const unsubscribeScene = sceneApi.subscribeNodes?.((currentNodes, previousNodes) => {
      const changes = grassFieldSiteChanges(currentNodes, previousNodes)
      for (const change of changes) {
        const node = currentNodes[change.id as AnyNodeId]
        const site = node?.parentId ? currentNodes[node.parentId as AnyNodeId] : undefined
        const group = sceneRegistry.nodes.get(change.id)
        if (
          !change.boundaryChanged &&
          change.terrainChanged &&
          site?.type === 'site' &&
          group &&
          updateGrassFieldTerrain(group, site)
        ) {
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
      const changedSiteIds = new Set<string>()

      for (const siteId of siteIds) {
        const currentField =
          current.strokes.get(siteId)?.field ?? current.remoteStrokes.get(siteId)?.field
        const previousField =
          previous.strokes.get(siteId)?.field ?? previous.remoteStrokes.get(siteId)?.field
        if (currentField !== previousField) changedSiteIds.add(siteId)
      }

      if (changedSiteIds.size > 0) {
        const nodes = sceneApi.nodes()
        for (const node of Object.values(nodes)) {
          if (
            (node.type as string) !== GRASS_FIELD_KIND ||
            !changedSiteIds.has(node.parentId as string)
          ) {
            continue
          }

          const site = nodes[node.parentId as AnyNodeId]
          const group = sceneRegistry.nodes.get(node.id)
          if (
            site?.type !== 'site' ||
            !group ||
            !updateGrassFieldTerrain(group, site as SiteNode)
          ) {
            sceneApi.markDirty(node.id)
          }
          if (site?.type === 'site' && siteHasWaterObstacles(site.id, nodes)) {
            const field = node as unknown as GrassFieldNode
            if (
              (field.flowerDensity ?? 0) > 0 ||
              !updateGrassFieldObstacles(field, site, nodes)
            ) {
              sceneApi.markDirty(node.id)
            }
          }
        }
      }
    })

    const previousNodes = previousNodesRef.current
    return () => {
      unsubscribeScene?.()
      unsubscribeLiveTerrain()
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
