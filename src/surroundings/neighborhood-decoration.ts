import type {
  ClassifiedNeighborCell,
  HousePlan,
  HouseStyle,
} from './neighborhood'
import { houseBodyFrame, houseGarageOffset } from './neighborhood'
import type {
  SurroundingsCorridorDescriptor,
} from './corridor'
import type { Point2 } from './frontages'
import { seededRange, seededUnit } from './seeded-random'
import type { RoadNetworkNode } from './streetscape/schema'
import type { RoadPresentationPlan, RoadPresentationSurfaceKind } from './streetscape-road-presentation'

const EPSILON = 1e-7
const TREE_CELL_MARGIN = 1.4
const HOUSE_TREE_CLEARANCE = 2.5
const DRIVEWAY_TREE_CLEARANCE = 3.4
const FENCE_CELL_MARGIN = 0.35
// Distance from the lot's front edge (the road side) to where the driveway
// and the entry path start: roughly the sidewalk's outer edge.
const FRONTAGE_APRON = 0.25
const STREET_TREE_SPACING: readonly [number, number] = [9.5, 13]
const STREET_TREE_JITTER = 1.6
const JUNCTION_TREE_CLEARANCE = 15
const CAR_LENGTH = 4.76
const CAR_WIDTH = 1.98
export const NEIGHBORHOOD_TREE_BUDGET = 96

export type NeighborhoodCatalogAssetId = 'bush' | 'hydrant' | 'parked-car'

/** Runtime-only planting intent. EZ-Tree seeds come from a bounded pool so
 * placements vary while the renderer shares a small prototype set. */
export type TreeSpecies = 'oak' | 'ash' | 'aspen' | 'pine'
export type TreeSize = 'small' | 'medium' | 'large'
export type TreeType = 'deciduous' | 'evergreen'

export type TreePlan = Readonly<{
  id: string
  species: TreeSpecies
  size: TreeSize
  treeType: TreeType
  foliageDensity: number
  leafColor: string
  seed: number
  position: Point2
  rotationY: number
  height: number
  cellId?: string
}>

// Placement seeds map onto the renderer's two near prototypes per species.
const TREE_SEED_POOL = [1, 7, 13, 21, 34, 55, 89, 144] as const
// A mature back-yard shade tree is selected by a house-style planting scheme.
const YARD_TREE: Readonly<Record<HouseStyle, { species: TreeSpecies; size: TreeSize; height: [number, number] }>> = {
  cottage: { species: 'oak', size: 'medium', height: [7.2, 9.5] },
  farmhouse: { species: 'ash', size: 'large', height: [8.2, 11.2] },
  pavilion: { species: 'pine', size: 'medium', height: [7.8, 10.4] },
}
const GROVE_SPECIES = ['oak', 'ash', 'pine'] as const
const GROVE_COMPANION: Readonly<Record<(typeof GROVE_SPECIES)[number], TreeSpecies>> = {
  oak: 'aspen',
  ash: 'oak',
  pine: 'aspen',
}
const GROVE_OFFSETS = [
  [-0.3, -0.27],
  [0.25, -0.25],
  [-0.08, -0.03],
  [-0.27, 0.25],
  [0.27, 0.23],
  [0.08, 0.3],
] as const satisfies readonly Point2[]
const GARDEN_TREES = [
  { offset: [-0.16, 0.12], species: 'aspen', height: [4.3, 6.2] },
  { offset: [0.16, -0.13], species: 'oak', height: [5.5, 7.7] },
  { offset: [0.09, 0.25], species: 'pine', height: [4.2, 6.6] },
] as const satisfies readonly Readonly<{
  offset: Point2
  species: TreeSpecies
  height: readonly [number, number]
}>[]
const GARDEN_BUSH_OFFSETS = [
  [-0.25, 0.03],
  [-0.24, 0.14],
  [-0.17, 0.21],
  [-0.07, 0.2],
  [-0.03, 0.1],
  [-0.11, 0.01],
] as const satisfies readonly Point2[]

function treeSeed(seed: string, key: string): number {
  return TREE_SEED_POOL[Math.floor(seededUnit(seed, key) * TREE_SEED_POOL.length) % TREE_SEED_POOL.length]!
}

const FIRST_RING_FOLIAGE_DENSITY = 1
const TREE_TYPE: Readonly<Record<TreeSpecies, TreeType>> = {
  oak: 'deciduous',
  ash: 'deciduous',
  aspen: 'deciduous',
  pine: 'evergreen',
}
const TREE_LEAF_COLORS: Readonly<Record<TreeSpecies, readonly string[]>> = {
  oak: ['#49683f', '#557348', '#607d50'],
  ash: ['#58764a', '#668355', '#718d5e'],
  aspen: ['#627d4f', '#6f8959', '#7a9364'],
  pine: ['#2f533a', '#385f40', '#416947'],
}

function treeAppearance(species: TreeSpecies, seed: string, key: string) {
  const colors = TREE_LEAF_COLORS[species]
  return {
    foliageDensity: FIRST_RING_FOLIAGE_DENSITY,
    leafColor: colors[Math.floor(seededUnit(seed, key) * colors.length) % colors.length]!,
    treeType: TREE_TYPE[species],
  }
}

export type CatalogPropPlan = Readonly<{
  id: string
  assetId: NeighborhoodCatalogAssetId
  position: Point2
  rotationY: number
  scale: number
  cellId?: string
}>

export type FencePlan = Readonly<{
  id: string
  position: Point2
  rotationY: number
  length: number
  height: number
  style: 'slat' | 'rail' | 'horizontal'
  color: string
  cellId: string
}>

export type StreetLightPlan = Readonly<{
  id: string
  position: Point2
  rotationY: number
  roadId: string
}>

export type PavingKind = 'driveway' | 'path' | 'patio'

/** Flat ground slab: driveway, entry path, or rear patio. */
export type PavingPlan = Readonly<{
  id: string
  kind: PavingKind
  polygon: readonly Point2[]
  cellId: string
}>

export type MailboxPlan = Readonly<{
  id: string
  position: Point2
  rotationY: number
  cellId: string
}>

export type NeighborhoodDecorationPlan = Readonly<{
  catalogProps: readonly CatalogPropPlan[]
  fences: readonly FencePlan[]
  streetLights: readonly StreetLightPlan[]
  paving: readonly PavingPlan[]
  mailboxes: readonly MailboxPlan[]
  trees: readonly TreePlan[]
}>

function add(first: Point2, second: Point2): Point2 {
  return [first[0] + second[0], first[1] + second[1]]
}

function subtract(first: Point2, second: Point2): Point2 {
  return [first[0] - second[0], first[1] - second[1]]
}

function scale(vector: Point2, amount: number): Point2 {
  return [vector[0] * amount, vector[1] * amount]
}

function dot(first: Point2, second: Point2): number {
  return first[0] * second[0] + first[1] * second[1]
}

function pointToSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const edge = subtract(end, start)
  const squaredLength = dot(edge, edge)
  if (squaredLength <= EPSILON) return Math.hypot(...subtract(point, start))
  const mix = Math.max(0, Math.min(1, dot(subtract(point, start), edge) / squaredLength))
  const closest = add(start, scale(edge, mix))
  return Math.hypot(...subtract(point, closest))
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return pointToSegmentDistance(point, start, end) <= EPSILON
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

function insideCell(point: Point2, cell: ClassifiedNeighborCell, margin: number): boolean {
  if (!pointInPolygon(point, cell.polygon)) return false
  return cell.polygon.every((start, index) =>
    pointToSegmentDistance(point, start, cell.polygon[(index + 1) % cell.polygon.length]!) >= margin)
}

function outsideHouse(point: Point2, house: HousePlan, margin: number): boolean {
  const relative = subtract(point, house.center)
  const across = Math.abs(dot(relative, house.right))
  const along = Math.abs(dot(relative, house.front))
  return across >= house.width / 2 + margin || along >= house.depth / 2 + margin
}

function pointDistance(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

/** World point from house-local (`right`, `front`) coordinates. */
function local(house: HousePlan, across: number, along: number): Point2 {
  return add(add(house.center, scale(house.right, across)), scale(house.front, along))
}

function localRectangle(
  house: HousePlan,
  acrossMin: number,
  acrossMax: number,
  alongMin: number,
  alongMax: number,
): Point2[] {
  return [
    local(house, acrossMin, alongMin),
    local(house, acrossMax, alongMin),
    local(house, acrossMax, alongMax),
    local(house, acrossMin, alongMax),
  ]
}

function facingRotation(direction: Point2): number {
  return Math.atan2(-direction[1], direction[0])
}

/** Distance along `front` from the house centre to the lot's front edge. */
function frontEdgeDistance(house: HousePlan, cell: ClassifiedNeighborCell): number {
  const toAccess = dot(subtract(house.access.point, house.center), house.front)
  // The access point sits on the road edge; the sidewalk band lies between it
  // and the lawn. Clamp so a shallow lot still yields a usable apron.
  const cellLimit = Math.min(...cell.polygon.map((point) => {
    const along = dot(subtract(point, house.center), house.front)
    return along > house.depth / 2 ? along : Number.POSITIVE_INFINITY
  }))
  return Math.min(toAccess, Number.isFinite(cellLimit) ? cellLimit : toAccess)
}

function fenceStyle(style: HouseStyle): Pick<FencePlan, 'height' | 'style'> {
  if (style === 'farmhouse') return { height: 1.25, style: 'horizontal' }
  if (style === 'pavilion') return { height: 1.1, style: 'slat' }
  return { height: 1.05, style: 'rail' }
}

function lotTrees(
  house: HousePlan,
  cell: ClassifiedNeighborCell,
  seed: string,
): TreePlan[] {
  const trees: TreePlan[] = []
  const yard = YARD_TREE[house.style]
  const treeSide = house.garage
    ? -house.garage.side
    : seededUnit(seed, `${house.id}:tree-side`) < 0.5 ? -1 : 1

  // Mature rear shade tree, deliberately off-centre and away from the garage.
  const rear = local(
    house,
    treeSide * (house.width * 0.28
      + seededRange(seed, `${house.id}:rear-tree-across`, -0.7, 0.9)),
    -(house.depth / 2
      + seededRange(seed, `${house.id}:rear-tree-depth`, 3.2, 4.5)),
  )
  if (
    insideCell(rear, cell, TREE_CELL_MARGIN)
    && outsideHouse(rear, house, HOUSE_TREE_CLEARANCE)
    && pointDistance(rear, house.access.point) >= DRIVEWAY_TREE_CLEARANCE
  ) {
    trees.push({
      id: `${house.id}-tree`,
      species: yard.species,
      size: yard.size,
      ...treeAppearance(yard.species, seed, `${house.id}:tree-foliage`),
      seed: treeSeed(seed, `${house.id}:tree-seed`),
      position: rear,
      rotationY: seededRange(seed, `${house.id}:tree-rotation`, -Math.PI, Math.PI),
      height: seededRange(seed, `${house.id}:tree-height`, yard.height[0], yard.height[1]),
      cellId: cell.id,
    })
  }

  // A smaller ornamental appears in some front gardens. It remains on the
  // side opposite the drive, while the seeded omission prevents a picket row.
  if (seededUnit(seed, `${house.id}:front-tree`) < 0.58) {
    const side = house.garage ? -house.garage.side : treeSide
    const species: TreeSpecies =
      seededUnit(seed, `${house.id}:front-tree-species`) < 0.72 ? 'aspen' : 'pine'
    const front = local(
      house,
      side * (house.width / 2
        + seededRange(seed, `${house.id}:front-tree-across`, 1.7, 2.7)),
      house.depth / 2
        + seededRange(seed, `${house.id}:front-tree-depth`, 2.2, 3.4),
    )
    if (
      insideCell(front, cell, TREE_CELL_MARGIN)
      && outsideHouse(front, house, HOUSE_TREE_CLEARANCE)
      && pointDistance(front, house.access.point) >= DRIVEWAY_TREE_CLEARANCE
    ) {
      trees.push({
        id: `${house.id}-front-tree`,
        species,
        size: 'small',
        ...treeAppearance(species, seed, `${house.id}:front-tree-foliage`),
        seed: treeSeed(seed, `${house.id}:front-tree-seed`),
        position: front,
        rotationY: seededRange(seed, `${house.id}:front-tree-rotation`, -Math.PI, Math.PI),
        height: seededRange(seed, `${house.id}:front-tree-height`, 4.1, 6.2),
        cellId: cell.id,
      })
    }
  }
  return trees
}

function buildAreaPoint(
  cell: ClassifiedNeighborCell,
  acrossFactor: number,
  alongFactor: number,
): Point2 | null {
  const area = cell.buildArea
  if (!area) return null
  return add(
    add(area.center, scale(area.right, area.width * acrossFactor)),
    scale(area.front, area.depth * alongFactor),
  )
}

function openLotDecorations(
  cell: ClassifiedNeighborCell,
  seed: string,
): Pick<NeighborhoodDecorationPlan, 'catalogProps' | 'trees'> {
  const catalogProps: CatalogPropPlan[] = []
  const trees: TreePlan[] = []
  if (!cell.buildArea) return { catalogProps, trees }

  if (cell.occupancy === 'garden') {
    for (const [index, offset] of GARDEN_BUSH_OFFSETS.entries()) {
      const position = buildAreaPoint(cell, offset[0], offset[1])!
      if (!insideCell(position, cell, 0.3)) continue
      catalogProps.push({
        id: `${cell.id}-garden-bush-${index}`,
        assetId: 'bush',
        position,
        rotationY: seededRange(seed, `${cell.id}:garden-bush-${index}:rotation`, -Math.PI, Math.PI),
        scale: seededRange(seed, `${cell.id}:garden-bush-${index}:scale`, 0.48, 0.7),
        cellId: cell.id,
      })
    }
    for (const [index, { offset, species, height }] of GARDEN_TREES.entries()) {
      if (
        index === GARDEN_TREES.length - 1
        && seededUnit(seed, `${cell.id}:garden-tree-${index}:gap`) < 0.55
      ) continue
      const across = offset[0]
        + seededRange(seed, `${cell.id}:garden-tree-${index}:x`, -0.025, 0.025)
      const along = offset[1]
        + seededRange(seed, `${cell.id}:garden-tree-${index}:z`, -0.025, 0.025)
      const position = buildAreaPoint(cell, across, along)!
      if (!insideCell(position, cell, TREE_CELL_MARGIN)) continue
      trees.push({
        id: `${cell.id}-garden-tree-${index}`,
        species,
        size: 'small',
        ...treeAppearance(species, seed, `${cell.id}:garden-tree-${index}:foliage`),
        seed: treeSeed(seed, `${cell.id}:garden-tree-${index}:seed`),
        position,
        rotationY: seededRange(seed, `${cell.id}:garden-tree-${index}:rotation`, -Math.PI, Math.PI),
        height: seededRange(seed, `${cell.id}:garden-tree-${index}:height`, height[0], height[1]),
        cellId: cell.id,
      })
    }
  }

  if (cell.occupancy === 'grove') {
    const dominant = GROVE_SPECIES[Math.floor(
      seededUnit(seed, `${cell.id}:grove-species`) * GROVE_SPECIES.length,
    ) % GROVE_SPECIES.length]!
    const companion = GROVE_COMPANION[dominant]
    for (const [index, offset] of GROVE_OFFSETS.entries()) {
      // Preserve an open edge in some groves rather than filling every slot.
      if (index >= 4 && seededUnit(seed, `${cell.id}:grove-${index}:gap`) < 0.24) continue
      const species = index === 2 ? companion : dominant
      const across = offset[0]
        + seededRange(seed, `${cell.id}:grove-${index}:x`, -0.035, 0.035)
      const along = offset[1]
        + seededRange(seed, `${cell.id}:grove-${index}:z`, -0.035, 0.035)
      const position = buildAreaPoint(cell, across, along)!
      if (!insideCell(position, cell, TREE_CELL_MARGIN)) continue
      const height = seededRange(seed, `${cell.id}:grove-${index}:height`, 5.4, 10.2)
      trees.push({
        id: `${cell.id}-grove-tree-${index}`,
        species,
        size: height >= 8.3 ? 'large' : 'medium',
        ...treeAppearance(species, seed, `${cell.id}:grove-${index}:foliage`),
        seed: treeSeed(seed, `${cell.id}:grove-${index}:seed`),
        position,
        rotationY: seededRange(seed, `${cell.id}:grove-${index}:rotation`, -Math.PI, Math.PI),
        height,
        cellId: cell.id,
      })
    }
  }

  return { catalogProps, trees }
}

function lotCatalogProps(
  house: HousePlan,
  cell: ClassifiedNeighborCell,
  seed: string,
): CatalogPropPlan[] {
  const props: CatalogPropPlan[] = []
  const body = houseBodyFrame(house)
  const garage = houseGarageOffset(house)

  // Foundation planting flanking the entry, on the body's front wall.
  const frontDoor = house.facades.find(({ side }) => side === 'front')?.openings
    .find(({ kind }) => kind === 'door')
  const doorSign = Math.sign(frontDoor?.offset ?? 0) || 1
  const bushOffsets = [-0.26, -0.4, 0.42]
  for (const [index, across] of bushOffsets.entries()) {
    const bodyAcross = body.offset + doorSign * body.width * across
    const position = local(house, bodyAcross, house.depth / 2 + 0.55)
    if (!insideCell(position, cell, 0.3) || !outsideHouse(position, house, 0.3)) continue
    // Never plant in front of the garage door.
    if (garage && Math.abs(bodyAcross - garage[0]) < house.garage!.width / 2 + 0.3) continue
    props.push({
      id: `${house.id}-bush-${index}`,
      assetId: 'bush',
      position,
      rotationY: seededRange(seed, `${house.id}:bush-${index}:rotation`, -Math.PI, Math.PI),
      scale: seededRange(seed, `${house.id}:bush-${index}:scale`, 0.34, 0.48),
      cellId: cell.id,
    })
  }

  // Roughly half the garages have a car parked on the driveway.
  if (garage && seededUnit(seed, `${house.id}:car`) < 0.55) {
    const carAlong = house.depth / 2 + 0.35 + CAR_LENGTH / 2
    const position = local(house, garage[0], carAlong)
    const edge = frontEdgeDistance(house, cell)
    if (carAlong + CAR_LENGTH / 2 < edge - FRONTAGE_APRON && insideCell(position, cell, CAR_WIDTH / 2 + 0.2)) {
      // Nose toward the garage; the procedural car's length runs along local Z.
      props.push({
        id: `${house.id}-car`,
        assetId: 'parked-car',
        position,
        rotationY: facingRotation(scale(house.front, -1)) + Math.PI / 2,
        scale: 1,
        cellId: cell.id,
      })
    }
  }
  return props
}

function lotPaving(house: HousePlan, cell: ClassifiedNeighborCell): PavingPlan[] {
  const paving: PavingPlan[] = []
  const body = houseBodyFrame(house)
  const garage = houseGarageOffset(house)
  const edge = frontEdgeDistance(house, cell)
  const frontFace = house.depth / 2
  const apron = edge - FRONTAGE_APRON
  if (apron <= frontFace + 0.5) return paving

  if (garage && house.garage) {
    const halfWidth = house.garage.width / 2 - 0.15
    const polygon = localRectangle(house, garage[0] - halfWidth, garage[0] + halfWidth, frontFace - 0.05, apron)
    if (polygon.every((point) => insideCell(point, cell, 0.05))) {
      paving.push({ id: `${house.id}-driveway`, kind: 'driveway', polygon, cellId: cell.id })
    }
  }

  const frontDoor = house.facades.find(({ side }) => side === 'front')?.openings
    .find(({ kind }) => kind === 'door')
  if (frontDoor) {
    const doorAcross = body.offset + frontDoor.offset
    // The porch and its step occupy the first ~1.7 m in front of the door.
    const polygon = localRectangle(house, doorAcross - 0.55, doorAcross + 0.55, frontFace + 1.7, apron)
    if (polygon.every((point) => insideCell(point, cell, 0.05))) {
      paving.push({ id: `${house.id}-path`, kind: 'path', polygon, cellId: cell.id })
    }
  }

  // Rear patio off the back wall, on the side away from the garage.
  const patioSide = house.garage ? house.garage.side : 1
  const patioAcross = body.offset + patioSide * Math.min(body.width * 0.2, body.width / 2 - 1.8)
  const patio = localRectangle(house, patioAcross - 1.8, patioAcross + 1.8, -(frontFace + 2.6), -(frontFace - 0.05))
  if (patio.every((point) => insideCell(point, cell, 0.4))) {
    paving.push({ id: `${house.id}-patio`, kind: 'patio', polygon: patio, cellId: cell.id })
  }
  return paving
}

function lotMailbox(house: HousePlan, cell: ClassifiedNeighborCell): MailboxPlan[] {
  const body = houseBodyFrame(house)
  const edge = frontEdgeDistance(house, cell)
  const garage = houseGarageOffset(house)
  // Curbside, just beside the driveway (or the path when there is none).
  const anchor = garage ? garage[0] + house.garage!.side * (house.garage!.width / 2 + 0.6) : body.offset + 1.6
  const position = local(house, anchor, edge - FRONTAGE_APRON - 0.35)
  if (!insideCell(position, cell, 0.2)) return []
  return [{
    id: `${house.id}-mailbox`,
    position,
    rotationY: facingRotation(house.front),
    cellId: cell.id,
  }]
}

/**
 * Suburban rear-yard fence: a run along the back of the lot plus the two side
 * returns stopping at the house's front-third, so neighbouring yards read as
 * separate properties while the street side stays open.
 */
function lotFences(
  house: HousePlan,
  cell: ClassifiedNeighborCell,
  seed: string,
): FencePlan[] {
  if (seededUnit(seed, `${house.id}:fence`) >= 0.8) return []
  const style = fenceStyle(house.style)
  const rear = -(house.depth / 2 + 4.6)
  const frontStop = house.depth / 2 - 1.6
  const halfWidth = house.width / 2 + 2.4
  const runs: Array<readonly [Point2, Point2]> = [
    [local(house, -halfWidth, rear), local(house, halfWidth, rear)],
    [local(house, -halfWidth, rear), local(house, -halfWidth, frontStop)],
    [local(house, halfWidth, rear), local(house, halfWidth, frontStop)],
  ]
  const fences: FencePlan[] = []
  runs.forEach(([start, end], index) => {
    if (!insideCell(start, cell, FENCE_CELL_MARGIN) || !insideCell(end, cell, FENCE_CELL_MARGIN)) return
    const direction = subtract(end, start)
    const runLength = Math.hypot(direction[0], direction[1])
    if (runLength < 1.5) return
    fences.push({
      id: `${house.id}-fence-${index}`,
      position: scale(add(start, end), 0.5),
      rotationY: facingRotation(scale(direction, 1 / runLength)),
      length: runLength,
      ...style,
      color: house.palette.accent,
      cellId: cell.id,
    })
  })
  return fences
}

/** Query the rendered bands, including rounded junctions, rather than treating
 * the corridor's full profile width as a straight carriageway edge. */
function streetLightPlacement(road: RoadPresentationPlan): (position: Point2) => boolean {
  const footprints = (kinds: readonly RoadPresentationSurfaceKind[]) => {
    const triangles: { polygon: Point2[]; minX: number; minZ: number; maxX: number; maxZ: number }[] = []
    for (const surface of road.surfaces) {
      if (!kinds.includes(surface.kind)) continue
      const { positions, indices } = surface.geometry
      for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index]! * 3, b = indices[index + 1]! * 3, c = indices[index + 2]! * 3
        const ax = positions[a]!, az = positions[a + 2]!
        const bx = positions[b]!, bz = positions[b + 2]!
        const cx = positions[c]!, cz = positions[c + 2]!
        if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) <= EPSILON) continue
        triangles.push({
          polygon: [[ax, az], [bx, bz], [cx, cz]],
          minX: Math.min(ax, bx, cx), minZ: Math.min(az, bz, cz),
          maxX: Math.max(ax, bx, cx), maxZ: Math.max(az, bz, cz),
        })
      }
    }
    return triangles
  }
  const sidewalks = footprints(['sidewalk'])
  const traffic = footprints(['carriageway', 'junction-carriageway', 'bike-lane', 'crosswalk'])
  const contains = (triangles: typeof sidewalks, point: Point2) => triangles.some((triangle) =>
    point[0] >= triangle.minX && point[0] <= triangle.maxX
    && point[1] >= triangle.minZ && point[1] <= triangle.maxZ
    && pointInPolygon(point, triangle.polygon))
  const probes = [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25]] as const
  return (position) => {
    for (const [dx, dz] of probes) {
      const point: Point2 = [position[0] + dx, position[1] + dz]
      if (!contains(sidewalks, point) || contains(traffic, point)) return false
    }
    return true
  }
}

const LIGHT_ALONG_SEARCH = [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10, -12, 12] as const
const LIGHT_LATERAL_SEARCH = [-0.5, -1, -1.5, -2, -2.5, -3, -3.5, -4, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const

function roadDecorations(
  corridor: SurroundingsCorridorDescriptor,
  seed: string,
  junctionPositions: readonly Point2[],
  drivewayPositions: readonly Point2[],
  canPlaceLight: (position: Point2) => boolean,
  occupiedLights: Point2[],
): Pick<NeighborhoodDecorationPlan, 'catalogProps' | 'streetLights' | 'trees'> {
  const catalogProps: CatalogPropPlan[] = []
  const streetLights: StreetLightPlan[] = []
  const trees: TreePlan[] = []
  const isPrimary = corridor.separator === 'primary-road'
  const usableLength = Math.max(0, corridor.road.length - 18)
  const towardRoad = scale(corridor.frame.outwardNormal, -1)

  if (isPrimary) {
    const count = Math.max(2, Math.floor(usableLength / 22))
    const spacing = usableLength / count
    const findPosition = (along: number): Point2 | undefined => {
      for (const shift of LIGHT_ALONG_SEARCH) {
        const station = along + shift
        if (Math.abs(station) > corridor.road.length / 2 - 4) continue
        const center = add(corridor.road.center, scale(corridor.frame.tangent, station))
        for (const lateral of LIGHT_LATERAL_SEARCH) {
          const position = add(center, scale(corridor.frame.outwardNormal, corridor.road.width / 2 + lateral))
          if (!canPlaceLight(position)
            || drivewayPositions.some((driveway) => pointDistance(position, driveway) < DRIVEWAY_TREE_CLEARANCE)
            || occupiedLights.some((light) => pointDistance(position, light) < 6)) continue
          return position
        }
      }
      return undefined
    }
    for (let index = 0; index < count; index += 1) {
      const along = -usableLength / 2 + spacing * (index + 0.5)
      const position = findPosition(along)
      if (!position) continue
      occupiedLights.push(position)
      streetLights.push({
        id: `${corridor.id}-street-light-${index}`,
        position,
        rotationY: facingRotation(towardRoad),
        roadId: corridor.road.id,
      })
    }
    catalogProps.push({
      id: `${corridor.id}-hydrant`,
      assetId: 'hydrant',
      position: add(
        add(corridor.road.center, scale(corridor.frame.tangent, -Math.min(usableLength * 0.28, 12))),
        scale(corridor.frame.outwardNormal, corridor.road.width / 2 + 1.05),
      ),
      rotationY: 0,
      scale: 1,
    })
  }

  // One coherent municipal species per street, with independently jittered
  // bays and occasional gaps. Mature specimens vary without becoming a row of
  // identical cones, while junction, driveway and lamp sight-lines stay open.
  const speciesPool: readonly TreeSpecies[] = isPrimary
    ? ['ash', 'oak']
    : ['oak', 'aspen', 'ash']
  const species = speciesPool[Math.floor(
    seededUnit(seed, `${corridor.id}:street-species`) * speciesPool.length,
  ) % speciesPool.length]!
  const treeLength = Math.max(0, corridor.road.length - 8)
  const nominalSpacing = seededRange(
    seed,
    `${corridor.id}:street-spacing`,
    STREET_TREE_SPACING[0],
    STREET_TREE_SPACING[1],
  )
  const treeCount = Math.floor(treeLength / nominalSpacing)
  const baySpacing = treeCount > 0 ? treeLength / treeCount : 0
  for (let index = 0; index < treeCount; index += 1) {
    if (
      treeCount > 4
      && seededUnit(seed, `${corridor.id}:street-tree-${index}:gap`) < 0.16
    ) continue
    const along = -treeLength / 2 + baySpacing * (index + 0.5)
      + seededRange(
        seed,
        `${corridor.id}:street-tree-${index}:jitter`,
        -Math.min(STREET_TREE_JITTER, baySpacing * 0.16),
        Math.min(STREET_TREE_JITTER, baySpacing * 0.16),
      )
    const vergeOffset = corridor.road.width / 2
      + seededRange(seed, `${corridor.id}:street-tree-${index}:verge`, 1.05, 1.45)
    const position = add(
      add(corridor.road.center, scale(corridor.frame.tangent, along)),
      scale(corridor.frame.outwardNormal, vergeOffset),
    )
    if (
      junctionPositions.some((junction) =>
        pointDistance(position, junction) < JUNCTION_TREE_CLEARANCE)
      || drivewayPositions.some((driveway) =>
        pointDistance(position, driveway) < DRIVEWAY_TREE_CLEARANCE)
      || streetLights.some((light) => pointDistance(position, light.position) < 2.4)
    ) continue
    const height = seededRange(
      seed,
      `${corridor.id}:street-tree-${index}:height`,
      isPrimary ? 6.2 : 5.2,
      isPrimary ? 9.2 : 8.4,
    )
    trees.push({
      id: `${corridor.id}-street-tree-${index}`,
      species,
      size: height >= 7.3 ? 'large' : 'medium',
      ...treeAppearance(species, seed, `${corridor.id}:street-tree-${index}:foliage`),
      seed: treeSeed(seed, `${corridor.id}:street-tree-${index}:seed`),
      position,
      rotationY: seededRange(seed, `${corridor.id}:street-tree-${index}:rotation`, -Math.PI, Math.PI),
      height,
    })
  }
  return { catalogProps, streetLights, trees }
}

export function deriveNeighborhoodDecorations(
  cells: readonly ClassifiedNeighborCell[],
  houses: readonly HousePlan[],
  corridors: readonly SurroundingsCorridorDescriptor[],
  roadNetwork: Pick<RoadNetworkNode, 'graphNodes' | 'junctions'>,
  roadPresentation: RoadPresentationPlan,
  seed = 'pascal-neighborhood-v1',
): NeighborhoodDecorationPlan {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]))
  const catalogProps: CatalogPropPlan[] = []
  const fences: FencePlan[] = []
  const paving: PavingPlan[] = []
  const mailboxes: MailboxPlan[] = []
  const trees: TreePlan[] = []

  for (const house of houses) {
    const cell = cellById.get(house.cellId)
    if (!cell) continue
    catalogProps.push(...lotCatalogProps(house, cell, seed))
    trees.push(...lotTrees(house, cell, seed))
    fences.push(...lotFences(house, cell, seed))
    paving.push(...lotPaving(house, cell))
    mailboxes.push(...lotMailbox(house, cell))
  }
  for (const cell of cells) {
    const openLot = openLotDecorations(cell, seed)
    catalogProps.push(...openLot.catalogProps)
    trees.push(...openLot.trees)
  }

  const junctionPositions = Object.values(roadNetwork.junctions).map(({ nodeId }) => {
    const [x, , z] = roadNetwork.graphNodes[nodeId]!.position
    return [x, z] as Point2
  })
  const drivewayPositions = houses.map(({ access }) => access.point)
  const canPlaceLight = corridors.some(({ separator }) => separator === 'primary-road')
    ? streetLightPlacement(roadPresentation)
    : () => false
  const occupiedLights: Point2[] = []
  const roads = corridors.map((corridor) =>
    roadDecorations(corridor, seed, junctionPositions, drivewayPositions, canPlaceLight, occupiedLights))
  for (const road of roads) {
    catalogProps.push(...road.catalogProps)
    trees.push(...road.trees)
  }

  return {
    catalogProps,
    fences,
    streetLights: roads.flatMap(({ streetLights }) => streetLights),
    paving,
    mailboxes,
    trees: trees.slice(0, NEIGHBORHOOD_TREE_BUDGET),
  }
}
