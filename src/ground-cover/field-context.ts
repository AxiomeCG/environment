import {
  terrainFieldOf,
  type GeometryContext,
  type TerrainField,
} from '@pascal-app/core'
import { resolveGrassHeightField } from './height-field'
import { buildGrassObstacleField, collectSiteNodes } from './obstacle-adapter'
import {
  createGrassObstacleTopology,
  type GrassObstacleField,
} from './obstacle-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  resolveGrassPaintField,
  siteBounds,
  type GrassPaintField,
  type SiteBounds,
} from './paint-field'
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
  const paint = resolveGrassPaintField(
    node.paintMap,
    bounds,
    DEFAULT_GRASS_PAINT_COLOR,
  )
  const height = resolveGrassHeightField(node.heightMap, bounds)
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
