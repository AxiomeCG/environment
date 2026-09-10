import { useInteractionScope } from '@pascal-app/editor'

let mountedPaintBodies = 0
let ownedPaintScope: object | null = null
let activeStrokeOwner: symbol | null = null

export function mountEnvironmentPaintBody(): () => void {
  if (mountedPaintBodies === 0) {
    useInteractionScope.getState().begin({ kind: 'painting' })
    ownedPaintScope = useInteractionScope.getState().scope
  }
  mountedPaintBodies += 1

  let mounted = true
  return () => {
    if (!mounted) return
    mounted = false
    mountedPaintBodies = Math.max(0, mountedPaintBodies - 1)
    if (mountedPaintBodies === 0 && ownedPaintScope) {
      const owned = ownedPaintScope
      ownedPaintScope = null
      useInteractionScope.getState().endIf((scope) => scope === owned)
    }
  }
}
export function isEnvironmentPaintScopeActive(): boolean {
  return useInteractionScope.getState().scope === ownedPaintScope
}
export function subscribeEnvironmentPaintScopeLoss(listener: () => void): () => void {
  return useInteractionScope.subscribe(() => {
    if (!isEnvironmentPaintScopeActive()) listener()
  })
}

export function claimEnvironmentPaintStroke(owner: symbol): boolean {
  if (activeStrokeOwner && activeStrokeOwner !== owner) return false
  activeStrokeOwner = owner
  return true
}

export function releaseEnvironmentPaintStroke(owner: symbol): void {
  if (activeStrokeOwner === owner) activeStrokeOwner = null
}
