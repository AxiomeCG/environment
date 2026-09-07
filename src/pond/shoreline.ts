import {
  normalAt,
  surfaceHeightAt,
  type TerrainField,
} from '@pascal-app/core'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { seededRange, seededUnit } from '../surroundings/seeded-random'
import type { PondSurface } from './basin'

export const POND_SHORE_ROCK_BUDGET = 256

export type PondShorelinePoint = readonly [x: number, z: number]
export type PondShorelineContour = ReadonlyArray<PondShorelinePoint>

type SurfaceVertex = {
  point: PondShorelinePoint
  depth: number
  key: string
}

type BoundaryEdge = {
  first: SurfaceVertex
  second: SurfaceVertex
  count: number
}

type ShoreSegment = {
  first: PondShorelinePoint
  second: PondShorelinePoint
}

type RockCandidate = {
  point: PondShorelinePoint
  score: number
}

type RockPlacement = {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
  color: Color
}

const SHORE_DEPTH_TOLERANCE = 1e-5
const ROCK_MATERIAL_COLOR = '#858278'
const UP = new Vector3(0, 1, 0)

/**
 * Extracts only zero-depth boundary edges from the clipped water triangles.
 * This includes concave banks and island contours, but excludes an underwater
 * site clip edge where there is no terrain waterline.
 */
export function extractPondShorelineContours(
  surface: PondSurface,
  depthTolerance = SHORE_DEPTH_TOLERANCE,
): PondShorelineContour[] {
  if (surface.level === null || surface.positions.length === 0) return []

  const edges = new Map<string, BoundaryEdge>()
  for (
    let positionOffset = 0, depthOffset = 0;
    positionOffset + 8 < surface.positions.length;
    positionOffset += 9, depthOffset += 3
  ) {
    const vertices = [0, 1, 2].map((index): SurfaceVertex => {
      const offset = positionOffset + index * 3
      const point = [surface.positions[offset]!, surface.positions[offset + 2]!] as const
      return {
        point,
        depth: surface.depths[depthOffset + index] ?? 0,
        key: pointKey(point),
      }
    })
    registerEdge(edges, vertices[0]!, vertices[1]!)
    registerEdge(edges, vertices[1]!, vertices[2]!)
    registerEdge(edges, vertices[2]!, vertices[0]!)
  }

  const boundary = [...edges.values()]
    .filter((edge) => (
      edge.count === 1
      && edge.first.depth <= depthTolerance
      && edge.second.depth <= depthTolerance
    ))
    .sort((left, right) => edgeKey(left.first, left.second).localeCompare(edgeKey(right.first, right.second)))
  if (boundary.length === 0) return []

  const adjacency = new Map<string, number[]>()
  const points = new Map<string, PondShorelinePoint>()
  for (let index = 0; index < boundary.length; index += 1) {
    const edge = boundary[index]!
    points.set(edge.first.key, edge.first.point)
    points.set(edge.second.key, edge.second.point)
    appendAdjacent(adjacency, edge.first.key, index)
    appendAdjacent(adjacency, edge.second.key, index)
  }

  const used = new Uint8Array(boundary.length)
  const contours: PondShorelinePoint[][] = []
  for (let edgeIndex = 0; edgeIndex < boundary.length; edgeIndex += 1) {
    if (used[edgeIndex] === 1) continue
    const edge = boundary[edgeIndex]!
    const firstDegree = adjacency.get(edge.first.key)?.length ?? 0
    const secondDegree = adjacency.get(edge.second.key)?.length ?? 0
    const start = firstDegree === 1
      ? edge.first.key
      : secondDegree === 1
        ? edge.second.key
        : edge.first.key < edge.second.key
          ? edge.first.key
          : edge.second.key
    const contour: PondShorelinePoint[] = []
    let current = start

    for (let guard = 0; guard <= boundary.length; guard += 1) {
      const point = points.get(current)
      if (!point) break
      contour.push(point)
      const nextEdgeIndex = (adjacency.get(current) ?? [])
        .filter((candidate) => used[candidate] === 0)
        .sort((left, right) => otherKey(boundary[left]!, current).localeCompare(otherKey(boundary[right]!, current)))[0]
      if (nextEdgeIndex === undefined) break
      used[nextEdgeIndex] = 1
      current = otherKey(boundary[nextEdgeIndex]!, current)
      if (current === start) {
        contour.push(points.get(start)!)
        break
      }
    }
    if (contour.length >= 2) contours.push(contour)
  }
  return contours
}

/** Horizontal distance to the terrain waterline, clamped to the requested fade width. */
export function createPondShoreDistances(
  surface: PondSurface,
  maximumDistance: number,
): Float32Array {
  const distances = new Float32Array(surface.depths.length)
  if (!(maximumDistance > 0) || !Number.isFinite(maximumDistance)) return distances
  distances.fill(maximumDistance)

  const segments = contourSegments(extractPondShorelineContours(surface))
  if (segments.length === 0) return distances

  const buckets = new Map<string, number[]>()
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const minX = Math.floor((Math.min(segment.first[0], segment.second[0]) - maximumDistance) / maximumDistance)
    const maxX = Math.floor((Math.max(segment.first[0], segment.second[0]) + maximumDistance) / maximumDistance)
    const minZ = Math.floor((Math.min(segment.first[1], segment.second[1]) - maximumDistance) / maximumDistance)
    const maxZ = Math.floor((Math.max(segment.first[1], segment.second[1]) + maximumDistance) / maximumDistance)
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) appendAdjacent(buckets, `${x}:${z}`, index)
    }
  }

  const maximumSquared = maximumDistance * maximumDistance
  for (let index = 0; index < distances.length; index += 1) {
    const x = surface.positions[index * 3]!
    const z = surface.positions[index * 3 + 2]!
    const key = `${Math.floor(x / maximumDistance)}:${Math.floor(z / maximumDistance)}`
    let nearestSquared = maximumSquared
    for (const segmentIndex of buckets.get(key) ?? []) {
      nearestSquared = Math.min(nearestSquared, pointSegmentDistanceSquared(x, z, segments[segmentIndex]!))
    }
    distances[index] = Math.sqrt(nearestSquared)
  }
  return distances
}

/** Builds one instanced rocky bank, or one expanded mesh for portable export. */
export function buildPondShoreGeometry(
  surface: PondSurface,
  terrain: TerrainField,
  seed: string,
  portable = false,
): Group {
  const group = new Group()
  group.name = 'environment-pond-shore'
  if (surface.level === null || surface.positions.length === 0) return group

  const contours = extractPondShorelineContours(surface)
  const placements = planRockPlacements(contours, terrain, seed)
  if (placements.length === 0) return group

  const source = createRockGeometry()
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    flatShading: true,
    metalness: 0,
    roughness: 0.94,
    vertexColors: portable,
  })
  material.name = 'Pond shoreline stone'
  const transform = new Matrix4()

  if (portable) {
    const transformed = placements.map((placement) => {
      const geometry = source.clone()
      const colors = new Float32Array(geometry.getAttribute('position').count * 3)
      for (let index = 0; index < colors.length; index += 3) {
        colors[index] = placement.color.r
        colors[index + 1] = placement.color.g
        colors[index + 2] = placement.color.b
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      geometry.applyMatrix4(transform.compose(
        placement.position,
        placement.rotation,
        placement.scale,
      ))
      return geometry
    })
    const merged = mergeGeometries(transformed, false)
    for (const geometry of transformed) geometry.dispose()
    source.dispose()
    if (!merged) {
      material.dispose()
      return group
    }
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    const rocks = new Mesh(merged, material)
    rocks.name = 'Pond shoreline rocks'
    rocks.castShadow = false
    rocks.receiveShadow = true
    group.add(rocks)
  } else {
    const rocks = new InstancedMesh(source, material, placements.length)
    rocks.name = 'environment-pond-shore-rocks'
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]!
      rocks.setMatrixAt(index, transform.compose(
        placement.position,
        placement.rotation,
        placement.scale,
      ))
      rocks.setColorAt(index, placement.color)
    }
    rocks.instanceMatrix.needsUpdate = true
    rocks.instanceColor!.needsUpdate = true
    rocks.computeBoundingBox()
    rocks.computeBoundingSphere()
    rocks.castShadow = false
    rocks.receiveShadow = true
    material.addEventListener('dispose', () => rocks.dispose())
    group.add(rocks)
  }

  group.userData.rockCount = placements.length
  group.userData.rockBudget = POND_SHORE_ROCK_BUDGET
  return group
}

function registerEdge(
  edges: Map<string, BoundaryEdge>,
  first: SurfaceVertex,
  second: SurfaceVertex,
): void {
  const key = edgeKey(first, second)
  const current = edges.get(key)
  if (current) current.count += 1
  else edges.set(key, { first, second, count: 1 })
}

function edgeKey(first: SurfaceVertex, second: SurfaceVertex): string {
  return first.key < second.key
    ? `${first.key}|${second.key}`
    : `${second.key}|${first.key}`
}

function pointKey(point: PondShorelinePoint): string {
  return `${Math.round(point[0] * 1e6)}:${Math.round(point[1] * 1e6)}`
}

function appendAdjacent(map: Map<string, number[]>, key: string, value: number): void {
  const values = map.get(key)
  if (values) values.push(value)
  else map.set(key, [value])
}

function otherKey(edge: BoundaryEdge, key: string): string {
  return edge.first.key === key ? edge.second.key : edge.first.key
}

function contourSegments(contours: readonly PondShorelineContour[]): ShoreSegment[] {
  const segments: ShoreSegment[] = []
  for (const contour of contours) {
    for (let index = 1; index < contour.length; index += 1) {
      const first = contour[index - 1]
      const second = contour[index]
      if (first && second && squaredDistance(first, second) > 1e-12) {
        segments.push({ first, second })
      }
    }
  }
  return segments
}

function pointSegmentDistanceSquared(x: number, z: number, segment: ShoreSegment): number {
  const dx = segment.second[0] - segment.first[0]
  const dz = segment.second[1] - segment.first[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-12) {
    const pointDx = x - segment.first[0]
    const pointDz = z - segment.first[1]
    return pointDx * pointDx + pointDz * pointDz
  }
  const amount = Math.max(0, Math.min(1, (
    (x - segment.first[0]) * dx + (z - segment.first[1]) * dz
  ) / lengthSquared))
  const nearestX = segment.first[0] + dx * amount
  const nearestZ = segment.first[1] + dz * amount
  const pointDx = x - nearestX
  const pointDz = z - nearestZ
  return pointDx * pointDx + pointDz * pointDz
}

function planRockPlacements(
  contours: readonly PondShorelineContour[],
  terrain: TerrainField,
  seed: string,
): RockPlacement[] {
  const spacing = Math.max(0.42, Math.min(0.9, terrain.spacing * 1.1))
  const candidates: RockCandidate[] = []
  for (let contourIndex = 0; contourIndex < contours.length; contourIndex += 1) {
    const contour = contours[contourIndex]!
    const segments = contourSegments([contour])
    const length = segments.reduce((sum, segment) => sum + Math.sqrt(squaredDistance(segment.first, segment.second)), 0)
    if (length <= 1e-6) continue
    let distance = length < spacing
      ? length * seededUnit(seed, `shore:${contourIndex}:short`)
      : spacing * seededUnit(seed, `shore:${contourIndex}:offset`)
    let candidateIndex = 0
    do {
      const point = pointAlongSegments(segments, Math.min(distance, length * 0.999_999))
      if (point) {
        const domain = `shore:${Math.round(point[0] * 1000)}:${Math.round(point[1] * 1000)}`
        candidates.push({ point, score: seededUnit(seed, `${domain}:priority`) })
      }
      distance += spacing * seededRange(seed, `shore:${contourIndex}:${candidateIndex}:gap`, 0.82, 1.18)
      candidateIndex += 1
    } while (distance < length && candidateIndex < POND_SHORE_ROCK_BUDGET * 8)
  }

  candidates.sort((left, right) => left.score - right.score || pointKey(left.point).localeCompare(pointKey(right.point)))
  const accepted: RockCandidate[] = []
  const minimumDistanceSquared = (spacing * 0.62) ** 2
  for (const candidate of candidates) {
    if (accepted.some((other) => squaredDistance(candidate.point, other.point) < minimumDistanceSquared)) continue
    accepted.push(candidate)
    if (accepted.length === POND_SHORE_ROCK_BUDGET) break
  }

  const normal = new Vector3()
  const terrainRotation = new Quaternion()
  const yawRotation = new Quaternion()
  return accepted.map(({ point }, index): RockPlacement => {
    const domain = `shore-rock:${Math.round(point[0] * 1000)}:${Math.round(point[1] * 1000)}:${index}`
    const width = spacing * seededRange(seed, `${domain}:width`, 0.68, 1.08)
    const height = width * seededRange(seed, `${domain}:height`, 0.36, 0.62)
    const depth = width * seededRange(seed, `${domain}:depth`, 0.68, 1.08)
    const sampledNormal = normalAt(terrain, point[0], point[1])
    normal.set(sampledNormal[0], Math.max(0.35, sampledNormal[1]), sampledNormal[2]).normalize()
    terrainRotation.setFromUnitVectors(UP, normal)
    yawRotation.setFromAxisAngle(UP, seededRange(seed, `${domain}:yaw`, -Math.PI, Math.PI))
    const rotation = terrainRotation.clone().multiply(yawRotation)
    const embedDepth = Math.min(0.12, height * seededRange(seed, `${domain}:embed`, 0.2, 0.34))
    const ground = surfaceHeightAt(terrain, point[0], point[1])
    return {
      position: new Vector3(point[0], ground + height * 0.5 - embedDepth, point[1]),
      rotation,
      scale: new Vector3(width, height, depth),
      color: new Color(ROCK_MATERIAL_COLOR).multiplyScalar(
        seededRange(seed, `${domain}:tone`, 0.82, 1.08),
      ),
    }
  })
}

function pointAlongSegments(
  segments: readonly ShoreSegment[],
  targetDistance: number,
): PondShorelinePoint | null {
  let remaining = targetDistance
  for (const segment of segments) {
    const length = Math.sqrt(squaredDistance(segment.first, segment.second))
    if (remaining <= length) {
      const amount = length > 0 ? remaining / length : 0
      return [
        segment.first[0] + (segment.second[0] - segment.first[0]) * amount,
        segment.first[1] + (segment.second[1] - segment.first[1]) * amount,
      ]
    }
    remaining -= length
  }
  return segments.at(-1)?.second ?? null
}

function createRockGeometry(): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(0.5, 0)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const bulge = 1 + Math.sin(x * 9 + z * 6) * 0.12 + Math.cos(y * 11 - x * 5) * 0.08
    positions.setXYZ(index, x * bulge + y * 0.08, y * bulge, z * bulge)
  }
  geometry.computeBoundingBox()
  const size = geometry.boundingBox!.getSize(new Vector3())
  geometry.center()
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function squaredDistance(first: PondShorelinePoint, second: PondShorelinePoint): number {
  const dx = second[0] - first[0]
  const dz = second[1] - first[1]
  return dx * dx + dz * dz
}
