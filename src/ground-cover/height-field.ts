import {
  createGrassPaintField,
  paintAt,
  resolveGrassPaintField,
  rgbToHex,
  type GrassPaintField,
  type SiteBounds,
} from './paint-field'

export const NEUTRAL_GRASS_HEIGHT_COLOR = '#808080'

export function createGrassHeightField(bounds: SiteBounds): GrassPaintField {
  return createGrassPaintField(bounds, NEUTRAL_GRASS_HEIGHT_COLOR, 1)
}

export function resolveGrassHeightField(
  data: unknown,
  bounds: SiteBounds,
): GrassPaintField {
  return resolveGrassPaintField(data, bounds, NEUTRAL_GRASS_HEIGHT_COLOR)
}

export function localGrassHeightScaleAt(
  field: GrassPaintField,
  x: number,
  z: number,
): number {
  return decodeLocalHeightScale(paintAt(field, x, z).r)
}

export function grassHeightTargetColor(
  direction: 'raise' | 'lower',
  amountPercent: number,
): string {
  const amount = clamp(amountPercent / 100, 0, 1)
  const scale = direction === 'raise' ? 1 + amount : 1 - amount
  const channel = encodeLocalHeightScale(scale)
  return rgbToHex({ r: channel, g: channel, b: channel })
}

export function decodeLocalHeightScale(channel: number): number {
  const byte = clamp(channel, 0, 1) * 255
  return byte < 128 ? byte / 128 : 1 + (byte - 128) / 127
}

function encodeLocalHeightScale(scale: number): number {
  const normalized = clamp(scale, 0, 2)
  return Math.round(
    normalized < 1 ? normalized * 128 : 128 + (normalized - 1) * 127,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
