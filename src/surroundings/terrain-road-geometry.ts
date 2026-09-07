import {
  EXTERIOR_TERRAIN_SECTION_SEGMENTS,
  EXTERIOR_TERRAIN_SECTION_SIZE,
  exteriorTerrainSectionKey,
  terrainSectionSegments,
  type ExteriorTerrainSampler,
} from './exterior-terrain'
import { buildMeshGeometryBuffers } from './mesh-geometry'
import type { MeshGeometryBuffers } from './mesh-geometry'

type Point3 = readonly [number, number, number]
const EMPTY: readonly Point3[] = []
const EPSILON = 1e-9

/** Clip a convex polygon in XZ, retaining the original road profile's Y. */
function clip(
  polygon: readonly Point3[],
  nx: number,
  nz: number,
  limit: number,
): readonly Point3[] {
  let insideCount = 0
  for (const point of polygon)
    if (point[0] * nx + point[2] * nz <= limit + EPSILON) insideCount += 1
  if (insideCount === polygon.length) return polygon
  if (insideCount === 0) return EMPTY
  const result: Point3[] = []
  let previous = polygon[polygon.length - 1]!
  let previousDistance = previous[0] * nx + previous[2] * nz - limit
  for (const point of polygon) {
    const distance = point[0] * nx + point[2] * nz - limit
    if (
      distance <= EPSILON !== previousDistance <= EPSILON &&
      Math.abs(distance) > EPSILON &&
      Math.abs(previousDistance) > EPSILON
    ) {
      const t = previousDistance / (previousDistance - distance)
      result.push([
        previous[0] + (point[0] - previous[0]) * t,
        previous[1] + (point[1] - previous[1]) * t,
        previous[2] + (point[2] - previous[2]) * t,
      ])
    }
    if (distance <= EPSILON) result.push(point)
    previous = point
    previousDistance = distance
  }
  return result
}

/** Match the ground's section grids and diagonals; bridge decks use their own
 * continuous elevation rather than being flattened onto the terrain grid. */
export function buildTerrainRoadGeometry(
  positions: readonly number[],
  indices: readonly number[],
  heightAt: (x: number, z: number) => number,
  triangleColors?: readonly number[],
  options?: {
    terrain: ExteriorTerrainSampler
    bridgeHeightAt?: (x: number, z: number) => number
  },
): MeshGeometryBuffers {
  const vertices: number[] = [],
    triangles: number[] = []
  const colors = triangleColors ? ([] as number[]) : undefined
  const heights = new Map<number, Map<number, number>>()
  const gridHeight = (x: number, z: number): number => {
    let column = heights.get(x)
    if (!column) {
      column = new Map()
      heights.set(x, column)
    }
    let height = column.get(z)
    if (height === undefined) {
      height = Math.fround(heightAt(x, z))
      column.set(z, height)
    }
    return height
  }
  const size = EXTERIOR_TERRAIN_SECTION_SIZE
  const appendSection = (
    source: readonly Point3[],
    sectionX: number,
    sectionZ: number,
    colorIndex: number,
  ) => {
    const originX = sectionX * size,
      originZ = sectionZ * size
    const polygon = clip(
      clip(clip(clip(source, -1, 0, -originX), 1, 0, originX + size), 0, -1, -originZ),
      0,
      1,
      originZ + size,
    )
    if (polygon.length < 3) return
    const segments = options
      ? terrainSectionSegments(options.terrain, {
          x: sectionX,
          z: sectionZ,
          key: exteriorTerrainSectionKey(sectionX, sectionZ),
        })
      : EXTERIOR_TERRAIN_SECTION_SEGMENTS
    const spacing = size / segments
    let minZ = Infinity,
      maxZ = -Infinity
    for (const point of polygon) {
      minZ = Math.min(minZ, point[2])
      maxZ = Math.max(maxZ, point[2])
    }
    const firstRow = Math.max(0, Math.floor((minZ - originZ) / spacing))
    const lastRow = Math.min(
      segments - 1,
      Math.max(firstRow, Math.floor((maxZ - originZ - EPSILON) / spacing)),
    )
    for (let row = firstRow; row <= lastRow; row += 1) {
      const z = originZ + row * spacing
      const strip = clip(clip(polygon, 0, -1, -z), 0, 1, z + spacing)
      if (strip.length < 3) continue
      let minX = Infinity,
        maxX = -Infinity
      for (const point of strip) {
        minX = Math.min(minX, point[0])
        maxX = Math.max(maxX, point[0])
      }
      const firstColumn = Math.max(0, Math.floor((minX - originX) / spacing))
      const lastColumn = Math.min(
        segments - 1,
        Math.max(firstColumn, Math.floor((maxX - originX - EPSILON) / spacing)),
      )
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = originX + column * spacing
        const cell = clip(clip(strip, -1, 0, -x), 1, 0, x + spacing)
        if (cell.length < 3) continue
        const a = gridHeight(x, z),
          b = gridHeight(x + spacing, z)
        const c = gridHeight(x, z + spacing),
          d = gridHeight(x + spacing, z + spacing)
        for (let half = 0; half < 2; half += 1) {
          const sign = half === 0 ? 1 : -1
          const part = clip(cell, sign, sign, sign * (x + z + spacing))
          if (part.length < 3) continue
          const first = vertices.length / 3
          for (const point of part) {
            const u = (point[0] - x) / spacing,
              v = (point[2] - z) / spacing
            const groundHeight =
              half === 0
                ? a * (1 - u - v) + b * u + c * v
                : d * (u + v - 1) + c * (1 - u) + b * (1 - v)
            const height = options?.bridgeHeightAt?.(point[0], point[2]) ?? groundHeight
            vertices.push(point[0], point[1] + height + 0.04, point[2])
            if (colors && triangleColors)
              colors.push(
                triangleColors[colorIndex]!,
                triangleColors[colorIndex + 1]!,
                triangleColors[colorIndex + 2]!,
              )
          }
          for (let corner = 1; corner < part.length - 1; corner += 1) {
            triangles.push(first, first + corner, first + corner + 1)
          }
        }
      }
    }
  }
  for (let index = 0; index < indices.length; index += 3) {
    const source: Point3[] = []
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = indices[index + corner]! * 3
      source.push([positions[offset]!, positions[offset + 1]!, positions[offset + 2]!])
    }
    const minX = Math.min(source[0]![0], source[1]![0], source[2]![0])
    const maxX = Math.max(source[0]![0], source[1]![0], source[2]![0])
    const minZ = Math.min(source[0]![2], source[1]![2], source[2]![2])
    const maxZ = Math.max(source[0]![2], source[1]![2], source[2]![2])
    const firstX = Math.floor(minX / size),
      firstZ = Math.floor(minZ / size)
    const lastX = Math.max(firstX, Math.floor((maxX - EPSILON) / size))
    const lastZ = Math.max(firstZ, Math.floor((maxZ - EPSILON) / size))
    for (let z = firstZ; z <= lastZ; z += 1) {
      for (let x = firstX; x <= lastX; x += 1) appendSection(source, x, z, index)
    }
  }
  return buildMeshGeometryBuffers(vertices, triangles, colors)
}
