import { describe, expect, test } from 'bun:test'
import {
  deriveBoundarySegments,
  type FrontageContext,
  type Point2,
} from './frontages'
import {
  deriveSurroundingsCorridor,
  deriveSurroundingsCorridors,
  deriveSurroundingsLayout,
  orientedRectangleCorners,
} from './corridor'

const DEFAULT_SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]

const PRIMARY_ROAD: FrontageContext = {
  separator: 'primary-road',
  access: 'none',
}

describe('deriveSurroundingsCorridor', () => {
  test('places a primary road immediately outside the selected frontage', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(segment)

    expect(corridor?.road).toEqual({
      id: 'surroundings-frontage-2-road',
      center: [0, 19.5],
      length: 30,
      width: 9,
    })
    expect(corridor?.frame).toEqual({
      origin: [0, 15],
      tangent: [-1, 0],
      outwardNormal: [0, 1],
    })
  })

  test('projects the road into 2D polygon corners from the Site edge', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!
    const corridor = deriveSurroundingsCorridor(segment)!

    expect(orientedRectangleCorners(corridor.road, corridor.frame)).toEqual([
      [15, 15],
      [-15, 15],
      [-15, 24],
      [15, 24],
    ])
  })

  test('does not create a corridor without a road context', () => {
    const segment = deriveBoundarySegments({ points: DEFAULT_SITE })[2]!

    expect(deriveSurroundingsCorridor(segment)).toBeNull()
  })

  test('divides the band beyond the road into deterministic neighboring properties', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(segment)

    expect(corridor?.properties).toEqual([
      {
        id: 'surroundings-frontage-2-property-0',
        center: [11.25, 35],
        frontageWidth: 7.5,
        depth: 22,
      },
      {
        id: 'surroundings-frontage-2-property-1',
        center: [3.75, 35],
        frontageWidth: 7.5,
        depth: 22,
      },
      {
        id: 'surroundings-frontage-2-property-2',
        center: [-3.75, 35],
        frontageWidth: 7.5,
        depth: 22,
      },
      {
        id: 'surroundings-frontage-2-property-3',
        center: [-11.25, 35],
        frontageWidth: 7.5,
        depth: 22,
      },
    ])
  })

  test('joins adjacent road frontages at their shared convex corner', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: {
          1: PRIMARY_ROAD,
          2: { separator: 'secondary-road', access: 'none' },
        },
      }),
    )

    expect(layout.roadJunctions).toEqual([
      {
        id: 'surroundings-junction-1-2',
        corners: [
          [15, 15],
          [24, 15],
          [24, 21],
          [15, 21],
        ],
      },
    ])
  })

  test('keeps each frontage corridor independent', () => {
    const topOnly = deriveSurroundingsCorridors(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 2: PRIMARY_ROAD },
      }),
    )
    const withSecondaryRoad = deriveSurroundingsCorridors(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: {
          0: { separator: 'secondary-road', access: 'none' },
          2: PRIMARY_ROAD,
        },
      }),
    )

    expect(withSecondaryRoad.map(({ id }) => id)).toEqual([
      'surroundings-frontage-0',
      'surroundings-frontage-2',
    ])
    expect(withSecondaryRoad[0]?.road.width).toBe(6)
    expect(withSecondaryRoad[1]).toEqual(topOnly[0])
  })
})
