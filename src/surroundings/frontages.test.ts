import { describe, expect, test } from 'bun:test'
import {
  deriveBoundarySegments,
  type FrontageContext,
  type Point2,
  withFrontageSeparator,
} from './frontages'

const DEFAULT_SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]

const NO_CONTEXT: FrontageContext = {
  separator: 'none',
  access: 'none',
}

function expectPoint(actual: Point2, expected: Point2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 10)
  expect(actual[1]).toBeCloseTo(expected[1], 10)
}

describe('deriveBoundarySegments', () => {
  test('derives outward frames for the default counter-clockwise Site', () => {
    const segments = deriveBoundarySegments({ points: DEFAULT_SITE })

    expect(segments).toHaveLength(4)
    expect(segments.map(({ index }) => index)).toEqual([0, 1, 2, 3])
    expectPoint(segments[0]!.outwardNormal, [0, -1])
    expectPoint(segments[1]!.outwardNormal, [1, 0])
    expectPoint(segments[2]!.tangent, [-1, 0])
    expectPoint(segments[2]!.outwardNormal, [0, 1])
    expectPoint(segments[3]!.outwardNormal, [-1, 0])
  })

  test('keeps matched geometric normals outward when winding reverses', () => {
    const clockwiseSite = [
      [-15, -15],
      [-15, 15],
      [15, 15],
      [15, -15],
    ] as const satisfies readonly Point2[]

    const segments = deriveBoundarySegments({ points: clockwiseSite })

    expectPoint(segments[0]!.outwardNormal, [-1, 0])
    expectPoint(segments[1]!.outwardNormal, [0, 1])
    expectPoint(segments[2]!.outwardNormal, [1, 0])
    expectPoint(segments[3]!.outwardNormal, [0, -1])
  })

  test('applies the explicitly selected separator without cycling', () => {
    const contexts = {
      1: {
        separator: 'secondary-road',
        access: 'driveway',
      },
    } as const

    const selected = withFrontageSeparator(contexts, 1, 'primary-road')

    expect(selected[1]).toEqual({
      separator: 'primary-road',
      access: 'driveway',
    })
    expect(contexts[1].separator).toBe('secondary-road')
  })

  test('removes an empty context when No road is selected directly', () => {
    const selected = withFrontageSeparator(
      { 2: { separator: 'primary-road', access: 'none' } },
      2,
      'none',
    )

    expect(selected).toEqual({})
  })

  test('attaches a selected context without changing other frontages', () => {
    const selected: FrontageContext = {
      separator: 'secondary-road',
      access: 'driveway',
      roadStyleId: 'residential-local',
    }

    const segments = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: selected },
    })

    expect(segments[2]!.context).toEqual(selected)
    expect(segments[0]!.context).toEqual(NO_CONTEXT)
    expect(segments[1]!.context).toEqual(NO_CONTEXT)
    expect(segments[3]!.context).toEqual(NO_CONTEXT)
  })

  test('derives a local outward frame on a concave Site', () => {
    const concaveSite = [
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ] as const satisfies readonly Point2[]

    const segments = deriveBoundarySegments({ points: concaveSite })

    expectPoint(segments[3]!.tangent, [0, 1])
    expectPoint(segments[3]!.outwardNormal, [1, 0])
  })

  test('rejects polygons without a usable oriented boundary', () => {
    expect(() => deriveBoundarySegments({ points: [[0, 0], [1, 0]] })).toThrow()
    expect(() => deriveBoundarySegments({
      points: [[0, 0], [1, 0], [2, 0]],
    })).toThrow()
    expect(() => deriveBoundarySegments({
      points: [[0, 0], [1, 0], [1, 0], [0, 1]],
    })).toThrow()
    expect(() => deriveBoundarySegments({
      points: [[0, 0], [1, 0], [Number.NaN, 1]],
    })).toThrow()
  })
})
