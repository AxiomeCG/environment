import { z } from 'zod'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/

export const GRASS_PAINT_FIELD_SIZES = [33, 65, 129, 257, 513] as const
export const DEFAULT_GRASS_PAINT_FIELD_SPACING = 0.05
export const DEFAULT_GRASS_PAINT_COLOR = '#202f1e'
export const CLEARED_GRASS_PAINT_COLOR = DEFAULT_GRASS_PAINT_COLOR
export const MAX_GRASS_PAINT_FIELD_SIDE = 513

export type SiteBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type RgbBytes = {
  r: number
  g: number
  b: number
}

export type GrassPaintSample = RgbBytes & { a: number }

export type GrassPaintField = {
  readonly origin: readonly [number, number]
  readonly spacing: number
  readonly cols: number
  readonly rows: number
  readonly values: Uint8Array
}

function encodeBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const remaining = bytes.length - index
    output += BASE64_ALPHABET.charAt(first >> 2)
    output += BASE64_ALPHABET.charAt(((first & 0x03) << 4) | (second >> 4))
    output +=
      remaining > 1
        ? BASE64_ALPHABET.charAt(((second & 0x0f) << 2) | (third >> 6))
        : '='
    output += remaining > 2 ? BASE64_ALPHABET.charAt(third & 0x3f) : '='
  }
  return output
}

function decodeCanonicalBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) return null

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  let outputIndex = 0

  for (let index = 0; index < text.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(text.charAt(index))
    const second = BASE64_ALPHABET.indexOf(text.charAt(index + 1))
    const third = text.charAt(index + 2) === '=' ? 0 : BASE64_ALPHABET.indexOf(text.charAt(index + 2))
    const fourth = text.charAt(index + 3) === '=' ? 0 : BASE64_ALPHABET.indexOf(text.charAt(index + 3))
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return null

    const bits = (first << 18) | (second << 12) | (third << 6) | fourth
    if (outputIndex < bytes.length) bytes[outputIndex++] = (bits >> 16) & 0xff
    if (outputIndex < bytes.length) bytes[outputIndex++] = (bits >> 8) & 0xff
    if (outputIndex < bytes.length) bytes[outputIndex++] = bits & 0xff
  }

  return encodeBase64(bytes) === text ? bytes : null
}

export function createRgbaPaintFieldDataSchema<const Type extends string>(type: Type) {
  return z
    .object({
      type: z.literal(type),
      origin: z.tuple([z.number().finite(), z.number().finite()]),
      spacing: z.number().finite().positive(),
      cols: z.number().int().positive().max(MAX_GRASS_PAINT_FIELD_SIDE),
      rows: z.number().int().positive().max(MAX_GRASS_PAINT_FIELD_SIDE),
      values: z.string(),
    })
    .strict()
    .superRefine((data, context) => {
      const bytes = decodeCanonicalBase64(data.values)
      if (!bytes) {
        context.addIssue({
          code: 'custom',
          message: 'values must be canonical base64',
          path: ['values'],
        })
        return
      }
      if (bytes.length !== data.cols * data.rows * 4) {
        context.addIssue({
          code: 'custom',
          message: 'values byte length must equal cols * rows * 4',
          path: ['values'],
        })
      }
    })
}

export const GrassPaintFieldData = createRgbaPaintFieldDataSchema('grass-paint-field')


export type GrassPaintFieldData = z.infer<typeof GrassPaintFieldData>
export type PersistedGrassPaintField = GrassPaintFieldData

export function siteBounds(boundary: ReadonlyArray<readonly [number, number]>): SiteBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, z] of boundary) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  return { minX, maxX, minZ, maxZ }
}

export function hexToRgb(hex: string): RgbBytes {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim())
  if (!match) throw new TypeError(`Invalid RGB hex color: ${hex}`)
  const digits = match[1] ?? ''
  const expanded =
    digits.length === 3
      ? `${digits.charAt(0)}${digits.charAt(0)}${digits.charAt(1)}${digits.charAt(1)}${digits.charAt(2)}${digits.charAt(2)}`
      : digits
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

export function rgbToHex(color: RgbBytes): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

export function createGrassPaintField(
  bounds: SiteBounds,
  colorHex: string,
  density = 1,
  preferredSpacing = DEFAULT_GRASS_PAINT_FIELD_SPACING,
): GrassPaintField {
  const extent = fieldExtent(normalizeBounds(bounds), preferredSpacing)
  const color = hexToRgb(colorHex)
  const alpha = Math.round(clamp01(density) * 255)
  const values = new Uint8Array(extent.cols * extent.rows * 4)

  for (let index = 0; index < values.length; index += 4) {
    values[index] = color.r
    values[index + 1] = color.g
    values[index + 2] = color.b
    values[index + 3] = alpha
  }

  return { ...extent, values }
}

export function encodeGrassPaintField(field: GrassPaintField): GrassPaintFieldData {
  assertGrassPaintField(field)
  return GrassPaintFieldData.parse({
    type: 'grass-paint-field',
    origin: [field.origin[0], field.origin[1]],
    spacing: field.spacing,
    cols: field.cols,
    rows: field.rows,
    values: encodeBase64(field.values),
  })
}

export function decodeGrassPaintField(data: unknown): GrassPaintField | null {
  const parsed = GrassPaintFieldData.safeParse(data)
  if (!parsed.success) return null
  const values = decodeCanonicalBase64(parsed.data.values)
  if (!values) return null

  return {
    origin: [parsed.data.origin[0], parsed.data.origin[1]],
    spacing: parsed.data.spacing,
    cols: parsed.data.cols,
    rows: parsed.data.rows,
    values,
  }
}

export function grassPaintFieldCoversBounds(field: GrassPaintField, bounds: SiteBounds): boolean {
  const normalized = normalizeBounds(bounds)
  const maxX = field.origin[0] + (field.cols - 1) * field.spacing
  const maxZ = field.origin[1] + (field.rows - 1) * field.spacing
  const tolerance = field.spacing * 1e-9
  return (
    field.origin[0] <= normalized.minX + tolerance &&
    field.origin[1] <= normalized.minZ + tolerance &&
    maxX >= normalized.maxX - tolerance &&
    maxZ >= normalized.maxZ - tolerance
  )
}

export function resolveGrassPaintField(
  data: unknown,
  bounds: SiteBounds,
  defaultColorHex: string,
): GrassPaintField {
  const normalizedBounds = normalizeBounds(bounds)
  const existing = decodeGrassPaintField(data)
  if (!existing) return createGrassPaintField(normalizedBounds, defaultColorHex, 1)

  const resolved = createGrassPaintField(
    normalizedBounds,
    defaultColorHex,
    1,
    Math.min(DEFAULT_GRASS_PAINT_FIELD_SPACING, existing.spacing),
  )
  const tolerance = Math.max(existing.spacing, resolved.spacing) * 1e-9
  if (
    grassPaintFieldCoversBounds(existing, normalizedBounds) &&
    existing.spacing <= resolved.spacing + tolerance
  ) {
    return existing
  }

  const oldBounds = boundsOfField(existing)
  for (let row = 0; row < resolved.rows; row += 1) {
    const z = resolved.origin[1] + row * resolved.spacing
    if (z < oldBounds.minZ - tolerance || z > oldBounds.maxZ + tolerance) continue
    for (let col = 0; col < resolved.cols; col += 1) {
      const x = resolved.origin[0] + col * resolved.spacing
      if (x < oldBounds.minX - tolerance || x > oldBounds.maxX + tolerance) continue
      const sample = paintAt(existing, x, z)
      const index = (row * resolved.cols + col) * 4
      resolved.values[index] = Math.round(sample.r * 255)
      resolved.values[index + 1] = Math.round(sample.g * 255)
      resolved.values[index + 2] = Math.round(sample.b * 255)
      resolved.values[index + 3] = Math.round(sample.a * 255)
    }
  }

  return resolved
}

export function paintAt(field: GrassPaintField, x: number, z: number): GrassPaintSample {
  const u = clamp((x - field.origin[0]) / field.spacing, 0, field.cols - 1)
  const v = clamp((z - field.origin[1]) / field.spacing, 0, field.rows - 1)
  const col0 = Math.floor(u)
  const row0 = Math.floor(v)
  const col1 = Math.min(field.cols - 1, col0 + 1)
  const row1 = Math.min(field.rows - 1, row0 + 1)
  const tx = u - col0
  const tz = v - row0

  return {
    r: bilinearChannel(field, col0, row0, col1, row1, tx, tz, 0) / 255,
    g: bilinearChannel(field, col0, row0, col1, row1, tx, tz, 1) / 255,
    b: bilinearChannel(field, col0, row0, col1, row1, tx, tz, 2) / 255,
    a: bilinearChannel(field, col0, row0, col1, row1, tx, tz, 3) / 255,
  }
}

function fieldExtent(bounds: SiteBounds, preferredSpacing: number): {
  origin: [number, number]
  spacing: number
  cols: number
  rows: number
} {
  let spacing = preferredSpacing
  let indices = latticeIndices(bounds, spacing)
  let wanted = Math.max(indices.maxCol - indices.minCol, indices.maxRow - indices.minRow) + 1
  let size = GRASS_PAINT_FIELD_SIZES.find((candidate) => candidate >= wanted)

  if (!size) {
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
    spacing = Math.max(preferredSpacing, span / (MAX_GRASS_PAINT_FIELD_SIDE - 2))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      indices = latticeIndices(bounds, spacing)
      wanted = Math.max(indices.maxCol - indices.minCol, indices.maxRow - indices.minRow) + 1
      if (wanted <= MAX_GRASS_PAINT_FIELD_SIDE) break
      spacing *= wanted / MAX_GRASS_PAINT_FIELD_SIDE + 1e-12
    }
    size = MAX_GRASS_PAINT_FIELD_SIDE
  }

  const originX = indices.minCol * spacing
  const originZ = indices.minRow * spacing
  if (!Number.isFinite(originX) || !Number.isFinite(originZ)) {
    throw new RangeError('Grass paint field bounds are outside the supported numeric range')
  }
  return { origin: [originX, originZ], spacing, cols: size, rows: size }
}

function latticeIndices(bounds: SiteBounds, spacing: number) {
  return {
    minCol: Math.floor(bounds.minX / spacing),
    maxCol: Math.ceil(bounds.maxX / spacing),
    minRow: Math.floor(bounds.minZ / spacing),
    maxRow: Math.ceil(bounds.maxZ / spacing),
  }
}

function normalizeBounds(bounds: SiteBounds): SiteBounds {
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)) {
    throw new TypeError('Grass paint field bounds must be finite')
  }
  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    maxX: Math.max(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  }
}

function boundsOfField(field: GrassPaintField): SiteBounds {
  return {
    minX: field.origin[0],
    maxX: field.origin[0] + (field.cols - 1) * field.spacing,
    minZ: field.origin[1],
    maxZ: field.origin[1] + (field.rows - 1) * field.spacing,
  }
}

function assertGrassPaintField(field: GrassPaintField): void {
  if (
    !Number.isFinite(field.origin[0]) ||
    !Number.isFinite(field.origin[1]) ||
    !Number.isFinite(field.spacing) ||
    field.spacing <= 0 ||
    !Number.isInteger(field.cols) ||
    !Number.isInteger(field.rows) ||
    field.cols < 1 ||
    field.rows < 1 ||
    field.cols > MAX_GRASS_PAINT_FIELD_SIDE ||
    field.rows > MAX_GRASS_PAINT_FIELD_SIDE ||
    !(field.values instanceof Uint8Array) ||
    field.values.length !== field.cols * field.rows * 4
  ) {
    throw new TypeError('Invalid grass paint field')
  }
}

function bilinearChannel(
  field: GrassPaintField,
  col0: number,
  row0: number,
  col1: number,
  row1: number,
  tx: number,
  tz: number,
  channel: number,
): number {
  const topLeft = field.values[(row0 * field.cols + col0) * 4 + channel] ?? 0
  const topRight = field.values[(row0 * field.cols + col1) * 4 + channel] ?? 0
  const bottomLeft = field.values[(row1 * field.cols + col0) * 4 + channel] ?? 0
  const bottomRight = field.values[(row1 * field.cols + col1) * 4 + channel] ?? 0
  const top = topLeft + (topRight - topLeft) * tx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
  return top + (bottom - top) * tz
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
