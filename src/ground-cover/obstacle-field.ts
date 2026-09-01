import { pointInPolygon2D } from '@pascal-app/core'
import type { SiteBounds } from './paint-field'

export const MAX_GRASS_OBSTACLE_DISTANCE = 3
export const DEFAULT_GRASS_OBSTACLE_SPACING = 0.1
export const MAX_GRASS_OBSTACLE_FIELD_SIDE = 513

export type GrassObstacleField = {
  readonly origin: readonly [number, number]
  readonly spacing: number
  readonly cols: number
  readonly rows: number
  /** RGBA8: distance, outward X, outward Z, allowed. */
  readonly values: Uint8Array
}

export type GrassObstacleShape =
  | {
      kind: 'polygon'
      points: ReadonlyArray<readonly [number, number]>
      holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
    }
  | {
      kind: 'capsule'
      start: readonly [number, number]
      end: readonly [number, number]
      radius: number
    }
  | {
      kind: 'box'
      center: readonly [number, number]
      halfSize: readonly [number, number]
      rotation: number
    }

export type GrassObstacleTopology = Pick<
  GrassObstacleField,
  'origin' | 'spacing' | 'cols' | 'rows'
>

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
  const occupied = new Uint8Array(topology.cols * topology.rows)
  for (const shape of shapes) rasterizeShape(topology, occupied, shape)

  const values = encodeObstacleField(topology, occupied)
  return {
    origin: [topology.origin[0], topology.origin[1]],
    spacing: topology.spacing,
    cols: topology.cols,
    rows: topology.rows,
    values,
  }
}

export function isGrassAllowedAt(field: GrassObstacleField, x: number, z: number): boolean {
  const col = Math.round((x - field.origin[0]) / field.spacing)
  const row = Math.round((z - field.origin[1]) / field.spacing)
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return true
  return (field.values[(row * field.cols + col) * 4 + 3] ?? 255) >= 128
}

function rasterizeShape(
  topology: GrassObstacleTopology,
  occupied: Uint8Array,
  shape: GrassObstacleShape,
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
  if (col1 < col0 || row1 < row0) return

  for (let row = row0; row <= row1; row += 1) {
    const z = topology.origin[1] + row * topology.spacing
    for (let col = col0; col <= col1; col += 1) {
      const x = topology.origin[0] + col * topology.spacing
      if (shapeContains(shape, x, z, padding)) occupied[row * topology.cols + col] = 1
    }
  }
}

function shapeBounds(shape: GrassObstacleShape): {
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
  shape: GrassObstacleShape,
  x: number,
  z: number,
  padding: number,
): boolean {
  if (shape.kind === 'polygon') {
    if (shape.points.length < 3) return false
    if (!pointInsidePolygon(x, z, shape.points)) return false
    return !shape.holes?.some((hole) => pointInsidePolygon(x, z, hole))
  }
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
function pointInsidePolygon(
  x: number,
  z: number,
  points: ReadonlyArray<readonly [number, number]>,
): boolean {
  // Core's implementation is read-only although its public parameter is mutable.
  const corePoints = points as Array<[number, number]>
  return pointInPolygon2D([x, z], corePoints, { includeBoundary: true })
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

function encodeObstacleField(
  topology: GrassObstacleTopology,
  occupied: Uint8Array,
): Uint8Array {
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
        values[offset + 3] = 0
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
      values[offset] = Math.round(
        Math.min(distance / MAX_GRASS_OBSTACLE_DISTANCE, 1) * 255,
      )
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
