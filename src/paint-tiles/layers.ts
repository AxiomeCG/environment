import type { GeometryContext, SiteNode } from '@pascal-app/core'
import { resolveGrassHeightField } from '../ground-cover/height-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  resolveGrassPaintField,
  siteBounds,
  type GrassPaintField,
  type SiteBounds,
} from '../ground-cover/paint-field'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import { resolveSurfaceMaterialField, type SurfaceMaterialField } from '../surface-material/field'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { composePaintTiles, paintTilesOf } from './compose'
import { withLotGround } from './lot-ground'
import type { PaintTileMap } from './schema'

/**
 * Each painted map as everything reads it: the node's own map (or its unpainted default) with the
 * map's tiles over it. `candidates` holds the tiles: the site's children, or every node.
 */
export function resolveGroundCoverPaint(
  node: Pick<GrassFieldNode, 'id' | 'paintMap' | 'unpaintedCoverage' | 'lotGround'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): GrassPaintField {
  const base = withLotGround(
    resolveGrassPaintField(
      node.paintMap,
      bounds,
      DEFAULT_GRASS_PAINT_COLOR,
      node.unpaintedCoverage ?? 1,
    ),
    node.lotGround,
    'paintMap',
  )
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'paintMap'))
}

export function resolveGroundCoverHeight(
  node: Pick<GrassFieldNode, 'id' | 'heightMap' | 'lotGround'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): GrassPaintField {
  const base = withLotGround(
    resolveGrassHeightField(node.heightMap, bounds),
    node.lotGround,
    'heightMap',
  )
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'heightMap'))
}

export function resolveSurfacePaint(
  node: Pick<SurfaceMaterialNode, 'id' | 'paintMap' | 'lotGround'>,
  candidates: Iterable<unknown>,
  bounds: SiteBounds,
): SurfaceMaterialField {
  const base = withLotGround(
    resolveSurfaceMaterialField(node.paintMap, bounds),
    node.lotGround,
    'surface',
  )
  return composePaintTiles(base, paintTilesOf(candidates, node.id, 'paintMap'))
}

/** A site's children as a builder resolves them: where its paint tiles live. */
export function siteChildrenIn(
  site: SiteNode,
  context: Pick<GeometryContext, 'resolve'>,
): unknown[] {
  return site.children.map((id) => context.resolve(id as never))
}

/**
 * The map a write targets as the scene holds it now: the painted node's map with its tiles over
 * it. Null when the node or its site is gone, or the node has no such map.
 */
export function resolvePaintedMap(
  nodes: Readonly<Record<string, unknown>>,
  target: { siteId: string; targetId: string; map: PaintTileMap },
): GrassPaintField | null {
  const site = nodes[target.siteId] as SiteNode | undefined
  const node = nodes[target.targetId] as { type?: unknown } | undefined
  if (site?.type !== 'site' || !node) return null
  const bounds = siteBounds(site.polygon.points)
  const candidates = Object.values(nodes)
  if (node.type === GRASS_FIELD_KIND) {
    const grass = node as GrassFieldNode
    return target.map === 'heightMap'
      ? resolveGroundCoverHeight(grass, candidates, bounds)
      : resolveGroundCoverPaint(grass, candidates, bounds)
  }
  if (node.type === SURFACE_MATERIAL_KIND && target.map === 'paintMap') {
    return resolveSurfacePaint(node as SurfaceMaterialNode, candidates, bounds)
  }
  return null
}
