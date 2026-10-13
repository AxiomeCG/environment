import type { AnyNodeId } from '@pascal-app/core'
import { paintAt, type GrassPaintField } from '../ground-cover/paint-field'
import {
  decodePaintTile,
  decodePaintTileValues,
  PAINT_TILE_KIND,
  type PaintTileMap,
  type PaintTileNode,
} from './schema'

function isPaintTile(node: unknown): node is PaintTileNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === PAINT_TILE_KIND
  )
}

/** The tiles of one map of one painted node among `candidates` (a site's children, or all nodes). */
export function paintTilesOf(
  candidates: Iterable<unknown>,
  targetId: string,
  map: PaintTileMap,
): PaintTileNode[] {
  const tiles: PaintTileNode[] = []
  for (const candidate of candidates) {
    if (isPaintTile(candidate) && candidate.targetId === targetId && candidate.map === map) {
      tiles.push(candidate)
    }
  }
  return tiles.sort((a, b) => a.id.localeCompare(b.id))
}

/** Every tile id of a painted node, whatever map: what its renderers depend on. */
export function paintTileIdsOf(candidates: Iterable<unknown>, targetId: string): string[] {
  const ids: string[] = []
  for (const candidate of candidates) {
    if (isPaintTile(candidate) && candidate.targetId === targetId) ids.push(candidate.id)
  }
  return ids.sort()
}

export function sharesLattice(tile: Pick<GrassPaintField, 'spacing'>, field: GrassPaintField): boolean {
  return Math.abs(tile.spacing - field.spacing) <= field.spacing * 1e-9
}

/** A tile on the field's own lattice: its pixels replace the cells they sit on. */
function blitTile(field: GrassPaintField, tile: PaintTileNode): void {
  const values = decodePaintTileValues(tile.tile)
  if (!values) return
  const firstCol = Math.round((tile.tile.origin[0] - field.origin[0]) / field.spacing)
  const firstRow = Math.round((tile.tile.origin[1] - field.origin[1]) / field.spacing)
  for (let row = 0; row < tile.tile.rows; row += 1) {
    const fieldRow = firstRow + row
    if (fieldRow < 0 || fieldRow >= field.rows) continue
    for (let col = 0; col < tile.tile.cols; col += 1) {
      const fieldCol = firstCol + col
      if (fieldCol < 0 || fieldCol >= field.cols) continue
      const source = (row * tile.tile.cols + col) * 4
      field.values.set(values.subarray(source, source + 4), (fieldRow * field.cols + fieldCol) * 4)
    }
  }
}

/**
 * A tile painted on a lattice the site no longer has (the lot was resized): resampled onto the
 * cells it covers, out to half its own spacing beyond its outer cells.
 */
function resampleTile(field: GrassPaintField, tile: PaintTileNode): void {
  const source = decodePaintTile(tile.tile)
  if (!source) return
  const reach = source.spacing / 2
  const minX = source.origin[0] - reach
  const minZ = source.origin[1] - reach
  const maxX = source.origin[0] + (source.cols - 1) * source.spacing + reach
  const maxZ = source.origin[1] + (source.rows - 1) * source.spacing + reach
  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    if (z < minZ || z > maxZ) continue
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      if (x < minX || x > maxX) continue
      const sample = paintAt(source, x, z)
      const offset = (row * field.cols + col) * 4
      field.values[offset] = Math.round(sample.r * 255)
      field.values[offset + 1] = Math.round(sample.g * 255)
      field.values[offset + 2] = Math.round(sample.b * 255)
      field.values[offset + 3] = Math.round(sample.a * 255)
    }
  }
}

/** `base` with the tiles laid over it, as a new field: what the renderer and the brush see. */
export function composePaintTiles(
  base: GrassPaintField,
  tiles: readonly PaintTileNode[],
): GrassPaintField {
  if (tiles.length === 0) return base
  const field: GrassPaintField = { ...base, values: new Uint8Array(base.values) }
  for (const tile of tiles) if (!sharesLattice(tile.tile, field)) resampleTile(field, tile)
  for (const tile of tiles) if (sharesLattice(tile.tile, field)) blitTile(field, tile)
  return field
}

/** The painted nodes whose tiles were created, changed or removed between two scenes. */
export function changedPaintTileTargets(
  current: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
  changedIds: Iterable<string>,
): Set<string> {
  const targets = new Set<string>()
  for (const id of changedIds) {
    for (const node of [current[id], previous[id]]) {
      if (isPaintTile(node)) targets.add(node.targetId)
    }
  }
  return targets
}

/** A painted node's plan drawing depends on its tiles: a tile commit redraws it. */
export function paintTileFloorplanDependencies(
  node: { id: string },
  nodes?: Readonly<Record<string, unknown>>,
): AnyNodeId[] {
  return nodes ? (paintTileIdsOf(Object.values(nodes), node.id) as AnyNodeId[]) : []
}
