import { SiteNode, type AnyNode } from '@pascal-app/core'
import { expect, test } from 'bun:test'
import { siteBounds, uniformPaintField } from '../ground-cover/paint-field'
import { resolveSurfacePaint } from '../paint-tiles/layers'
import { planPaintTileChanges, type PaintTileChanges } from '../paint-tiles/plan'
import { paintTilesOf } from '../paint-tiles/compose'
import { createSurfaceMaterialNode } from './create-node'
import { SURFACE_MATERIAL_PAINT_COLOR } from './material-types'
import { createSurfacePaintTexture, disposeSurfacePaintTexture } from './texture'
import { surfaceTileChangesRedraw } from './tile-refresh'

type Nodes = Record<string, AnyNode>

const lot = [
  [0, 0],
  [16, 0],
  [16, 16],
  [0, 16],
] as Array<[number, number]>

function applyTiles(nodes: Nodes, changes: PaintTileChanges): Nodes {
  const next: Nodes = { ...nodes }
  for (const { node } of changes.create ?? []) next[String(node.id)] = node
  for (const { id, data } of changes.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes.delete ?? []) delete next[id]
  return next
}

test('surface tile changes reach every texture drawn from the Surface, the grass underlay too', () => {
  // Sol's round-2 probe: Surface tiles go from grass to path while Grass shows its own copy.
  const site = SiteNode.parse({ id: 'site_lot', polygon: { type: 'polygon', points: lot } })
  const surface = createSurfaceMaterialNode(site)
  const target = { siteId: site.id, targetId: surface.id, map: 'paintMap' as const }
  const bounds = siteBounds(lot)
  const empty = resolveSurfacePaint(surface, [], bounds)
  let nodes: Nodes = { [site.id]: site as AnyNode, [surface.id]: surface as unknown as AnyNode }
  const grassy = uniformPaintField(empty, SURFACE_MATERIAL_PAINT_COLOR['flowered-grass'], 255)
  nodes = applyTiles(nodes, planPaintTileChanges(target, [], empty, grassy))
  const underlay = createSurfacePaintTexture(surface.id, grassy)

  const pathy = uniformPaintField(empty, SURFACE_MATERIAL_PAINT_COLOR['road-path'], 255)
  const tiles = paintTilesOf(Object.values(nodes), surface.id, 'paintMap')
  const previous = nodes
  const changes = planPaintTileChanges(target, tiles, grassy, pathy)
  nodes = applyTiles(nodes, changes)
  const changedIds = (changes.update ?? []).map((entry) => entry.id)

  const redraw = surfaceTileChangesRedraw(nodes, previous, changedIds)
  expect(redraw).toEqual({ surfaces: [surface.id], rebuildGroundCoverOf: [] })
  expect(underlay.image.data).toEqual(pathy.values)
  disposeSurfacePaintTexture(surface.id, underlay)
})
