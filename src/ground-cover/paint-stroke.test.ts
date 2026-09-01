import { describe, expect, test } from 'bun:test'
import { weightAt } from '@pascal-app/core'
import { createGrassObstacleField } from './obstacle-field'
import { type GrassPaintField } from './paint-field'
import {
  advancePaintStroke,
  beginPaintStroke,
  currentPaintField,
  DEFAULT_PAINT_STROKE_SETTINGS,
  detachPaintStrokeAnchor,
  maxPaintCoverage,
  type PaintStrokeSettings,
} from './paint-stroke'

const SITE: Array<[number, number]> = [
  [-4, -4],
  [4, -4],
  [4, 4],
  [-4, 4],
]

function field(color: [number, number, number] = [20, 40, 60], alpha = 0): GrassPaintField {
  const cols = 17
  const rows = 17
  const values = new Uint8Array(cols * rows * 4)
  for (let index = 0; index < values.length; index += 4) {
    values[index] = color[0]
    values[index + 1] = color[1]
    values[index + 2] = color[2]
    values[index + 3] = alpha
  }
  return { origin: [-4, -4], spacing: 0.5, cols, rows, values }
}

function rgbaAt(target: GrassPaintField, x: number, z: number): [number, number, number, number] {
  const col = Math.round((x - target.origin[0]) / target.spacing)
  const row = Math.round((z - target.origin[1]) / target.spacing)
  const offset = (row * target.cols + col) * 4
  return [
    target.values[offset] ?? 0,
    target.values[offset + 1] ?? 0,
    target.values[offset + 2] ?? 0,
    target.values[offset + 3] ?? 0,
  ]
}

function runStroke(
  start: GrassPaintField,
  settings: Partial<PaintStrokeSettings>,
  path: Array<[number, number]>,
  boundary = SITE,
): GrassPaintField {
  const stroke = beginPaintStroke({ field: start, boundary, settings })
  for (const [x, z] of path) advancePaintStroke(stroke, x, z)
  return currentPaintField(stroke)
}

describe('paint stroke settings and snapshot', () => {
  test('provides terrain-like defaults plus grass paint controls', () => {
    expect(DEFAULT_PAINT_STROKE_SETTINGS).toEqual({
      radius: 2,
      strength: 1,
      falloff: 0.1,
      shape: 'round',
      mode: 'paint',
      targetDensity: 1,
      color: '#3f6b2f',
      noiseAmount: 0,
      noiseScale: 1,
      seed: 1,
    })
  })

  test('keeps full coverage through the middle with a narrow edge falloff', () => {
    expect(weightAt(DEFAULT_PAINT_STROKE_SETTINGS, 1.5, 0)).toBe(1)
    expect(weightAt(DEFAULT_PAINT_STROKE_SETTINGS, 1.9, 0)).toBeCloseTo(0.5)
    expect(weightAt(DEFAULT_PAINT_STROKE_SETTINGS, 2, 0)).toBe(0)
  })

  test('freezes a byte snapshot and exposes a separate live result', () => {
    const source = field([10, 20, 30], 0)
    const stroke = beginPaintStroke({
      field: source,
      boundary: SITE,
      settings: { strength: 1, falloff: 0, radius: 1, color: '#ffffff' },
    })
    const centreOffset = (8 * source.cols + 8) * 4
    source.values.set([1, 2, 3, 4], centreOffset)

    advancePaintStroke(stroke, 0, 0)

    expect(Array.from(stroke.snapshot.values.slice(centreOffset, centreOffset + 4))).toEqual([
      10, 20, 30, 0,
    ])
    expect(rgbaAt(stroke.result, 0, 0)).toEqual([255, 255, 255, 255])
    expect(stroke.result.values).not.toBe(stroke.snapshot.values)
  })
})

describe('paint, erase, and smooth', () => {
  test('paint tints a cleared white perimeter faster than it raises density', () => {
    const result = runStroke(
      field([255, 255, 255], 0),
      {
        mode: 'paint',
        radius: 1,
        strength: 0.5,
        falloff: 0,
        color: '#6e7882',
        targetDensity: 0.8,
      },
      [[0, 0]],
    )

    expect(rgbaAt(result, 0, 0)).toEqual([152, 160, 167, 102])
    expect(rgbaAt(result, 2, 0)).toEqual([255, 255, 255, 0])
  })

  test('paint still blends RGB by brush strength over existing grass', () => {
    const result = runStroke(
      field([10, 20, 30], 255),
      {
        mode: 'paint',
        radius: 1,
        strength: 0.5,
        falloff: 0,
        color: '#6e7882',
        targetDensity: 1,
      },
      [[0, 0]],
    )

    expect(rgbaAt(result, 0, 0)).toEqual([60, 70, 80, 255])
  })

  test('cosine soft falloff controls coverage exactly when noise is zero', () => {
    const settings = {
      ...DEFAULT_PAINT_STROKE_SETTINGS,
      radius: 2,
      strength: 1,
      falloff: 1,
      color: '#14283c',
      targetDensity: 1,
      noiseAmount: 0,
    }
    const result = runStroke(field(), settings, [[0, 0]])

    expect(rgbaAt(result, 0, 0)[3]).toBe(255)
    expect(rgbaAt(result, 1, 0)[3]).toBe(Math.round(weightAt(settings, 1, 0) * 255))
    expect(rgbaAt(result, 2, 0)[3]).toBe(0)
  })

  test('one stroke saturates under dwelling and re-crossing', () => {
    const settings = { radius: 1.5, strength: 0.5, falloff: 0, targetDensity: 1 }
    const once = runStroke(field(), settings, [[0, 0]])
    const repeated = runStroke(field(), settings, [
      [0, 0],
      [2, 0],
      [0, 0],
      [2, 0],
      [0, 0],
    ])

    expect(rgbaAt(repeated, 0, 0)).toEqual(rgbaAt(once, 0, 0))
    expect(rgbaAt(repeated, 0, 0)[3]).toBe(128)
  })

  test('a second stroke progresses farther toward the target', () => {
    const settings = { radius: 1, strength: 0.5, falloff: 0, targetDensity: 1 }
    const first = runStroke(field(), settings, [[0, 0]])
    const second = runStroke(first, settings, [[0, 0]])

    expect(rgbaAt(first, 0, 0)[3]).toBe(128)
    expect(rgbaAt(second, 0, 0)[3]).toBe(192)
  })

  test('erase lowers alpha while preserving snapshot RGB exactly', () => {
    const result = runStroke(
      field([17, 91, 203], 200),
      { mode: 'erase', radius: 1, strength: 0.5, falloff: 0, color: '#ffffff' },
      [[0, 0]],
    )

    expect(rgbaAt(result, 0, 0)).toEqual([17, 91, 203, 100])
  })

  test('smooth moves all four channels toward one stable 3x3 snapshot blur', () => {
    const source = field([0, 0, 0], 0)
    const centreOffset = (8 * source.cols + 8) * 4
    source.values.set([255, 180, 90, 255], centreOffset)
    const result = runStroke(
      source,
      { mode: 'smooth', radius: 0.75, strength: 1, falloff: 0 },
      [[0, 0]],
    )

    expect(rgbaAt(result, 0, 0)).toEqual([28, 20, 10, 28])
    expect(rgbaAt(result, 2, 0)).toEqual([0, 0, 0, 0])
  })
})
describe('obstacle clipping', () => {
  test('preserves paint below illegal obstacle cells while painting around them', () => {
    const source = field()
    const obstacles = createGrassObstacleField(
      source,
      [{ kind: 'box', center: [0, 0], halfSize: [0.75, 0.75], rotation: 0 }],
    )
    const stroke = beginPaintStroke({
      field: source,
      boundary: SITE,
      obstacleField: obstacles,
      settings: { radius: 2, strength: 1, falloff: 0, targetDensity: 1 },
    })

    advancePaintStroke(stroke, 0, 0)

    expect(rgbaAt(stroke.result, 0, 0)[3]).toBe(0)
    expect(rgbaAt(stroke.result, 1.5, 0)[3]).toBe(255)
  })
})


describe('noise, site clipping, and stroke motion', () => {
  test('world-space noise is deterministic by seed and changes with another seed', () => {
    const settings = {
      radius: 2,
      strength: 1,
      falloff: 0.7,
      targetDensity: 1,
      noiseAmount: 0.8,
      noiseScale: 1.25,
      seed: 42,
    }
    const first = runStroke(field(), settings, [
      [-2, -1],
      [2, 1],
    ])
    const repeated = runStroke(field(), settings, [
      [-2, -1],
      [2, 1],
    ])
    const anotherSeed = runStroke(field(), { ...settings, seed: 43 }, [
      [-2, -1],
      [2, 1],
    ])

    expect(Array.from(repeated.values)).toEqual(Array.from(first.values))
    expect(Array.from(anotherSeed.values)).not.toEqual(Array.from(first.values))
  })

  test('samples outside the site polygon remain untouched', () => {
    const leftHalf: Array<[number, number]> = [
      [-4, -4],
      [0, -4],
      [0, 4],
      [-4, 4],
    ]
    const result = runStroke(
      field(),
      { radius: 2, strength: 1, falloff: 0, targetDensity: 1 },
      [[0, 0]],
      leftHalf,
    )

    expect(rgbaAt(result, -0.5, 0)[3]).toBe(255)
    expect(rgbaAt(result, 0, 0)[3]).toBe(255)
    expect(rgbaAt(result, 0.5, 0)[3]).toBe(0)
  })

  test('a fast drag and event-dense drag produce the same stroke', () => {
    const settings = { radius: 2, strength: 0.8, falloff: 0.8, targetDensity: 1 }
    const coarse = runStroke(field(), settings, [
      [-3, 0],
      [3, 0],
    ])
    const fine = runStroke(
      field(),
      settings,
      Array.from({ length: 49 }, (_, index) => [-3 + (6 * index) / 48, 0] as [number, number]),
    )

    expect(Array.from(fine.values)).toEqual(Array.from(coarse.values))
  })

  test('short motion deposits no new dab, then accumulated arc length does', () => {
    const stroke = beginPaintStroke({ field: field(), boundary: SITE, settings: { radius: 4 } })

    expect(advancePaintStroke(stroke, 0, 0)).not.toBeNull()
    expect(advancePaintStroke(stroke, 0.2, 0)).toBeNull()
    expect(advancePaintStroke(stroke, 0.7, 0)).toBeNull()
    expect(advancePaintStroke(stroke, 1.1, 0)).not.toBeNull()
    expect(maxPaintCoverage(stroke)).toBe(1)
  })

  test('detaching the dab anchor does not bridge a skipped pointer gap', () => {
    const stroke = beginPaintStroke({
      field: field(),
      boundary: SITE,
      settings: { radius: 1, strength: 1, falloff: 0 },
    })
    advancePaintStroke(stroke, -3, 0)
    detachPaintStrokeAnchor(stroke)
    advancePaintStroke(stroke, 3, 0)

    expect(rgbaAt(stroke.result, -3, 0)[3]).toBe(255)
    expect(rgbaAt(stroke.result, 0, 0)[3]).toBe(0)
    expect(rgbaAt(stroke.result, 3, 0)[3]).toBe(255)
  })
})
