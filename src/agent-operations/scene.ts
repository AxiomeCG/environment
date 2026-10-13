import type { AnyNode, SiteNode } from '@pascal-app/core'
import { refuse } from './refuse'
import type { PlanPoint, SceneNodes } from './types'

/** A contract point (`[x, z]` as a plain array) as a tuple, or null when malformed. */
export function asPoint(value: readonly number[] | undefined): PlanPoint | null {
  if (!value || value.length !== 2) return null
  const [x, z] = value
  if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return null
  return [x, z]
}

export function asPolygon(
  values: ReadonlyArray<readonly number[]> | undefined,
): PlanPoint[] | null {
  if (!values) return null
  const points: PlanPoint[] = []
  for (const value of values) {
    const point = asPoint(value)
    if (!point) return null
    points.push(point)
  }
  return points
}

/** The scene's one site; every Environment tool works on it and refuses ambiguity. */
export function requireSite(nodes: SceneNodes): SiteNode {
  const sites = Object.values(nodes).filter((node) => node.type === 'site')
  if (sites.length > 1) {
    refuse('ambiguous_site', `This scene has ${sites.length} sites; Environment tools need one.`, {
      siteIds: sites.map((site) => String(site.id)),
    })
  }
  const site = sites[0]
  if (!site) refuse('no_site', 'This scene has no site.')
  return site as SiteNode
}

export function requireSitePolygon(site: SiteNode): PlanPoint[] {
  const points = site.polygon?.points
  if (!points || points.length < 3 || Math.abs(polygonArea(points)) <= 1e-9) {
    refuse('invalid_polygon', 'The site has no usable boundary polygon.')
  }
  return points.map((point) => [point[0], point[1]] as const)
}

/**
 * The site's own child of a kind (never "the first of that kind anywhere"), first by id.
 * Plugin node kinds are not members of core's `AnyNode` union, hence the cast through unknown.
 */
export function siteChildOfKind<T>(nodes: SceneNodes, siteId: string, kind: string): T | null {
  return siteChildrenOfKind<T>(nodes, siteId, kind)[0] ?? null
}

export function siteChildrenOfKind<T>(nodes: SceneNodes, siteId: string, kind: string): T[] {
  const found = Object.values(nodes)
    .filter((node) => node.type === kind && String(node.parentId) === siteId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return found as unknown as T[]
}

export function polygonArea(points: ReadonlyArray<PlanPoint>): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index]
    const second = points[(index + 1) % points.length]
    if (!first || !second) continue
    sum += first[0] * second[1] - second[0] * first[1]
  }
  return sum / 2
}

export function isValidPolygon(points: ReadonlyArray<PlanPoint>): boolean {
  return points.length >= 3 && Math.abs(polygonArea(points)) > 1e-9
}

export function distanceToSegment(x: number, z: number, first: PlanPoint, second: PlanPoint): number {
  const dx = second[0] - first[0]
  const dz = second[1] - first[1]
  const lengthSquared = dx * dx + dz * dz
  const t =
    lengthSquared <= 0
      ? 0
      : Math.min(1, Math.max(0, ((x - first[0]) * dx + (z - first[1]) * dz) / lengthSquared))
  return Math.hypot(x - (first[0] + t * dx), z - (first[1] + t * dz))
}

export function pointInPolygon(x: number, z: number, polygon: ReadonlyArray<PlanPoint>): boolean {
  let inside = false
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const first = polygon[index]
    const second = polygon[previous]
    if (!first || !second) continue
    if (distanceToSegment(x, z, first, second) <= 1e-9) return true
    if (
      (first[1] > z) !== (second[1] > z) &&
      x < ((second[0] - first[0]) * (z - first[1])) / (second[1] - first[1]) + first[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

/** Signed distance to a polygon: positive inside, negative outside, zero on the edge. */
export function signedDistanceToPolygon(x: number, z: number, polygon: ReadonlyArray<PlanPoint>): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index]
    const second = polygon[(index + 1) % polygon.length]
    if (!first || !second) continue
    distance = Math.min(distance, distanceToSegment(x, z, first, second))
  }
  return pointInPolygon(x, z, polygon) ? distance : -distance
}

export function distanceToPolyline(x: number, z: number, points: ReadonlyArray<PlanPoint>): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index + 1 < points.length; index += 1) {
    const first = points[index]
    const second = points[index + 1]
    if (!first || !second) continue
    distance = Math.min(distance, distanceToSegment(x, z, first, second))
  }
  return distance
}

export function polylineLength(points: ReadonlyArray<PlanPoint>): number {
  let length = 0
  for (let index = 0; index + 1 < points.length; index += 1) {
    const first = points[index]
    const second = points[index + 1]
    if (!first || !second) continue
    length += Math.hypot(second[0] - first[0], second[1] - first[1])
  }
  return length
}

export function roundFact(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Deterministic 0..1 hash of a position, for seeded prop placement and yaw. */
export function hash01(seed: number, x: number, z: number): number {
  const phase = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453
  return phase - Math.floor(phase)
}
