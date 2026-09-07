import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { ShapeUtils, Vector2 } from 'three'
import { POND_LEVEL_STEP } from './schema'

type Point2 = readonly [number, number]
type MutablePoint2 = [number, number]
type MeshTriangle = readonly [number, number, number]

type MeshVertex = {
  readonly x: number
  readonly z: number
  readonly height: number
  boundary: boolean
}

type TerrainMesh = {
  readonly vertices: MeshVertex[]
  readonly triangles: MeshTriangle[]
  readonly adjacency: ReadonlyArray<ReadonlyArray<number>>
}

type BasinTopology = {
  readonly mesh: TerrainMesh
  readonly bottomVertices: readonly number[]
}
type WetPoint = {
  readonly x: number
  readonly z: number
  readonly height: number
}

type PriorityEntry = {
  readonly vertex: number
  readonly level: number
}

export type PondBasin = {
  terrain: TerrainField
  boundary: ReadonlyArray<Point2>
  seed: Point2
  bottomLevel: number
  spillLevel: number
  levelStep: number
  levels: readonly number[]
}

export type PondSurface = {
  level: number | null
  positions: Float32Array
  depths: Float32Array
  area: number
}

const GEOMETRY_EPSILON = 1e-8
const MAX_CONTOUR_LEVELS = 256
const basinTopologies = new WeakMap<PondBasin, BasinTopology>()
const EMPTY_FLOATS = new Float32Array(0)

export function analyzePondBasin(
  terrain: TerrainField,
  boundary: ReadonlyArray<Point2>,
  seed: Point2,
): PondBasin | null {
  if (!validTerrain(terrain) || !validBoundary(boundary) || !finitePoint(seed)) return null

  const mesh = buildTerrainMesh(terrain, boundary)
  if (mesh.triangles.length === 0) return null

  const containingTriangles = trianglesAtPoint(mesh, seed)
  if (containingTriangles.length === 0) return null

  let initialVertex = -1
  let initialHeight = Number.POSITIVE_INFINITY
  for (const triangleIndex of containingTriangles) {
    const triangle = mesh.triangles[triangleIndex]
    if (!triangle) continue
    for (const vertexIndex of triangle) {
      const height = mesh.vertices[vertexIndex]?.height ?? Number.POSITIVE_INFINITY
      if (
        height < initialHeight - GEOMETRY_EPSILON ||
        (Math.abs(height - initialHeight) <= GEOMETRY_EPSILON && vertexIndex < initialVertex)
      ) {
        initialHeight = height
        initialVertex = vertexIndex
      }
    }
  }
  if (initialVertex < 0) return null

  const bottomVertices = descendToMinimum(mesh, initialVertex)
  const firstBottomVertex = bottomVertices[0]
  if (firstBottomVertex === undefined) return null
  const bottomVertex = mesh.vertices[firstBottomVertex]
  if (!bottomVertex) return null
  const bottomLevel = bottomVertex.height

  const rootByVertex = buildWatershedRoots(mesh)
  const selectedRoot = rootByVertex[firstBottomVertex]
  if (selectedRoot === undefined || selectedRoot < 0) return null
  const catchment = new Uint8Array(mesh.vertices.length)
  for (let index = 0; index < rootByVertex.length; index += 1) {
    if (rootByVertex[index] === selectedRoot) catchment[index] = 1
  }

  const spillLevel = priorityFloodToSpill(mesh, bottomVertices, catchment)
  const tolerance = heightTolerance(terrain)
  if (!Number.isFinite(spillLevel) || spillLevel <= bottomLevel + tolerance) return null

  const levelStep = quantizedLevelStep(terrain)
  const levels = buildLevels(bottomLevel, spillLevel, levelStep, tolerance)
  if (levels.length === 0) return null

  const basin: PondBasin = {
    terrain,
    boundary,
    seed: [bottomVertex.x, bottomVertex.z],
    bottomLevel,
    spillLevel,
    levelStep,
    levels,
  }
  basinTopologies.set(basin, { mesh, bottomVertices })
  return basin
}

export function buildPondSurface(
  basin: PondBasin,
  requestedLevel: number | null,
): PondSurface {
  if (requestedLevel === null || !Number.isFinite(requestedLevel)) return emptySurface()

  const topology = basinTopologies.get(basin) ?? recoverTopology(basin)
  if (!topology) return emptySurface()

  const tolerance = heightTolerance(basin.terrain)
  const level = Math.min(requestedLevel, basin.spillLevel)
  if (level <= basin.bottomLevel + tolerance) return emptySurface()

  const reachable = connectedWetVertices(topology, level, tolerance)
  const positions: number[] = []
  const depths: number[] = []
  let area = 0

  for (const triangle of topology.mesh.triangles) {
    if (!triangle.some((vertex) => reachable[vertex] === 1)) continue

    const vertices = triangle.map((index): WetPoint => {
      const vertex = topology.mesh.vertices[index]
      if (!vertex) return { x: 0, z: 0, height: Number.POSITIVE_INFINITY }
      return { x: vertex.x, z: vertex.z, height: vertex.height }
    })
    let wetPolygon = clipTriangleBelowLevel(vertices, level, tolerance)
    if (wetPolygon.length < 3) continue

    const signedArea = polygonArea(wetPolygon)
    if (Math.abs(signedArea) <= GEOMETRY_EPSILON) continue
    if (signedArea > 0) wetPolygon = [...wetPolygon].reverse()

    const first = wetPolygon[0]
    if (!first) continue
    for (let index = 1; index < wetPolygon.length - 1; index += 1) {
      const second = wetPolygon[index]
      const third = wetPolygon[index + 1]
      if (!second || !third) continue
      appendSurfaceVertex(first, level, positions, depths)
      appendSurfaceVertex(second, level, positions, depths)
      appendSurfaceVertex(third, level, positions, depths)
      area += Math.abs(cross2(first, second, third)) / 2
    }
  }

  if (positions.length === 0 || area <= GEOMETRY_EPSILON) return emptySurface()
  return {
    level,
    positions: new Float32Array(positions),
    depths: new Float32Array(depths),
    area,
  }
}

export function pondSurfaceDepthAt(surface: PondSurface, x: number, z: number): number {
  if (surface.level === null || !Number.isFinite(x) || !Number.isFinite(z)) return 0

  let deepest = 0
  for (let offset = 0, depthOffset = 0; offset + 8 < surface.positions.length; offset += 9, depthOffset += 3) {
    const ax = surface.positions[offset]
    const az = surface.positions[offset + 2]
    const bx = surface.positions[offset + 3]
    const bz = surface.positions[offset + 5]
    const cx = surface.positions[offset + 6]
    const cz = surface.positions[offset + 8]
    if (
      ax === undefined || az === undefined || bx === undefined || bz === undefined ||
      cx === undefined || cz === undefined
    ) {
      continue
    }

    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) continue
    const firstWeight = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator
    const secondWeight = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator
    const thirdWeight = 1 - firstWeight - secondWeight
    if (
      firstWeight < -GEOMETRY_EPSILON ||
      secondWeight < -GEOMETRY_EPSILON ||
      thirdWeight < -GEOMETRY_EPSILON
    ) {
      continue
    }

    const firstDepth = surface.depths[depthOffset] ?? 0
    const secondDepth = surface.depths[depthOffset + 1] ?? 0
    const thirdDepth = surface.depths[depthOffset + 2] ?? 0
    deepest = Math.max(
      deepest,
      firstDepth * firstWeight + secondDepth * secondWeight + thirdDepth * thirdWeight,
    )
  }
  return Math.max(0, deepest)
}

export function nextPondLevel(
  basin: PondBasin,
  current: number | null,
  action: 'raise' | 'lower' | 'fill' | 'empty',
): number | null {
  if (action === 'empty') return null
  if (action === 'fill') return basin.spillLevel

  const tolerance = heightTolerance(basin.terrain)
  if (action === 'raise') {
    if (current === null || !Number.isFinite(current)) return basin.levels[0] ?? null
    for (const level of basin.levels) {
      if (level > current + tolerance) return level
    }
    return basin.spillLevel
  }

  if (current === null || !Number.isFinite(current)) return null
  let previous: number | null = null
  for (const level of basin.levels) {
    if (level >= current - tolerance) break
    previous = level
  }
  return previous
}

export function buildPondContourPositions(
  terrain: TerrainField,
  boundary: ReadonlyArray<Point2>,
  step: number,
): Float32Array {
  if (!validTerrain(terrain) || !validBoundary(boundary) || !Number.isFinite(step) || step <= 0) {
    return EMPTY_FLOATS
  }

  const mesh = buildTerrainMesh(terrain, boundary)
  if (mesh.vertices.length === 0 || mesh.triangles.length === 0) return EMPTY_FLOATS

  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const vertex of mesh.vertices) {
    minimum = Math.min(minimum, vertex.height)
    maximum = Math.max(maximum, vertex.height)
  }
  if (!Number.isFinite(minimum) || maximum - minimum <= GEOMETRY_EPSILON) return EMPTY_FLOATS

  const rawCount = Math.floor((maximum - minimum) / step) + 1
  const spacing = step * Math.max(1, Math.ceil(rawCount / MAX_CONTOUR_LEVELS))
  const firstLevel = Math.ceil((minimum - GEOMETRY_EPSILON) / spacing) * spacing
  const positions: number[] = []
  const emitted = new Set<string>()

  for (let level = firstLevel; level <= maximum + GEOMETRY_EPSILON; level += spacing) {
    const normalizedLevel = normalizeNumber(level)
    for (const triangle of mesh.triangles) {
      const vertices = triangle.map((index): WetPoint => {
        const vertex = mesh.vertices[index]
        if (!vertex) return { x: 0, z: 0, height: 0 }
        return { x: vertex.x, z: vertex.z, height: vertex.height }
      })
      appendTriangleContours(vertices, normalizedLevel, emitted, positions)
    }
  }

  return new Float32Array(positions)
}

function validTerrain(terrain: TerrainField): boolean {
  return (
    terrain.cols >= 2 &&
    terrain.rows >= 2 &&
    Number.isFinite(terrain.spacing) &&
    terrain.spacing > 0 &&
    Number.isFinite(terrain.step) &&
    terrain.step > 0
  )
}

function validBoundary(boundary: ReadonlyArray<Point2>): boolean {
  return boundary.length >= 3 && boundary.every(finitePoint) && Math.abs(polygonArea(boundary)) > GEOMETRY_EPSILON
}

function finitePoint(point: Point2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1])
}

function buildTerrainMesh(terrain: TerrainField, rawBoundary: ReadonlyArray<Point2>): TerrainMesh {
  const boundary = sanitizeBoundary(rawBoundary)
  if (boundary.length < 3) return { vertices: [], triangles: [], adjacency: [] }

  const contour = boundary.map(([x, z]) => new Vector2(x, z))
  const siteTriangleIndices = ShapeUtils.triangulateShape(contour, [])
  if (siteTriangleIndices.length === 0) return { vertices: [], triangles: [], adjacency: [] }

  const siteTriangles = siteTriangleIndices.map((indices) =>
    indices.map((index) => boundary[index]).filter((point): point is Point2 => point !== undefined),
  ).filter((triangle) => triangle.length === 3)
  const bounds = polygonBounds(boundary)
  const terrainMaxX = terrain.origin[0] + (terrain.cols - 1) * terrain.spacing
  const terrainMaxZ = terrain.origin[1] + (terrain.rows - 1) * terrain.spacing
  const minX = Math.max(bounds.minX, terrain.origin[0])
  const maxX = Math.min(bounds.maxX, terrainMaxX)
  const minZ = Math.max(bounds.minZ, terrain.origin[1])
  const maxZ = Math.min(bounds.maxZ, terrainMaxZ)
  if (maxX - minX <= GEOMETRY_EPSILON || maxZ - minZ <= GEOMETRY_EPSILON) {
    return { vertices: [], triangles: [], adjacency: [] }
  }

  const firstCol = Math.max(0, Math.floor((minX - terrain.origin[0]) / terrain.spacing) - 1)
  const lastCol = Math.min(terrain.cols - 2, Math.ceil((maxX - terrain.origin[0]) / terrain.spacing))
  const firstRow = Math.max(0, Math.floor((minZ - terrain.origin[1]) / terrain.spacing) - 1)
  const lastRow = Math.min(terrain.rows - 2, Math.ceil((maxZ - terrain.origin[1]) / terrain.spacing))

  const vertices: MeshVertex[] = []
  const triangles: MeshTriangle[] = []
  const vertexByPosition = new Map<string, number>()
  const triangleKeys = new Set<string>()

  const vertexIndex = ([x, z]: Point2): number => {
    const key = pointKey(x, z)
    const existing = vertexByPosition.get(key)
    if (existing !== undefined) return existing
    const index = vertices.length
    vertices.push({ x, z, height: surfaceHeightAt(terrain, x, z), boundary: false })
    vertexByPosition.set(key, index)
    return index
  }

  for (let row = firstRow; row <= lastRow; row += 1) {
    const z0 = terrain.origin[1] + row * terrain.spacing
    const z1 = z0 + terrain.spacing
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x0 = terrain.origin[0] + col * terrain.spacing
      const x1 = x0 + terrain.spacing
      const terrainTriangles: ReadonlyArray<ReadonlyArray<Point2>> = [
        [[x0, z0], [x0, z1], [x1, z0]],
        [[x1, z0], [x0, z1], [x1, z1]],
      ]

      for (const terrainTriangle of terrainTriangles) {
        for (const siteTriangle of siteTriangles) {
          const intersection = clipToConvexPolygon(siteTriangle, terrainTriangle)
          if (intersection.length < 3 || Math.abs(polygonArea(intersection)) <= GEOMETRY_EPSILON) continue

          const first = vertexIndex(intersection[0] as Point2)
          for (let index = 1; index < intersection.length - 1; index += 1) {
            const second = vertexIndex(intersection[index] as Point2)
            const third = vertexIndex(intersection[index + 1] as Point2)
            if (first === second || second === third || third === first) continue
            const triangle: MeshTriangle = [first, second, third]
            const key = [...triangle].sort((left, right) => left - right).join(':')
            if (triangleKeys.has(key)) continue
            triangleKeys.add(key)
            triangles.push(triangle)
          }
        }
      }
    }
  }

  const adjacencySets = vertices.map(() => new Set<number>())
  const edgeCounts = new Map<string, { readonly first: number; readonly second: number; count: number }>()
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const first = triangle[index]
      const second = triangle[(index + 1) % 3]
      if (first === undefined || second === undefined) continue
      adjacencySets[first]?.add(second)
      adjacencySets[second]?.add(first)
      const low = Math.min(first, second)
      const high = Math.max(first, second)
      const key = `${low}:${high}`
      const edge = edgeCounts.get(key)
      if (edge) edge.count += 1
      else edgeCounts.set(key, { first: low, second: high, count: 1 })
    }
  }
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue
    const first = vertices[edge.first]
    const second = vertices[edge.second]
    if (first) first.boundary = true
    if (second) second.boundary = true
  }

  return {
    vertices,
    triangles,
    adjacency: adjacencySets.map((neighbors) => [...neighbors].sort((left, right) => left - right)),
  }
}

function sanitizeBoundary(boundary: ReadonlyArray<Point2>): Point2[] {
  const points: Point2[] = []
  for (const point of boundary) {
    const previous = points[points.length - 1]
    if (!previous || !samePoint(previous, point)) points.push([point[0], point[1]])
  }
  if (points.length > 1 && samePoint(points[0] as Point2, points[points.length - 1] as Point2)) {
    points.pop()
  }
  return points
}

function trianglesAtPoint(mesh: TerrainMesh, point: Point2): number[] {
  const result: number[] = []
  for (let index = 0; index < mesh.triangles.length; index += 1) {
    const triangle = mesh.triangles[index]
    if (!triangle) continue
    const first = mesh.vertices[triangle[0]]
    const second = mesh.vertices[triangle[1]]
    const third = mesh.vertices[triangle[2]]
    if (first && second && third && pointInTriangle(point, first, second, third)) result.push(index)
  }
  return result
}

function descendToMinimum(mesh: TerrainMesh, initialVertex: number): number[] {
  let current = initialVertex
  while (true) {
    const height = mesh.vertices[current]?.height
    if (height === undefined) return []

    const plateau: number[] = []
    const seen = new Set<number>([current])
    const queue = [current]
    let lowerVertex = -1
    let lowerHeight = height

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const vertex = queue[cursor]
      if (vertex === undefined) continue
      plateau.push(vertex)
      for (const neighbor of mesh.adjacency[vertex] ?? []) {
        const neighborHeight = mesh.vertices[neighbor]?.height
        if (neighborHeight === undefined) continue
        if (neighborHeight < lowerHeight - GEOMETRY_EPSILON) {
          lowerHeight = neighborHeight
          lowerVertex = neighbor
        } else if (
          Math.abs(neighborHeight - lowerHeight) <= GEOMETRY_EPSILON &&
          neighborHeight < height - GEOMETRY_EPSILON &&
          (lowerVertex < 0 || neighbor < lowerVertex)
        ) {
          lowerVertex = neighbor
        }
        if (Math.abs(neighborHeight - height) <= GEOMETRY_EPSILON && !seen.has(neighbor)) {
          seen.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    if (lowerVertex < 0) return plateau.sort((left, right) => left - right)
    current = lowerVertex
  }
}
function buildWatershedRoots(mesh: TerrainMesh): Int32Array {
  const vertexCount = mesh.vertices.length
  const parent = new Int32Array(vertexCount)
  for (let index = 0; index < vertexCount; index += 1) parent[index] = index

  const representativeOf = (start: number): number => {
    let representative = start
    while (parent[representative] !== representative) {
      representative = parent[representative] as number
    }
    let current = start
    while (current !== representative) {
      const next = parent[current] as number
      parent[current] = representative
      current = next
    }
    return representative
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const height = mesh.vertices[vertex]?.height
    if (height === undefined) continue
    for (const neighbor of mesh.adjacency[vertex] ?? []) {
      if (neighbor <= vertex) continue
      const neighborHeight = mesh.vertices[neighbor]?.height
      if (neighborHeight === undefined || Math.abs(neighborHeight - height) > GEOMETRY_EPSILON) continue
      const firstRoot = representativeOf(vertex)
      const secondRoot = representativeOf(neighbor)
      if (firstRoot === secondRoot) continue
      const lowerRoot = Math.min(firstRoot, secondRoot)
      parent[Math.max(firstRoot, secondRoot)] = lowerRoot
    }
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    parent[vertex] = representativeOf(vertex)
  }

  const plateauHeight = new Float64Array(vertexCount)
  plateauHeight.fill(Number.POSITIVE_INFINITY)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const plateau = parent[vertex] as number
    const height = mesh.vertices[vertex]?.height
    if (height !== undefined) plateauHeight[plateau] = Math.min(plateauHeight[plateau] as number, height)
  }

  const downstream = new Int32Array(vertexCount)
  downstream.fill(-1)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const plateau = parent[vertex] as number
    const height = plateauHeight[plateau] as number
    for (const neighbor of mesh.adjacency[vertex] ?? []) {
      const neighborPlateau = parent[neighbor] as number
      if (neighborPlateau === plateau) continue
      const neighborHeight = plateauHeight[neighborPlateau] as number
      if (neighborHeight >= height - GEOMETRY_EPSILON) continue
      const selected = downstream[plateau] as number
      const selectedHeight = selected >= 0
        ? plateauHeight[selected] as number
        : Number.POSITIVE_INFINITY
      if (
        neighborHeight < selectedHeight - GEOMETRY_EPSILON ||
        (Math.abs(neighborHeight - selectedHeight) <= GEOMETRY_EPSILON && neighborPlateau < selected)
      ) {
        downstream[plateau] = neighborPlateau
      }
    }
  }

  const minimumByPlateau = new Int32Array(vertexCount)
  minimumByPlateau.fill(-1)
  const resolveMinimum = (start: number): number => {
    const path: number[] = []
    let current = start
    while (minimumByPlateau[current] === -1 && downstream[current] !== -1) {
      path.push(current)
      current = downstream[current] as number
    }
    const minimum = minimumByPlateau[current] === -1
      ? current
      : minimumByPlateau[current] as number
    minimumByPlateau[current] = minimum
    for (const plateau of path) minimumByPlateau[plateau] = minimum
    return minimum
  }

  const rootByVertex = new Int32Array(vertexCount)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    rootByVertex[vertex] = resolveMinimum(parent[vertex] as number)
  }
  return rootByVertex
}


function priorityFloodToSpill(
  mesh: TerrainMesh,
  sources: readonly number[],
  catchment: Uint8Array,
): number {
  const levels = new Float64Array(mesh.vertices.length)
  levels.fill(Number.POSITIVE_INFINITY)
  const heap: PriorityEntry[] = []
  for (const source of sources) {
    const level = mesh.vertices[source]?.height
    if (level === undefined) continue
    levels[source] = level
    pushPriority(heap, { vertex: source, level })
  }

  let spillLevel = Number.POSITIVE_INFINITY
  while (heap.length > 0) {
    const current = popPriority(heap)
    if (!current || current.level > (levels[current.vertex] ?? Number.POSITIVE_INFINITY) + GEOMETRY_EPSILON) continue
    if (current.level >= spillLevel - GEOMETRY_EPSILON) return spillLevel
    const vertex = mesh.vertices[current.vertex]
    if (!vertex) continue
    if (vertex.boundary) spillLevel = Math.min(spillLevel, current.level)

    for (const neighbor of mesh.adjacency[current.vertex] ?? []) {
      const neighborHeight = mesh.vertices[neighbor]?.height
      if (neighborHeight === undefined) continue
      const nextLevel = Math.max(current.level, neighborHeight)
      if (catchment[neighbor] !== 1) {
        spillLevel = Math.min(spillLevel, nextLevel)
        continue
      }
      if (nextLevel >= (levels[neighbor] ?? Number.POSITIVE_INFINITY) - GEOMETRY_EPSILON) continue
      levels[neighbor] = nextLevel
      pushPriority(heap, { vertex: neighbor, level: nextLevel })
    }
  }
  return spillLevel
}

function pushPriority(heap: PriorityEntry[], entry: PriorityEntry): void {
  heap.push(entry)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    const parentEntry = heap[parent]
    if (!parentEntry || comparePriority(parentEntry, entry) <= 0) break
    heap[index] = parentEntry
    index = parent
  }
  heap[index] = entry
}

function popPriority(heap: PriorityEntry[]): PriorityEntry | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (!first || !last || heap.length === 0) return first

  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    if (left >= heap.length) break
    let child = left
    if (right < heap.length && comparePriority(heap[right] as PriorityEntry, heap[left] as PriorityEntry) < 0) {
      child = right
    }
    const childEntry = heap[child]
    if (!childEntry || comparePriority(last, childEntry) <= 0) break
    heap[index] = childEntry
    index = child
  }
  heap[index] = last
  return first
}

function comparePriority(left: PriorityEntry, right: PriorityEntry): number {
  return left.level - right.level || left.vertex - right.vertex
}

function quantizedLevelStep(terrain: TerrainField): number {
  const units = Math.max(1, Math.round(POND_LEVEL_STEP / terrain.step))
  return normalizeNumber(units * terrain.step)
}

function buildLevels(
  bottomLevel: number,
  spillLevel: number,
  levelStep: number,
  tolerance: number,
): number[] {
  const levels: number[] = []
  for (let level = bottomLevel + levelStep; level < spillLevel - tolerance; level += levelStep) {
    levels.push(normalizeNumber(level))
  }
  if (levels.length === 0 || Math.abs((levels[levels.length - 1] as number) - spillLevel) > tolerance) {
    levels.push(spillLevel)
  }
  return levels
}

function recoverTopology(basin: PondBasin): BasinTopology | null {
  const recovered = analyzePondBasin(basin.terrain, basin.boundary, basin.seed)
  if (!recovered) return null
  return basinTopologies.get(recovered) ?? null
}

function connectedWetVertices(
  topology: BasinTopology,
  level: number,
  tolerance: number,
): Uint8Array {
  const wet = new Uint8Array(topology.mesh.vertices.length)
  const queue: number[] = []
  for (const source of topology.bottomVertices) {
    const height = topology.mesh.vertices[source]?.height
    if (height === undefined || height >= level - tolerance || wet[source] === 1) continue
    wet[source] = 1
    queue.push(source)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const vertex = queue[cursor]
    if (vertex === undefined) continue
    for (const neighbor of topology.mesh.adjacency[vertex] ?? []) {
      const height = topology.mesh.vertices[neighbor]?.height
      if (height === undefined || height >= level - tolerance || wet[neighbor] === 1) continue
      wet[neighbor] = 1
      queue.push(neighbor)
    }
  }
  return wet
}


function clipTriangleBelowLevel(
  triangle: readonly WetPoint[],
  level: number,
  tolerance: number,
): WetPoint[] {
  const output: WetPoint[] = []
  let previous = triangle[triangle.length - 1]
  if (!previous) return output
  let previousInside = previous.height <= level + tolerance

  for (const current of triangle) {
    const currentInside = current.height <= level + tolerance
    if (currentInside !== previousInside) output.push(heightIntersection(previous, current, level))
    if (currentInside) output.push(current)
    previous = current
    previousInside = currentInside
  }
  return deduplicateWetPoints(output)
}

function heightIntersection(first: WetPoint, second: WetPoint, level: number): WetPoint {
  const delta = second.height - first.height
  if (Math.abs(delta) <= GEOMETRY_EPSILON) return { x: second.x, z: second.z, height: level }
  const amount = Math.max(0, Math.min(1, (level - first.height) / delta))
  return {
    x: first.x + (second.x - first.x) * amount,
    z: first.z + (second.z - first.z) * amount,
    height: level,
  }
}

function appendSurfaceVertex(
  point: WetPoint,
  level: number,
  positions: number[],
  depths: number[],
): void {
  positions.push(point.x, level, point.z)
  depths.push(Math.max(0, level - point.height))
}

function emptySurface(): PondSurface {
  return { level: null, positions: new Float32Array(0), depths: new Float32Array(0), area: 0 }
}

function appendTriangleContours(
  triangle: readonly WetPoint[],
  level: number,
  emitted: Set<string>,
  positions: number[],
): void {
  const tolerance = GEOMETRY_EPSILON
  if (triangle.every((point) => Math.abs(point.height - level) <= tolerance)) return

  const intersections: MutablePoint2[] = []
  for (let index = 0; index < triangle.length; index += 1) {
    const first = triangle[index]
    const second = triangle[(index + 1) % triangle.length]
    if (!first || !second) continue
    const firstDelta = first.height - level
    const secondDelta = second.height - level
    const firstOn = Math.abs(firstDelta) <= tolerance
    const secondOn = Math.abs(secondDelta) <= tolerance

    if (firstOn && secondOn) {
      appendContourSegment([first.x, first.z], [second.x, second.z], level, emitted, positions)
      continue
    }
    if (firstOn) addUniquePoint(intersections, [first.x, first.z])
    if (secondOn) addUniquePoint(intersections, [second.x, second.z])
    if (firstDelta * secondDelta < 0) {
      const crossing = heightIntersection(first, second, level)
      addUniquePoint(intersections, [crossing.x, crossing.z])
    }
  }

  if (intersections.length === 2) {
    appendContourSegment(intersections[0] as Point2, intersections[1] as Point2, level, emitted, positions)
  } else if (intersections.length > 2) {
    let first = intersections[0] as Point2
    let second = intersections[1] as Point2
    let greatestDistance = squaredDistance(first, second)
    for (let left = 0; left < intersections.length; left += 1) {
      for (let right = left + 1; right < intersections.length; right += 1) {
        const candidateFirst = intersections[left] as Point2
        const candidateSecond = intersections[right] as Point2
        const distance = squaredDistance(candidateFirst, candidateSecond)
        if (distance > greatestDistance) {
          first = candidateFirst
          second = candidateSecond
          greatestDistance = distance
        }
      }
    }
    appendContourSegment(first, second, level, emitted, positions)
  }
}

function appendContourSegment(
  first: Point2,
  second: Point2,
  level: number,
  emitted: Set<string>,
  positions: number[],
): void {
  if (samePoint(first, second)) return
  const firstKey = pointKey(first[0], first[1])
  const secondKey = pointKey(second[0], second[1])
  const key = firstKey < secondKey
    ? `${normalizeNumber(level)}:${firstKey}:${secondKey}`
    : `${normalizeNumber(level)}:${secondKey}:${firstKey}`
  if (emitted.has(key)) return
  emitted.add(key)
  positions.push(first[0], level, first[1], second[0], level, second[1])
}

function addUniquePoint(points: MutablePoint2[], point: MutablePoint2): void {
  if (!points.some((candidate) => samePoint(candidate, point))) points.push(point)
}

function clipToConvexPolygon(
  subject: ReadonlyArray<Point2>,
  clipper: ReadonlyArray<Point2>,
): Point2[] {
  let output = subject.map(([x, z]): Point2 => [x, z])
  const orientation = Math.sign(polygonArea(clipper)) || 1

  for (let index = 0; index < clipper.length && output.length > 0; index += 1) {
    const clipStart = clipper[index]
    const clipEnd = clipper[(index + 1) % clipper.length]
    if (!clipStart || !clipEnd) continue
    const input = output
    output = []
    let previous = input[input.length - 1]
    if (!previous) continue
    let previousInside = insideHalfPlane(previous, clipStart, clipEnd, orientation)

    for (const current of input) {
      const currentInside = insideHalfPlane(current, clipStart, clipEnd, orientation)
      if (currentInside !== previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd))
      }
      if (currentInside) output.push(current)
      previous = current
      previousInside = currentInside
    }
    output = deduplicatePoints(output)
  }
  return output
}

function insideHalfPlane(point: Point2, first: Point2, second: Point2, orientation: number): boolean {
  return orientation * cross2(first, second, point) >= -GEOMETRY_EPSILON
}

function lineIntersection(first: Point2, second: Point2, clipFirst: Point2, clipSecond: Point2): Point2 {
  const rx = second[0] - first[0]
  const rz = second[1] - first[1]
  const sx = clipSecond[0] - clipFirst[0]
  const sz = clipSecond[1] - clipFirst[1]
  const denominator = rx * sz - rz * sx
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return second
  const amount = ((clipFirst[0] - first[0]) * sz - (clipFirst[1] - first[1]) * sx) / denominator
  return [first[0] + amount * rx, first[1] + amount * rz]
}

function deduplicatePoints(points: Point2[]): Point2[] {
  const result: Point2[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (!previous || !samePoint(previous, point)) result.push(point)
  }
  if (result.length > 1 && samePoint(result[0] as Point2, result[result.length - 1] as Point2)) {
    result.pop()
  }
  return result
}

function deduplicateWetPoints(points: WetPoint[]): WetPoint[] {
  const result: WetPoint[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (!previous || !samePoint([previous.x, previous.z], [point.x, point.z])) result.push(point)
  }
  const first = result[0]
  const last = result[result.length - 1]
  if (first && last && result.length > 1 && samePoint([first.x, first.z], [last.x, last.z])) result.pop()
  return result
}

function pointInTriangle(point: Point2, first: MeshVertex, second: MeshVertex, third: MeshVertex): boolean {
  const firstCross = cross2([first.x, first.z], [second.x, second.z], point)
  const secondCross = cross2([second.x, second.z], [third.x, third.z], point)
  const thirdCross = cross2([third.x, third.z], [first.x, first.z], point)
  const hasNegative = firstCross < -GEOMETRY_EPSILON || secondCross < -GEOMETRY_EPSILON || thirdCross < -GEOMETRY_EPSILON
  const hasPositive = firstCross > GEOMETRY_EPSILON || secondCross > GEOMETRY_EPSILON || thirdCross > GEOMETRY_EPSILON
  return !(hasNegative && hasPositive)
}

function isWetPoint(point: Point2 | WetPoint): point is WetPoint {
  return !Array.isArray(point)
}

function polygonArea(points: ReadonlyArray<Point2 | WetPoint>): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    const currentX = isWetPoint(current) ? current.x : current[0]
    const currentZ = isWetPoint(current) ? current.z : current[1]
    const nextX = isWetPoint(next) ? next.x : next[0]
    const nextZ = isWetPoint(next) ? next.z : next[1]
    area += currentX * nextZ - nextX * currentZ
  }
  return area / 2
}

function cross2(first: Point2 | WetPoint, second: Point2 | WetPoint, third: Point2 | WetPoint): number {
  const firstX = isWetPoint(first) ? first.x : first[0]
  const firstZ = isWetPoint(first) ? first.z : first[1]
  const secondX = isWetPoint(second) ? second.x : second[0]
  const secondZ = isWetPoint(second) ? second.z : second[1]
  const thirdX = isWetPoint(third) ? third.x : third[0]
  const thirdZ = isWetPoint(third) ? third.z : third[1]
  return (secondX - firstX) * (thirdZ - firstZ) - (secondZ - firstZ) * (thirdX - firstX)
}

function polygonBounds(points: ReadonlyArray<Point2>): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

function samePoint(first: Point2, second: Point2): boolean {
  return Math.abs(first[0] - second[0]) <= GEOMETRY_EPSILON && Math.abs(first[1] - second[1]) <= GEOMETRY_EPSILON
}

function pointKey(x: number, z: number): string {
  return `${normalizeNumber(x)}:${normalizeNumber(z)}`
}

function normalizeNumber(value: number): number {
  return Math.round(value * 1e10) / 1e10
}

function squaredDistance(first: Point2, second: Point2): number {
  const x = second[0] - first[0]
  const z = second[1] - first[1]
  return x * x + z * z
}

function heightTolerance(terrain: TerrainField): number {
  return Math.max(GEOMETRY_EPSILON, terrain.step * 1e-7)
}
