import type { GeometryContext, SiteNode } from '@pascal-app/core'
import { resolveGrassHeightField } from '../ground-cover/height-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  resolveGrassPaintField,
  type GrassPaintField,
  type SiteBounds,
} from '../ground-cover/paint-field'
import type { GrassFieldNode } from '../ground-cover/schema'
import { resolveSurfaceMaterialField, type SurfaceMaterialField } from '../surface-material/field'
import type { SurfaceMaterialNode } from '../surface-material/schema'
import { composePaintTiles, paintTilesOf } from './compose'

/**
 * Each painted map as everything reads it: the node's own map (or its unpainted default) with the
 * map's tiles over it. `candidates` holds the tiles: the site's children, or every node.
 */
export function resolveGroundCoverPaint(
  node: Pick<GrassFieldNode, 'id' | 'paintMap' | 'unpaintedCoverage'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): GrassPaintField {
  const base = resolveGrassPaintField(
    node.paintMap,
    bounds,
    DEFAULT_GRASS_PAINT_COLOR,
    node.unpaintedCoverage ?? 1,
  )
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'paintMap'))
}

export function resolveGroundCoverHeight(
  node: Pick<GrassFieldNode, 'id' | 'heightMap'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): GrassPaintField {
  const base = resolveGrassHeightField(node.heightMap, bounds)
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'heightMap'))
}

export function resolveSurfacePaint(
  node: Pick<SurfaceMaterialNode, 'id' | 'paintMap'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): SurfaceMaterialField {
  const base = resolveSurfaceMaterialField(node.paintMap, bounds)
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'paintMap'))
}

/** A site's children as a builder resolves them: where its paint tiles live. */
export function siteChildrenIn(site: SiteNode, context: Pick<GeometryContext, 'resolve'>): unknown[] {
  return site.children.map((id) => context.resolve(id as never))
}
