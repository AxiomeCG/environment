import { describe, expect, test } from 'bun:test'
import {
  asDrawnProfile,
  resolvePointValues,
  riverSectionShape,
  riverSectionTargetHeight,
  solveDownhillProfile,
  type RiverProfileStation,
} from './planner'
import type { RiverSection } from './schema'

const SECTION: RiverSection = {
  shape: 'curved',
  bankSlope: 2,
  bendAsymmetry: 0,
  bermM: 0,
  blendM: 2,
}

function stations(ground: readonly number[], depthM = 1): RiverProfileStation[] {
  return ground.map((groundY, index) => ({ distanceM: index * 10, groundY, depthM }))
}

describe('downhill profile solver', () => {
  test('water never rises: it cuts through a rise and embanks across steep drops', () => {
    // Ground falls, rises sharply, then drops away. Inset for depth 1 is 0.12.
    const profile = solveDownhillProfile(stations([5, 4, 6, 2, 1]), 5)
    expect(profile.map((sample) => sample.waterY)).toEqual([4.88, 4.38, 4.38, 3.88, 3.38])
    for (let index = 1; index < profile.length; index += 1) {
      expect(profile[index]!.waterY).toBeLessThanOrEqual(profile[index - 1]!.waterY)
    }
    // Held up above the falling ground at the max slope: an embankment.
    expect(profile[1]!.embankmentM).toBeCloseTo(0.5, 6)
    expect(profile[3]!.embankmentM).toBeCloseTo(2, 6)
    // Level through the rise: the channel cuts, no embankment needed.
    expect(profile[2]!.embankmentM).toBe(0)
    expect(profile[3]!.rapid).toBe(true)
    expect(profile[2]!.rapid).toBe(false)
  })

  test('a zero max slope holds one level from the upstream end', () => {
    const profile = solveDownhillProfile(stations([5, 1, 4]), 0)
    expect(profile.map((sample) => sample.waterY)).toEqual([4.88, 4.88, 4.88])
  })

  test('as-drawn water follows the ground and can rise', () => {
    const profile = asDrawnProfile(stations([5, 4, 6]))
    expect(profile[2]!.waterY).toBeGreaterThan(profile[1]!.waterY)
    expect(profile.every((sample) => sample.embankmentM === 0)).toBe(true)
  })
})

describe('per-point values', () => {
  test('missing values interpolate between set neighbours', () => {
    expect(resolvePointValues(5, [null, 2, null, null, 8], 4)).toEqual([2, 2, 4, 6, 8])
  })

  test('no overrides fall back everywhere; one override holds along the river', () => {
    expect(resolvePointValues(3, [], 4)).toEqual([4, 4, 4])
    expect(resolvePointValues(4, [null, null, 7, null], 4)).toEqual([7, 7, 7, 7])
  })
})

describe('cross-section', () => {
  test('trapezoid has a flat bed and banks at the section slope', () => {
    // Half-width 5, depth 1, bank slope 2: side run 2, bed half-width 3.
    expect(riverSectionShape('trapezoid', 0, 5, 1, 2)).toBe(1)
    expect(riverSectionShape('trapezoid', 3, 5, 1, 2)).toBe(1)
    expect(riverSectionShape('trapezoid', 4, 5, 1, 2)).toBeCloseTo(0.5, 6)
    expect(riverSectionShape('trapezoid', 5, 5, 1, 2)).toBe(0)
    expect(riverSectionShape('curved', 0, 5, 1, 2)).toBe(1)
    expect(riverSectionShape('curved', 5, 5, 1, 2)).toBe(0)
  })

  test('bend shift moves the deepest line off centre', () => {
    const base = {
      groundY: 10,
      centerGroundY: 10,
      channelTopY: 10,
      depthM: 2,
      halfWidthM: 3,
      section: SECTION,
    }
    const atShift = riverSectionTargetHeight({ ...base, lateralM: 1, bendShiftM: 1 })!
    const opposite = riverSectionTargetHeight({ ...base, lateralM: -1, bendShiftM: 1 })!
    expect(atShift).toBeCloseTo(8, 6)
    expect(opposite).toBeGreaterThan(atShift)
  })

  test('banks cut toward high ground and fill toward low ground, then stop', () => {
    const base = {
      centerGroundY: 10,
      channelTopY: 10,
      depthM: 1,
      halfWidthM: 2,
      bendShiftM: 0,
      section: SECTION,
    }
    // Cut side: bank line rises 1 per 2 run from the channel top.
    expect(riverSectionTargetHeight({ ...base, lateralM: 3, groundY: 14 })).toBeCloseTo(10.5, 6)
    // Fill side: feathers from the channel top down to the low ground over the blend.
    const filled = riverSectionTargetHeight({ ...base, lateralM: 2.5, groundY: 8 })!
    expect(filled).toBeGreaterThan(8)
    expect(filled).toBeLessThan(10)
    // Beyond every reach the ground is untouched.
    expect(riverSectionTargetHeight({ ...base, lateralM: 40, groundY: 14 })).toBeNull()
    expect(riverSectionTargetHeight({ ...base, lateralM: 40, groundY: 8 })).toBeNull()
  })
})
