import { pointOnSegment } from '@pascal-app/core'
import type { SiteBounds } from './paint-field'

export const MAX_GRASS_OBSTACLE_DISTANCE = 3
export const DEFAULT_GRASS_OBSTACLE_SPACING = 0.1
export const MAX_GRASS_OBSTACLE_FIELD_SIDE = 513
/**
 * The most a mask may cost to draw, in cell and edge visits per cell of the field: a full-size
 * field (513 x 513) stops at about 17 million visits, whatever the scene holds. A shape that
 * would take the mask over it is left out (grass grows there); the mask is still drawn.
 */
export const GRASS_OBSTACLE_WORK_PER_CELL = 64
/**
 * The mask's fourth channel says who has the ground at a cell: the lawn (255), something standing
 * in it (128: a plant, a piece of furniture, a rock; no blade or flower there, but the lawn's
 * ground is still drawn under it), or another surface (0: paving, a house, water; nothing of the
 * lawn). Read as 0..1, blades and flowers need more than `GRASS_BLADES_FROM`, the lawn's ground
 * more than `GRASS_GROUND_FROM`.
 */
export const GRASS_BLADES_FROM = 0.75
export const GRASS_GROUND_FROM = 0.25
const STANDING = 128
/** Core's `pointOnSegment` tolerance: a lattice point this near an edge is on the outline. */
const ON_EDGE_TOLERANCE = 1e-6
/** How far past an edge's own box a point core calls "on" it can lie. */
const ON_EDGE_REACH = 2e-3

export type GrassObstacleField = {
  readonly origin: readonly [number, number]
  readonly spacing: number
  readonly cols: number
  readonly rows: number
  /** RGBA8: distance, outward X, outward Z, allowed. */
  readonly values: Uint8Array
}

export type GrassObstacleSample = {
  distance: number
  directionX: number
  directionZ: number
  allowed: number
}

export type GrassObstacleShape =
  | {
      kind: 'triangles'
      positions: Float32Array
    }
  | {
      kind: 'polygon'
      points: ReadonlyArray<readonly [number, number]>
      holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
      /** Something standing in the lawn: no blade here, the lawn's ground kept under it. */
      keepsGround?: boolean
    }
  | {
      kind: 'capsule'
      start: readonly [number, number]
      end: readonly [number, number]
      radius: number
      keepsGround?: boolean
    }
  | {
      kind: 'box'
      keepsGround?: boolean
      center: readonly [number, number]
      halfSize: readonly [number, number]
      rotation: number
    }

type PlanObstacleShape = Exclude<GrassObstacleShape, { kind: 'triangles' }>
export type GrassObstacleTopology = Pick<GrassObstacleField, 'origin' | 'spacing' | 'cols' | 'rows'>

export function createGrassObstacleTopology(bounds: SiteBounds): GrassObstacleTopology {
  const width = Math.max(0, bounds.maxX - bounds.minX)
  const depth = Math.max(0, bounds.maxZ - bounds.minZ)
  const spacing = Math.max(
    DEFAULT_GRASS_OBSTACLE_SPACING,
    width / (MAX_GRASS_OBSTACLE_FIELD_SIDE - 1),
    depth / (MAX_GRASS_OBSTACLE_FIELD_SIDE - 1),
  )
  return {
    origin: [bounds.minX, bounds.minZ],
    spacing,
    cols: Math.max(1, Math.min(MAX_GRASS_OBSTACLE_FIELD_SIDE, Math.ceil(width / spacing) + 1)),
    rows: Math.max(1, Math.min(MAX_GRASS_OBSTACLE_FIELD_SIDE, Math.ceil(depth / spacing) + 1)),
  }
}

export function createGrassObstacleField(
  topology: GrassObstacleTopology,
  shapes: readonly GrassObstacleShape[],
): GrassObstacleField {
  const occupied = rasterizeShapes(topology, shapes)
  const values = encodeObstacleField(topology, occupied)
  return {
    origin: [topology.origin[0], topology.origin[1]],
    spacing: topology.spacing,
    cols: topology.cols,
    rows: topology.rows,
    values,
  }
}

/** 1 = the ground is another surface's; 2 = something stands in the lawn; the first wins. */
const OWNED = 1
const STOOD_ON = 2

function rasterizeShapes(
  topology: GrassObstacleTopology,
  shapes: readonly GrassObstacleShape[],
): Uint8Array {
  const occupied = new Uint8Array(topology.cols * topology.rows)
  const budget = { left: GRASS_OBSTACLE_WORK_PER_CELL * topology.cols * topology.rows }
  for (const shape of shapes) {
    if (budget.left <= 0) break
    if (shape.kind === 'triangles') {
      // Reuse one polygon rather than allocating a shape for every water triangle.
      const points: [[number, number], [number, number], [number, number]] = [
        [0, 0],
        [0, 0],
        [0, 0],
      ]
      const triangle: PlanObstacleShape = { kind: 'polygon', points }
      for (let offset = 0; offset + 8 < shape.positions.length; offset += 9) {
        for (let vertex = 0; vertex < 3; vertex += 1) {
          points[vertex]![0] = shape.positions[offset + vertex * 3]!
          points[vertex]![1] = shape.positions[offset + vertex * 3 + 2]!
        }
        rasterizeShape(topology, occupied, triangle, budget)
        if (budget.left <= 0) break
      }
    } else {
      rasterizeShape(topology, occupied, shape, budget)
    }
  }
  return occupied
}

/** Whether a blade or a flower may stand at the nearest cell: the lawn's own ground. */
export function isGrassAllowedAt(field: GrassObstacleField, x: number, z: number): boolean {
  return ownerAt(field, x, z) > STANDING
}

/**
 * Whether the lawn's ground is still drawn at the nearest cell: its own, or under something that
 * only stands in it. Paint is laid by this rule, so a hedge planted before or after the lawn has
 * the same green ground under it.
 */
export function isLawnGroundAt(field: GrassObstacleField, x: number, z: number): boolean {
  return ownerAt(field, x, z) >= STANDING
}

function ownerAt(field: GrassObstacleField, x: number, z: number): number {
  const col = Math.round((x - field.origin[0]) / field.spacing)
  const row = Math.round((z - field.origin[1]) / field.spacing)
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return 255
  return field.values[(row * field.cols + col) * 4 + 3] ?? 255
}

/**
 * The cells of `topology` that shapes cover, without the distance field: 1 where a shape owns the
 * ground, 2 where one only stands on it. For a caller that needs the footprint alone.
 */
export function rasterizeObstacleCells(
  topology: GrassObstacleTopology,
  shapes: readonly GrassObstacleShape[],
): Uint8Array {
  return rasterizeShapes(topology, shapes)
}

export function sampleGrassObstacle(
  field: GrassObstacleField,
  x: number,
  z: number,
): GrassObstacleSample {
  const u = Math.max(0, Math.min(field.cols - 1, (x - field.origin[0]) / field.spacing))
  const v = Math.max(0, Math.min(field.rows - 1, (z - field.origin[1]) / field.spacing))
  const col0 = Math.floor(u)
  const row0 = Math.floor(v)
  const col1 = Math.min(field.cols - 1, col0 + 1)
  const row1 = Math.min(field.rows - 1, row0 + 1)
  const tx = u - col0
  const tz = v - row0

  return {
    distance:
      (bilinearObstacleChannel(field, col0, row0, col1, row1, tx, tz, 0) / 255) *
      MAX_GRASS_OBSTACLE_DISTANCE,
    directionX: (bilinearObstacleChannel(field, col0, row0, col1, row1, tx, tz, 1) / 255) * 2 - 1,
    directionZ: (bilinearObstacleChannel(field, col0, row0, col1, row1, tx, tz, 2) / 255) * 2 - 1,
    allowed: bilinearObstacleChannel(field, col0, row0, col1, row1, tx, tz, 3) / 255,
  }
}

function bilinearObstacleChannel(
  field: GrassObstacleField,
  col0: number,
  row0: number,
  col1: number,
  row1: number,
  tx: number,
  tz: number,
  channel: number,
): number {
  const topLeft = field.values[(row0 * field.cols + col0) * 4 + channel] ?? 0
  const topRight = field.values[(row0 * field.cols + col1) * 4 + channel] ?? 0
  const bottomLeft = field.values[(row1 * field.cols + col0) * 4 + channel] ?? 0
  const bottomRight = field.values[(row1 * field.cols + col1) * 4 + channel] ?? 0
  const top = topLeft + (topRight - topLeft) * tx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
  return top + (bottom - top) * tz
}

type WorkBudget = { left: number }

function rasterizeShape(
  topology: GrassObstacleTopology,
  occupied: Uint8Array,
  shape: PlanObstacleShape,
  budget: WorkBudget,
): void {
  const padding = topology.spacing * Math.SQRT1_2
  const bounds = shapeBounds(shape)
  const col0 = clampIndex(
    Math.floor((bounds.minX - padding - topology.origin[0]) / topology.spacing),
    topology.cols,
  )
  const row0 = clampIndex(
    Math.floor((bounds.minZ - padding - topology.origin[1]) / topology.spacing),
    topology.rows,
  )
  const col1 = clampIndex(
    Math.ceil((bounds.maxX + padding - topology.origin[0]) / topology.spacing),
    topology.cols,
  )
  const row1 = clampIndex(
    Math.ceil((bounds.maxZ + padding - topology.origin[1]) / topology.spacing),
    topology.rows,
  )
  // Bounds that are not numbers (a shape holding NaN) cover no cell.
  if (!(col1 >= col0) || !(row1 >= row0)) return

  const rows = row1 - row0 + 1
  const cols = col1 - col0 + 1
  if (shape.kind === 'polygon') {
    if (shape.points.length < 3) return
    const box: CellBox = { col0, row0, col1, row1 }
    // A hole is read inside its own box, clipped to the outline's.
    const holes: { ring: Ring; box: CellBox }[] = []
    let work = ringWork(box, shape.points.length)
    for (const ring of shape.holes ?? []) {
      if (ring.length < 3) continue
      const holeBox = clipBox(ringBox(topology, ring), box)
      if (!holeBox) continue
      holes.push({ ring, box: holeBox })
      work += ringWork(holeBox, ring.length)
    }
    if (work > budget.left) return
    budget.left -= work
    rasterizePolygon(topology, occupied, shape.points, holes, box, shape.keepsGround === true)
    return
  }

  const work = rows * cols
  if (work > budget.left) return
  budget.left -= work
  for (let row = row0; row <= row1; row += 1) {
    const z = topology.origin[1] + row * topology.spacing
    for (let col = col0; col <= col1; col += 1) {
      const x = topology.origin[0] + col * topology.spacing
      if (shapeContains(shape, x, z, padding)) claim(occupied, row * topology.cols + col, shape.keepsGround === true)
    }
  }
}

/** A cell another surface owns stays owned; one only stood on can still become owned. */
function claim(occupied: Uint8Array, index: number, keepsGround: boolean): void {
  if (!keepsGround) occupied[index] = OWNED
  else if (occupied[index] === 0) occupied[index] = STOOD_ON
}

type Ring = ReadonlyArray<readonly [number, number]>
type CellBox = { col0: number; row0: number; col1: number; row1: number }

/** The cells a ring can reach (a cell beyond it on each side, for points on its outline). */
function ringBox(topology: GrassObstacleTopology, ring: Ring): CellBox | null {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of ring) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  const box = {
    col0: Math.floor((minX - topology.origin[0]) / topology.spacing) - 1,
    row0: Math.floor((minZ - topology.origin[1]) / topology.spacing) - 1,
    col1: Math.ceil((maxX - topology.origin[0]) / topology.spacing) + 1,
    row1: Math.ceil((maxZ - topology.origin[1]) / topology.spacing) + 1,
  }
  return box.col1 >= box.col0 && box.row1 >= box.row0 ? box : null
}

function clipBox(box: CellBox | null, within: CellBox): CellBox | null {
  if (!box) return null
  const clipped = {
    col0: Math.max(box.col0, within.col0),
    row0: Math.max(box.row0, within.row0),
    col1: Math.min(box.col1, within.col1),
    row1: Math.min(box.row1, within.row1),
  }
  return clipped.col1 >= clipped.col0 && clipped.row1 >= clipped.row0 ? clipped : null
}

/** Each row reads every edge and every cell once; each edge then walks its own rows and columns. */
function ringWork(box: CellBox, edges: number): number {
  const rows = box.row1 - box.row0 + 1
  const cols = box.col1 - box.col0 + 1
  return rows * (edges + cols) + edges * (rows + cols)
}

/**
 * The lattice points of the box inside `outer` and in no hole, an outline counting as inside its
 * ring: exactly what core's `pointInPolygon2D` (boundary included) answers point by point, read
 * row by row instead. A row costs its ring's edges plus its cells, not their product, so a ring
 * of thousands of points over the whole field stays a matter of milliseconds.
 */
function rasterizePolygon(
  topology: GrassObstacleTopology,
  occupied: Uint8Array,
  outer: Ring,
  holes: ReadonlyArray<{ ring: Ring; box: CellBox }>,
  box: CellBox,
  keepsGround: boolean,
): void {
  const cols = box.col1 - box.col0 + 1
  const rows = box.row1 - box.row0 + 1
  const inside = new Uint8Array(cols * rows)
  markRing(topology, inside, box, outer, box, 1)
  // A hole takes its outline with it, as it did point by point.
  for (const hole of holes) markRing(topology, inside, box, hole.ring, hole.box, 0)
  for (let row = 0; row < rows; row += 1) {
    const target = (box.row0 + row) * topology.cols + box.col0
    const source = row * cols
    for (let col = 0; col < cols; col += 1) {
      if (inside[source + col]) claim(occupied, target + col, keepsGround)
    }
  }
}

/** Write `value` at every lattice point of the box that core's test puts inside `ring`. */
function markRing(
  topology: GrassObstacleTopology,
  inside: Uint8Array,
  /** The box `inside` covers. */
  frame: CellBox,
  ring: Ring,
  /** The part of it this ring can reach. */
  { col0, row0, col1, row1 }: CellBox,
  value: 0 | 1,
): void {
  const cols = frame.col1 - frame.col0 + 1
  const [originX, originZ] = topology.origin
  const spacing = topology.spacing
  const count = ring.length
  const crossings: number[] = []

  // Interior, by the parity of the edges a ray toward +x crosses: core's own comparison.
  for (let row = row0; row <= row1; row += 1) {
    const z = originZ + row * spacing
    crossings.length = 0
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const current = ring[i] as readonly [number, number]
      const previous = ring[j] as readonly [number, number]
      if (current[1] > z !== previous[1] > z) {
        crossings.push(
          ((previous[0] - current[0]) * (z - current[1])) / (previous[1] - current[1]) + current[0],
        )
      }
    }
    if (crossings.length === 0) continue
    crossings.sort(ascending)
    const offset = (row - frame.row0) * cols
    let passed = 0
    for (let col = col0; col <= col1; col += 1) {
      const x = originX + col * spacing
      // A crossing counts while the point is strictly left of it.
      while (passed < crossings.length && !(x < (crossings[passed] as number))) passed += 1
      if ((crossings.length - passed) % 2 === 1) inside[offset + col - frame.col0] = value
    }
  }

  // The outline itself: the lattice points core's `pointOnSegment` finds on an edge.
  const point: [number, number] = [0, 0]
  for (let i = 0; i < count; i += 1) {
    const start = ring[i] as readonly [number, number]
    const end = ring[(i + 1) % count] as readonly [number, number]
    const minX = Math.min(start[0], end[0]) - ON_EDGE_REACH
    const maxX = Math.max(start[0], end[0]) + ON_EDGE_REACH
    const minZ = Math.min(start[1], end[1]) - ON_EDGE_REACH
    const maxZ = Math.max(start[1], end[1]) + ON_EDGE_REACH
    const firstRow = Math.max(row0, Math.ceil((minZ - originZ) / spacing))
    const lastRow = Math.min(row1, Math.floor((maxZ - originZ) / spacing))
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    for (let row = firstRow; row <= lastRow; row += 1) {
      const z = originZ + row * spacing
      let fromX = minX
      let toX = maxX
      if (Math.abs(dz) >= ON_EDGE_REACH) {
        // Off a near-level edge, only the points beside where the edge meets this row can be on it.
        const onLine = start[0] + ((z - start[1]) * dx) / dz
        const slack = ON_EDGE_TOLERANCE / Math.abs(dz) + 1e-7 + Math.abs(onLine) * 1e-12
        fromX = Math.max(fromX, onLine - slack)
        toX = Math.min(toX, onLine + slack)
      }
      const firstCol = Math.max(col0, Math.ceil((fromX - originX) / spacing))
      const lastCol = Math.min(col1, Math.floor((toX - originX) / spacing))
      for (let col = firstCol; col <= lastCol; col += 1) {
        point[0] = originX + col * spacing
        point[1] = z
        if (pointOnSegment(point, start as [number, number], end as [number, number])) {
          inside[(row - frame.row0) * cols + col - frame.col0] = value
        }
      }
    }
  }
}

const ascending = (left: number, right: number) => left - right

function shapeBounds(shape: PlanObstacleShape): {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
} {
  if (shape.kind === 'capsule') {
    return {
      minX: Math.min(shape.start[0], shape.end[0]) - shape.radius,
      minZ: Math.min(shape.start[1], shape.end[1]) - shape.radius,
      maxX: Math.max(shape.start[0], shape.end[0]) + shape.radius,
      maxZ: Math.max(shape.start[1], shape.end[1]) + shape.radius,
    }
  }
  if (shape.kind === 'box') {
    const cos = Math.abs(Math.cos(shape.rotation))
    const sin = Math.abs(Math.sin(shape.rotation))
    const extentX = cos * shape.halfSize[0] + sin * shape.halfSize[1]
    const extentZ = sin * shape.halfSize[0] + cos * shape.halfSize[1]
    return {
      minX: shape.center[0] - extentX,
      minZ: shape.center[1] - extentZ,
      maxX: shape.center[0] + extentX,
      maxZ: shape.center[1] + extentZ,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of shape.points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ }
}

function shapeContains(
  shape: Exclude<PlanObstacleShape, { kind: 'polygon' }>,
  x: number,
  z: number,
  padding: number,
): boolean {
  if (shape.kind === 'capsule') {
    const radius = shape.radius + padding
    return squaredDistanceToSegment(x, z, shape.start, shape.end) <= radius * radius
  }

  const dx = x - shape.center[0]
  const dz = z - shape.center[1]
  const cos = Math.cos(shape.rotation)
  const sin = Math.sin(shape.rotation)
  const localX = cos * dx + sin * dz
  const localZ = -sin * dx + cos * dz
  return (
    Math.abs(localX) <= shape.halfSize[0] + padding &&
    Math.abs(localZ) <= shape.halfSize[1] + padding
  )
}

function squaredDistanceToSegment(
  x: number,
  z: number,
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const segmentX = end[0] - start[0]
  const segmentZ = end[1] - start[1]
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ
  if (lengthSquared <= Number.EPSILON) {
    return (x - start[0]) ** 2 + (z - start[1]) ** 2
  }
  const t = Math.max(
    0,
    Math.min(1, ((x - start[0]) * segmentX + (z - start[1]) * segmentZ) / lengthSquared),
  )
  const nearestX = start[0] + segmentX * t
  const nearestZ = start[1] + segmentZ * t
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2
}

function encodeObstacleField(topology: GrassObstacleTopology, occupied: Uint8Array): Uint8Array {
  const size = topology.cols * topology.rows
  const nearestColumns = new Int32Array(size)
  const nearestRows = new Int32Array(size)
  nearestColumns.fill(-1)
  nearestRows.fill(-1)

  if (occupied.some((value) => value !== 0)) {
    computeNearestObstacle(topology.cols, topology.rows, occupied, nearestColumns, nearestRows)
  }

  const values = new Uint8Array(size * 4)
  for (let row = 0; row < topology.rows; row += 1) {
    for (let col = 0; col < topology.cols; col += 1) {
      const index = row * topology.cols + col
      const offset = index * 4
      const nearestCol = nearestColumns[index] ?? -1
      const nearestRow = nearestRows[index] ?? -1
      if (occupied[index]) {
        values[offset] = 0
        values[offset + 1] = 128
        values[offset + 2] = 128
        values[offset + 3] = occupied[index] === STOOD_ON ? STANDING : 0
        continue
      }
      if (nearestCol < 0 || nearestRow < 0) {
        values[offset] = 255
        values[offset + 1] = 128
        values[offset + 2] = 128
        values[offset + 3] = 255
        continue
      }

      const dx = col - nearestCol
      const dz = row - nearestRow
      const gridDistance = Math.hypot(dx, dz)
      const distance = gridDistance * topology.spacing
      values[offset] = Math.round(Math.min(distance / MAX_GRASS_OBSTACLE_DISTANCE, 1) * 255)
      values[offset + 1] = encodeDirection(gridDistance > 0 ? dx / gridDistance : 0)
      values[offset + 2] = encodeDirection(gridDistance > 0 ? dz / gridDistance : 0)
      values[offset + 3] = 255
    }
  }
  return values
}

function computeNearestObstacle(
  cols: number,
  rows: number,
  occupied: Uint8Array,
  nearestColumns: Int32Array,
  nearestRows: Int32Array,
): void {
  const infinity = 1e20
  const maxSide = Math.max(cols, rows)
  const source = new Float64Array(maxSide)
  const distances = new Float64Array(maxSide)
  const argumentsByLine = new Int32Array(maxSide)
  const parabolaLocations = new Int32Array(maxSide)
  const intersections = new Float64Array(maxSide + 1)
  const verticalDistances = new Float64Array(cols * rows)
  const verticalNearestRows = new Int32Array(cols * rows)

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      source[row] = occupied[row * cols + col] ? 0 : infinity
    }
    distanceTransform1D(
      source,
      rows,
      distances,
      argumentsByLine,
      parabolaLocations,
      intersections,
      infinity,
    )
    for (let row = 0; row < rows; row += 1) {
      const index = row * cols + col
      verticalDistances[index] = distances[row] ?? infinity
      verticalNearestRows[index] = argumentsByLine[row] ?? -1
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      source[col] = verticalDistances[row * cols + col] ?? infinity
    }
    distanceTransform1D(
      source,
      cols,
      distances,
      argumentsByLine,
      parabolaLocations,
      intersections,
      infinity,
    )
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const nearestCol = argumentsByLine[col] ?? -1
      nearestColumns[index] = nearestCol
      nearestRows[index] =
        nearestCol >= 0 ? (verticalNearestRows[row * cols + nearestCol] ?? -1) : -1
    }
  }
}

function distanceTransform1D(
  source: Float64Array,
  length: number,
  distances: Float64Array,
  argumentsByLine: Int32Array,
  parabolaLocations: Int32Array,
  intersections: Float64Array,
  infinity: number,
): void {
  let firstFinite = -1
  for (let index = 0; index < length; index += 1) {
    if ((source[index] ?? infinity) < infinity) {
      firstFinite = index
      break
    }
  }
  if (firstFinite < 0) {
    for (let index = 0; index < length; index += 1) {
      distances[index] = infinity
      argumentsByLine[index] = -1
    }
    return
  }

  let k = 0
  parabolaLocations[0] = firstFinite
  intersections[0] = Number.NEGATIVE_INFINITY
  intersections[1] = Number.POSITIVE_INFINITY

  for (let q = firstFinite + 1; q < length; q += 1) {
    const sourceQ = source[q] ?? infinity
    if (sourceQ >= infinity) continue
    let location = parabolaLocations[k] ?? firstFinite
    let intersection =
      (sourceQ + q * q - (source[location] ?? infinity) - location * location) /
      (2 * q - 2 * location)
    while (intersection <= (intersections[k] ?? Number.NEGATIVE_INFINITY)) {
      k -= 1
      location = parabolaLocations[k] ?? firstFinite
      intersection =
        (sourceQ + q * q - (source[location] ?? infinity) - location * location) /
        (2 * q - 2 * location)
    }
    k += 1
    parabolaLocations[k] = q
    intersections[k] = intersection
    intersections[k + 1] = Number.POSITIVE_INFINITY
  }

  k = 0
  for (let q = 0; q < length; q += 1) {
    while ((intersections[k + 1] ?? Number.POSITIVE_INFINITY) < q) k += 1
    const location = parabolaLocations[k] ?? firstFinite
    distances[q] = (q - location) * (q - location) + (source[location] ?? infinity)
    argumentsByLine[q] = location
  }
}

function encodeDirection(value: number): number {
  return Math.round((Math.max(-1, Math.min(1, value)) * 0.5 + 0.5) * 255)
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, value))
}
