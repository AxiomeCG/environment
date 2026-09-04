import { describe, expect, test } from 'bun:test'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  convexPolygonsOverlap,
  deriveHousePlans,
  deriveNeighborCellClassifications,
  deriveRoadReservations,
  houseFacadeFrame,
  houseGarageFootprint,
} from './neighborhood'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const PRIMARY = { separator: 'primary-road', access: 'none' } as const satisfies FrontageContext
const SECONDARY = { separator: 'secondary-road', access: 'none' } as const satisfies FrontageContext

function neighborhood(
  contexts: Record<number, FrontageContext>,
  seed = 'pascal-neighborhood-v1',
  site: readonly Point2[] = SITE,
) {
  const segments = deriveBoundarySegments({ points: site, contexts })
  const layout = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const network = deriveRuntimeRoadNetwork(layout)
  const cells = deriveNeighborCellClassifications(segments, layout, network, seed)
  return { cells, houses: deriveHousePlans(cells, seed), network }
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  const edgeX = end[0] - start[0]
  const edgeY = end[1] - start[1]
  const relativeX = point[0] - start[0]
  const relativeY = point[1] - start[1]
  const cross = edgeX * relativeY - edgeY * relativeX
  const dot = relativeX * edgeX + relativeY * edgeY
  return Math.abs(cross) < 1e-6 && dot >= -1e-6 && dot <= edgeX ** 2 + edgeY ** 2 + 1e-6
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!
    const end = polygon[index]!
    if (pointOnSegment(point, start, end)) return true
    if (
      (start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < (end[0] - start[0]) * (point[1] - start[1])
        / (end[1] - start[1]) + start[0]
    ) inside = !inside
  }
  return inside
}


function assertOpeningsStayInsideFacades(
  houses: ReturnType<typeof deriveHousePlans>,
): void {
  for (const house of houses) {
    expect(house.facades.flatMap(({ openings }) => openings).filter(({ kind }) => kind === 'door'))
      .toHaveLength(1)
    expect(house.facades.find(({ side }) => side === 'front')?.openings.some(({ kind }) => kind === 'door'))
      .toBe(true)

    for (const facade of house.facades) {
      const { length } = houseFacadeFrame(house, facade.side)
      for (const opening of facade.openings) {
        expect(Math.abs(opening.offset) + opening.width / 2).toBeLessThan(length / 2 - 0.2)
        expect(opening.bottom + opening.height).toBeLessThan(house.wallHeight - 0.2)
      }
      for (let firstIndex = 0; firstIndex < facade.openings.length; firstIndex += 1) {
        const first = facade.openings[firstIndex]!
        for (let secondIndex = firstIndex + 1; secondIndex < facade.openings.length; secondIndex += 1) {
          const second = facade.openings[secondIndex]!
          const separatedHorizontally = Math.abs(first.offset - second.offset)
            >= (first.width + second.width) / 2
          const separatedVertically = first.bottom + first.height <= second.bottom
            || second.bottom + second.height <= first.bottom
          expect(separatedHorizontally || separatedVertically).toBe(true)
        }
      }
    }
  }
}

describe('procedural surroundings neighborhood', () => {
  test('derives a deterministic bounded mix of houses, gardens, and groves', () => {
    const first = neighborhood({})
    const second = neighborhood({})

    expect(first.cells).toEqual(second.cells)
    expect(first.houses).toEqual(second.houses)
    expect(first.cells.every(({ use }) => use === 'buildable')).toBe(true)
    // 30 m frontages split into two lots each, plus four corner lots.
    expect(first.cells).toHaveLength(12)
    const occupiedLots = first.cells.filter(({ occupancy }) => occupancy === 'house')
    expect(occupiedLots).toHaveLength(8)
    expect(first.cells.filter(({ occupancy }) => occupancy === 'garden')).toHaveLength(2)
    expect(first.cells.filter(({ occupancy }) => occupancy === 'grove')).toHaveLength(2)
    expect(first.cells.filter(({ occupancy }) => occupancy === 'none')).toEqual([])
    expect(first.houses).toHaveLength(occupiedLots.length)
    expect(first.houses.every(({ cellId }) =>
      first.cells.find(({ id }) => id === cellId)?.occupancy === 'house')).toBe(true)
    expect(new Set(first.cells.map(({ id }) => id)).size).toBe(first.cells.length)
  })

  test('makes corner lots less likely to contain a house', () => {
    let cornerHouses = 0
    let cornerLots = 0
    let frontageHouses = 0
    let frontageLots = 0

    for (let index = 0; index < 64; index += 1) {
      for (const cell of neighborhood({}, `occupancy-sample-${index}`).cells) {
        if (!cell.buildArea) continue
        if (cell.kind === 'corner') {
          cornerLots += 1
          if (cell.occupancy === 'house') cornerHouses += 1
        } else {
          frontageLots += 1
          if (cell.occupancy === 'house') frontageHouses += 1
        }
      }
    }

    expect(cornerHouses / cornerLots).toBeLessThan(frontageHouses / frontageLots)
  })

  test('balances the extra open lot between garden and grove across seeds', () => {
    const smallSite = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ] as const satisfies readonly Point2[]
    const contexts = { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: SECONDARY }
    let gardenSamples = 0
    let groveSamples = 0

    for (let index = 0; index < 32; index += 1) {
      const openLots = neighborhood(contexts, `odd-open-sample-${index}`, smallSite).cells
        .filter(({ occupancy }) => occupancy === 'garden' || occupancy === 'grove')
      expect(openLots).toHaveLength(1)
      if (openLots[0]!.occupancy === 'garden') gardenSamples += 1
      else groveSamples += 1
    }

    expect(gardenSamples).toBeGreaterThan(0)
    expect(groveSamples).toBeGreaterThan(0)
  })

  test('attaches a garage wing inside the lot on the side away from the entry', () => {
    const { cells, houses } = neighborhood({ 0: SECONDARY, 1: SECONDARY, 2: PRIMARY, 3: SECONDARY })
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const garaged = houses.filter(({ garage }) => garage)

    expect(garaged.length).toBeGreaterThan(0)
    expect(garaged.length).toBeLessThan(houses.length)
    for (const house of garaged) {
      const footprint = houseGarageFootprint(house)!
      const cell = cellById.get(house.cellId)!
      expect(footprint.every((point) => pointInPolygon(point, cell.polygon))).toBe(true)
      expect(footprint.every((point) => pointInPolygon(point, house.footprint))).toBe(true)
      const door = house.facades.find(({ side }) => side === 'front')!.openings
        .find(({ kind }) => kind === 'door')!
      expect(Math.sign(door.offset)).toBe(-house.garage!.side)
      const wingSide = house.garage!.side === 1 ? 'right' : 'left'
      expect(house.facades.find(({ side }) => side === wingSide)!.openings).toEqual([])
    }
  })

  test('clusters a coherent seeded mix of architectural typologies around the site', () => {
    const { cells, houses } = neighborhood({})
    const styles = new Set(houses.map(({ style }) => style))
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const ringOrder = [...houses].sort((left, right) => {
      const leftCell = cellById.get(left.cellId)!
      const rightCell = cellById.get(right.cellId)!
      const leftPosition = leftCell.frontageIndices[0]! * 3
        + (leftCell.kind === 'corner' ? 2 : leftCell.lotIndex)
      const rightPosition = rightCell.frontageIndices[0]! * 3
        + (rightCell.kind === 'corner' ? 2 : rightCell.lotIndex)
      return leftPosition - rightPosition
    })

    expect(styles.size).toBeGreaterThanOrEqual(2)
    expect(styles.size).toBeLessThanOrEqual(3)
    expect(ringOrder.slice(1).some((house, index) => house.style === ringOrder[index]!.style))
      .toBe(true)
    for (const house of houses) {
      const expected = house.style === 'farmhouse'
        ? { storeys: 2, roof: 'gambrel', pitches: [40, 44] } as const
        : house.style === 'pavilion'
          ? { storeys: 1, roof: 'hip', pitches: [22, 26] } as const
          : { storeys: 1, roof: 'gable', pitches: [36, 40] } as const
      expect(house.storeys).toBe(expected.storeys)
      expect(house.roof.kind).toBe(expected.roof)
      expect([...expected.pitches] as number[]).toContain(house.roof.pitchDegrees)
      expect(house.roof.pitchDegrees).toBe(expected.pitches[house.variant])
    }
    for (const house of houses) {
      expect(house.palette.foundation).toMatch(/^#[\da-f]{6}$/)
      expect(house.palette.glass).toMatch(/^#[\da-f]{6}$/)
    }
  })

  test('uses a finite seeded variant set so distinct houses still share prototypes', () => {
    const houses = neighborhood({}).houses
    const prototypesByVariant = new Map<string, Set<string>>()
    const prototypeKeys = new Set<string>()

    for (const house of houses) {
      const variantKey = `${house.style}:${house.variant}`
      const prototype = JSON.stringify({
        width: house.width,
        depth: house.depth,
        storeys: house.storeys,
        wallHeight: house.wallHeight,
        roof: house.roof,
        facades: house.facades,
        palette: house.palette,
      })
      const prototypes = prototypesByVariant.get(variantKey) ?? new Set<string>()
      prototypes.add(prototype)
      prototypesByVariant.set(variantKey, prototypes)
      prototypeKeys.add(variantKey)
    }

    expect([...prototypesByVariant.values()].every(({ size }) => size === 1)).toBe(true)
    expect(prototypeKeys.size).toBeGreaterThan(3)
    expect(prototypeKeys.size).toBeLessThanOrEqual(6)
    expect(neighborhood({}, 'alternate-neighborhood').houses.map(({ variant }) => variant))
      .not.toEqual(houses.map(({ variant }) => variant))
  })

  test('places at most one house in each visible neighbor cell', () => {
    const { cells, houses } = neighborhood({})

    for (const cell of cells) {
      const occupants = houses.filter((house) =>
        convexPolygonsOverlap(house.footprint, cell.polygon))
      expect(occupants.length).toBeLessThanOrEqual(1)
    }
  })

  test('keeps houses in the buildable portions of road-covered tiles', () => {
    const routed = neighborhood({
      0: SECONDARY,
      1: SECONDARY,
      2: PRIMARY,
      3: SECONDARY,
    })
    const buildableCells = routed.cells.filter(({ buildArea }) => buildArea !== undefined)
    const occupiedCellIds = new Set(routed.houses.map(({ cellId }) => cellId))

    expect(buildableCells.length).toBeGreaterThanOrEqual(4)
    expect(buildableCells.some(({ roadCoverage }) => roadCoverage > 1e-7)).toBe(true)
    expect(routed.houses).toHaveLength(
      buildableCells.filter(({ occupancy }) => occupancy === 'house').length,
    )
    for (const cell of routed.cells) {
      expect(occupiedCellIds.has(cell.id)).toBe(cell.occupancy === 'house')
    }
  })

  test('keeps every house inside its cell and clear of road reservations', () => {
    const { cells, houses, network } = neighborhood({ 1: SECONDARY, 2: PRIMARY })
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const reservations = deriveRoadReservations(network)

    for (const house of houses) {
      const cell = cellById.get(house.cellId)
      expect(cell).toBeDefined()
      expect(house.footprint.every((point) => pointInPolygon(point, cell!.polygon))).toBe(true)
      expect(reservations.some(({ clearancePolygon }) =>
        convexPolygonsOverlap(house.footprint, clearancePolygon))).toBe(false)
    }
  })

  test('keeps restrained placement variation facing each resolved road access', () => {
    const { houses } = neighborhood({})
    let rotatedHouses = 0

    for (const house of houses) {
      const toAccess: Point2 = [
        house.access.point[0] - house.center[0],
        house.access.point[1] - house.center[1],
      ]
      const magnitude = Math.hypot(toAccess[0], toAccess[1])
      const alignment = (toAccess[0] * house.front[0] + toAccess[1] * house.front[1]) / magnitude
      const setback = toAccess[0] * house.front[0] + toAccess[1] * house.front[1] - house.depth / 2
      expect(alignment).toBeGreaterThanOrEqual(Math.cos(2.5 * Math.PI / 180) - 1e-7)
      expect(setback).toBeGreaterThan(3.1)
      expect(setback).toBeLessThan(5.9)
      if (alignment < 1 - 1e-7) rotatedHouses += 1
    }
    expect(rotatedHouses).toBeGreaterThan(0)
  })

  test('keeps doors and windows within non-overlapping facade bays', () => {
    assertOpeningsStayInsideFacades(neighborhood({}).houses)
    assertOpeningsStayInsideFacades(neighborhood({ 1: SECONDARY, 2: PRIMARY }).houses)
  })
})
