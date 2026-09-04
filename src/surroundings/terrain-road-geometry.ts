import { EXTERIOR_TERRAIN_SECTION_SEGMENTS, EXTERIOR_TERRAIN_SECTION_SIZE } from './exterior-terrain'
import { buildMeshGeometryBuffers } from './mesh-geometry'
import type { MeshGeometryBuffers } from './mesh-geometry'

type Point3 = readonly [number, number, number]
const EMPTY: readonly Point3[] = []
const EPSILON = 1e-9

/** Clip a convex polygon in XZ, retaining the original road profile's Y. */
function clip(polygon: readonly Point3[], nx: number, nz: number, limit: number): readonly Point3[] {
  let insideCount = 0
  for (const point of polygon) if (point[0] * nx + point[2] * nz <= limit + EPSILON) insideCount += 1
  if (insideCount === polygon.length) return polygon
  if (insideCount === 0) return EMPTY
  const result: Point3[] = []
  let previous = polygon[polygon.length - 1]!
  let previousDistance = previous[0] * nx + previous[2] * nz - limit
  for (const point of polygon) {
    const distance = point[0] * nx + point[2] * nz - limit
    if ((distance <= EPSILON) !== (previousDistance <= EPSILON)
      && Math.abs(distance) > EPSILON && Math.abs(previousDistance) > EPSILON) {
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

/** Roads share the rendered ground's grid AND triangle diagonals. Sampling the
 * analytic height field alone lets the two triangulations intersect on hills. */
export function buildTerrainRoadGeometry(
  positions: readonly number[],
  indices: readonly number[],
  heightAt: (x: number, z: number) => number,
  triangleColors?: readonly number[],
): MeshGeometryBuffers {
  const spacing = EXTERIOR_TERRAIN_SECTION_SIZE / EXTERIOR_TERRAIN_SECTION_SEGMENTS
  const vertices: number[] = [], triangles: number[] = []
  const colors = triangleColors ? [] as number[] : undefined
  const heights = new Map<number, Map<number, number>>()
  const gridHeight = (x: number, z: number): number => {
    let column = heights.get(x)
    if (!column) { column = new Map(); heights.set(x, column) }
    let height = column.get(z)
    if (height === undefined) {
      // Match the terrain's uploaded Float32 heights, not an unrendered surface.
      height = Math.fround(heightAt(x * spacing, z * spacing))
      column.set(z, height)
    }
    return height
  }
  for (let index = 0; index < indices.length; index += 3) {
    const source: Point3[] = []
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = indices[index + corner]! * 3
      source.push([positions[offset]!, positions[offset + 1]!, positions[offset + 2]!])
    }
    const firstRow = Math.floor(Math.min(source[0]![2], source[1]![2], source[2]![2]) / spacing)
    const lastRow = Math.max(firstRow, Math.floor((Math.max(source[0]![2], source[1]![2], source[2]![2]) - EPSILON) / spacing))
    for (let row = firstRow; row <= lastRow; row += 1) {
      const z = row * spacing
      const strip = clip(clip(source, 0, -1, -z), 0, 1, z + spacing)
      if (strip.length < 3) continue
      let minX = Infinity, maxX = -Infinity
      for (const point of strip) { minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]) }
      const firstColumn = Math.floor(minX / spacing)
      const lastColumn = Math.max(firstColumn, Math.floor((maxX - EPSILON) / spacing))
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = column * spacing
        const cell = clip(clip(strip, -1, 0, -x), 1, 0, x + spacing)
        if (cell.length < 3) continue
        const a = gridHeight(column, row), b = gridHeight(column + 1, row)
        const c = gridHeight(column, row + 1), d = gridHeight(column + 1, row + 1)
        for (let half = 0; half < 2; half += 1) {
          const sign = half === 0 ? 1 : -1
          const polygon = clip(cell, sign, sign, sign * (x + z + spacing))
          if (polygon.length < 3) continue
          const first = vertices.length / 3
          for (const point of polygon) {
            const u = (point[0] - x) / spacing, v = (point[2] - z) / spacing
            const height = half === 0
              ? a * (1 - u - v) + b * u + c * v
              : d * (u + v - 1) + c * (1 - u) + b * (1 - v)
            vertices.push(point[0], point[1] + height + 0.04, point[2])
            if (colors && triangleColors) colors.push(triangleColors[index]!, triangleColors[index + 1]!, triangleColors[index + 2]!)
          }
          for (let corner = 1; corner < polygon.length - 1; corner += 1) {
            triangles.push(first, first + corner, first + corner + 1)
          }
        }
      }
    }
  }
  return buildMeshGeometryBuffers(vertices, triangles, colors)
}
