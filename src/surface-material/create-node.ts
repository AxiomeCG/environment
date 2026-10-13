import type { SiteNode } from '@pascal-app/core'
import { SurfaceMaterialNode } from './schema'

/** A site's new Surface, as the panel and the agent both create it: nothing painted yet. */
export function createSurfaceMaterialNode(site: Pick<SiteNode, 'id'>): SurfaceMaterialNode {
  return SurfaceMaterialNode.parse({ parentId: site.id })
}
