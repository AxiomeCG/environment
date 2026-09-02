import { type BrushSettings, pointInPolygon2D, weightAt } from '@pascal-app/core'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  hexToRgb,
  rgbToHex,
  type GrassPaintField,
  type RgbBytes,
} from './paint-field'
import { isGrassAllowedAt, type GrassObstacleField } from './obstacle-field'

const DAB_SPACING_FRACTION = 0.25

export type PaintMode = 'paint' | 'erase' | 'smooth'

export type PaintStrokeSettings = BrushSettings & {
  mode: PaintMode
  targetDensity: number
  premultiplyColorByDensity: boolean
  clipToBoundary: boolean
  color: string
  noiseAmount: number
  noiseScale: number
  seed: number
}

export const DEFAULT_PAINT_STROKE_SETTINGS: PaintStrokeSettings = {
  radius: 2,
  strength: 1,
  falloff: 0.1,
  shape: 'round',
  mode: 'paint',
  targetDensity: 1,
  premultiplyColorByDensity: false,
  clipToBoundary: true,
  color: DEFAULT_GRASS_PAINT_COLOR,
  noiseAmount: 0,
  noiseScale: 1,
  seed: 1,
}

export type PaintStroke = {
  readonly settings: PaintStrokeSettings
  readonly boundary: Array<[number, number]>
  readonly snapshot: GrassPaintField
  readonly obstacles: GrassObstacleField | null
  readonly result: GrassPaintField
  readonly mask: Map<number, number>
  smoothed: Uint8Array | null
  lastX: number | null
  lastZ: number | null
}

export function beginPaintStroke(options: {
  field: GrassPaintField
  boundary: ReadonlyArray<readonly [number, number]>
  obstacleField?: GrassObstacleField | null
  settings?: Partial<PaintStrokeSettings>
}): PaintStroke {
  assertField(options.field)
  const settings = normalizeSettings(options.settings)
  const snapshot: GrassPaintField = {
    origin: [options.field.origin[0], options.field.origin[1]],
    spacing: options.field.spacing,
    cols: options.field.cols,
    rows: options.field.rows,
    values: new Uint8Array(options.field.values),
  }
  const result: GrassPaintField = { ...snapshot, values: new Uint8Array(snapshot.values) }

  return {
    settings,
    boundary: options.boundary.map(([x, z]) => [x, z]),
    snapshot,
    obstacles: options.obstacleField ?? null,
    result,
    mask: new Map(),
    smoothed: null,
    lastX: null,
    lastZ: null,
  }
}

export function advancePaintStroke(
  stroke: PaintStroke,
  x: number,
  z: number,
): GrassPaintField | null {
  const dabs = dabPositions(stroke, x, z)
  if (dabs.length === 0) return null

  const field = stroke.snapshot
  const color = hexToRgb(stroke.settings.color)
  let changed = false

  for (const [dabX, dabZ] of dabs) {
    const range = footprint(field, dabX, dabZ, stroke.settings.radius)
    if (!range) continue

    for (let row = range.row0; row <= range.row1; row += 1) {
      const sampleZ = field.origin[1] + row * field.spacing
      for (let col = range.col0; col <= range.col1; col += 1) {
        const sampleX = field.origin[0] + col * field.spacing
        if (
          stroke.settings.clipToBoundary &&
          !pointInPolygon2D([sampleX, sampleZ], stroke.boundary, { includeBoundary: true })
        ) {
          continue
        }
        if (stroke.obstacles && !isGrassAllowedAt(stroke.obstacles, sampleX, sampleZ)) {
          continue
        }

        const brushWeight = weightAt(stroke.settings, sampleX - dabX, sampleZ - dabZ)
        if (brushWeight <= 0) continue
        const coverage = modulatedCoverage(stroke.settings, brushWeight, sampleX, sampleZ)
        const sampleIndex = row * field.cols + col
        const previous = stroke.mask.get(sampleIndex) ?? 0
        if (coverage <= previous) continue

        stroke.mask.set(sampleIndex, coverage)
        resolveSample(stroke, sampleIndex, color)
        changed = true
      }
    }
  }

  return changed ? stroke.result : null
}

export function detachPaintStrokeAnchor(stroke: PaintStroke): void {
  stroke.lastX = null
  stroke.lastZ = null
}

export function currentPaintField(stroke: PaintStroke): GrassPaintField {
  return stroke.result
}

export function maxPaintCoverage(stroke: PaintStroke): number {
  let maximum = 0
  for (const coverage of stroke.mask.values()) {
    if (coverage > maximum) maximum = coverage
  }
  return maximum
}

function resolveSample(stroke: PaintStroke, sampleIndex: number, color: RgbBytes): void {
  const offset = sampleIndex * 4
  const values = stroke.snapshot.values
  const result = stroke.result.values
  const coverage = stroke.mask.get(sampleIndex) ?? 0
  const amount = clamp01(coverage * stroke.settings.strength)
  const baseR = values[offset] ?? 0
  const baseG = values[offset + 1] ?? 0
  const baseB = values[offset + 2] ?? 0
  const baseA = values[offset + 3] ?? 0

  if (stroke.settings.mode === 'erase') {
    const target = stroke.settings.premultiplyColorByDensity ? 0 : baseR
    result[offset] = blendByte(baseR, target, amount)
    result[offset + 1] = blendByte(
      baseG,
      stroke.settings.premultiplyColorByDensity ? 0 : baseG,
      amount,
    )
    result[offset + 2] = blendByte(
      baseB,
      stroke.settings.premultiplyColorByDensity ? 0 : baseB,
      amount,
    )
    result[offset + 3] = blendByte(baseA, 0, amount)
    return
  }

  if (stroke.settings.mode === 'smooth') {
    const smoothed = smoothedSnapshot(stroke)
    result[offset] = blendByte(baseR, smoothed[offset] ?? baseR, amount)
    result[offset + 1] = blendByte(baseG, smoothed[offset + 1] ?? baseG, amount)
    result[offset + 2] = blendByte(baseB, smoothed[offset + 2] ?? baseB, amount)
    result[offset + 3] = blendByte(baseA, smoothed[offset + 3] ?? baseA, amount)
    return
  }

  if (stroke.settings.premultiplyColorByDensity) {
    const targetAlpha = Math.round(stroke.settings.targetDensity * 255)
    result[offset] = blendByte(baseR, Math.round((color.r * targetAlpha) / 255), amount)
    result[offset + 1] = blendByte(baseG, Math.round((color.g * targetAlpha) / 255), amount)
    result[offset + 2] = blendByte(baseB, Math.round((color.b * targetAlpha) / 255), amount)
    result[offset + 3] = blendByte(baseA, targetAlpha, amount)
    return
  }

  const colorAmount = lerp(amount, Math.sqrt(amount), 1 - baseA / 255)
  result[offset] = blendByte(baseR, color.r, colorAmount)
  result[offset + 1] = blendByte(baseG, color.g, colorAmount)
  result[offset + 2] = blendByte(baseB, color.b, colorAmount)
  result[offset + 3] = blendByte(baseA, Math.round(stroke.settings.targetDensity * 255), amount)
}

function smoothedSnapshot(stroke: PaintStroke): Uint8Array {
  if (stroke.smoothed) return stroke.smoothed
  const field = stroke.snapshot
  const smoothed = new Uint8Array(field.values.length)

  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const outputOffset = (row * field.cols + col) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        let sum = 0
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          const sourceRow = clamp(row + rowOffset, 0, field.rows - 1)
          for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
            const sourceCol = clamp(col + colOffset, 0, field.cols - 1)
            sum += field.values[(sourceRow * field.cols + sourceCol) * 4 + channel] ?? 0
          }
        }
        smoothed[outputOffset + channel] = Math.round(sum / 9)
      }
    }
  }

  stroke.smoothed = smoothed
  return smoothed
}

function dabPositions(stroke: PaintStroke, x: number, z: number): Array<[number, number]> {
  if (stroke.lastX === null || stroke.lastZ === null) {
    stroke.lastX = x
    stroke.lastZ = z
    return [[x, z]]
  }

  const spacing = stroke.settings.radius * DAB_SPACING_FRACTION
  const dx = x - stroke.lastX
  const dz = z - stroke.lastZ
  const distance = Math.hypot(dx, dz)
  if (distance < spacing) return []

  const steps = Math.floor(distance / spacing)
  const dabs: Array<[number, number]> = []
  for (let step = 1; step <= steps; step += 1) {
    const t = (step * spacing) / distance
    dabs.push([stroke.lastX + dx * t, stroke.lastZ + dz * t])
  }
  const last = dabs[dabs.length - 1]
  if (last) {
    stroke.lastX = last[0]
    stroke.lastZ = last[1]
  }
  return dabs
}

function footprint(
  field: GrassPaintField,
  x: number,
  z: number,
  radius: number,
): { col0: number; row0: number; col1: number; row1: number } | null {
  const col0 = Math.max(0, Math.ceil((x - radius - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.ceil((z - radius - field.origin[1]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.floor((x + radius - field.origin[0]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.floor((z + radius - field.origin[1]) / field.spacing))
  if (col1 < col0 || row1 < row0) return null
  return { col0, row0, col1, row1 }
}

function modulatedCoverage(
  settings: PaintStrokeSettings,
  brushWeight: number,
  x: number,
  z: number,
): number {
  if (settings.noiseAmount <= 0) return brushWeight
  const noise = coherentValueNoise(x, z, settings.noiseScale, settings.seed)
  const modulation = 1 - settings.noiseAmount + settings.noiseAmount * noise
  return brushWeight * modulation
}

function coherentValueNoise(x: number, z: number, scale: number, seed: number): number {
  const scaledX = x / scale
  const scaledZ = z / scale
  const x0 = Math.floor(scaledX)
  const z0 = Math.floor(scaledZ)
  const tx = smoothstep(scaledX - x0)
  const tz = smoothstep(scaledZ - z0)
  const top = lerp(hashValue(x0, z0, seed), hashValue(x0 + 1, z0, seed), tx)
  const bottom = lerp(hashValue(x0, z0 + 1, seed), hashValue(x0 + 1, z0 + 1, seed), tx)
  return lerp(top, bottom, tz)
}

function hashValue(x: number, z: number, seed: number): number {
  let hash = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5)
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0xffffffff
}

function normalizeSettings(settings: Partial<PaintStrokeSettings> | undefined): PaintStrokeSettings {
  const merged = { ...DEFAULT_PAINT_STROKE_SETTINGS, ...settings }
  const runtimeColor = settings?.color
  const color = rgbToHex(
    hexToRgb(
      typeof runtimeColor === 'string'
        ? runtimeColor
        : DEFAULT_PAINT_STROKE_SETTINGS.color,
    ),
  )
  return Object.freeze({
    radius:
      Number.isFinite(merged.radius) && merged.radius > 0
        ? merged.radius
        : DEFAULT_PAINT_STROKE_SETTINGS.radius,
    strength: finiteClamp01(merged.strength, DEFAULT_PAINT_STROKE_SETTINGS.strength),
    falloff: finiteClamp01(merged.falloff, DEFAULT_PAINT_STROKE_SETTINGS.falloff),
    shape: merged.shape === 'square' ? 'square' : 'round',
    mode: merged.mode === 'erase' || merged.mode === 'smooth' ? merged.mode : 'paint',
    targetDensity: finiteClamp01(
      merged.targetDensity,
      DEFAULT_PAINT_STROKE_SETTINGS.targetDensity,
    ),
    color,
    premultiplyColorByDensity: merged.premultiplyColorByDensity === true,
    clipToBoundary: merged.clipToBoundary !== false,
    noiseAmount: finiteClamp01(merged.noiseAmount, DEFAULT_PAINT_STROKE_SETTINGS.noiseAmount),
    noiseScale:
      Number.isFinite(merged.noiseScale) && merged.noiseScale > 0
        ? merged.noiseScale
        : DEFAULT_PAINT_STROKE_SETTINGS.noiseScale,
    seed: Number.isFinite(merged.seed)
      ? Math.trunc(merged.seed)
      : DEFAULT_PAINT_STROKE_SETTINGS.seed,
  })
}


function assertField(field: GrassPaintField): void {
  if (
    !Number.isFinite(field.origin[0]) ||
    !Number.isFinite(field.origin[1]) ||
    !Number.isFinite(field.spacing) ||
    field.spacing <= 0 ||
    !Number.isInteger(field.cols) ||
    !Number.isInteger(field.rows) ||
    field.cols < 1 ||
    field.rows < 1 ||
    field.values.length !== field.cols * field.rows * 4
  ) {
    throw new TypeError('Invalid grass paint field')
  }
}

function blendByte(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}


function finiteClamp01(value: number, fallback: number): number {
  return Number.isFinite(value) ? clamp01(value) : fallback
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}
