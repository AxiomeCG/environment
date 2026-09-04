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

const EPSILON = 1e-7
const TREE_CELL_MARGIN = 1.1
const FENCE_CELL_MARGIN = 0.35
// Distance from the lot's front edge (the road side) to where the driveway
// and the entry path start: roughly the sidewalk's outer edge.
const FRONTAGE_APRON = 0.25
const STREET_TREE_SPACING = 11
const CAR_LENGTH = 4.76
const CAR_WIDTH = 1.98

export type NeighborhoodCatalogAssetId = 'bush' | 'hydrant' | 'tesla'

/**
 * Procedural tree from Nature's ez-tree preset vocabulary. Species × size ×
 * seed defines one shared geometry variant; the renderer instances every tree
 * with the same variant in one draw call per sub-mesh, exactly like the
 * Nature plugin does for placed trees.
 */
export type TreeSpecies = 'oak' | 'ash' | 'aspen' | 'pine'
export type TreeSize = 'small' | 'medium' | 'large'

export type TreePlan = Readonly<{
  id: string
  species: TreeSpecies
  size: TreeSize
  seed: number
  position: Point2
  rotationY: number
  height: number
  cellId?: string
}>

// Bounded seed pool shared with Nature so the variant count stays small.
const TREE_SEED_POOL = [1, 7, 13, 21, 34, 55, 89, 144] as const
// Yard trees: one species per house style so the street reads as planted.
const YARD_TREE: Readonly<Record<HouseStyle, { species: TreeSpecies; size: TreeSize; height: [number, number] }>> = {
  cottage: { species: 'oak', size: 'medium', height: [6.4, 7.6] },
  farmhouse: { species: 'ash', size: 'medium', height: [7.2, 8.6] },
  pavilion: { species: 'pine', size: 'medium', height: [7.8, 9.4] },
}
const GROVE_SPECIES = ['oak', 'aspen', 'pine'] as const
const GROVE_OFFSETS = [
  [-0.28, -0.27],
  [0.27, -0.24],
  [-0.08, 0],
  [-0.29, 0.27],
  [0.25, 0.26],
] as const satisfies readonly Point2[]
const GARDEN_BUSH_OFFSETS = [
  [-0.28, -0.2],
  [-0.08, -0.25],
  [0.16, -0.2],
  [0.29, -0.04],
  [0.1, 0.15],
  [-0.2, 0.16],
] as const satisfies readonly Point2[]

function treeSeed(seed: string, key: string): number {
  return TREE_SEED_POOL[Math.floor(seededUnit(seed, key) * TREE_SEED_POOL.length) % TREE_SEED_POOL.length]!
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

  // Back-yard shade tree on the side away from the garage.
  const treeSide = house.garage ? -house.garage.side : seededUnit(seed, `${house.id}:tree-side`) < 0.5 ? -1 : 1
  const rear = local(house, treeSide * house.width * 0.3, -(house.depth / 2 + 3.1))
  if (insideCell(rear, cell, TREE_CELL_MARGIN) && outsideHouse(rear, house, 2.2)) {
    trees.push({
      id: `${house.id}-tree`,
      species: yard.species,
      size: yard.size,
      seed: treeSeed(seed, `${house.id}:tree-seed`),
      position: rear,
      rotationY: seededRange(seed, `${house.id}:tree-rotation`, -Math.PI, Math.PI),
      height: seededRange(seed, `${house.id}:tree-height`, yard.height[0], yard.height[1]),
      cellId: cell.id,
    })
  }

  // Small ornamental in the front lawn, opposite the driveway, on about half
  // the lots so the street rhythm stays irregular.
  if (seededUnit(seed, `${house.id}:front-tree`) < 0.5) {
    const side = house.garage ? -house.garage.side : treeSide
    const front = local(house, side * (house.width / 2 + 1.6), house.depth / 2 + 2.4)
    if (insideCell(front, cell, TREE_CELL_MARGIN) && outsideHouse(front, house, 1.4)) {
      trees.push({
        id: `${house.id}-front-tree`,
        species: 'aspen',
        size: 'small',
        seed: treeSeed(seed, `${house.id}:front-tree-seed`),
        position: front,
        rotationY: seededRange(seed, `${house.id}:front-tree-rotation`, -Math.PI, Math.PI),
        height: seededRange(seed, `${house.id}:front-tree-height`, 3.8, 4.8),
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
        scale: seededRange(seed, `${cell.id}:garden-bush-${index}:scale`, 0.38, 0.58),
        cellId: cell.id,
      })
    }
    const position = buildAreaPoint(cell, -0.23, 0.22)!
    if (insideCell(position, cell, TREE_CELL_MARGIN)) {
      trees.push({
        id: `${cell.id}-garden-tree`,
        species: 'aspen',
        size: 'small',
        seed: TREE_SEED_POOL[1]!,
        position,
        rotationY: seededRange(seed, `${cell.id}:garden-tree:rotation`, -Math.PI, Math.PI),
        height: seededRange(seed, `${cell.id}:garden-tree:height`, 4.2, 5.3),
        cellId: cell.id,
      })
    }
  }

  if (cell.occupancy === 'grove') {
    const species = GROVE_SPECIES[
      Math.floor(seededUnit(seed, `${cell.id}:grove-species`) * GROVE_SPECIES.length)
    ]!
    const seedOffset = Math.floor(seededUnit(seed, `${cell.id}:grove-seeds`) * 4) * 2
    for (const [index, offset] of GROVE_OFFSETS.entries()) {
      const across = offset[0] + seededRange(seed, `${cell.id}:grove-${index}:x`, -0.025, 0.025)
      const along = offset[1] + seededRange(seed, `${cell.id}:grove-${index}:z`, -0.025, 0.025)
      const position = buildAreaPoint(cell, across, along)!
      if (!insideCell(position, cell, TREE_CELL_MARGIN)) continue
      trees.push({
        id: `${cell.id}-grove-tree-${index}`,
        species,
        size: 'small',
        seed: TREE_SEED_POOL[(seedOffset + index % 2) % TREE_SEED_POOL.length]!,
        position,
        rotationY: seededRange(seed, `${cell.id}:grove-${index}:rotation`, -Math.PI, Math.PI),
        height: seededRange(seed, `${cell.id}:grove-${index}:height`, 4.8, 6.4),
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
      // Nose toward the garage; the asset's length runs along its local Z.
      props.push({
        id: `${house.id}-car`,
        assetId: 'tesla',
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
  if (house.access.kind !== 'road') return []
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

function roadDecorations(
  corridor: SurroundingsCorridorDescriptor,
  seed: string,
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
    for (let index = 0; index < count; index += 1) {
      const along = -usableLength / 2 + spacing * (index + 0.5)
      streetLights.push({
        id: `${corridor.id}-street-light-${index}`,
        position: add(
          add(corridor.road.center, scale(corridor.frame.tangent, along)),
          scale(corridor.frame.outwardNormal, corridor.road.width / 2 + 1.8),
        ),
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

  // Street trees in the verge on the far (neighbour) side of the road, offset
  // half a bay from the lights so the two never coincide. One species per
  // street, alternating seeds, like a municipal planting scheme.
  const treeLength = Math.max(0, corridor.road.length - 6)
  const treeCount = Math.floor(treeLength / STREET_TREE_SPACING)
  const species: TreeSpecies = isPrimary ? 'ash' : 'oak'
  for (let index = 0; index < treeCount; index += 1) {
    const along = -treeLength / 2 + STREET_TREE_SPACING * (index + 0.5)
    trees.push({
      id: `${corridor.id}-street-tree-${index}`,
      species,
      size: 'small',
      seed: TREE_SEED_POOL[index % 2 === 0 ? 3 : 5]!,
      position: add(
        add(corridor.road.center, scale(corridor.frame.tangent, along)),
        scale(corridor.frame.outwardNormal, corridor.road.width / 2 + 1.1),
      ),
      rotationY: seededRange(seed, `${corridor.id}:street-tree-${index}`, -Math.PI, Math.PI),
      height: seededRange(seed, `${corridor.id}:street-tree-${index}:height`, 4.6, 5.6),
    })
  }
  return { catalogProps, streetLights, trees }
}

export function deriveNeighborhoodDecorations(
  cells: readonly ClassifiedNeighborCell[],
  houses: readonly HousePlan[],
  corridors: readonly SurroundingsCorridorDescriptor[],
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

  const roads = corridors.map((corridor) => roadDecorations(corridor, seed))
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
    trees,
  }
}
