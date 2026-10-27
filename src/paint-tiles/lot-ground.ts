import { pointInPolygon2D } from '@pascal-app/core'
import { encodeLocalHeightScale } from '../ground-cover/height-field'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  hexToRgb,
  type GrassPaintField,
  type RgbBytes,
} from '../ground-cover/paint-field'
import { blendPaintCell, type PaintCellBlend } from '../ground-cover/paint-stroke'
import {
  SURFACE_MATERIAL_PAINT_COLOR,
  type SurfaceMaterialId,
} from '../surface-material/material-types'
import type { LotGround, LotGroundKind } from './lot-ground-schema'

/** The surface each ground kind lays; none lays no surface. */
export const GROUND_SURFACE: Record<LotGroundKind, SurfaceMaterialId | null> = {
  grass: 'flowered-grass',
  earth: 'desert-ground',
  path: 'road-path',
  paving: 'paved-road',
  none: null,
}

/** What the grass brush would do to grass coverage: paint it (with the tint) or erase it. */
export function grassPaintBlend(ground: LotGroundKind, tint: RgbBytes | null): PaintCellBlend {
  return {
    mode: ground === 'grass' ? 'paint' : 'erase',
    color: tint ?? hexToRgb(DEFAULT_GRASS_PAINT_COLOR),
    targetDensity: 1,
    premultiplyColorByDensity: false,
  }
}

/** What the surface brush would do: paint the ground's material, or erase every channel. */
export function surfacePaintBlend(ground: LotGroundKind): PaintCellBlend {
  const material = GROUND_SURFACE[ground]
  return {
    mode: material ? 'paint' : 'erase',
    color: material ? SURFACE_MATERIAL_PAINT_COLOR[material] : { r: 0, g: 0, b: 0 },
    targetDensity: 1,
    premultiplyColorByDensity: true,
  }
}

export function heightPaintBlend(grassHeight: number): PaintCellBlend {
  const channel = encodeLocalHeightScale(grassHeight)
  return {
    mode: 'paint',
    color: { r: channel, g: channel, b: channel },
    targetDensity: 1,
    premultiplyColorByDensity: false,
  }
}

/** The three maps a lot's ground covers. */
export type LotGroundLayer = 'paintMap' | 'heightMap' | 'surface'

/** What the lot's ground does to one map, or null where it leaves the map as it is. */
function blendFor(lotGround: LotGround, layer: LotGroundLayer): PaintCellBlend | null {
  if (layer === 'surface') return surfacePaintBlend(lotGround.ground)
  if (layer === 'paintMap') {
    return grassPaintBlend(lotGround.ground, lotGround.tint ? hexToRgb(lotGround.tint) : null)
  }
  return lotGround.ground === 'grass' && lotGround.grassHeight !== undefined
    ? heightPaintBlend(lotGround.grassHeight)
    : null
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }

/** The reach of a lot's edge, as `lay_ground` reads a cell on it as inside. */
const EDGE_EPSILON = 1e-9

/** The lot's box when it is an axis-aligned rectangle (the usual lot), else null. */
function rectangleOf(lot: LotGround['lot']): Rect | null {
  if (lot.length !== 4) return null
  const xs = new Set(lot.map(([x]) => x))
  const zs = new Set(lot.map(([, z]) => z))
  if (xs.size !== 2 || zs.size !== 2) return null
  for (let index = 0; index < 4; index += 1) {
    const from = lot[index]
    const to = lot[(index + 1) % 4]
    if (!from || !to || (from[0] !== to[0] && from[1] !== to[1])) return null
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

/**
 * Paint `lotGround` over every cell of `field` that lies outside the lot it was laid over, in
 * place: land the lot has grown into, and the cells at the old edge the lot's own paint stopped
 * short of. Returns how many cells it wrote.
 */
export function paintBeyondLot(
  field: GrassPaintField,
  lotGround: LotGround,
  layer: LotGroundLayer,
): number {
  const blend = blendFor(lotGround, layer)
  if (!blend) return 0
  const lot = lotGround.lot as [number, number][]
  const rect = rectangleOf(lotGround.lot)
  let written = 0
  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      const inside = rect
        ? x >= rect.minX - EDGE_EPSILON &&
          x <= rect.maxX + EDGE_EPSILON &&
          z >= rect.minZ - EDGE_EPSILON &&
          z <= rect.maxZ + EDGE_EPSILON
        : pointInPolygon2D([x, z], lot)
      if (inside) continue
      blendPaintCell(field.values, field.values, (row * field.cols + col) * 4, 1, blend)
      written += 1
    }
  }
  return written
}

/**
 * `field` with the lot's ground painted over the land outside the lot it was laid over: the base
 * every map resolves from, under its paint tiles. `field` itself when there is no such ground or
 * no such land.
 */
export function withLotGround(
  field: GrassPaintField,
  lotGround: LotGround | undefined,
  layer: LotGroundLayer,
): GrassPaintField {
  if (!lotGround || !blendFor(lotGround, layer)) return field
  const covered: GrassPaintField = { ...field, values: new Uint8Array(field.values) }
  return paintBeyondLot(covered, lotGround, layer) > 0 ? covered : field
}

export function lotGroundsEqual(first: LotGround | undefined, second: LotGround | undefined): boolean {
  return first === second || (!!first && !!second && JSON.stringify(first) === JSON.stringify(second))
}
