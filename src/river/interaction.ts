import {
  useLiveNodeOverrides,
  type AnyNodeId,
  type SceneApi,
} from '@pascal-app/core'
import { useInteractionScope } from '@pascal-app/editor'
import type { RiverNode } from './schema'
import { RIVER_KIND } from './schema'

export type RiverReshapeDriver = 'tool' | 'floorplan'

type RiverDraftScope = { readonly kind: 'drafting'; readonly tool: string }
type RiverControlPointScope = {
  readonly kind: 'reshaping'
  readonly nodeId: string
  readonly reshape: 'control-point'
  readonly driver: RiverReshapeDriver
  readonly index: number
}

let mountedDraftBodies = 0
let ownedDraftingScope: RiverDraftScope | null = null
let ownedControlPointScope: RiverControlPointScope | null = null
let activeGestureOwner: symbol | null = null
let mountedToolBodies = 0
let toolBodyRevision = 0
const previewReferences = new Map<
  string,
  { count: number; previousPoints: unknown; sceneApi: SceneApi }
>()

export function retainRiverToolBody(onLastUnmount: () => void): () => void {
  mountedToolBodies += 1
  toolBodyRevision += 1
  let released = false
  return () => {
    if (released) return
    released = true
    mountedToolBodies = Math.max(0, mountedToolBodies - 1)
    const revision = ++toolBodyRevision
    queueMicrotask(() => {
      if (mountedToolBodies === 0 && toolBodyRevision === revision) onLastUnmount()
    })
  }
}

export function ownsRiverDraftingScope(): boolean {
  return Boolean(
    ownedDraftingScope && useInteractionScope.getState().scope === ownedDraftingScope,
  )
}

export function retainRiverDraftingScope(): () => void {
  mountedDraftBodies += 1
  ensureRiverDraftingScope()
  let released = false
  return () => {
    if (released) return
    released = true
    mountedDraftBodies = Math.max(0, mountedDraftBodies - 1)
    if (mountedDraftBodies !== 0) return
    if (ownedDraftingScope) {
      const scopeToEnd = ownedDraftingScope
      useInteractionScope.getState().endIf((scope) => scope === scopeToEnd)
      ownedDraftingScope = null
    }
  }
}

export function ensureRiverDraftingScope(): boolean {
  if (ownedDraftingScope && ownsRiverDraftingScope()) return true
  ownedDraftingScope = null
  const state = useInteractionScope.getState()
  if (state.scope.kind !== 'idle') return false
  const scope = { kind: 'drafting', tool: RIVER_KIND } as const
  state.begin(scope)
  if (useInteractionScope.getState().scope !== scope) return false
  ownedDraftingScope = scope
  return true
}

export function endRiverDraftingScope(): void {
  if (!ownedDraftingScope) return
  const scopeToEnd = ownedDraftingScope
  useInteractionScope.getState().endIf((scope) => scope === scopeToEnd)
  ownedDraftingScope = null
}

export function beginRiverControlPointScope(
  nodeId: string,
  index: number,
  driver: RiverReshapeDriver,
): boolean {
  const state = useInteractionScope.getState()
  if (state.scope.kind !== 'idle') return false
  const scope = {
    kind: 'reshaping',
    nodeId,
    reshape: 'control-point',
    driver,
    index,
  } as const
  state.begin(scope)
  if (useInteractionScope.getState().scope !== scope) return false
  ownedControlPointScope = scope
  return true
}
export function ownsRiverControlPointScope(
  nodeId: string,
  index: number,
  driver: RiverReshapeDriver,
): boolean {
  return Boolean(
    ownedControlPointScope &&
      ownedControlPointScope.nodeId === nodeId &&
      ownedControlPointScope.index === index &&
      ownedControlPointScope.driver === driver &&
      useInteractionScope.getState().scope === ownedControlPointScope,
  )
}


export function endRiverControlPointScope(
  nodeId: string,
  index: number,
  driver: RiverReshapeDriver,
): void {
  if (
    !ownedControlPointScope ||
    ownedControlPointScope.nodeId !== nodeId ||
    ownedControlPointScope.index !== index ||
    ownedControlPointScope.driver !== driver
  ) {
    return
  }
  const scopeToEnd = ownedControlPointScope
  useInteractionScope.getState().endIf((scope) => scope === scopeToEnd)
  ownedControlPointScope = null
}

export function endRiverControlPointScopeForNode(nodeId: string): void {
  if (!ownedControlPointScope || ownedControlPointScope.nodeId !== nodeId) return
  const scopeToEnd = ownedControlPointScope
  useInteractionScope.getState().endIf((scope) => scope === scopeToEnd)
  ownedControlPointScope = null
}

export function claimRiverGesture(owner: symbol): boolean {
  if (activeGestureOwner && activeGestureOwner !== owner) return false
  activeGestureOwner = owner
  return true
}

export function ownsRiverGesture(owner: symbol): boolean {
  return activeGestureOwner === owner
}

export function releaseRiverGesture(owner: symbol): void {
  if (activeGestureOwner === owner) activeGestureOwner = null
}

export function retainRiverNodePreview(sceneApi: SceneApi, nodeId: string): () => void {
  const current = previewReferences.get(nodeId)
  if (current) {
    current.count += 1
  } else {
    previewReferences.set(nodeId, {
      count: 1,
      previousPoints: useLiveNodeOverrides.getState().get(nodeId)?.points,
      sceneApi,
    })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const reference = previewReferences.get(nodeId)
    if (!reference) return
    reference.count -= 1
    if (reference.count > 0) return
    const overrides = useLiveNodeOverrides.getState()
    if (reference.previousPoints === undefined) overrides.clearFields(nodeId, ['points'])
    else overrides.set(nodeId, { points: reference.previousPoints })
    reference.sceneApi.markDirty(nodeId as AnyNodeId)
    previewReferences.delete(nodeId)
  }
}

export function publishRiverNodePreview(sceneApi: SceneApi, river: RiverNode): void {
  useLiveNodeOverrides.getState().set(river.id, { points: river.points })
  sceneApi.markDirty(river.id as AnyNodeId)
}
