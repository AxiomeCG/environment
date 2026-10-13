import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import {
  decodeCanonicalBase64,
  encodeBase64,
  type GrassPaintField,
} from '../ground-cover/paint-field'
import { decodePixelRuns, encodePixelRuns } from './runs'

export const PAINT_TILE_KIND = 'environment:paint-tile'

/** Cells per side of a tile: one tile change, old and new, stays well under a 64 KiB operation. */
export const PAINT_TILE_SIDE = 64

/** The maps a tile can override: a Ground cover's `paintMap` or `heightMap`, a Surface's `paintMap`. */
export const PAINT_TILE_MAPS = ['paintMap', 'heightMap'] as const
export type PaintTileMap = (typeof PAINT_TILE_MAPS)[number]

/** One tile's cells: a block of a paint lattice, its RGBA pixels run-length coded, in base64. */
export const PaintTileData = z
  .object({
    type: z.literal('paint-tile'),
    origin: z.tuple([z.number().finite(), z.number().finite()]),
    spacing: z.number().finite().positive(),
    cols: z.number().int().positive().max(PAINT_TILE_SIDE),
    rows: z.number().int().positive().max(PAINT_TILE_SIDE),
    runs: z.string(),
  })
  .strict()
  .superRefine((data, context) => {
    if (!decodePaintTileValues(data)) {
      context.addIssue({
        code: 'custom',
        message: 'runs must be canonical base64 of run-length coded cols * rows pixels',
        path: ['runs'],
      })
    }
  })

export type PaintTileData = z.infer<typeof PaintTileData>

/**
 * Part of a Ground cover's or Surface's paint, kept as its own node so a stroke sends only the
 * tiles it touched. A child of the site (`targetId` names the painted node), tiles override the
 * target's own map cell by cell; they never overlap one another.
 */
export const PaintTileNode = BaseNode.extend({
  id: objectId('paint-tile'),
  type: nodeType(PAINT_TILE_KIND),
  targetId: z.string().min(1),
  map: z.enum(PAINT_TILE_MAPS),
  tile: PaintTileData,
})

export type PaintTileNode = z.infer<typeof PaintTileNode>

export function decodePaintTileValues(
  data: Pick<PaintTileData, 'cols' | 'rows' | 'runs'>,
): Uint8Array | null {
  const runs = decodeCanonicalBase64(data.runs)
  return runs ? decodePixelRuns(runs, data.cols * data.rows) : null
}

/** The tile as a field of its own, for sampling. */
export function decodePaintTile(data: PaintTileData): GrassPaintField | null {
  const values = decodePaintTileValues(data)
  if (!values) return null
  return {
    origin: [data.origin[0], data.origin[1]],
    spacing: data.spacing,
    cols: data.cols,
    rows: data.rows,
    values,
  }
}

/** A rectangle of lattice cells, by first column and row and size. */
export type LatticeBlock = { col: number; row: number; cols: number; rows: number }

/** The cells of `field` inside `block`, as a tile. */
export function encodePaintTile(field: GrassPaintField, block: LatticeBlock): PaintTileData {
  const values = new Uint8Array(block.cols * block.rows * 4)
  for (let row = 0; row < block.rows; row += 1) {
    const start = ((block.row + row) * field.cols + block.col) * 4
    values.set(field.values.subarray(start, start + block.cols * 4), row * block.cols * 4)
  }
  return {
    type: 'paint-tile',
    origin: [
      field.origin[0] + block.col * field.spacing,
      field.origin[1] + block.row * field.spacing,
    ],
    spacing: field.spacing,
    cols: block.cols,
    rows: block.rows,
    runs: encodeBase64(encodePixelRuns(values)),
  }
}
