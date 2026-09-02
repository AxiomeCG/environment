import { describe, expect, test } from 'bun:test'
import {
  deriveBoundarySegments,
  type FrontageContext,
  type Point2,
} from './frontages'
import {
  deriveRoadPresentationAlignments,
  deriveSurroundingsCorridor,
  deriveSurroundingsCorridors,
  deriveSurroundingsLayout,
  orientedRectangleCorners,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
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

  test('uses complete Streetscape-compatible widths for retained roads and neighbors', () => {
    const segments = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: {
        0: { separator: 'secondary-road', access: 'none' },
        2: PRIMARY_ROAD,
      },
    })

    const secondary = deriveSurroundingsCorridor(
      segments[0]!,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )
    const primary = deriveSurroundingsCorridor(
      segments[2]!,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    expect(secondary?.road.width).toBeCloseTo(10.4)
    expect(secondary?.road.center).toEqual([0, -20.2])
    expect(secondary?.properties[0]?.center[1]).toBeCloseTo(-36.4)
    expect(primary?.road.width).toBeCloseTo(15.7)
    expect(primary?.road.center[1]).toBeCloseTo(22.85)
    expect(primary?.properties[0]?.center[1]).toBeCloseTo(41.7)
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

    expect(layout.roadJunctions).toHaveLength(1)
    expect(layout.roadJunctions[0]?.id).toBe('surroundings-junction-1-2')
    expect(layout.roadJunctions[0]?.separator).toBe('primary-road')
    expect(layout.roadJunctions[0]?.corners).toEqual([
      [15, 15],
      [24, 15],
      [24, 21],
      [15, 21],
    ])
    expect(layout.roadJunctions[0]?.centerline).toHaveLength(11)
    expect(layout.roadJunctions[0]?.centerline[0]).toEqual([19.5, 15])
    expect(layout.roadJunctions[0]?.centerline.at(-1)).toEqual([15, 18])
  })

  test('connects matching Streetscape-compatible roads with a tangent bend', () => {
    const secondaryRoad = { separator: 'secondary-road', access: 'none' } as const
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: secondaryRoad, 2: secondaryRoad },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    const bend = layout.roadJunctions[0]!
    const firstDelta = [
      bend.centerline[1]![0] - bend.centerline[0]![0],
      bend.centerline[1]![1] - bend.centerline[0]![1],
    ] as const
    const lastDelta = [
      bend.centerline.at(-1)![0] - bend.centerline.at(-2)![0],
      bend.centerline.at(-1)![1] - bend.centerline.at(-2)![1],
    ] as const

    expect(bend.separator).toBe('secondary-road')
    expect(bend.centerline[0]).toEqual([20.2, 15])
    expect(bend.centerline.at(-1)).toEqual([15, 20.2])
    expect(Math.abs(firstDelta[0])).toBeLessThan(Math.abs(firstDelta[1]))
    expect(Math.abs(lastDelta[1])).toBeLessThan(Math.abs(lastDelta[0]))
  })

  test('merges compatible adjacent frontage roads into one gap-free render alignment', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: PRIMARY_ROAD, 2: PRIMARY_ROAD },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    const alignments = deriveRoadPresentationAlignments(layout)

    expect(alignments).toHaveLength(1)
    expect(alignments[0]?.corridorIds).toEqual([
      'surroundings-frontage-1',
      'surroundings-frontage-2',
    ])
    expect(alignments[0]?.junctionIds).toEqual(['surroundings-junction-1-2'])
    expect(alignments[0]?.centerline[0]).toEqual([22.85, -15])
    expect(alignments[0]?.centerline.at(-1)).toEqual([-15, 22.85])
    expect(
      alignments[0]?.centerline.filter(([x, z]) => x === 22.85 && z === 15),
    ).toHaveLength(1)
    expect(
      alignments[0]?.centerline.filter(([x, z]) => x === 15 && z === 22.85),
    ).toHaveLength(1)
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
