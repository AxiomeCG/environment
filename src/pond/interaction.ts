import { useInteractionScope } from '@pascal-app/editor'

let mountedToolBodies = 0
let ownedPaintingScope: { readonly kind: 'painting' } | null = null
let activeGestureOwner: symbol | null = null

export function retainPondToolScope(): () => void {
  mountedToolBodies += 1
  ensurePondToolScope()
  let released = false
  return () => {
    if (released) return
    released = true
    mountedToolBodies = Math.max(0, mountedToolBodies - 1)
    if (mountedToolBodies !== 0) return
    activeGestureOwner = null
    if (ownedPaintingScope) {
      const scopeToEnd = ownedPaintingScope
      useInteractionScope.getState().endIf((scope) => scope === scopeToEnd)
      ownedPaintingScope = null
    }
  }
}

export function ensurePondToolScope(): boolean {
  const state = useInteractionScope.getState()
  if (ownedPaintingScope && state.scope === ownedPaintingScope) return true
  ownedPaintingScope = null
  if (state.scope.kind !== 'idle') return false
  const scope = { kind: 'painting' } as const
  state.begin(scope)
  if (useInteractionScope.getState().scope !== scope) return false
  ownedPaintingScope = scope
  return true
}
export function ownsPondToolScope(): boolean {
  return Boolean(ownedPaintingScope && useInteractionScope.getState().scope === ownedPaintingScope)
}


export function claimPondGesture(owner: symbol): boolean {
  if (!ensurePondToolScope()) return false
  if (activeGestureOwner && activeGestureOwner !== owner) return false
  activeGestureOwner = owner
  return true
}

export function ownsPondGesture(owner: symbol): boolean {
  return activeGestureOwner === owner
}

export function releasePondGesture(owner: symbol): void {
  if (activeGestureOwner === owner) activeGestureOwner = null
}
