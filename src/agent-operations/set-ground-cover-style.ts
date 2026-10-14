import type { AnyNode } from '@pascal-app/core'
import { createGroundCoverNode } from '../ground-cover/create-node'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { groundCoverStylePatch, type GroundCoverStyle } from '../ground-cover/style'
import { groundCoverStyleFacts } from './ground-cover-style-facts'
import { refuse } from './refuse'
import { requireSite, siteChildOfKind } from './scene'
import type { AgentOperation } from './types'

export type SetGroundCoverStyleInput = Partial<GroundCoverStyle>

export const setGroundCoverStyle: AgentOperation<SetGroundCoverStyleInput> = (nodes, input) => {
  const parsed = groundCoverStylePatch.safeParse(input)
  if (!parsed.success) {
    refuse('invalid_ground_cover_style', 'Ground-cover style must use the inspector fields and bounds.', {
      issues: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    })
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined))
  if (Object.keys(patch).length === 0) {
    refuse('invalid_ground_cover_style', 'Provide at least one ground-cover style field.')
  }
  const site = requireSite(nodes)
  const existing = siteChildOfKind<GrassFieldNode>(nodes, String(site.id), GRASS_FIELD_KIND)
  const node = { ...(existing ?? createGroundCoverNode(site)), ...patch }
  return {
    result: {
      groundCoverId: String(node.id),
      created: existing === null,
      ...groundCoverStyleFacts(node),
    },
    changes: existing
      ? { update: [{ id: String(node.id), data: patch as Partial<AnyNode> }] }
      : { create: [{ node: node as unknown as AnyNode, parentId: String(site.id) }] },
  }
}
