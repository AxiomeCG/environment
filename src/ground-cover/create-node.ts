import type { SiteNode } from '@pascal-app/core'
import { GrassFieldNode } from './schema'

/**
 * A site's new Ground cover, as the panel and the agent both create it: no grass anywhere yet and
 * every blade at the node's height. It carries no maps: paint arrives as tiles where it is laid.
 */
export function createGroundCoverNode(site: Pick<SiteNode, 'id'>): GrassFieldNode {
  return GrassFieldNode.parse({ parentId: site.id, unpaintedCoverage: 0 })
}
