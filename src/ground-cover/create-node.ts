import type { SiteNode } from '@pascal-app/core'
import { createGrassHeightField } from './height-field'
import {
  CLEARED_GRASS_PAINT_COLOR,
  createGrassPaintField,
  encodeGrassPaintField,
  siteBounds,
} from './paint-field'
import { GrassFieldNode } from './schema'

/**
 * A site's new Ground cover, as the panel and the agent both create it: no grass anywhere yet
 * (a zero-density paint map) and every blade at the node's height (a neutral height map).
 */
export function createGroundCoverNode(site: Pick<SiteNode, 'id' | 'polygon'>): GrassFieldNode {
  const bounds = siteBounds(site.polygon.points)
  return GrassFieldNode.parse({
    parentId: site.id,
    paintMap: encodeGrassPaintField(createGrassPaintField(bounds, CLEARED_GRASS_PAINT_COLOR, 0)),
    heightMap: encodeGrassPaintField(createGrassHeightField(bounds)),
  })
}
