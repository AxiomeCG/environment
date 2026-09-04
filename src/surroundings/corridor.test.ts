import { describe, expect, test } from 'bun:test'
import {
  deriveBoundarySegments,
  type FrontageContext,
  type Point2,
} from './frontages'
import {
  deriveNeighborCells,
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
const ZERO_CELL_VARIATION = {
  seed: 'corridor-tests',
  depthVariation: 0,
} as const


describe('deriveSurroundingsCorridor', () => {
  test('places a primary road immediately outside the selected frontage and continues it outward', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(segment)

    expect(corridor?.road).toEqual({
      id: 'surroundings-frontage-2-road',
      center: [0, 19.5],
      length: 154,
      width: 9,
    })
    expect(corridor?.frame).toEqual({
      origin: [0, 15],
      tangent: [-1, 0],
      outwardNormal: [0, 1],
    })
  })

  test('extends a primary road through the near neighborhood street', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(
      segment,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )!

    expect(corridor.road.length).toBeCloseTo(180.8)
    const roadCorners = orientedRectangleCorners(corridor.road, corridor.frame)
    const expectedRoadCorners = [
      [90.4, 15],
      [-90.4, 15],
      [-90.4, 30.7],
      [90.4, 30.7],
    ] as const
    for (const [index, corner] of roadCorners.entries()) {
      expect(corner[0]).toBeCloseTo(expectedRoadCorners[index]![0])
      expect(corner[1]).toBeCloseTo(expectedRoadCorners[index]![1])
    }
  })

  test('projects the road into 2D polygon corners from the Site edge', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!
    const corridor = deriveSurroundingsCorridor(segment)!

    expect(orientedRectangleCorners(corridor.road, corridor.frame)).toEqual([
      [77, 15],
      [-77, 15],
      [-77, 24],
      [77, 24],
    ])
  })

  test('uses complete Streetscape-compatible widths for retained roads', () => {
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
    expect(primary?.road.width).toBeCloseTo(15.7)
    expect(primary?.road.center[1]).toBeCloseTo(22.85)
  })

  test('does not create a corridor without a road context', () => {
    const segment = deriveBoundarySegments({ points: DEFAULT_SITE })[2]!

    expect(deriveSurroundingsCorridor(segment)).toBeNull()
  })

  test('derives one visible frontage and corner cell per site edge without roads', () => {
    const cells = deriveNeighborCells(
      deriveBoundarySegments({ points: DEFAULT_SITE }),
      undefined,
      ZERO_CELL_VARIATION,
    )

    expect(cells).toHaveLength(8)
    expect(cells.filter(({ kind }) => kind === 'frontage')).toHaveLength(4)
    expect(cells.filter(({ kind }) => kind === 'corner')).toHaveLength(4)
    expect(cells.find(({ id }) => id === 'surroundings-cell-frontage-2')).toEqual({
      id: 'surroundings-cell-frontage-2',
      kind: 'frontage',
      frontageIndices: [2],
      polygon: [
        [15, 15],
        [-15, 15],
        [-15, 46],
        [15, 46],
      ],
    })
    expect(cells.find(({ id }) => id === 'surroundings-cell-corner-1-2')).toEqual({
      id: 'surroundings-cell-corner-1-2',
      kind: 'corner',
      frontageIndices: [1, 2],
      polygon: [
        [15, 15],
        [46, 15],
        [46, 46],
        [15, 46],
      ],
    })
  })

  test('keeps candidate-cell geometry stable when a primary road is selected', () => {
    const withoutRoad = deriveNeighborCells(
      deriveBoundarySegments({ points: DEFAULT_SITE }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      ZERO_CELL_VARIATION,
    )
    const withPrimaryRoad = deriveNeighborCells(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 2: PRIMARY_ROAD },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      ZERO_CELL_VARIATION,
    )

    expect(withPrimaryRoad).toEqual(withoutRoad)
    expect(
      withPrimaryRoad.find(({ id }) => id === 'surroundings-cell-frontage-2')
        ?.polygon[2]?.[1],
    ).toBeCloseTo(52.7)
  })

  test('varies lot depth deterministically while sharing exact corner boundaries', () => {
    const segments = deriveBoundarySegments({ points: DEFAULT_SITE })
    const first = deriveNeighborCells(segments)
    const second = deriveNeighborCells(segments)
    const frontageDepths = first
      .filter(({ kind }) => kind === 'frontage')
      .map(({ polygon }) => Math.hypot(
        polygon[3]![0] - polygon[0]![0],
        polygon[3]![1] - polygon[0]![1],
      ))

    expect(second).toEqual(first)
    expect(new Set(frontageDepths.map((depth) => depth.toFixed(4))).size).toBeGreaterThan(1)

    const previous = first.find(({ id }) => id === 'surroundings-cell-frontage-1')!
    const next = first.find(({ id }) => id === 'surroundings-cell-frontage-2')!
    const corner = first.find(({ id }) => id === 'surroundings-cell-corner-1-2')!
    expect(corner.polygon[1]).toEqual(previous.polygon[2])
    expect(corner.polygon.at(-1)).toEqual(next.polygon[3])
  })

  test('includes the candidate-cell ring in a layout with no selected road', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({ points: DEFAULT_SITE }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    expect(layout.corridors).toEqual([])
    expect(layout.roadJunctions).toEqual([])
    expect(layout.neighborCells).toHaveLength(8)
    expect(layout.outerRoad).toBeUndefined()
    expect(deriveRoadPresentationAlignments(layout)).toEqual([])
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

  test('omits the near street when an acute Site cannot support a safe offset', () => {
    const acuteSite = [
      [-100, 0],
      [0, 0],
      [-81.91520442889918, 57.35764363510461],
    ] as const satisfies readonly Point2[]
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: acuteSite,
        contexts: {
          0: { separator: 'secondary-road', access: 'none' },
          1: PRIMARY_ROAD,
        },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    expect(layout.outerRoad).toBeUndefined()
    expect(deriveRoadPresentationAlignments(layout).map(({ id }) => id)).toEqual([
      'surroundings-frontage-0-road',
      'surroundings-frontage-1-road',
    ])
  })

  test('omits the near street below the safe 60-degree offset limit', () => {
    const fortyFiveDegreeSite = [
      [-100, 0],
      [0, 0],
      [-70.71067811865476, 70.71067811865474],
    ] as const satisfies readonly Point2[]
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: fortyFiveDegreeSite,
        contexts: {
          0: { separator: 'secondary-road', access: 'none' },
          1: PRIMARY_ROAD,
        },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    expect(layout.outerRoad).toBeUndefined()
  })

  test('keeps adjacent secondary roads independent from the open near street', () => {
    const secondaryRoad = { separator: 'secondary-road', access: 'none' } as const
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: secondaryRoad, 2: secondaryRoad },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    const alignments = deriveRoadPresentationAlignments(layout)
    const nearRoad = alignments.find(
      ({ id }) => id === 'surroundings-near-neighborhood-road',
    )!

    expect(alignments.slice(0, 2).map(({ corridorIds }) => corridorIds)).toEqual([
      ['surroundings-frontage-1'],
      ['surroundings-frontage-2'],
    ])
    expect(alignments.slice(0, 2).every(({ junctionIds }) => junctionIds.length === 0)).toBe(true)
    expect(nearRoad.centerline.length).toBeGreaterThanOrEqual(5)
    expect(nearRoad.centerline[0]).not.toEqual(nearRoad.centerline.at(-1))
    expect(nearRoad.centerline.flat().every(Number.isFinite)).toBe(true)
  })

  test('uses the cell variation seed for deterministic near-street variation', () => {
    const segments = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })
    const first = deriveSurroundingsLayout(
      segments,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'near-street-a', depthVariation: 0.2 },
    )
    const repeated = deriveSurroundingsLayout(
      segments,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'near-street-a', depthVariation: 0.2 },
    )
    const different = deriveSurroundingsLayout(
      segments,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      { seed: 'near-street-b', depthVariation: 0.2 },
    )

    expect(repeated.outerRoad).toEqual(first.outerRoad)
    expect(different.outerRoad?.centerline).not.toEqual(first.outerRoad?.centerline)
  })

  test('keeps every selected frontage as a separate outward continuation', () => {
    const secondaryRoad = { separator: 'secondary-road', access: 'none' } as const
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: {
          0: secondaryRoad,
          1: secondaryRoad,
          2: secondaryRoad,
          3: PRIMARY_ROAD,
        },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    const alignments = deriveRoadPresentationAlignments(layout)
    const frontageAlignments = alignments.filter(({ corridorIds }) => corridorIds.length > 0)
    const nearRoad = alignments.find(
      ({ id }) => id === 'surroundings-near-neighborhood-road',
    )!

    expect(frontageAlignments).toHaveLength(4)
    expect(frontageAlignments.every(({ corridorIds, junctionIds }) =>
      corridorIds.length === 1 && junctionIds.length === 0)).toBe(true)
    expect(frontageAlignments.every(({ centerline }) =>
      centerline.flat().every(Number.isFinite))).toBe(true)
    expect(nearRoad.centerline[0]).not.toEqual(nearRoad.centerline.at(-1))
  })

  test('keeps extended primary roads as independent through alignments', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: PRIMARY_ROAD, 2: PRIMARY_ROAD },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )

    const alignments = deriveRoadPresentationAlignments(layout)

    expect(layout.roadJunctions).toHaveLength(1)
    expect(alignments.slice(0, 2)).toEqual([
      {
        id: 'surroundings-frontage-1-road',
        separator: 'primary-road',
        centerline: [
          [22.85, -90.4],
          [22.85, 90.4],
        ],
        corridorIds: ['surroundings-frontage-1'],
        junctionIds: [],
      },
      {
        id: 'surroundings-frontage-2-road',
        separator: 'primary-road',
        centerline: [
          [90.4, 22.85],
          [-90.4, 22.85],
        ],
        corridorIds: ['surroundings-frontage-2'],
        junctionIds: [],
      },
    ])
    expect(alignments[2]?.id).toBe('surroundings-near-neighborhood-road')
    expect(alignments[2]?.centerline[0]).not.toEqual(alignments[2]?.centerline.at(-1))
  })

  test('continues a secondary road across the near street regardless of primary ordering', () => {
    const secondaryRoad = { separator: 'secondary-road', access: 'none' } as const
    const withPrimaryAtEnd = deriveRoadPresentationAlignments(
      deriveSurroundingsLayout(
        deriveBoundarySegments({
          points: DEFAULT_SITE,
          contexts: { 1: secondaryRoad, 2: PRIMARY_ROAD },
        }),
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      ),
    )
    const withPrimaryAtStart = deriveRoadPresentationAlignments(
      deriveSurroundingsLayout(
        deriveBoundarySegments({
          points: DEFAULT_SITE,
          contexts: { 1: PRIMARY_ROAD, 2: secondaryRoad },
        }),
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      ),
    )

    const secondaryAtEnd = withPrimaryAtEnd.find(
      ({ id }) => id === 'surroundings-frontage-1-road',
    )!
    const secondaryAtStart = withPrimaryAtStart.find(
      ({ id }) => id === 'surroundings-frontage-2-road',
    )!

    expect(secondaryAtEnd).toMatchObject({
      separator: 'secondary-road',
      junctionIds: [],
    })
    expect(secondaryAtEnd.centerline[0]).toEqual([20.2, -90.4])
    expect(secondaryAtEnd.centerline[1]).toEqual([20.2, 90.4])

    expect(secondaryAtStart).toMatchObject({
      separator: 'secondary-road',
      junctionIds: [],
    })
    expect(secondaryAtStart.centerline[0]).toEqual([90.4, 20.2])
    expect(secondaryAtStart.centerline[1]).toEqual([-90.4, 20.2])
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
