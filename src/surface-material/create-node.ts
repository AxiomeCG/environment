import type { SiteNode } from '@pascal-app/core'
import { siteBounds } from '../ground-cover/paint-field'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from './field'
import { SurfaceMaterialNode } from './schema'

/** A site's new Surface, as the panel and the agent both create it: nothing painted yet. */
export function createSurfaceMaterialNode(
  site: Pick<SiteNode, 'id' | 'polygon'>,
): SurfaceMaterialNode {
  return SurfaceMaterialNode.parse({
    parentId: site.id,
    paintMap: encodeSurfaceMaterialField(createSurfaceMaterialField(siteBounds(site.polygon.points))),
  })
}
