import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import type { Point2 } from './frontages'

const BOUNDARY_EPSILON = 1e-9

export type LotBoundary = Readonly<{
  heightAt: (x: number, z: number) => number | null
  subdivideEdge: (start: Point2, end: Point2) => readonly Point2[]
}>

/** Keep the join on the host's triangle planes without refining the exterior grid. */
export function createLotBoundary(
  boundary: readonly Point2[],
  terrain: TerrainField | null,
): LotBoundary | undefined {
  if (!terrain || boundary.length < 3 || !(terrain.spacing > 0)) return undefined
  const edges = boundary.flatMap((start, index) => {
    const end = boundary[(index + 1) % boundary.length]
    if (!end || Math.hypot(end[0] - start[0], end[1] - start[1]) <= BOUNDARY_EPSILON)
      return []
    const points = hostTriangleCrossings(start, end, terrain)
    const height = surfaceHeightAt(terrain, ...start)
    const refine = points.some(
      (point) => Math.abs(surfaceHeightAt(terrain, ...point) - height) > BOUNDARY_EPSILON,
    )
    return [{ start, end, refine }]
  })
  return {
    heightAt: (x, z) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null
      return edges.some((edge) => onSegment(edge.start, edge.end, [x, z]))
        ? surfaceHeightAt(terrain, x, z)
        : null
    },
    subdivideEdge: (start, end) => {
      const points: Point2[] = [start, end]
      for (const edge of edges) {
        if (!edge.refine) continue
        const overlap = overlappingEdge(start, end, edge.start, edge.end)
        if (overlap) points.push(...hostTriangleCrossings(overlap[0], overlap[1], terrain))
      }
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      points.sort((a, b) => (a[0] - b[0]) * dx + (a[1] - b[1]) * dz)
      return points.filter((point, index) => {
        const previous = points[index - 1]
        return (
          !previous ||
          Math.hypot(point[0] - previous[0], point[1] - previous[1]) > BOUNDARY_EPSILON
        )
      })
    },
  }
}

function overlappingEdge(
  start: Point2,
  end: Point2,
  edgeStart: Point2,
  edgeEnd: Point2,
): readonly [Point2, Point2] | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= BOUNDARY_EPSILON) return null
  for (const point of [edgeStart, edgeEnd]) {
    const cross = dx * (point[1] - start[1]) - dz * (point[0] - start[0])
    if (Math.abs(cross) > BOUNDARY_EPSILON * length) return null
  }
  const project = (point: Point2) =>
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (length * length)
  const first = project(edgeStart)
  const last = project(edgeEnd)
  const lower = Math.max(0, Math.min(first, last))
  const upper = Math.min(1, Math.max(first, last))
  if ((upper - lower) * length <= BOUNDARY_EPSILON) return null
  return [
    [start[0] + lower * dx, start[1] + lower * dz],
    [start[0] + upper * dx, start[1] + upper * dz],
  ]
}

function onSegment(start: Point2, end: Point2, point: Point2): boolean {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const squaredLength = dx * dx + dz * dz
  if (squaredLength === 0) return false
  const amount = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / squaredLength),
  )
  return (
    Math.hypot(point[0] - start[0] - amount * dx, point[1] - start[1] - amount * dz) <=
    BOUNDARY_EPSILON
  )
}

function hostTriangleCrossings(
  start: Point2,
  end: Point2,
  terrain: TerrainField,
): Point2[] {
  const u0 = (start[0] - terrain.origin[0]) / terrain.spacing
  const v0 = (start[1] - terrain.origin[1]) / terrain.spacing
  const u1 = (end[0] - terrain.origin[0]) / terrain.spacing
  const v1 = (end[1] - terrain.origin[1]) / terrain.spacing
  const amounts = [0, 1]
  const addPlanes = (from: number, to: number, first: number, last: number, diagonal = false) => {
    if (Math.abs(to - from) <= BOUNDARY_EPSILON) return
    const lower = Math.max(first, Math.ceil(Math.min(from, to)))
    const upper = Math.min(last, Math.floor(Math.max(from, to)))
    for (let plane = lower; plane <= upper; plane += 1) {
      const amount = (plane - from) / (to - from)
      if (amount <= BOUNDARY_EPSILON || amount >= 1 - BOUNDARY_EPSILON) continue
      if (diagonal) {
        const u = u0 + (u1 - u0) * amount
        const v = v0 + (v1 - v0) * amount
        // Outside the host footprint the public surface clamps an axis; only
        // grid planes, not the continued diagonal, can change its slope there.
        if (u < 0 || u > terrain.cols - 1 || v < 0 || v > terrain.rows - 1) continue
      }
      amounts.push(amount)
    }
  }
  addPlanes(u0, u1, 0, terrain.cols - 1)
  addPlanes(v0, v1, 0, terrain.rows - 1)
  addPlanes(u0 + v0, u1 + v1, 1, terrain.cols + terrain.rows - 3, true)
  amounts.sort((left, right) => left - right)
  return amounts
    .filter((amount, index) => index === 0 || amount - (amounts[index - 1] ?? 0) > BOUNDARY_EPSILON)
    .map((amount): Point2 => {
      if (amount === 0) return start
      if (amount === 1) return end
      return [
        start[0] + (end[0] - start[0]) * amount,
        start[1] + (end[1] - start[1]) * amount,
      ]
    })
}
