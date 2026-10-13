'use client'

import {
  acquireSceneHistoryPause,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
  useLiveTerrain,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
} from '@pascal-app/core'
import { useEffect } from 'react'
import { RIVER_KIND, RiverNode } from './schema'
import {
  rebuildRiverTerrain,
  riverTerrainFingerprint,
  riverTerrainIsApplied,
  riverTerrainSavedByEarlierCarver,
} from './terrain'

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
  if (currentRiver.data.parentId !== previousRiver.data.parentId) return true
  // The fingerprint covers every grading-relevant field (path, widths, depths,
  // profile, section, ends), so new fields cannot silently miss reconciliation.
  return (
    riverTerrainFingerprint([currentRiver.data]) !== riverTerrainFingerprint([previousRiver.data])
  )
}

export type RiverReconcileWrite = Readonly<{
  update: Pick<SiteNode, 'terrain' | 'metadata'>
  /** Correcting a Site as an earlier version saved it: a load migration, not an edit. */
  migration: boolean
}>

/**
 * The terrain and metadata that bring a Site in line with its rivers, or null
 * when it already carries them. An apply stamps the Site with its carve, so
 * reconciling right after one writes nothing: no second history entry. A Site
 * saved by an earlier carver whose carve this one reproduces is not written
 * either; its stamp is refreshed by the next real river change.
 */
export function riverReconcileUpdate(
  site: SiteNode,
  rivers: readonly RiverNode[],
): RiverReconcileWrite | null {
  const hasTracking =
    site.metadata !== null &&
    Object.prototype.hasOwnProperty.call(site.metadata, 'environmentRiverTerrain')
  if (rivers.length === 0 && !hasTracking) return null
  if (riverTerrainIsApplied(site, rivers)) return null
  const migration = riverTerrainSavedByEarlierCarver(site)
  const rebuilt = rebuildRiverTerrain(site, rivers)
  const sameTerrain = terrainDataEqual(site.terrain, rebuilt.terrainData)
  if (sameTerrain && (migration || metadataEqual(site.metadata, rebuilt.metadata))) return null
  return { update: { terrain: rebuilt.terrainData, metadata: rebuilt.metadata }, migration }
}

export default function RiverSystem({ sceneApi }: { sceneApi: SceneApi }) {
  useEffect(() => {
    let reconciling = false

    const reconcile = (siteIds: ReadonlySet<string>) => {
      if (reconciling || siteIds.size === 0) return
      reconciling = true
      try {
        applyReconcileWrites(sceneApi, reconcileWrites(sceneApi.nodes(), siteIds))
      } finally {
        reconciling = false
      }
      markRiversOfSites(sceneApi, siteIds)
    }

    const unsubscribeScene =
      sceneApi.subscribeNodes?.((currentNodes, previousNodes) => {
        if (reconciling) return
        const changes = riverSiteChanges(currentNodes, previousNodes)
        reconcile(new Set(changes.map((change) => change.siteId)))
      }) ?? (() => {})
    const unsubscribePreviews = subscribeLivePreviews(sceneApi)
    reconcile(riverSitesOf(sceneApi.nodes()))

    return () => {
      unsubscribeScene()
      unsubscribePreviews()
    }
  }, [sceneApi])

  return null
}

/**
 * Edits are ordinary writes. Undoing must never bring back a carve the
 * current planner refuses, so a load migration records no undo step and no
 * local scene commit.
 */
function applyReconcileWrites(
  sceneApi: SceneApi,
  { edits, migrations }: Readonly<{ edits: SiteUpdate[]; migrations: SiteUpdate[] }>,
): void {
  applySiteUpdates(sceneApi, edits)
  if (migrations.length === 0) return
  const releaseHistory = acquireSceneHistoryPause(useScene)
  try {
    applySiteUpdates(sceneApi, migrations)
  } finally {
    releaseHistory()
  }
}

/** Sites with rivers, or with a river carve still tracked after their last river went. */
function riverSitesOf(nodes: Readonly<Record<string, AnyNode>>): Set<string> {
  const siteIds = new Set<string>()
  for (const node of Object.values(nodes)) {
    if ((node.type as string) === RIVER_KIND && node.parentId) siteIds.add(node.parentId as string)
    if (
      node.type === 'site' &&
      node.metadata &&
      Object.prototype.hasOwnProperty.call(node.metadata, 'environmentRiverTerrain')
    ) {
      siteIds.add(String(node.id))
    }
  }
  return siteIds
}

/** Redraw rivers while their Site's terrain or boundary is previewed live. */
function subscribeLivePreviews(sceneApi: SceneApi): () => void {
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
  return () => {
    unsubscribeTerrain()
    unsubscribeBoundary()
  }
}

type SiteUpdate = Readonly<{ id: AnyNodeId; data: Partial<AnyNode> }>

/** The Site writes that bring these Sites in line with their rivers, split by kind. */
function reconcileWrites(
  nodes: Readonly<Record<string, AnyNode>>,
  siteIds: ReadonlySet<string>,
): Readonly<{ edits: SiteUpdate[]; migrations: SiteUpdate[] }> {
  const edits: SiteUpdate[] = []
  const migrations: SiteUpdate[] = []
  for (const siteId of siteIds) {
    const parsedSite = SiteNode.safeParse(nodes[siteId])
    if (!parsedSite.success) continue
    const site = parsedSite.data
    const rivers = Object.values(nodes)
      .filter(
        (candidate) => candidate.parentId === site.id && (candidate.type as string) === RIVER_KIND,
      )
      .map((candidate) => RiverNode.safeParse(candidate))
      .filter((parsed): parsed is { success: true; data: RiverNode } => parsed.success)
      .map((parsed) => parsed.data)
    const write = riverReconcileUpdate(site, rivers)
    if (!write) continue
    const update = { id: site.id as AnyNodeId, data: write.update as Partial<AnyNode> }
    if (write.migration) migrations.push(update)
    else edits.push(update)
  }
  return { edits, migrations }
}

function applySiteUpdates(sceneApi: SceneApi, updates: readonly SiteUpdate[]): void {
  if (updates.length === 0) return
  if (!sceneApi.applyChanges) {
    throw new Error('RiverSystem requires SceneApi.applyChanges for reconciliation.')
  }
  sceneApi.applyChanges({ update: [...updates] })
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
