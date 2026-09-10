'use client'

import {
  SiteNode,
  useLiveNodeOverrides,
  useLiveTerrain,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
} from '@pascal-app/core'
import { useEffect } from 'react'
import { RIVER_KIND, RiverNode } from './schema'
import { rebuildRiverTerrain } from './terrain'

export type RiverSiteChange = Readonly<{
  siteId: string
  riverChanged: boolean
  boundaryChanged: boolean
  terrainChanged: boolean
}>

export function riverSiteChanges(
  currentNodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
): RiverSiteChange[] {
  const changes = new Map<string, RiverSiteChange>()
  const add = (siteId: string | null | undefined, flags: Omit<RiverSiteChange, 'siteId'>) => {
    if (!siteId) return
    const current = changes.get(siteId)
    changes.set(siteId, {
      siteId,
      riverChanged: Boolean(current?.riverChanged || flags.riverChanged),
      boundaryChanged: Boolean(current?.boundaryChanged || flags.boundaryChanged),
      terrainChanged: Boolean(current?.terrainChanged || flags.terrainChanged),
    })
  }

  const nodeIds = new Set([...Object.keys(currentNodes), ...Object.keys(previousNodes)])
  for (const id of nodeIds) {
    const current = currentNodes[id]
    const previous = previousNodes[id]
    if (current === previous) continue
    const currentIsRiver = Boolean(current && (current.type as string) === RIVER_KIND)
    const previousIsRiver = Boolean(previous && (previous.type as string) === RIVER_KIND)
    if ((currentIsRiver || previousIsRiver) && riverGradingChanged(current, previous)) {
      if (currentIsRiver) {
        add(current?.parentId as string | null, {
          riverChanged: true,
          boundaryChanged: false,
          terrainChanged: false,
        })
      }
      if (previousIsRiver) {
        add(previous?.parentId as string | null, {
          riverChanged: true,
          boundaryChanged: false,
          terrainChanged: false,
        })
      }
    }
    if (
      (current?.type as string | undefined) === 'site' ||
      (previous?.type as string | undefined) === 'site'
    ) {
      const currentSite = current && current.type === 'site' ? current : undefined
      const previousSite = previous && previous.type === 'site' ? previous : undefined
      add(id, {
        riverChanged: false,
        boundaryChanged: currentSite?.polygon !== previousSite?.polygon,
        terrainChanged: currentSite?.terrain !== previousSite?.terrain,
      })
    }
  }
  return [...changes.values()]
}

function riverGradingChanged(current: AnyNode | undefined, previous: AnyNode | undefined): boolean {
  if (!current || !previous) return true
  if ((current.type as string) !== RIVER_KIND || (previous.type as string) !== RIVER_KIND)
    return true
  const currentRiver = RiverNode.safeParse(current)
  const previousRiver = RiverNode.safeParse(previous)
  if (!currentRiver.success || !previousRiver.success) return true
  if (
    currentRiver.data.parentId !== previousRiver.data.parentId ||
    currentRiver.data.width !== previousRiver.data.width ||
    currentRiver.data.depth !== previousRiver.data.depth ||
    currentRiver.data.source !== previousRiver.data.source ||
    currentRiver.data.outlet !== previousRiver.data.outlet ||
    currentRiver.data.points.length !== previousRiver.data.points.length
  ) {
    return true
  }
  return currentRiver.data.points.some((point, index) => {
    const prior = previousRiver.data.points[index]
    return !prior || point[0] !== prior[0] || point[1] !== prior[1]
  })
}

export default function RiverSystem({ sceneApi }: { sceneApi: SceneApi }) {
  useEffect(() => {
    let reconciling = false

    const reconcile = (siteIds: ReadonlySet<string>) => {
      if (reconciling || siteIds.size === 0) return
      const nodes = sceneApi.nodes()
      const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
      for (const siteId of siteIds) {
        const parsedSite = SiteNode.safeParse(nodes[siteId as AnyNodeId])
        if (!parsedSite.success) continue
        const site = parsedSite.data
        const rivers = Object.values(nodes)
          .filter(
            (candidate) =>
              candidate.parentId === site.id && (candidate.type as string) === RIVER_KIND,
          )
          .map((candidate) => RiverNode.safeParse(candidate))
          .filter((parsed): parsed is { success: true; data: RiverNode } => parsed.success)
          .map((parsed) => parsed.data)
        const hasTracking =
          site.metadata !== null &&
          Object.prototype.hasOwnProperty.call(site.metadata, 'environmentRiverTerrain')
        if (rivers.length === 0 && !hasTracking) continue
        const rebuilt = rebuildRiverTerrain(site, rivers)
        if (
          terrainDataEqual(site.terrain, rebuilt.terrainData) &&
          metadataEqual(site.metadata, rebuilt.metadata)
        ) {
          continue
        }
        updates.push({
          id: site.id as AnyNodeId,
          data: {
            terrain: rebuilt.terrainData,
            metadata: rebuilt.metadata,
          } as Partial<AnyNode>,
        })
      }
      if (updates.length > 0) {
        reconciling = true
        try {
          if (!sceneApi.applyChanges) {
            throw new Error('RiverSystem requires SceneApi.applyChanges for reconciliation.')
          }
          sceneApi.applyChanges({ update: updates })
        } finally {
          reconciling = false
        }
      }
      markRiversOfSites(sceneApi, siteIds)
    }

    const unsubscribeScene =
      sceneApi.subscribeNodes?.((currentNodes, previousNodes) => {
        if (reconciling) return
        const changes = riverSiteChanges(currentNodes, previousNodes)
        reconcile(new Set(changes.map((change) => change.siteId)))
      }) ?? (() => {})

    const unsubscribeTerrain = useLiveTerrain.subscribe((current, previous) => {
      const siteIds = new Set([
        ...current.strokes.keys(),
        ...current.remoteStrokes.keys(),
        ...previous.strokes.keys(),
        ...previous.remoteStrokes.keys(),
      ])
      const changed = new Set<string>()
      for (const siteId of siteIds) {
        const currentField =
          current.strokes.get(siteId)?.field ?? current.remoteStrokes.get(siteId)?.field
        const previousField =
          previous.strokes.get(siteId)?.field ?? previous.remoteStrokes.get(siteId)?.field
        if (currentField !== previousField) changed.add(siteId)
      }
      markRiversOfSites(sceneApi, changed)
    })

    const unsubscribeBoundary = useLiveNodeOverrides.subscribe((current, previous) => {
      const siteIds = new Set([...current.overrides.keys(), ...previous.overrides.keys()])
      const changed = new Set<string>()
      for (const siteId of siteIds) {
        if (current.overrides.get(siteId)?.polygon !== previous.overrides.get(siteId)?.polygon) {
          changed.add(siteId)
        }
      }
      markRiversOfSites(sceneApi, changed)
    })

    const initialSites = new Set<string>()
    for (const node of Object.values(sceneApi.nodes())) {
      if ((node.type as string) === RIVER_KIND && node.parentId)
        initialSites.add(node.parentId as string)
      if (
        node.type === 'site' &&
        node.metadata &&
        Object.prototype.hasOwnProperty.call(node.metadata, 'environmentRiverTerrain')
      ) {
        initialSites.add(String(node.id))
      }
    }
    reconcile(initialSites)

    return () => {
      unsubscribeScene()
      unsubscribeTerrain()
      unsubscribeBoundary()
    }
  }, [sceneApi])

  return null
}

function markRiversOfSites(sceneApi: SceneApi, siteIds: ReadonlySet<string>): void {
  if (siteIds.size === 0) return
  for (const node of Object.values(sceneApi.nodes())) {
    if (
      (node.type as string) === RIVER_KIND &&
      node.parentId &&
      siteIds.has(node.parentId as string)
    ) {
      sceneApi.markDirty(node.id as AnyNodeId)
    }
  }
}

function terrainDataEqual(
  left: SiteNode['terrain'],
  right: NonNullable<SiteNode['terrain']>,
): boolean {
  return Boolean(
    left &&
      left.type === right.type &&
      left.cols === right.cols &&
      left.rows === right.rows &&
      left.spacing === right.spacing &&
      left.step === right.step &&
      left.origin[0] === right.origin[0] &&
      left.origin[1] === right.origin[1] &&
      left.heights === right.heights,
  )
}

function metadataEqual(left: SiteNode['metadata'], right: SiteNode['metadata']): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}
