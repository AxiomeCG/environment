import { describe, expect, spyOn, test } from 'bun:test'
import { Group, InstancedMesh, Matrix4, Vector3 } from 'three'
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
import {
  buildParkedCarInstances,
  buildShrubInstances,
} from './neighborhood-decoration-renderer'
import {
  deriveNeighborhoodDecorations,
  NEIGHBORHOOD_TREE_BUDGET,
} from './neighborhood-decoration'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { buildRoadPresentationPlan, type RoadPresentationSurfaceKind } from './streetscape-road-presentation'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const SECONDARY = { separator: 'secondary-road', access: 'none' } as const satisfies FrontageContext
const CONNECTED = { 2: SECONDARY } as const satisfies Record<number, FrontageContext>

function neighborhood(contexts: Record<number, FrontageContext> = CONNECTED) {
  const segments = deriveBoundarySegments({ points: SITE, contexts })
  const layout = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const network = deriveRuntimeRoadNetwork(layout)
  const cells = deriveNeighborCellClassifications(layout, network)
  const houses = deriveHousePlans(cells)
  const road = buildRoadPresentationPlan(network)
  return {
    cells,
    houses,
    layout,
    network,
    road,
    decorations: deriveNeighborhoodDecorations(cells, houses, layout.corridors, network, road),
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
    expect(new Set(first.decorations.trees.map(({ seed }) => seed)).size)
      .toBeLessThanOrEqual(8)
    for (const tree of first.decorations.trees) {
      expect(tree.height).toBeGreaterThan(4)
      expect(tree.height).toBeLessThanOrEqual(11.2)
    }
    for (const tree of yardTrees) {
      const house = houseByCell.get(tree.cellId!)!
      const relative: Point2 = [
        tree.position[0] - house.center[0],
        tree.position[1] - house.center[1],
      ]
      const across = Math.abs(relative[0] * house.right[0] + relative[1] * house.right[1])
      const along = Math.abs(relative[0] * house.front[0] + relative[1] * house.front[1])
      expect(across >= house.width / 2 + 2.5 || along >= house.depth / 2 + 2.5).toBe(true)
      expect(Math.hypot(
        tree.position[0] - house.access.point[0],
        tree.position[1] - house.access.point[1],
      )).toBeGreaterThanOrEqual(3.4)
    }
    const gardenCount = first.cells.filter(({ occupancy }) => occupancy === 'garden').length
    expect(first.decorations.catalogProps.filter(({ assetId }) => assetId === 'bush').length)
      .toBeLessThanOrEqual(first.houses.length * 3 + gardenCount * 6)
  })

  test('clusters garden and grove trees without repeating a fixed full grid', () => {
    const { cells, houses, decorations } = neighborhood()
    const occupiedCellIds = new Set(houses.map(({ cellId }) => cellId))
    const gardens = cells.filter(({ occupancy }) => occupancy === 'garden')
    const groves = cells.filter(({ occupancy }) => occupancy === 'grove')

    expect(gardens.length).toBeGreaterThan(0)
    expect(groves.length).toBeGreaterThan(0)
    for (const cell of [...gardens, ...groves]) {
      expect(occupiedCellIds.has(cell.id)).toBe(false)
      expect(decorations.paving.some(({ cellId }) => cellId === cell.id)).toBe(false)
      expect(decorations.mailboxes.some(({ cellId }) => cellId === cell.id)).toBe(false)
      expect(decorations.fences.some(({ cellId }) => cellId === cell.id)).toBe(false)
    }
    for (const cell of gardens) {
      const bushes = decorations.catalogProps.filter(({ cellId, assetId }) =>
        cellId === cell.id && assetId === 'bush')
      const gardenTrees = decorations.trees.filter(({ cellId }) => cellId === cell.id)
      expect(bushes.length).toBeGreaterThan(0)
      expect(gardenTrees.length).toBeGreaterThan(0)
      expect(gardenTrees.length).toBeLessThanOrEqual(3)
      for (const tree of gardenTrees) {
        expect(Math.max(...bushes.map(({ position }) =>
          Math.hypot(position[0] - tree.position[0], position[1] - tree.position[1]))))
          .toBeLessThan(7)
      }
    }
    for (const cell of groves) {
      const groveTrees = decorations.trees.filter(({ cellId }) => cellId === cell.id)
      expect(groveTrees.length).toBeGreaterThan(0)
      expect(groveTrees.length).toBeLessThanOrEqual(6)
      const speciesCounts = new Map<string, number>()
      for (const { species } of groveTrees) {
        speciesCounts.set(species, (speciesCounts.get(species) ?? 0) + 1)
      }
      expect(Math.max(...speciesCounts.values())).toBeGreaterThanOrEqual(groveTrees.length - 1)
    }
  })

  test('uses varied maturity and species within the bounded first-ring budget', () => {
    const { houses, decorations } = neighborhood({
      0: { separator: 'secondary-road', access: 'none' },
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'secondary-road', access: 'none' },
      3: { separator: 'primary-road', access: 'none' },
    })
    const species = new Set(decorations.trees.map((tree) => tree.species))
    const heights = decorations.trees.map(({ height }) => height)

    expect(decorations.trees.length).toBeGreaterThan(houses.length)
    expect(decorations.trees.length).toBeLessThanOrEqual(NEIGHBORHOOD_TREE_BUDGET)
    expect(species.has('oak')).toBe(true)
    expect(species.has('pine')).toBe(true)
    expect(species.size).toBeGreaterThanOrEqual(3)
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(3)
    expect(decorations.trees.filter(({ species: value }) => value === 'pine')
      .every(({ treeType }) => treeType === 'evergreen')).toBe(true)
    expect(decorations.trees.filter(({ species: value }) => value !== 'pine')
      .every(({ treeType }) => treeType === 'deciduous')).toBe(true)
  })

  test('grounds shared near-tree prototypes within the instance budget', async () => {
    const originalDocument = globalThis.document
    const documentStub = {
      createElementNS: () => ({
        addEventListener() {},
        removeEventListener() {},
        set src(_value: string) {},
      }),
    } as unknown as Document
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: documentStub,
      writable: true,
    })

    try {
      // EZ-Tree creates texture images at module scope, after this DOM stub exists.
      const {
        buildTreeInstances,
        NEIGHBORHOOD_TREE_PROTOTYPE_CAP,
      } = await import('./neighborhood-trees')
      const { decorations } = neighborhood({
        0: { separator: 'secondary-road', access: 'none' },
        1: { separator: 'secondary-road', access: 'none' },
        2: { separator: 'secondary-road', access: 'none' },
        3: { separator: 'primary-road', access: 'none' },
      })
      const heightAt = (x: number, z: number) => x * 0.012 - z * 0.007
      const root = buildTreeInstances(decorations.trees, heightAt)
      const instances = root.children.filter((child) => child instanceof InstancedMesh)

      expect(root.userData.treeCount).toBe(decorations.trees.length)
      expect(root.userData.treeCount).toBeLessThanOrEqual(NEIGHBORHOOD_TREE_BUDGET)
      expect(root.userData.variantCount).toBeLessThanOrEqual(NEIGHBORHOOD_TREE_PROTOTYPE_CAP)
      expect(root.userData.prototypePoolCap).toBe(NEIGHBORHOOD_TREE_PROTOTYPE_CAP)
      expect(root.userData.drawCallCount).toBeLessThanOrEqual(NEIGHBORHOOD_TREE_PROTOTYPE_CAP * 2)
      expect(root.userData.visibleTriangleCount).toBeLessThanOrEqual(100_000)
      expect(root.userData.ownedBufferBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(instances.filter(({ name }) => name.includes('leaves'))
        .every(({ instanceColor }) => instanceColor !== null)).toBe(true)

      const transform = new Matrix4()
      const rootScales = new Set<number>()
      for (const instance of instances) {
        for (let index = 0; index < instance.count; index += 1) {
          transform.fromArray(instance.instanceMatrix.array, index * 16)
          const elements = transform.elements
          const x = elements[12]!, y = elements[13]!, z = elements[14]!
          expect(y).toBeCloseTo(heightAt(x, z), 5)
          const scaleX = Math.hypot(elements[0]!, elements[1]!, elements[2]!)
          const scaleZ = Math.hypot(elements[8]!, elements[9]!, elements[10]!)
          rootScales.add(Math.round(scaleX / scaleZ * 1_000))
        }
      }
      expect(rootScales.size).toBeGreaterThan(1)

      for (const instance of instances) instance.dispose()
    } finally {
      if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
      else Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
        writable: true,
      })
    }
  }, 30_000)

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
    const { cells, houses, decorations, network } = neighborhood({
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
      else {
        expect(Math.min(...forward)).toBeGreaterThanOrEqual(house.depth / 2 - 0.1)
        expect(house.access.kind).toBe('road')
        expect(network.edges[house.access.roadId]).toBeDefined()
      }
    }
    for (const mailbox of decorations.mailboxes) {
      const house = houseByCell.get(mailbox.cellId)!
      const toBox: Point2 = [mailbox.position[0] - house.center[0], mailbox.position[1] - house.center[1]]
      expect(toBox[0] * house.front[0] + toBox[1] * house.front[1]).toBeGreaterThan(house.depth / 2)
    }
    const cars = decorations.catalogProps.filter(({ assetId }) => assetId === 'parked-car')
    expect(cars.length).toBeGreaterThan(0)
    expect(cars.length).toBeLessThanOrEqual(garaged.length)
    for (const car of cars) {
      const house = houseByCell.get(car.cellId!)!
      expect(house.garage).toBeDefined()
      const driveway = decorations.paving.find(({ kind, cellId }) => kind === 'driveway' && cellId === car.cellId)!
      expect(pointInPolygon(car.position, driveway.polygon)).toBe(true)
      const carForward: Point2 = [Math.sin(car.rotationY), Math.cos(car.rotationY)]
      expect(carForward[0] * -house.front[0] + carForward[1] * -house.front[1])
        .toBeCloseTo(1)
      expect(car.scale).toBe(1)
    }
  })

  test('plants coherent but nonperiodic verge trees clear of roads and drives', () => {
    const { layout, houses, decorations } = neighborhood({
      1: { separator: 'secondary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
    })
    const streetTrees = decorations.trees.filter(({ id }) => id.includes('-street-tree-'))
    const observedSpacings = new Set<number>()
    expect(streetTrees.length).toBeGreaterThan(0)
    for (const corridor of layout.corridors) {
      const trees = streetTrees.filter(({ id }) =>
        id.startsWith(`${corridor.id}-street-tree-`))
      expect(new Set(trees.map(({ species }) => species)).size).toBeLessThanOrEqual(1)
      const stations: number[] = []
      for (const tree of trees) {
        const relative: Point2 = [
          tree.position[0] - corridor.road.center[0],
          tree.position[1] - corridor.road.center[1],
        ]
        const outward = relative[0] * corridor.frame.outwardNormal[0]
          + relative[1] * corridor.frame.outwardNormal[1]
        expect(outward).toBeGreaterThanOrEqual(corridor.road.width / 2 + 1.05)
        expect(outward).toBeLessThanOrEqual(corridor.road.width / 2 + 1.45)
        for (const house of houses) {
          expect(Math.hypot(
            tree.position[0] - house.access.point[0],
            tree.position[1] - house.access.point[1],
          )).toBeGreaterThanOrEqual(3.4)
        }
        stations.push(
          relative[0] * corridor.frame.tangent[0]
          + relative[1] * corridor.frame.tangent[1],
        )
      }
      stations.sort((first, second) => first - second)
      for (let index = 1; index < stations.length; index += 1) {
        observedSpacings.add(Math.round((stations[index]! - stations[index - 1]!) * 10))
      }
    }
    expect(observedSpacings.size).toBeGreaterThan(1)
  })

  test('keeps street trees clear of road junctions', () => {
    const plan = neighborhood({
      1: { separator: 'primary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
    })
    const junctions = Object.values(plan.network.junctions).map(({ nodeId }) =>
      plan.network.graphNodes[nodeId]!.position)
    const streetTrees = plan.decorations.trees.filter(({ id }) => id.includes('-street-tree-'))

    expect(junctions.length).toBeGreaterThan(1)
    expect(streetTrees.length).toBeGreaterThan(0)
    for (const tree of streetTrees) {
      for (const [x, , z] of junctions) {
        expect(Math.hypot(tree.position[0] - x, tree.position[1] - z)).toBeGreaterThanOrEqual(15)
      }
    }
  })

  test('keeps streetlight bases on sidewalks and outside traffic at crossings', () => {
    const plan = neighborhood({
      1: { separator: 'primary-road', access: 'none' },
      2: { separator: 'primary-road', access: 'none' },
    })
    const polygons = (kinds: readonly RoadPresentationSurfaceKind[]): Point2[][] => {
      const triangles: Point2[][] = []
      for (const surface of plan.road.surfaces) {
        if (!kinds.includes(surface.kind)) continue
        const { positions, indices } = surface.geometry
        for (let index = 0; index < indices.length; index += 3) {
          triangles.push([0, 1, 2].map((corner) => {
            const vertex = indices[index + corner]! * 3
            return [positions[vertex]!, positions[vertex + 2]!] as Point2
          }))
        }
      }
      return triangles
    }
    const sidewalks = polygons(['sidewalk'])
    const traffic = polygons(['carriageway', 'junction-carriageway', 'bike-lane', 'crosswalk'])
    expect(new Set(plan.decorations.streetLights.map(({ roadId }) => roadId)))
      .toEqual(new Set(plan.layout.corridors.map(({ road }) => road.id)))
    for (const light of plan.decorations.streetLights) {
      for (const [dx, dz] of [[0, 0], [-0.2, 0], [0.2, 0], [0, -0.2], [0, 0.2]]) {
        const base: Point2 = [light.position[0] + dx!, light.position[1] + dz!]
        expect(sidewalks.some((polygon) => pointInPolygon(base, polygon))).toBe(true)
        expect(traffic.some((polygon) => pointInPolygon(base, polygon))).toBe(false)
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
    expect(new Set(withPrimary.decorations.streetLights.map(({ roadId }) => roadId)))
      .toEqual(new Set([primary.road.id]))
    expect(withPrimary.decorations.catalogProps.filter(({ assetId }) => assetId === 'hydrant'))
      .toHaveLength(1)
  })
  test('renders bushes as one bounded multi-lobe shrub pool', () => {
    const { decorations } = neighborhood()
    const bushes = decorations.catalogProps.filter(({ assetId }) => assetId === 'bush')
    const root = buildShrubInstances(bushes)
    const shrubs = root.children[0]

    expect(root.userData.drawCallCount).toBe(1)
    expect(root.userData.instanceCount).toBe(bushes.length)
    expect(root.userData.lobeCount).toBe(7)
    expect(shrubs).toBeInstanceOf(InstancedMesh)
    expect((shrubs as InstancedMesh).count).toBe(bushes.length)
    expect((shrubs as InstancedMesh).instanceColor).not.toBeNull()

    const geometry = (shrubs as InstancedMesh).geometry
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new Vector3())
    expect(size.x / size.y).toBeLessThan(2.2)
    expect(size.z / size.y).toBeGreaterThan(0.8)
    expect((geometry.index?.count ?? geometry.getAttribute('position').count) / 3)
      .toBeLessThanOrEqual(140)
    ;(shrubs as InstancedMesh).dispose()
  })

  test('renders every parked car as two grounded shared batches under its triangle ceiling', () => {
    const { decorations } = neighborhood()
    const cars = decorations.catalogProps.filter(({ assetId }) => assetId === 'parked-car')
    const root = buildParkedCarInstances(cars, () => 2.25)
    const instances = root.children as InstancedMesh[]
    const matrix = new Matrix4()
    const position = new Vector3()

    expect(cars.length).toBeGreaterThan(0)
    expect(root.userData.drawCallCount).toBe(2)
    expect(root.userData.instanceCount).toBe(cars.length)
    expect(root.userData.prototypeTriangleCount).toBeLessThanOrEqual(500)
    expect(root.userData.visibleTriangleCount)
      .toBe(root.userData.prototypeTriangleCount * cars.length)
    expect(instances).toHaveLength(2)
    expect(instances[0]!.instanceColor).not.toBeNull()
    for (const mesh of instances) {
      expect(mesh).toBeInstanceOf(InstancedMesh)
      expect(mesh.count).toBe(cars.length)
      mesh.getMatrixAt(0, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.y).toBeCloseTo(2.25)
      mesh.dispose()
    }
    root.clear()
  })

  test('reuses every house batch when a road moves its lot', () => {
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
    expect(root.children).toEqual(previousChildren)
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
