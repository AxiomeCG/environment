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
  test('places a primary road immediately outside the selected frontage', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(segment)

    expect(corridor?.road).toEqual({
      id: 'surroundings-frontage-2-road',
      center: [0, 19.5],
      length: 92,
      width: 9,
    })
    expect(corridor?.frame).toEqual({
      origin: [0, 15],
      tangent: [-1, 0],
      outwardNormal: [0, 1],
    })
  })

  test('extends a primary road through the complete Streetscape cell ring', () => {
    const segment = deriveBoundarySegments({
      points: DEFAULT_SITE,
      contexts: { 2: PRIMARY_ROAD },
    })[2]!

    const corridor = deriveSurroundingsCorridor(
      segment,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )!

    expect(corridor.road.length).toBeCloseTo(105.4)
    const roadCorners = orientedRectangleCorners(corridor.road, corridor.frame)
    const expectedRoadCorners = [
      [52.7, 15],
      [-52.7, 15],
      [-52.7, 30.7],
      [52.7, 30.7],
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
      [46, 15],
      [-46, 15],
      [-46, 24],
      [46, 24],
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

  test('merges adjacent secondary roads into one gap-free render alignment', () => {
    const secondaryRoad = { separator: 'secondary-road', access: 'none' } as const
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: secondaryRoad, 2: secondaryRoad },
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
    expect(alignments[0]?.centerline[0]).toEqual([20.2, -15])
    expect(alignments[0]?.centerline.at(-1)).toEqual([-15, 20.2])
    expect(
      alignments[0]?.centerline.filter(([x, z]) => x === 20.2 && z === 15),
    ).toHaveLength(1)
    expect(
      alignments[0]?.centerline.filter(([x, z]) => x === 15 && z === 20.2),
    ).toHaveLength(1)
  })

  test('keeps three adjacent secondary frontages as one curved alignment', () => {
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

    const secondaryAlignment = deriveRoadPresentationAlignments(layout)[0]

    expect(secondaryAlignment?.corridorIds).toEqual([
      'surroundings-frontage-0',
      'surroundings-frontage-1',
      'surroundings-frontage-2',
    ])
    expect(secondaryAlignment?.junctionIds).toEqual([
      'surroundings-junction-0-1',
      'surroundings-junction-1-2',
    ])
    expect(secondaryAlignment?.centerline[0]).toEqual([-15, -20.2])
    expect(secondaryAlignment?.centerline.at(-1)).toEqual([-15, 20.2])
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
    expect(alignments).toEqual([
      {
        id: 'surroundings-frontage-1-road',
        separator: 'primary-road',
        centerline: [
          [22.85, -52.7],
          [22.85, 52.7],
        ],
        corridorIds: ['surroundings-frontage-1'],
        junctionIds: [],
      },
      {
        id: 'surroundings-frontage-2-road',
        separator: 'primary-road',
        centerline: [
          [52.7, 22.85],
          [-52.7, 22.85],
        ],
        corridorIds: ['surroundings-frontage-2'],
        junctionIds: [],
      },
    ])
  })

  test('extends a secondary feeder from the primary edge to the outer ring', () => {
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

    expect(withPrimaryAtEnd[0]).toMatchObject({
      separator: 'secondary-road',
      junctionIds: [],
    })
    expect(withPrimaryAtEnd[0]?.centerline[0]?.[0]).toBeCloseTo(20.2)
    expect(withPrimaryAtEnd[0]?.centerline[0]?.[1]).toBeCloseTo(-52.7)
    expect(withPrimaryAtEnd[0]?.centerline[1]?.[0]).toBeCloseTo(20.2)
    expect(withPrimaryAtEnd[0]?.centerline[1]?.[1]).toBeCloseTo(15)

    expect(withPrimaryAtStart[1]).toMatchObject({
      separator: 'secondary-road',
      junctionIds: [],
    })
    expect(withPrimaryAtStart[1]?.centerline[0]?.[0]).toBeCloseTo(15)
    expect(withPrimaryAtStart[1]?.centerline[0]?.[1]).toBeCloseTo(20.2)
    expect(withPrimaryAtStart[1]?.centerline[1]?.[0]).toBeCloseTo(-52.7)
    expect(withPrimaryAtStart[1]?.centerline[1]?.[1]).toBeCloseTo(20.2)
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
