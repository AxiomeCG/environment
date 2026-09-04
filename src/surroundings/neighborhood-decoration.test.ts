import { describe, expect, spyOn, test } from 'bun:test'
import { Group, InstancedMesh, Matrix4 } from 'three'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  deriveHousePlans,
  deriveNeighborCellClassifications,
} from './neighborhood'
import { updatePascalHouseInstances } from './house-neighborhood'
import { buildFenceInstances } from './neighborhood-decoration-renderer'
import { deriveNeighborhoodDecorations } from './neighborhood-decoration'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]

function neighborhood(contexts: Record<number, FrontageContext> = {}) {
  const segments = deriveBoundarySegments({ points: SITE, contexts })
  const layout = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const network = deriveRuntimeRoadNetwork(layout)
  const cells = deriveNeighborCellClassifications(segments, layout, network)
  const houses = deriveHousePlans(cells)
  return {
    cells,
    houses,
    layout,
    decorations: deriveNeighborhoodDecorations(cells, houses, layout.corridors),
  }
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!
    const end = polygon[index]!
    const edgeX = end[0] - start[0]
    const edgeY = end[1] - start[1]
    const relativeX = point[0] - start[0]
    const relativeY = point[1] - start[1]
    const cross = edgeX * relativeY - edgeY * relativeX
    const projection = relativeX * edgeX + relativeY * edgeY
    if (Math.abs(cross) < 1e-6 && projection >= -1e-6
      && projection <= edgeX ** 2 + edgeY ** 2 + 1e-6) return true
    if (
      (start[1] > point[1]) !== (end[1] > point[1])
      && point[0] < edgeX * (point[1] - start[1]) / edgeY + start[0]
    ) inside = !inside
  }
  return inside
}

describe('neighborhood decoration grammar', () => {
  test('is deterministic and keeps each lot prop in its owning buildable cell', () => {
    const first = neighborhood()
    const second = neighborhood()

    expect(first.decorations).toEqual(second.decorations)
    const cellById = new Map(first.cells.map((cell) => [cell.id, cell]))
    const houseByCell = new Map(first.houses.map((house) => [house.cellId, house]))
    const lotPlacements = [
      ...first.decorations.catalogProps,
      ...first.decorations.trees,
    ]
    for (const prop of lotPlacements) {
      if (!prop.cellId) continue
      const cell = cellById.get(prop.cellId)!
      const house = houseByCell.get(prop.cellId)
      expect(pointInPolygon(prop.position, cell.polygon)).toBe(true)
      if (house) {
        const relativeX = prop.position[0] - house.center[0]
        const relativeY = prop.position[1] - house.center[1]
        const across = Math.abs(relativeX * house.right[0] + relativeY * house.right[1])
        const along = Math.abs(relativeX * house.front[0] + relativeY * house.front[1])
        expect(across >= house.width / 2 + 0.3 || along >= house.depth / 2 + 0.3).toBe(true)
      } else {
        expect(['garden', 'grove']).toContain(cell.occupancy)
        expect(pointInPolygon(prop.position, cell.buildArea!.footprint)).toBe(true)
      }
    }

    const yardTrees = first.decorations.trees.filter(({ cellId }) =>
      cellId && cellById.get(cellId)?.occupancy === 'house')
    const openLotTrees = first.decorations.trees.filter(({ cellId }) =>
      cellId && cellById.get(cellId)?.occupancy !== 'house')
    expect(yardTrees.length).toBeGreaterThan(0)
    expect(yardTrees.length).toBeLessThanOrEqual(first.houses.length * 2)
    expect(openLotTrees.length).toBeGreaterThan(0)
    // Shared ez-tree variants: the whole ring must fit a handful of generations.
    const variants = new Set(first.decorations.trees.map(({ species, size, seed }) => `${species}:${size}:${seed}`))
    expect(variants.size).toBeLessThanOrEqual(16)
    for (const tree of first.decorations.trees) {
      expect(tree.height).toBeGreaterThan(3)
      expect(tree.height).toBeLessThan(10)
    }
    const gardenCount = first.cells.filter(({ occupancy }) => occupancy === 'garden').length
    expect(first.decorations.catalogProps.filter(({ assetId }) => assetId === 'bush').length)
      .toBeLessThanOrEqual(first.houses.length * 3 + gardenCount * 6)
  })

  test('uses existing bounded vegetation pools for garden and grove lots', () => {
    const { cells, houses, decorations } = neighborhood()
    const occupiedCellIds = new Set(houses.map(({ cellId }) => cellId))
    const gardens = cells.filter(({ occupancy }) => occupancy === 'garden')
    const groves = cells.filter(({ occupancy }) => occupancy === 'grove')

    expect(gardens).toHaveLength(2)
    expect(groves).toHaveLength(2)
    for (const cell of [...gardens, ...groves]) {
      expect(occupiedCellIds.has(cell.id)).toBe(false)
      expect(decorations.paving.some(({ cellId }) => cellId === cell.id)).toBe(false)
      expect(decorations.mailboxes.some(({ cellId }) => cellId === cell.id)).toBe(false)
      expect(decorations.fences.some(({ cellId }) => cellId === cell.id)).toBe(false)
    }
    for (const cell of gardens) {
      expect(decorations.catalogProps.filter(({ cellId, assetId }) =>
        cellId === cell.id && assetId === 'bush')).toHaveLength(6)
      expect(decorations.trees.filter(({ cellId }) => cellId === cell.id)).toHaveLength(1)
    }
    for (const cell of groves) {
      expect(decorations.trees.filter(({ cellId }) => cellId === cell.id)).toHaveLength(5)
    }
  })

  test('encloses back yards with fence runs that stay inside the lot and off the street side', () => {
    const { cells, houses, decorations } = neighborhood()
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const houseByCell = new Map(houses.map((house) => [house.cellId, house]))

    expect(decorations.fences.length).toBeGreaterThan(0)
    expect(decorations.fences.length).toBeLessThanOrEqual(houses.length * 3)
    expect(new Set(decorations.fences.map(({ cellId }) => cellId)).size).toBeLessThan(houses.length)
    for (const fence of decorations.fences) {
      const cell = cellById.get(fence.cellId)!
      const house = houseByCell.get(fence.cellId)!
      const halfSpan: Point2 = [
        Math.cos(fence.rotationY) * fence.length / 2,
        -Math.sin(fence.rotationY) * fence.length / 2,
      ]
      for (const sign of [-1, 1]) {
        const end: Point2 = [
          fence.position[0] + sign * halfSpan[0],
          fence.position[1] + sign * halfSpan[1],
        ]
        expect(pointInPolygon(end, cell.polygon)).toBe(true)
        const forward = (end[0] - house.center[0]) * house.front[0]
          + (end[1] - house.center[1]) * house.front[1]
        // Never past the house's front third: the street side stays open.
        expect(forward).toBeLessThan(house.depth / 2 - 1.5)
      }
    }
  })

  test('paves a driveway to every garage and a path to every entry inside the lot', () => {
    const { cells, houses, decorations } = neighborhood({
      0: { separator: 'secondary-road', access: 'none' },
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
      3: { separator: 'secondary-road', access: 'none' },
    })
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const houseByCell = new Map(houses.map((house) => [house.cellId, house]))
    const garaged = houses.filter(({ garage }) => garage)

    expect(decorations.paving.filter(({ kind }) => kind === 'driveway')).toHaveLength(garaged.length)
    expect(decorations.paving.filter(({ kind }) => kind === 'path')).toHaveLength(houses.length)
    expect(decorations.mailboxes).toHaveLength(houses.length)
    for (const slab of decorations.paving) {
      const cell = cellById.get(slab.cellId)!
      const house = houseByCell.get(slab.cellId)!
      expect(slab.polygon.every((point) => pointInPolygon(point, cell.polygon))).toBe(true)
      const forward = slab.polygon.map((point) =>
        (point[0] - house.center[0]) * house.front[0] + (point[1] - house.center[1]) * house.front[1])
      if (slab.kind === 'patio') expect(Math.max(...forward)).toBeLessThanOrEqual(-house.depth / 2 + 0.1)
      else expect(Math.min(...forward)).toBeGreaterThanOrEqual(house.depth / 2 - 0.1)
    }
    for (const mailbox of decorations.mailboxes) {
      const house = houseByCell.get(mailbox.cellId)!
      const toBox: Point2 = [mailbox.position[0] - house.center[0], mailbox.position[1] - house.center[1]]
      expect(toBox[0] * house.front[0] + toBox[1] * house.front[1]).toBeGreaterThan(house.depth / 2)
    }
    const cars = decorations.catalogProps.filter(({ assetId }) => assetId === 'tesla')
    expect(cars.length).toBeGreaterThan(0)
    expect(cars.length).toBeLessThanOrEqual(garaged.length)
    for (const car of cars) {
      const house = houseByCell.get(car.cellId!)!
      expect(house.garage).toBeDefined()
      const driveway = decorations.paving.find(({ kind, cellId }) => kind === 'driveway' && cellId === car.cellId)!
      expect(pointInPolygon(car.position, driveway.polygon)).toBe(true)
    }
  })

  test('lines every road with street trees on the neighbour side', () => {
    const { layout, decorations } = neighborhood({
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
    })
    for (const corridor of layout.corridors) {
      const trees = decorations.trees.filter(({ id }) => id.startsWith(`${corridor.id}-street-tree-`))
      expect(trees.length).toBeGreaterThanOrEqual(2)
      for (const tree of trees) {
        const relative: Point2 = [
          tree.position[0] - corridor.road.center[0],
          tree.position[1] - corridor.road.center[1],
        ]
        const outward = relative[0] * corridor.frame.outwardNormal[0]
          + relative[1] * corridor.frame.outwardNormal[1]
        expect(outward).toBeCloseTo(corridor.road.width / 2 + 1.1)
      }
    }
  })

  test('reserves repeated lights and one hydrant for primary roads only', () => {
    const secondaryOnly = neighborhood({
      1: { separator: 'secondary-road', access: 'none' },
    })
    expect(secondaryOnly.decorations.streetLights).toEqual([])
    expect(secondaryOnly.decorations.catalogProps.some(({ assetId }) => assetId === 'hydrant'))
      .toBe(false)

    const withPrimary = neighborhood({
      2: { separator: 'primary-road', access: 'none' },
    })
    const primary = withPrimary.layout.corridors.find(({ separator }) => separator === 'primary-road')!
    expect(withPrimary.decorations.streetLights.length).toBeGreaterThanOrEqual(2)
    expect(withPrimary.decorations.catalogProps.filter(({ assetId }) => assetId === 'hydrant'))
      .toHaveLength(1)

    for (const light of withPrimary.decorations.streetLights) {
      const relative: Point2 = [
        light.position[0] - primary.road.center[0],
        light.position[1] - primary.road.center[1],
      ]
      const outward = relative[0] * primary.frame.outwardNormal[0]
        + relative[1] * primary.frame.outwardNormal[1]
      expect(outward).toBeCloseTo(primary.road.width / 2 + 1.8)
    }
  })
  test('renders every painted boundary run from one scaled instanced wall', () => {
    const { decorations } = neighborhood({
      0: { separator: 'secondary-road', access: 'none' },
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
      3: { separator: 'secondary-road', access: 'none' },
    })
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const instances = buildFenceInstances(decorations.fences)

      expect(error).not.toHaveBeenCalled()
      expect(instances.userData.fenceCount).toBe(decorations.fences.length)
      expect(instances.userData.prototypeCount).toBe(1)
      expect(instances.children).toHaveLength(1)
      const walls = instances.children[0]
      expect(walls).toBeInstanceOf(InstancedMesh)
      expect((walls as InstancedMesh).count).toBe(decorations.fences.length)
      expect((walls as InstancedMesh).geometry.getAttribute('position')).toBeDefined()
      ;(walls as InstancedMesh).dispose()
    } finally {
      error.mockRestore()
    }
  })

  test('replaces every house instance when a road moves its lot', () => {
    const plan = neighborhood({
      0: { separator: 'secondary-road', access: 'none' },
    }).houses[0]!
    const movedPlan = {
      ...plan,
      center: [plan.center[0] + 4, plan.center[1] - 3] as Point2,
      front: plan.right,
      right: [-plan.front[0], -plan.front[1]] as Point2,
    }
    const root = new Group()
    const parent = new Group()
    parent.add(root)

    updatePascalHouseInstances(root, [plan])
    const previousChildren = [...root.children]
    const previousMatrix = new Matrix4()
    ;(previousChildren[0] as InstancedMesh).getMatrixAt(0, previousMatrix)

    updatePascalHouseInstances(root, [movedPlan])
    const currentMatrix = new Matrix4()
    ;(root.children[0] as InstancedMesh).getMatrixAt(0, currentMatrix)

    expect(parent.children).toEqual([root])
    expect(previousChildren.every((child) => child.parent === null)).toBe(true)
    expect(root.userData.houseCount).toBe(1)
    expect(currentMatrix.equals(previousMatrix)).toBe(false)

    for (const child of root.children) {
      if (child instanceof InstancedMesh) child.dispose()
    }
    root.clear()
  })

  test('assigns globally unique stable ids to every repeated prop', () => {
    const { decorations } = neighborhood({
      0: { separator: 'secondary-road', access: 'none' },
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
      3: { separator: 'secondary-road', access: 'none' },
    })
    const ids = [
      ...decorations.catalogProps.map(({ id }) => id),
      ...decorations.fences.map(({ id }) => id),
      ...decorations.streetLights.map(({ id }) => id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
