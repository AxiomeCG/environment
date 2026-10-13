import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import type { GrassPaintField } from '../ground-cover/paint-field'
import { sharesLattice } from './compose'
import {
  encodePaintTile,
  PAINT_TILE_SIDE,
  PaintTileNode,
  type LatticeBlock,
  type PaintTileData,
  type PaintTileMap,
} from './schema'

/** Which map of which painted node a write goes to, and the site its tiles hang under. */
export type PaintTileTarget = { siteId: string; targetId: string; map: PaintTileMap }

/** Tile changes as every scene writer takes them: one atomic commit, one undo step. */
export type PaintTileChanges = {
  create?: { node: AnyNode; parentId: AnyNodeId }[]
  update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete?: AnyNodeId[]
}

/** A block of the lattice, keyed by its place on the world grid of the lattice's spacing. */
type TileBlock = LatticeBlock & { key: string }

/**
 * One id per block of a map, so two writers of the same block meet on one node. Blocks are
 * aligned on the world grid of the spacing, so they stay put when the lot's bounds move.
 */
export function paintTileId(target: Omit<PaintTileTarget, 'siteId'>, blockCol: number, blockRow: number): string {
  return `paint-tile_${target.targetId}.${target.map}.${blockCol}.${blockRow}`
}

function worldCellIndex(coordinate: number, spacing: number): number {
  return Math.round(coordinate / spacing)
}

function blockSpan(firstWorldCell: number, cells: number, blockIndex: number) {
  const start = Math.max(0, blockIndex * PAINT_TILE_SIDE - firstWorldCell)
  const end = Math.min(cells - 1, (blockIndex + 1) * PAINT_TILE_SIDE - 1 - firstWorldCell)
  return { start, length: end - start + 1 }
}

function latticeBlocks(field: GrassPaintField, target: PaintTileTarget): TileBlock[] {
  const firstCol = worldCellIndex(field.origin[0], field.spacing)
  const firstRow = worldCellIndex(field.origin[1], field.spacing)
  const blocks: TileBlock[] = []
  const lastBlockRow = Math.floor((firstRow + field.rows - 1) / PAINT_TILE_SIDE)
  const lastBlockCol = Math.floor((firstCol + field.cols - 1) / PAINT_TILE_SIDE)
  for (let blockRow = Math.floor(firstRow / PAINT_TILE_SIDE); blockRow <= lastBlockRow; blockRow += 1) {
    const rows = blockSpan(firstRow, field.rows, blockRow)
    for (let blockCol = Math.floor(firstCol / PAINT_TILE_SIDE); blockCol <= lastBlockCol; blockCol += 1) {
      const cols = blockSpan(firstCol, field.cols, blockCol)
      blocks.push({
        key: paintTileId(target, blockCol, blockRow),
        col: cols.start,
        row: rows.start,
        cols: cols.length,
        rows: rows.length,
      })
    }
  }
  return blocks
}

function blockChanged(before: GrassPaintField, after: GrassPaintField, block: LatticeBlock): boolean {
  for (let row = block.row; row < block.row + block.rows; row += 1) {
    const start = (row * after.cols + block.col) * 4
    for (let index = start; index < start + block.cols * 4; index += 1) {
      if (before.values[index] !== after.values[index]) return true
    }
  }
  return false
}

/** Whether a tile from another lattice covers any cell of the block (out to half its spacing). */
function blockOverlapsTile(field: GrassPaintField, block: LatticeBlock, tile: PaintTileData): boolean {
  const reach = tile.spacing / 2
  const blockMinX = field.origin[0] + block.col * field.spacing
  const blockMinZ = field.origin[1] + block.row * field.spacing
  const blockMaxX = blockMinX + (block.cols - 1) * field.spacing
  const blockMaxZ = blockMinZ + (block.rows - 1) * field.spacing
  return (
    blockMaxX >= tile.origin[0] - reach &&
    blockMinX <= tile.origin[0] + (tile.cols - 1) * tile.spacing + reach &&
    blockMaxZ >= tile.origin[1] - reach &&
    blockMinZ <= tile.origin[1] + (tile.rows - 1) * tile.spacing + reach
  )
}

function assertSameLattice(before: GrassPaintField, after: GrassPaintField): void {
  if (
    before.cols !== after.cols ||
    before.rows !== after.rows ||
    before.spacing !== after.spacing ||
    before.origin[0] !== after.origin[0] ||
    before.origin[1] !== after.origin[1]
  ) {
    throw new RangeError('A paint write compares two fields on one lattice')
  }
}

/**
 * The tile writes that take a map from `before` to `after`: each block that changed is written
 * whole as one tile (created or updated), and nothing else is sent. Tiles left on another lattice
 * by a resized lot are folded into the blocks they cover and removed with the first write, so no
 * two tiles ever overlap.
 */
export function planPaintTileChanges(
  target: PaintTileTarget,
  existing: readonly PaintTileNode[],
  before: GrassPaintField,
  after: GrassPaintField,
): PaintTileChanges {
  assertSameLattice(before, after)
  const blocks = latticeBlocks(after, target)
  const changed = new Set(
    blocks.filter((block) => blockChanged(before, after, block)).map((block) => block.key),
  )
  if (changed.size === 0) return {}
  const stale = existing.filter((tile) => !sharesLattice(tile.tile, after))
  const written = blocks.filter(
    (block) =>
      changed.has(block.key) || stale.some((tile) => blockOverlapsTile(after, block, tile.tile)),
  )
  const existingById = new Map(existing.map((tile) => [tile.id, tile]))
  const changes = writeBlocks(target, written, existingById, after)
  const writtenIds = new Set(written.map((block) => block.key))
  const removed = stale.filter((tile) => !writtenIds.has(tile.id)).map((tile) => tile.id as AnyNodeId)
  if (removed.length > 0) changes.delete = removed
  return changes
}

function writeBlocks(
  target: PaintTileTarget,
  blocks: readonly TileBlock[],
  existingById: ReadonlyMap<string, PaintTileNode>,
  field: GrassPaintField,
): PaintTileChanges {
  const create: NonNullable<PaintTileChanges['create']> = []
  const update: NonNullable<PaintTileChanges['update']> = []
  for (const block of blocks) {
    const tile = encodePaintTile(field, block)
    const current = existingById.get(block.key)
    if (!current) {
      const node = PaintTileNode.parse({
        id: block.key,
        parentId: target.siteId,
        targetId: target.targetId,
        map: target.map,
        tile,
      })
      create.push({ node: node as unknown as AnyNode, parentId: target.siteId as AnyNodeId })
    } else if (JSON.stringify(current.tile) !== JSON.stringify(tile)) {
      update.push({ id: current.id as AnyNodeId, data: { tile } as unknown as Partial<AnyNode> })
    }
  }
  return {
    ...(create.length > 0 ? { create } : {}),
    ...(update.length > 0 ? { update } : {}),
  }
}

/** Several maps' tile writes as one commit. */
export function mergePaintTileChanges(...parts: readonly PaintTileChanges[]): PaintTileChanges {
  const create = parts.flatMap((part) => part.create ?? [])
  const update = parts.flatMap((part) => part.update ?? [])
  const remove = parts.flatMap((part) => part.delete ?? [])
  return {
    ...(create.length > 0 ? { create } : {}),
    ...(update.length > 0 ? { update } : {}),
    ...(remove.length > 0 ? { delete: remove } : {}),
  }
}
