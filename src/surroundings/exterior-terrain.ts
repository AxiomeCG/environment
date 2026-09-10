import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { ShapeUtils, Vector2 } from 'three'
import type { Point2 } from './frontages'
import { createLandscapeHeight, LANDSCAPE_EXTENT } from './landscape-noise'
import { clipConvexPolygon } from './neighborhood'
import type { LandscapeRegion } from './landscape-region'

export const EXTERIOR_TERRAIN_SECTION_SIZE = 64
export const EXTERIOR_TERRAIN_SECTION_SEGMENTS = 10
export const EXTERIOR_TERRAIN_GROUND_OFFSET = -0.02
export const EXTERIOR_TERRAIN_EXTENT = LANDSCAPE_EXTENT

const MINIMUM_RELIEF_START_DISTANCE = 42
const RELIEF_TRANSITION_DISTANCE = 62
const NORMAL_SAMPLE_DISTANCE = 1
const GEOMETRY_EPSILON = 1e-9

export type ExteriorTerrainSectionAddress = Readonly<{
  key: string
  x: number
  z: number
}>

export type ExteriorTerrainContext = Readonly<{
  boundary: readonly Point2[]
  levelTerrainDistance?: number
  terrain: TerrainField | null
  seed?: string
  reliefAmplitudeScale?: number
  region?: LandscapeRegion
}>

export type ExteriorTerrainSampler = Readonly<{
  heightAt: (x: number, z: number) => number
  normalAt: (x: number, z: number) => readonly [number, number, number]
  sectionSegments?: (address: ExteriorTerrainSectionAddress) => number
}>

export type ExteriorTerrainSection = Readonly<{
  address: ExteriorTerrainSectionAddress
  indices: Uint32Array
  normals: Float32Array
  positions: Float32Array
}>

export type ExteriorTerrainGeometry = Readonly<{
  indices: Uint32Array
  normals: Float32Array
  ownedBufferBytes: number
  positions: Float32Array
  sectionCount: number
  triangleCount: number
}>

export function exteriorTerrainSectionKey(sectionX: number, sectionZ: number): string {
  return `exterior-terrain:${sectionX}:${sectionZ}`
}

export function exteriorTerrainSectionAddressAt(
  worldX: number,
  worldZ: number,
): ExteriorTerrainSectionAddress {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('Exterior Terrain coordinates must be finite')
  }

  const x = Math.floor(worldX / EXTERIOR_TERRAIN_SECTION_SIZE)
  const z = Math.floor(worldZ / EXTERIOR_TERRAIN_SECTION_SIZE)
  return { key: exteriorTerrainSectionKey(x, z), x, z }
}

export function deriveExteriorTerrainSectionAddresses(
  boundary: readonly Point2[],
  extent = EXTERIOR_TERRAIN_EXTENT,
): ExteriorTerrainSectionAddress[] {
  if (!hasUsableBoundary(boundary) || !Number.isFinite(extent) || extent < 0) return []

  const bounds = boundaryBounds(boundary)
  const minSectionX = Math.floor((bounds.minX - extent) / EXTERIOR_TERRAIN_SECTION_SIZE)
  const maxSectionX = Math.ceil((bounds.maxX + extent) / EXTERIOR_TERRAIN_SECTION_SIZE) - 1
  const minSectionZ = Math.floor((bounds.minZ - extent) / EXTERIOR_TERRAIN_SECTION_SIZE)
  const maxSectionZ = Math.ceil((bounds.maxZ + extent) / EXTERIOR_TERRAIN_SECTION_SIZE) - 1
  const addresses: ExteriorTerrainSectionAddress[] = []

  for (let z = minSectionZ; z <= maxSectionZ; z += 1) {
    for (let x = minSectionX; x <= maxSectionX; x += 1) {
      addresses.push({ key: exteriorTerrainSectionKey(x, z), x, z })
    }
  }

  return addresses
}

export function createExteriorTerrainSampler({
  boundary,
  levelTerrainDistance,
  terrain,
  seed,
  reliefAmplitudeScale = 1,
  region,
}: ExteriorTerrainContext): ExteriorTerrainSampler {
  if (!hasUsableBoundary(boundary)) {
    return {
      heightAt: () => 0,
      normalAt: () => [0, 1, 0],
    }
  }

  const reliefStartDistance = Number.isFinite(levelTerrainDistance)
    ? Math.max(MINIMUM_RELIEF_START_DISTANCE, levelTerrainDistance!)
    : MINIMUM_RELIEF_START_DISTANCE
  const reliefFullDistance = reliefStartDistance + RELIEF_TRANSITION_DISTANCE
  const reference = polygonCentroid(boundary)
  const bounds = boundaryBounds(boundary)
  const landscapeHeight = createLandscapeHeight(
    reference,
    Math.max(
      ...boundary.map((point) => Math.hypot(point[0] - reference[0], point[1] - reference[1])),
    ),
    seed,
    region,
  )
  const heightAt = (x: number, z: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0

    const beyondTransition =
      x < bounds.minX - reliefFullDistance ||
      x > bounds.maxX + reliefFullDistance ||
      z < bounds.minZ - reliefFullDistance ||
      z > bounds.maxZ + reliefFullDistance
    const transfer = beyondTransition
      ? 1
      : smoothstep(
          reliefStartDistance,
          reliefFullDistance,
          exteriorDistanceToBoundary(boundary, x, z),
        )
    const siteHeight = terrain && transfer < 1 ? surfaceHeightAt(terrain, x, z) : 0
    const height =
      transfer === 0
        ? siteHeight
        : siteHeight * (1 - transfer) + landscapeHeight(x, z) * transfer * reliefAmplitudeScale
    return Number.isFinite(height) ? height : 0
  }
  const normalAt = (x: number, z: number): readonly [number, number, number] => {
    const dhdx =
      (heightAt(x + NORMAL_SAMPLE_DISTANCE, z) - heightAt(x - NORMAL_SAMPLE_DISTANCE, z)) /
      (NORMAL_SAMPLE_DISTANCE * 2)
    const dhdz =
      (heightAt(x, z + NORMAL_SAMPLE_DISTANCE) - heightAt(x, z - NORMAL_SAMPLE_DISTANCE)) /
      (NORMAL_SAMPLE_DISTANCE * 2)
    const length = Math.hypot(dhdx, 1, dhdz)
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) return [0, 1, 0]
    return [-dhdx / length, 1 / length, -dhdz / length]
  }

  return { heightAt, normalAt }
}

/** Share the rendered grid between terrain, road draping, and grounded props.
 * Each procedural height is evaluated once; off-grid queries use the same
 * diagonal as the terrain triangles, not a different analytic surface. */
export function createRenderedTerrainSampler(
  source: ExteriorTerrainSampler,
  addresses: readonly ExteriorTerrainSectionAddress[],
): ExteriorTerrainSampler {
  if (!addresses.length) return source
  type Grid = {
    address: ExteriorTerrainSectionAddress
    segments: number
    inverseSpacing: number
    heights: Float32Array
  }
  const rows = new Map<number, Map<number, Grid>>()
  for (const address of addresses) {
    let row = rows.get(address.z)
    if (!row) {
      row = new Map()
      rows.set(address.z, row)
    }
    const segments = terrainSectionSegments(source, address)
    row.set(address.x, {
      address,
      segments,
      inverseSpacing: segments / EXTERIOR_TERRAIN_SECTION_SIZE,
      heights: new Float32Array((segments + 1) ** 2).fill(NaN),
    })
  }
  const vertexHeight = (grid: Grid, column: number, row: number): number => {
    const index = row * (grid.segments + 1) + column
    let height = grid.heights[index]!
    if (Number.isNaN(height)) {
      height = Math.fround(
        stitchedTerrainVertexHeight(source, grid.address, grid.segments, column, row),
      )
      grid.heights[index] = height
    }
    return height
  }
  const heightAt = (x: number, z: number): number => {
    const sectionX = Math.floor(x / EXTERIOR_TERRAIN_SECTION_SIZE)
    const sectionZ = Math.floor(z / EXTERIOR_TERRAIN_SECTION_SIZE)
    const grid = rows.get(sectionZ)?.get(sectionX)
    if (!grid) return source.heightAt(x, z)
    const localX = (x - sectionX * EXTERIOR_TERRAIN_SECTION_SIZE) * grid.inverseSpacing
    const localZ = (z - sectionZ * EXTERIOR_TERRAIN_SECTION_SIZE) * grid.inverseSpacing
    const roundedX = Math.round(localX)
    const roundedZ = Math.round(localZ)
    if (
      Math.abs(localX - roundedX) < GEOMETRY_EPSILON &&
      Math.abs(localZ - roundedZ) < GEOMETRY_EPSILON
    ) {
      return vertexHeight(grid, roundedX, roundedZ)
    }
    const column = Math.min(grid.segments - 1, Math.floor(localX))
    const row = Math.min(grid.segments - 1, Math.floor(localZ))
    const u = localX - column
    const v = localZ - row
    const east = vertexHeight(grid, column + 1, row)
    const north = vertexHeight(grid, column, row + 1)
    return u + v <= 1
      ? vertexHeight(grid, column, row) * (1 - u - v) + east * u + north * v
      : vertexHeight(grid, column + 1, row + 1) * (u + v - 1) + east * (1 - v) + north * (1 - u)
  }
  const normalAt = (x: number, z: number): readonly [number, number, number] => {
    const grid = rows
      .get(Math.floor(z / EXTERIOR_TERRAIN_SECTION_SIZE))
      ?.get(Math.floor(x / EXTERIOR_TERRAIN_SECTION_SIZE))
    const spacing = grid ? 1 / grid.inverseSpacing : NORMAL_SAMPLE_DISTANCE
    const dx = heightAt(x - spacing, z) - heightAt(x + spacing, z)
    const dz = heightAt(x, z - spacing) - heightAt(x, z + spacing)
    const dy = spacing * 2
    const length = Math.hypot(dx, dy, dz)
    return length > GEOMETRY_EPSILON && Number.isFinite(length)
      ? [dx / length, dy / length, dz / length]
      : [0, 1, 0]
  }
  return { ...source, heightAt, normalAt }
}

export function createTerrainSubdivisionSampler(
  source: ExteriorTerrainSampler,
  boundary: readonly Point2[],
): ExteriorTerrainSampler {
  const bounds = boundaryBounds(boundary)
  const resolutions = new Map<string, number>()
  return {
    ...source,
    sectionSegments: (address) => {
      const minX = address.x * EXTERIOR_TERRAIN_SECTION_SIZE
      const cached = resolutions.get(address.key)
      if (cached !== undefined) return cached
      const minZ = address.z * EXTERIOR_TERRAIN_SECTION_SIZE
      const dx = Math.max(bounds.minX - minX - EXTERIOR_TERRAIN_SECTION_SIZE, minX - bounds.maxX, 0)
      const dz = Math.max(bounds.minZ - minZ - EXTERIOR_TERRAIN_SECTION_SIZE, minZ - bounds.maxZ, 0)
      const distance = Math.hypot(dx, dz)
      const segments = Math.max(
        terrainSectionSegments(source, address),
        distance < 80 ? 20 : 10,
      )
      resolutions.set(address.key, segments)
      return segments
    },
  }
}

export function buildExteriorTerrainSection(
  address: ExteriorTerrainSectionAddress,
  sampler: ExteriorTerrainSampler,
  boundary: readonly Point2[],
): ExteriorTerrainSection {
  const segments = terrainSectionSegments(sampler, address)
  const verticesPerSide = segments + 1
  const vertexCount = verticesPerSide * verticesPerSide
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const indexValues: number[] = []
  const spacing = EXTERIOR_TERRAIN_SECTION_SIZE / segments
  const originX = address.x * EXTERIOR_TERRAIN_SECTION_SIZE
  const originZ = address.z * EXTERIOR_TERRAIN_SECTION_SIZE
  const bounds = boundaryBounds(boundary)
  const needsBoundaryClip =
    originX <= bounds.maxX &&
    originX + EXTERIOR_TERRAIN_SECTION_SIZE >= bounds.minX &&
    originZ <= bounds.maxZ &&
    originZ + EXTERIOR_TERRAIN_SECTION_SIZE >= bounds.minZ
  const clippedPositions: number[] = []
  const clippedNormals: number[] = []
  let exteriorTriangles: Point2[][] | undefined
  const appendBoundarySkirt = (polygon: readonly Point2[]) => {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]!,
        end = polygon[(index + 1) % polygon.length]!
      const dx = end[0] - start[0],
        dz = end[1] - start[1]
      const length = Math.hypot(dx, dz)
      if (
        length <= GEOMETRY_EPSILON ||
        !boundary.some((edge, edgeIndex) => {
          const next = boundary[(edgeIndex + 1) % boundary.length]!
          return (
            distanceToSegment(edge, next, ...start) <= GEOMETRY_EPSILON &&
            distanceToSegment(edge, next, ...end) <= GEOMETRY_EPSILON
          )
        })
      )
        continue
      const base = vertexCount + clippedPositions.length / 3
      const startHeight = sampler.heightAt(...start),
        endHeight = sampler.heightAt(...end)
      // Close the deliberate road-clearance offset without covering the Site
      // or raising the terrain beneath any road.
      clippedPositions.push(
        start[0],
        startHeight,
        start[1],
        end[0],
        endHeight,
        end[1],
        start[0],
        startHeight - EXTERIOR_TERRAIN_GROUND_OFFSET,
        start[1],
        end[0],
        endHeight - EXTERIOR_TERRAIN_GROUND_OFFSET,
        end[1],
      )
      for (let vertex = 0; vertex < 4; vertex += 1)
        clippedNormals.push(-dz / length, 0, dx / length)
      indexValues.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  }
  const appendTriangle = (
    triangle: readonly [Point2, Point2, Point2],
    a: number,
    b: number,
    c: number,
  ) => {
    if (!triangleOverlapsPolygonInterior(triangle, boundary)) {
      indexValues.push(a, b, c)
      appendBoundarySkirt(triangle)
      return
    }
    // Triangulate the complement, not a fan or an oversized hole. This also
    // handles concave Sites and Sites smaller than a single terrain triangle.
    if (!exteriorTriangles) {
      const margin = EXTERIOR_TERRAIN_SECTION_SIZE
      const contour = [
        new Vector2(bounds.minX - margin, bounds.minZ - margin),
        new Vector2(bounds.maxX + margin, bounds.minZ - margin),
        new Vector2(bounds.maxX + margin, bounds.maxZ + margin),
        new Vector2(bounds.minX - margin, bounds.maxZ + margin),
      ]
      const hole = boundary.map(([x, z]) => new Vector2(x, z))
      const faces = ShapeUtils.triangulateShape(contour, [hole])
      const points = [...contour, ...hole]
      exteriorTriangles = faces.map((face) =>
        face.map((index): Point2 => {
          const point = points[index]!
          return [point.x, point.y]
        }),
      )
    }
    for (const exterior of exteriorTriangles) {
      const polygon = clipConvexPolygon(triangle, exterior)
      if (polygon.length < 3 || Math.abs(signedDoubleArea(polygon)) <= GEOMETRY_EPSILON) continue
      const base = vertexCount + clippedPositions.length / 3
      for (const [x, z] of polygon) {
        clippedPositions.push(x, sampler.heightAt(x, z), z)
        clippedNormals.push(...sampler.normalAt(x, z))
      }
      for (let index = 1; index < polygon.length - 1; index += 1) {
        if (Math.abs(cross2(polygon[0]!, polygon[index]!, polygon[index + 1]!)) <= GEOMETRY_EPSILON)
          continue
        indexValues.push(base, base + index, base + index + 1)
      }
      appendBoundarySkirt(polygon)
    }
  }

  for (let row = 0; row < verticesPerSide; row += 1) {
    const z = originZ + row * spacing
    for (let column = 0; column < verticesPerSide; column += 1) {
      const x = originX + column * spacing
      const offset = (row * verticesPerSide + column) * 3
      const height = stitchedTerrainVertexHeight(sampler, address, segments, column, row)
      const normal = stitchedTerrainVertexNormal(sampler, address, segments, column, row)
      positions[offset] = x
      positions[offset + 1] = height
      positions[offset + 2] = z
      normals.set(normal, offset)
    }
  }

  for (let row = 0; row < segments; row += 1) {
    const z = originZ + row * spacing
    for (let column = 0; column < segments; column += 1) {
      const x = originX + column * spacing
      const first = row * verticesPerSide + column
      const nextColumn = first + 1
      const nextRow = first + verticesPerSide
      const diagonal = nextRow + 1
      if (
        !needsBoundaryClip ||
        x + spacing < bounds.minX ||
        x > bounds.maxX ||
        z + spacing < bounds.minZ ||
        z > bounds.maxZ
      ) {
        indexValues.push(first, nextRow, nextColumn, nextColumn, nextRow, diagonal)
        continue
      }
      const firstTriangle = [
        [x, z],
        [x, z + spacing],
        [x + spacing, z],
      ] as const
      const secondTriangle = [
        [x + spacing, z],
        [x, z + spacing],
        [x + spacing, z + spacing],
      ] as const
      appendTriangle(firstTriangle, first, nextRow, nextColumn)
      appendTriangle(secondTriangle, nextColumn, nextRow, diagonal)
    }
  }

  if (clippedPositions.length > 0) {
    const mergedPositions = new Float32Array(positions.length + clippedPositions.length)
    const mergedNormals = new Float32Array(normals.length + clippedNormals.length)
    mergedPositions.set(positions)
    mergedPositions.set(clippedPositions, positions.length)
    mergedNormals.set(normals)
    mergedNormals.set(clippedNormals, normals.length)
    return {
      address,
      indices: new Uint32Array(indexValues),
      normals: mergedNormals,
      positions: mergedPositions,
    }
  }
  return { address, indices: new Uint32Array(indexValues), normals, positions }
}

export function buildExteriorTerrainSections(
  addresses: readonly ExteriorTerrainSectionAddress[],
  context: ExteriorTerrainContext,
): ExteriorTerrainSection[] {
  const uniqueAddresses = new Map<string, ExteriorTerrainSectionAddress>()
  for (const address of addresses) {
    const key = exteriorTerrainSectionKey(address.x, address.z)
    uniqueAddresses.set(key, { key, x: address.x, z: address.z })
  }
  const orderedAddresses = [...uniqueAddresses.values()].sort(
    (left, right) => left.z - right.z || left.x - right.x,
  )
  const sampler = createExteriorTerrainSampler(context)
  return orderedAddresses.map((address) =>
    buildExteriorTerrainSection(address, sampler, context.boundary),
  )
}

export function mergeExteriorTerrainSections(
  sections: readonly ExteriorTerrainSection[],
): ExteriorTerrainGeometry {
  const positionLength = sections.reduce((sum, section) => sum + section.positions.length, 0)
  const normalLength = sections.reduce((sum, section) => sum + section.normals.length, 0)
  const indexLength = sections.reduce((sum, section) => sum + section.indices.length, 0)
  const positions = new Float32Array(positionLength)
  const normals = new Float32Array(normalLength)
  const indices = new Uint32Array(indexLength)
  let positionOffset = 0
  let normalOffset = 0
  let indexOffset = 0
  let vertexOffset = 0

  for (const section of sections) {
    positions.set(section.positions, positionOffset)
    normals.set(section.normals, normalOffset)
    for (let index = 0; index < section.indices.length; index += 1) {
      indices[indexOffset + index] = section.indices[index]! + vertexOffset
    }
    positionOffset += section.positions.length
    normalOffset += section.normals.length
    indexOffset += section.indices.length
    vertexOffset += section.positions.length / 3
  }

  return {
    indices,
    normals,
    ownedBufferBytes: positions.byteLength + normals.byteLength + indices.byteLength,
    positions,
    sectionCount: sections.length,
    triangleCount: indices.length / 3,
  }
}

const MAX_EXTERIOR_TERRAIN_SECTION_SEGMENTS = 40

export function terrainSectionSegments(
  sampler: ExteriorTerrainSampler,
  address: ExteriorTerrainSectionAddress,
): number {
  const requested = sampler.sectionSegments?.(address)
  if (!Number.isFinite(requested)) return EXTERIOR_TERRAIN_SECTION_SEGMENTS
  // Nested subdivisions retain every coarse edge vertex; arbitrary counts
  // interpolate across coarse kinks and leave cracks between section meshes.
  let segments = EXTERIOR_TERRAIN_SECTION_SEGMENTS
  while (segments < requested! && segments < MAX_EXTERIOR_TERRAIN_SECTION_SEGMENTS) {
    segments *= 2
  }
  return segments
}

function stitchedTerrainVertexHeight(
  sampler: ExteriorTerrainSampler,
  address: ExteriorTerrainSectionAddress,
  segments: number,
  column: number,
  row: number,
): number {
  const interpolation = coarserEdgeInterpolation(sampler, address, segments, column, row)
  if (interpolation) {
    return (
      sampler.heightAt(interpolation.x0, interpolation.z0) * (1 - interpolation.amount) +
      sampler.heightAt(interpolation.x1, interpolation.z1) * interpolation.amount
    )
  }
  const spacing = EXTERIOR_TERRAIN_SECTION_SIZE / segments
  return sampler.heightAt(
    address.x * EXTERIOR_TERRAIN_SECTION_SIZE + column * spacing,
    address.z * EXTERIOR_TERRAIN_SECTION_SIZE + row * spacing,
  )
}

function stitchedTerrainVertexNormal(
  sampler: ExteriorTerrainSampler,
  address: ExteriorTerrainSectionAddress,
  segments: number,
  column: number,
  row: number,
): readonly [number, number, number] {
  const interpolation = coarserEdgeInterpolation(sampler, address, segments, column, row)
  if (!interpolation) {
    const spacing = EXTERIOR_TERRAIN_SECTION_SIZE / segments
    return sampler.normalAt(
      address.x * EXTERIOR_TERRAIN_SECTION_SIZE + column * spacing,
      address.z * EXTERIOR_TERRAIN_SECTION_SIZE + row * spacing,
    )
  }
  const first = sampler.normalAt(interpolation.x0, interpolation.z0)
  const second = sampler.normalAt(interpolation.x1, interpolation.z1)
  const x = first[0] * (1 - interpolation.amount) + second[0] * interpolation.amount
  const y = first[1] * (1 - interpolation.amount) + second[1] * interpolation.amount
  const z = first[2] * (1 - interpolation.amount) + second[2] * interpolation.amount
  const length = Math.hypot(x, y, z)
  return length > GEOMETRY_EPSILON ? [x / length, y / length, z / length] : [0, 1, 0]
}

function coarserEdgeInterpolation(
  sampler: ExteriorTerrainSampler,
  address: ExteriorTerrainSectionAddress,
  segments: number,
  column: number,
  row: number,
): Readonly<{ x0: number; z0: number; x1: number; z1: number; amount: number }> | null {
  let neighbor: ExteriorTerrainSectionAddress | null = null
  let along = 0
  let horizontal = false
  if (column === 0) {
    neighbor = {
      key: exteriorTerrainSectionKey(address.x - 1, address.z),
      x: address.x - 1,
      z: address.z,
    }
    along = row / segments
  } else if (column === segments) {
    neighbor = {
      key: exteriorTerrainSectionKey(address.x + 1, address.z),
      x: address.x + 1,
      z: address.z,
    }
    along = row / segments
  } else if (row === 0) {
    neighbor = {
      key: exteriorTerrainSectionKey(address.x, address.z - 1),
      x: address.x,
      z: address.z - 1,
    }
    along = column / segments
    horizontal = true
  } else if (row === segments) {
    neighbor = {
      key: exteriorTerrainSectionKey(address.x, address.z + 1),
      x: address.x,
      z: address.z + 1,
    }
    along = column / segments
    horizontal = true
  }
  if (!neighbor) return null
  const neighborSegments = terrainSectionSegments(sampler, neighbor)
  if (neighborSegments >= segments) return null
  const coarse = along * neighborSegments
  const lower = Math.floor(coarse)
  if (Math.abs(coarse - lower) <= GEOMETRY_EPSILON) return null
  const amount = coarse - lower
  const low = lower / neighborSegments
  const high = (lower + 1) / neighborSegments
  const baseX = address.x * EXTERIOR_TERRAIN_SECTION_SIZE
  const baseZ = address.z * EXTERIOR_TERRAIN_SECTION_SIZE
  if (horizontal) {
    const z = row === 0 ? baseZ : baseZ + EXTERIOR_TERRAIN_SECTION_SIZE
    return {
      x0: baseX + low * EXTERIOR_TERRAIN_SECTION_SIZE,
      z0: z,
      x1: baseX + high * EXTERIOR_TERRAIN_SECTION_SIZE,
      z1: z,
      amount,
    }
  }
  const x = column === 0 ? baseX : baseX + EXTERIOR_TERRAIN_SECTION_SIZE
  return {
    x0: x,
    z0: baseZ + low * EXTERIOR_TERRAIN_SECTION_SIZE,
    x1: x,
    z1: baseZ + high * EXTERIOR_TERRAIN_SECTION_SIZE,
    amount,
  }
}

function exteriorDistanceToBoundary(boundary: readonly Point2[], x: number, z: number): number {
  if (pointInPolygon(boundary, x, z)) return 0

  let distance = Infinity
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!
    const end = boundary[(index + 1) % boundary.length]!
    distance = Math.min(distance, distanceToSegment(start, end, x, z))
  }
  return Number.isFinite(distance) ? distance : 0
}

function distanceToSegment(start: Point2, end: Point2, x: number, z: number): number {
  const deltaX = end[0] - start[0]
  const deltaZ = end[1] - start[1]
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  if (lengthSquared <= GEOMETRY_EPSILON) return Math.hypot(x - start[0], z - start[1])
  const mix = Math.max(
    0,
    Math.min(1, ((x - start[0]) * deltaX + (z - start[1]) * deltaZ) / lengthSquared),
  )
  return Math.hypot(x - (start[0] + deltaX * mix), z - (start[1] + deltaZ * mix))
}

function triangleOverlapsPolygonInterior(
  triangle: readonly [Point2, Point2, Point2],
  boundary: readonly Point2[],
): boolean {
  const centroid: Point2 = [
    (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
    (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
  ]
  if (pointInPolygonInterior(boundary, centroid[0], centroid[1])) return true
  if (triangle.some(([x, z]) => pointInPolygonInterior(boundary, x, z))) return true
  if (boundary.some((point) => pointInTriangleInterior(point, triangle))) return true

  for (let triangleIndex = 0; triangleIndex < triangle.length; triangleIndex += 1) {
    const triangleStart = triangle[triangleIndex]!
    const triangleEnd = triangle[(triangleIndex + 1) % triangle.length]!
    for (let boundaryIndex = 0; boundaryIndex < boundary.length; boundaryIndex += 1) {
      if (
        segmentsProperlyIntersect(
          triangleStart,
          triangleEnd,
          boundary[boundaryIndex]!,
          boundary[(boundaryIndex + 1) % boundary.length]!,
        )
      )
        return true
    }
  }
  return false
}

function pointInPolygonInterior(boundary: readonly Point2[], x: number, z: number): boolean {
  for (let index = 0; index < boundary.length; index += 1) {
    if (
      distanceToSegment(boundary[index]!, boundary[(index + 1) % boundary.length]!, x, z) <=
      GEOMETRY_EPSILON
    )
      return false
  }
  return pointInPolygon(boundary, x, z)
}

function pointInTriangleInterior(
  point: Point2,
  triangle: readonly [Point2, Point2, Point2],
): boolean {
  const crosses = triangle.map((start, index) =>
    cross2(start, triangle[(index + 1) % triangle.length]!, point),
  )
  return (
    crosses.every((cross) => cross > GEOMETRY_EPSILON) ||
    crosses.every((cross) => cross < -GEOMETRY_EPSILON)
  )
}

function segmentsProperlyIntersect(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): boolean {
  const firstA = cross2(firstStart, firstEnd, secondStart)
  const firstB = cross2(firstStart, firstEnd, secondEnd)
  const secondA = cross2(secondStart, secondEnd, firstStart)
  const secondB = cross2(secondStart, secondEnd, firstEnd)
  const opposite = (left: number, right: number) =>
    (left > GEOMETRY_EPSILON && right < -GEOMETRY_EPSILON) ||
    (left < -GEOMETRY_EPSILON && right > GEOMETRY_EPSILON)
  return opposite(firstA, firstB) && opposite(secondA, secondB)
}

function cross2(start: Point2, end: Point2, point: Point2): number {
  return (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
}

function pointInPolygon(boundary: readonly Point2[], x: number, z: number): boolean {
  let inside = false
  for (
    let currentIndex = 0, previousIndex = boundary.length - 1;
    currentIndex < boundary.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = boundary[currentIndex]!
    const previous = boundary[previousIndex]!
    const crosses =
      current[1] > z !== previous[1] > z &&
      x < ((previous[0] - current[0]) * (z - current[1])) / (previous[1] - current[1]) + current[0]
    if (crosses) inside = !inside
  }
  return inside
}

function smoothstep(start: number, end: number, value: number): number {
  const normalized = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return normalized * normalized * (3 - 2 * normalized)
}

export function polygonCentroid(boundary: readonly Point2[]): Point2 {
  let crossSum = 0
  let xSum = 0
  let zSum = 0
  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!
    const next = boundary[(index + 1) % boundary.length]!
    const cross = current[0] * next[1] - next[0] * current[1]
    crossSum += cross
    xSum += (current[0] + next[0]) * cross
    zSum += (current[1] + next[1]) * cross
  }
  const denominator = crossSum * 3
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    const bounds = boundaryBounds(boundary)
    return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2]
  }
  return [xSum / denominator, zSum / denominator]
}

function hasUsableBoundary(boundary: readonly Point2[]): boolean {
  return (
    boundary.length >= 3 &&
    boundary.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)) &&
    Math.abs(signedDoubleArea(boundary)) > GEOMETRY_EPSILON
  )
}

function signedDoubleArea(boundary: readonly Point2[]): number {
  let area = 0
  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!
    const next = boundary[(index + 1) % boundary.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area
}

function boundaryBounds(boundary: readonly Point2[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of boundary) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}
