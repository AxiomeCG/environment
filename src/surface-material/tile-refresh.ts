import { GRASS_FIELD_KIND } from '../ground-cover/schema'
import { changedPaintTileTargets } from '../paint-tiles/compose'
import { resolvePaintedMap } from '../paint-tiles/layers'
import { SURFACE_MATERIAL_KIND } from './schema'
import { updateSurfacePaintTextures } from './texture'

type SceneNodes = Readonly<Record<string, { type?: unknown; parentId?: unknown } | undefined>>

/** What Surface tile changes ask of the drawing: Surfaces to redraw, Ground covers to rebuild. */
export type SurfaceTileRedraw = { surfaces: string[]; rebuildGroundCoverOf: string[] }

/**
 * After a scene change, every texture drawn from a changed Surface's paint (its own, and each
 * Ground cover's underlay of it) is brought to the map its tiles now compose, in place. The
 * Surfaces still redraw; a site whose textures could not be updated in place (none yet, or a new
 * lattice) also has its Ground cover rebuilt, so the grass shows the new surface beneath it.
 */
export function surfaceTileChangesRedraw(
  current: SceneNodes,
  previous: SceneNodes,
  changedIds: Iterable<string>,
): SurfaceTileRedraw {
  const surfaces = [...changedPaintTileTargets(current, previous, changedIds)].filter(
    (id) => current[id]?.type === SURFACE_MATERIAL_KIND,
  )
  const rebuildGroundCoverOf: string[] = []
  for (const id of surfaces) {
    const siteId = String(current[id]?.parentId)
    const field = resolvePaintedMap(current, { siteId, targetId: id, map: 'paintMap' })
    if (!(field && updateSurfacePaintTextures(id, field))) rebuildGroundCoverOf.push(siteId)
  }
  return { surfaces, rebuildGroundCoverOf }
}

/** The Ground covers of these sites. */
export function groundCoversOf(nodes: SceneNodes, siteIds: readonly string[]): string[] {
  if (siteIds.length === 0) return []
  return Object.entries(nodes)
    .filter(
      ([, node]) => node?.type === GRASS_FIELD_KIND && siteIds.includes(String(node.parentId)),
    )
    .map(([id]) => id)
}
