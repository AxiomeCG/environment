import { type AnyNode, type AnyNodeId, type GeometryContext, useScene } from '@pascal-app/core'
import { useMemo } from 'react'

export type ReplaceResolve = GeometryContext['resolve']

/**
 * The node lookup a `bakeReplaceRenderer` builds from: the host's `resolve`
 * over the graph the artifact was baked from (the baked viewer never loads that
 * graph into `useScene`), else the scene store.
 */
export function useReplaceResolve(resolve: ReplaceResolve | undefined): ReplaceResolve {
  const sceneNodes = useScene((state) => state.nodes)
  const storeNodes = resolve ? null : sceneNodes
  return useMemo(
    () =>
      resolve
      ?? (<N = AnyNode>(id: AnyNodeId) => storeNodes?.[id] as N | undefined),
    [resolve, storeNodes],
  )
}

/** Builder context for one replace node; `siblingKind` collects its parent's other children of that kind. */
export function replaceGeometryContext(
  node: { id: string; parentId: string | null },
  resolve: ReplaceResolve,
  siblingKind?: string,
): GeometryContext {
  const parent = node.parentId ? (resolve(node.parentId as AnyNodeId) ?? null) : null
  const childIds = parent && 'children' in parent && Array.isArray(parent.children)
    ? (parent.children as AnyNodeId[])
    : []
  const siblings = siblingKind
    ? childIds
        .map((id) => resolve(id))
        .filter((candidate): candidate is AnyNode =>
          candidate !== undefined
          && String(candidate.id) !== node.id
          && (candidate.type as string) === siblingKind,
        )
    : []
  return { parent, resolve, children: [], siblings }
}
