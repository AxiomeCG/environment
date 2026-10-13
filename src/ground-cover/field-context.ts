import {
  terrainFieldOf,
  type GeometryContext,
  type TerrainField,
} from '@pascal-app/core'
import {
  resolveGroundCoverHeight,
  resolveGroundCoverPaint,
  siteChildrenIn,
} from '../paint-tiles/layers'
import { buildGrassObstacleField, collectSiteNodes } from './obstacle-adapter'
import {
  createGrassObstacleTopology,
  type GrassObstacleField,
} from './obstacle-field'
import { siteBounds, type GrassPaintField, type SiteBounds } from './paint-field'
import type { GrassFieldNode } from './schema'

export type GroundCoverFields = {
  site: Extract<GeometryContext['parent'], { type: 'site' }>
  boundary: ReadonlyArray<readonly [number, number]>
  bounds: SiteBounds
  terrain: TerrainField | null
  paint: GrassPaintField
  height: GrassPaintField
  obstacles: GrassObstacleField
}

export function resolveGroundCoverFields(
  node: GrassFieldNode,
  context: GeometryContext,
): GroundCoverFields | null {
  const site = context.parent
  if (site?.type !== 'site') return null

  const boundary = site.polygon.points
  const bounds = siteBounds(boundary)
  const siteChildren = siteChildrenIn(site, context)
  const paint = resolveGroundCoverPaint(node, siteChildren, bounds)
  const height = resolveGroundCoverHeight(node, siteChildren, bounds)
  const nodes = collectSiteNodes(site, context.resolve)
  const obstacles = buildGrassObstacleField(
    site,
    nodes,
    createGrassObstacleTopology(bounds),
  )

  return {
    site,
    boundary,
    bounds,
    terrain: terrainFieldOf(site),
    paint,
    height,
    obstacles,
  }
}
