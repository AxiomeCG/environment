import {
  surfaceHeightAt,
  terrainFieldOf,
  type GeometryContext,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  ShapeUtils,
  Vector2,
} from 'three'
import { POND_WATER_APPEARANCE } from '../pond/appearance'
import type { PondSurface } from '../pond/basin'
import type { WaterQuality } from '../pond/schema'
import { buildPondShoreGeometry, createPondShoreDistances } from '../pond/shoreline'
import { createWaterMaterial } from '../surroundings/water-material'
import type { RiverNode } from './schema'
import {
  riverPathWidthScale,
  riverSurfaceInset,
  riverTerrainBaseline,
  sampleRiverPath,
  type SampledRiverPath,
} from './terrain'

export { RIVER_MAX_CENTERLINE_SEGMENTS } from './terrain'
export const RIVER_LATERAL_SEGMENTS = 8
export const RIVER_MAX_WATER_TRIANGLES = 32_000

const WATER_CLEARANCE = 0.012
const BANK_INSET = 0.018
const WET_EPSILON = 0.006
const CLIP_EPSILON = 1e-8
const LATERAL_FRACTIONS = [-1, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1] as const

type SurfaceVertex = {
  x: number
  y: number
  z: number
  depth: number
  course: number
  lateral: number
  flowX: number
  flowZ: number
}

type SiteTriangle = readonly [Vector2, Vector2, Vector2]

export type RiverSurface = PondSurface &
  Readonly<{
    waterFlow: Float32Array
    waterCourse: Float32Array
    sampledPath: SampledRiverPath
    triangleBudget: number
  }>

export type ResolvedRiver = Readonly<{
  site: SiteNode
  terrain: TerrainField
  baseline: TerrainField
  surface: RiverSurface
}>

export function resolveRiver(node: RiverNode, context: GeometryContext): ResolvedRiver | null {
  const parent = context.parent
  if (!parent || parent.type !== 'site') return null
  const terrain = terrainFieldOf(parent)
  if (!terrain) return null
  const baseline = riverTerrainBaseline(parent) ?? terrain
  const surface = buildRiverSurface(node, parent, terrain, baseline)
  return surface ? { site: parent, terrain, baseline, surface } : null
}

/**
 * Build the clipped water ribbon from the same sampled centerline used by the
 * terrain carver. Passing `baselineTerrain` is useful for first-draft live
 * previews, before the Site has river metadata; native persisted geometry can
 * recover it from the Site automatically.
 */
export function buildRiverSurface(
  node: RiverNode,
  site: SiteNode,
  carvedTerrain?: TerrainField | null,
  baselineTerrain?: TerrainField | null,
): RiverSurface | null {
  const terrain = carvedTerrain ?? terrainFieldOf(site)
  if (!terrain) return null
  const baseline = baselineTerrain ?? riverTerrainBaseline(site) ?? terrain
  const sampledPath = sampleRiverPath(baseline, node, site.polygon.points)
  if (!sampledPath) return null
  const boundaryTriangles = triangulateSiteBoundary(site.polygon.points)
  if (boundaryTriangles.length === 0) return null

  const rows = buildRibbonRows(node, sampledPath, baseline, terrain)
  if (rows.length < 2) return null
  const positions: number[] = []
  const depths: number[] = []
  const flows: number[] = []
  const courses: number[] = []
  let area = 0
  let triangleCount = 0

  const emitSiteClipped = (wet: readonly SurfaceVertex[]) => {
    if (triangleCount >= RIVER_MAX_WATER_TRIANGLES || wet.length < 3) return
    const bounds = polygonBounds(wet)
    for (const boundaryTriangle of boundaryTriangles) {
      if (triangleCount >= RIVER_MAX_WATER_TRIANGLES) break
      if (!boundsOverlap(bounds, triangleBounds(boundaryTriangle))) continue
      const clipped = clipToTriangle(wet, boundaryTriangle)
      if (clipped.length < 3) continue
      for (let index = 1; index + 1 < clipped.length; index += 1) {
        const first = clipped[0]!
        const second = clipped[index]!
        const third = clipped[index + 1]!
        const winding = cross2(first, second, third)
        const triangleArea = Math.abs(winding) * 0.5
        if (triangleArea <= CLIP_EPSILON) continue
        appendVertex(first, positions, depths, flows, courses)
        appendVertex(winding < 0 ? second : third, positions, depths, flows, courses)
        appendVertex(winding < 0 ? third : second, positions, depths, flows, courses)
        area += triangleArea
        triangleCount += 1
        if (triangleCount >= RIVER_MAX_WATER_TRIANGLES) break
      }
    }
  }

  // Intersect the ribbon with the native terrain triangles before clipping its
  // wet contour. Interpolating depth across a coarse ribbon skips raised banks.
  const corners = [new Vector2(), new Vector2(), new Vector2(), new Vector2()] as const
  const terrainTriangles: readonly SiteTriangle[] = [
    [corners[0], corners[2], corners[1]],
    [corners[1], corners[2], corners[3]],
  ]
  const emitClipped = (triangle: readonly [SurfaceVertex, SurfaceVertex, SurfaceVertex]) => {
    const bounds = polygonBounds(triangle)
    const col0 = Math.max(0, Math.floor((bounds.minX - terrain.origin[0]) / terrain.spacing))
    const row0 = Math.max(0, Math.floor((bounds.minZ - terrain.origin[1]) / terrain.spacing))
    const col1 = Math.min(
      terrain.cols - 2,
      Math.floor((bounds.maxX - terrain.origin[0]) / terrain.spacing),
    )
    const row1 = Math.min(
      terrain.rows - 2,
      Math.floor((bounds.maxZ - terrain.origin[1]) / terrain.spacing),
    )
    for (let row = row0; row <= row1 && triangleCount < RIVER_MAX_WATER_TRIANGLES; row += 1) {
      const z = terrain.origin[1] + row * terrain.spacing
      for (let col = col0; col <= col1 && triangleCount < RIVER_MAX_WATER_TRIANGLES; col += 1) {
        const x = terrain.origin[0] + col * terrain.spacing
        corners[0].set(x, z)
        corners[1].set(x + terrain.spacing, z)
        corners[2].set(x, z + terrain.spacing)
        corners[3].set(x + terrain.spacing, z + terrain.spacing)
        for (const terrainTriangle of terrainTriangles) {
          const polygon = clipToTriangle(triangle, terrainTriangle)
          if (polygon.length < 3) continue
          for (const vertex of polygon) {
            vertex.depth = vertex.y - WATER_CLEARANCE - surfaceHeightAt(terrain, vertex.x, vertex.z)
          }
          emitSiteClipped(clipWetPolygon(polygon))
        }
      }
    }
  }

  for (let row = 1; row < rows.length; row += 1) {
    const previous = rows[row - 1]!
    const current = rows[row]!
    for (let column = 1; column < current.length; column += 1) {
      const a = previous[column - 1]!
      const b = current[column - 1]!
      const c = current[column]!
      const d = previous[column]!
      emitClipped([a, b, d])
      emitClipped([b, c, d])
    }
  }
  if (positions.length === 0) return null

  return {
    level: averageWaterHeight(positions),
    positions: new Float32Array(positions),
    depths: new Float32Array(depths),
    waterFlow: new Float32Array(flows),
    waterCourse: new Float32Array(courses),
    area,
    sampledPath,
    triangleBudget: RIVER_MAX_WATER_TRIANGLES,
  }
}

export function buildRiverGeometry(node: RiverNode, context: GeometryContext): Group {
  return buildResolvedRiverGeometry(node, resolveRiver(node, context))
}

/**
 * Build a full-fidelity authoring preview without mistaking the live carved
 * override for the river-free source terrain.
 */
export function buildRiverPreviewGeometry(
  node: RiverNode,
  site: SiteNode,
  carvedTerrain: TerrainField,
  baselineTerrain: TerrainField,
): Group {
  const surface = buildRiverSurface(node, site, carvedTerrain, baselineTerrain)
  const resolved = surface
    ? { site, terrain: carvedTerrain, baseline: baselineTerrain, surface }
    : null
  return buildResolvedRiverGeometry(node, resolved)
}

function buildResolvedRiverGeometry(node: RiverNode, resolved: ResolvedRiver | null): Group {
  const group = new Group()
  group.name = 'environment-river'
  if (!resolved) return group
  const appearance = POND_WATER_APPEARANCE[waterQuality(node.quality)]
  const shoreFadeDistance = Math.max(0.18, Math.min(0.9, resolved.terrain.spacing * 1.3))
  const geometry = createRiverSurfaceGeometry(resolved.surface, shoreFadeDistance)
  const material = createWaterMaterial({
    name: `environment-river-water-${node.quality}`,
    color: appearance.shallowColor,
    deepColor: appearance.deepColor,
    foamColor: appearance.foamColor,
    foamStrength: appearance.foamStrength,
    flow: {
      speed: node.flowSpeed,
      direction: node.flowDirection === 'reverse' ? -1 : 1,
    },
    depthRange: appearance.depthRange,
    roughness: appearance.roughness,
    shoreRoughness: appearance.shoreRoughness,
    rippleStrength: appearance.rippleStrength,
    waveScale: appearance.waveScale,
    speedScale: appearance.speedScale,
    shoreFade: [shoreFadeDistance, appearance.shoreAbsorptionDepth],
    opacity: appearance.opacity,
  })
  const water = new Mesh(geometry, material)
  water.name = 'environment-river-water'
  water.castShadow = false
  water.receiveShadow = false
  water.renderOrder = 2
  group.add(water)
  if (node.shoreline === 'rocky') {
    group.add(buildPondShoreGeometry(resolved.surface, resolved.terrain, String(node.id)))
  }
  group.userData.waterArea = resolved.surface.area
  group.userData.waterTriangles = resolved.surface.positions.length / 9
  group.userData.waterTriangleBudget = resolved.surface.triangleBudget
  group.userData.centerlineSegments = resolved.surface.sampledPath.points.length - 1
  return group
}

/** Portable ordinary meshes/materials for generic GLB export. */
export function buildRiverBakeGeometry(node: RiverNode, context: GeometryContext): Group {
  const group = new Group()
  group.name = node.name || 'River'
  const resolved = resolveRiver(node, context)
  if (!resolved) return group
  const appearance = POND_WATER_APPEARANCE[waterQuality(node.quality)]
  const shoreFadeDistance = Math.max(0.18, Math.min(0.9, resolved.terrain.spacing * 1.3))
  const geometry = createRiverSurfaceGeometry(resolved.surface, shoreFadeDistance)
  const shallow = new Color(appearance.shallowColor)
  const deep = new Color(appearance.deepColor)
  const color = new Color()
  const colors = new Float32Array(resolved.surface.depths.length * 4)
  const shoreDistances = geometry.getAttribute('shoreDistance')
  for (let index = 0; index < resolved.surface.depths.length; index += 1) {
    const depth = resolved.surface.depths[index]!
    const depthMix = smoothstep(appearance.depthRange[0], appearance.depthRange[1], depth)
    color.lerpColors(shallow, deep, depthMix)
    const baseOpacity =
      appearance.opacity[0] + (appearance.opacity[1] - appearance.opacity[0]) * depthMix
    const opticalCoverage = 1 - Math.exp(-depth / appearance.shoreAbsorptionDepth)
    const edgeCoverage = smoothstep(
      0,
      shoreFadeDistance,
      shoreDistances?.getX(index) ?? shoreFadeDistance,
    )
    colors[index * 4] = color.r
    colors[index * 4 + 1] = color.g
    colors[index * 4 + 2] = color.b
    colors[index * 4 + 3] = baseOpacity * opticalCoverage * edgeCoverage
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    depthWrite: false,
    ior: 1.333,
    metalness: 0,
    opacity: 1,
    roughness: appearance.roughness,
    transparent: true,
    vertexColors: true,
  })
  material.name = `River water ${node.quality}`
  const water = new Mesh(geometry, material)
  water.name = 'River water'
  water.castShadow = false
  water.receiveShadow = false
  group.add(water)
  if (node.shoreline === 'rocky') {
    group.add(buildPondShoreGeometry(resolved.surface, resolved.terrain, String(node.id), true))
  }
  return group
}

export function createRiverSurfaceGeometry(
  surface: RiverSurface,
  shoreFadeDistance = 0,
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(surface.positions, 3))
  geometry.setAttribute('waterDepth', new Float32BufferAttribute(surface.depths, 1))
  geometry.setAttribute('waterFlow', new Float32BufferAttribute(surface.waterFlow, 2))
  geometry.setAttribute('waterCourse', new Float32BufferAttribute(surface.waterCourse, 2))
  if (shoreFadeDistance > 0) {
    geometry.setAttribute(
      'shoreDistance',
      new Float32BufferAttribute(createPondShoreDistances(surface, shoreFadeDistance), 1),
    )
  }
  const normals = new Float32Array(surface.depths.length * 3)
  for (let index = 0; index < surface.depths.length; index += 1) normals[index * 3 + 1] = 1
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildRibbonRows(
  node: RiverNode,
  path: SampledRiverPath,
  baseline: TerrainField,
  terrain: TerrainField,
): SurfaceVertex[][] {
  const rows: SurfaceVertex[][] = []
  const surfaceInset = riverSurfaceInset(node.depth)
  for (let index = 0; index < path.points.length; index += 1) {
    const point = path.points[index]!
    const before = path.points[Math.max(0, index - 1)]!
    const after = path.points[Math.min(path.points.length - 1, index + 1)]!
    let tangentX = after[0] - before[0]
    let tangentZ = after[2] - before[2]
    const tangentLength = Math.hypot(tangentX, tangentZ)
    if (tangentLength <= CLIP_EPSILON) continue
    tangentX /= tangentLength
    tangentZ /= tangentLength
    const normalX = -tangentZ
    const normalZ = tangentX
    const halfWidth = node.width * 0.5 * riverPathWidthScale(path, node, path.distances[index]!)
    const centerWaterHeight = point[1] - surfaceInset
    rows.push(
      LATERAL_FRACTIONS.map((fraction): SurfaceVertex => {
        const x = point[0] + normalX * halfWidth * fraction
        const z = point[2] + normalZ * halfWidth * fraction
        const sourceHeight = Math.min(
          centerWaterHeight,
          surfaceHeightAt(baseline, x, z) - BANK_INSET,
        )
        const bedHeight = surfaceHeightAt(terrain, x, z)
        return {
          x,
          y: sourceHeight + WATER_CLEARANCE,
          z,
          depth: sourceHeight - bedHeight,
          course: path.distances[index]!,
          lateral: halfWidth * fraction,
          flowX: tangentX,
          flowZ: tangentZ,
        }
      }),
    )
  }
  return rows
}

function clipWetPolygon(triangle: readonly SurfaceVertex[]): SurfaceVertex[] {
  const result: SurfaceVertex[] = []
  let previous = triangle[triangle.length - 1]!
  let previousInside = previous.depth >= WET_EPSILON
  for (const current of triangle) {
    const currentInside = current.depth >= WET_EPSILON
    if (currentInside !== previousInside) {
      const amount = (WET_EPSILON - previous.depth) / (current.depth - previous.depth)
      const edge = interpolateVertex(previous, current, amount)
      edge.depth = 0
      result.push(edge)
    }
    if (currentInside) result.push({ ...current, depth: current.depth - WET_EPSILON })
    previous = current
    previousInside = currentInside
  }
  return result
}

function triangulateSiteBoundary(
  rawBoundary: readonly (readonly [number, number])[],
): SiteTriangle[] {
  const boundary: Vector2[] = []
  for (const point of rawBoundary) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    const candidate = new Vector2(point[0], point[1])
    if (!boundary.at(-1)?.equals(candidate)) boundary.push(candidate)
  }
  if (boundary.length > 2 && boundary[0]!.equals(boundary.at(-1)!)) boundary.pop()
  if (boundary.length < 3 || Math.abs(ShapeUtils.area(boundary)) <= CLIP_EPSILON) return []
  return ShapeUtils.triangulateShape(boundary, []).map(
    (face) => [boundary[face[0]!]!, boundary[face[1]!]!, boundary[face[2]!]!] as const,
  )
}

function clipToTriangle(
  polygon: readonly SurfaceVertex[],
  triangle: SiteTriangle,
): SurfaceVertex[] {
  let output = [...polygon]
  const orientation = Math.sign(crossVector2(triangle[0], triangle[1], triangle[2])) || 1
  for (let edge = 0; edge < 3 && output.length > 0; edge += 1) {
    const start = triangle[edge]!
    const end = triangle[(edge + 1) % 3]!
    const input = output
    output = []
    let previous = input.at(-1)!
    let previousDistance = orientation * crossPoint(start, end, previous)
    for (const current of input) {
      const currentDistance = orientation * crossPoint(start, end, current)
      const previousInside = previousDistance >= -CLIP_EPSILON
      const currentInside = currentDistance >= -CLIP_EPSILON
      if (currentInside !== previousInside) {
        const amount = previousDistance / (previousDistance - currentDistance)
        output.push(interpolateVertex(previous, current, amount))
      }
      if (currentInside) output.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }
  return deduplicatePolygon(output)
}

function interpolateVertex(
  start: SurfaceVertex,
  end: SurfaceVertex,
  amount: number,
): SurfaceVertex {
  const inverse = 1 - amount
  let flowX = start.flowX * inverse + end.flowX * amount
  let flowZ = start.flowZ * inverse + end.flowZ * amount
  const flowLength = Math.hypot(flowX, flowZ)
  if (flowLength > CLIP_EPSILON) {
    flowX /= flowLength
    flowZ /= flowLength
  }
  return {
    x: start.x * inverse + end.x * amount,
    y: start.y * inverse + end.y * amount,
    z: start.z * inverse + end.z * amount,
    depth: start.depth * inverse + end.depth * amount,
    course: start.course * inverse + end.course * amount,
    lateral: start.lateral * inverse + end.lateral * amount,
    flowX,
    flowZ,
  }
}

function deduplicatePolygon(polygon: SurfaceVertex[]): SurfaceVertex[] {
  const result: SurfaceVertex[] = []
  for (const point of polygon) {
    const previous = result.at(-1)
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > CLIP_EPSILON) {
      result.push(point)
    }
  }
  if (result.length > 2) {
    const first = result[0]!
    const last = result.at(-1)!
    if (Math.hypot(first.x - last.x, first.z - last.z) <= CLIP_EPSILON) result.pop()
  }
  return result
}

function appendVertex(
  vertex: SurfaceVertex,
  positions: number[],
  depths: number[],
  flows: number[],
  courses: number[],
): void {
  positions.push(vertex.x, vertex.y, vertex.z)
  depths.push(Math.max(0, vertex.depth))
  flows.push(vertex.flowX, vertex.flowZ)
  courses.push(vertex.course, vertex.lateral)
}

function polygonBounds(polygon: readonly SurfaceVertex[]) {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const point of polygon) {
    minX = Math.min(minX, point.x)
    minZ = Math.min(minZ, point.z)
    maxX = Math.max(maxX, point.x)
    maxZ = Math.max(maxZ, point.z)
  }
  return { minX, minZ, maxX, maxZ }
}

function triangleBounds(triangle: SiteTriangle) {
  return {
    minX: Math.min(triangle[0].x, triangle[1].x, triangle[2].x),
    minZ: Math.min(triangle[0].y, triangle[1].y, triangle[2].y),
    maxX: Math.max(triangle[0].x, triangle[1].x, triangle[2].x),
    maxZ: Math.max(triangle[0].y, triangle[1].y, triangle[2].y),
  }
}

function boundsOverlap(
  first: { minX: number; minZ: number; maxX: number; maxZ: number },
  second: { minX: number; minZ: number; maxX: number; maxZ: number },
): boolean {
  return (
    first.minX <= second.maxX + CLIP_EPSILON &&
    first.maxX >= second.minX - CLIP_EPSILON &&
    first.minZ <= second.maxZ + CLIP_EPSILON &&
    first.maxZ >= second.minZ - CLIP_EPSILON
  )
}

function cross2(first: SurfaceVertex, second: SurfaceVertex, third: SurfaceVertex): number {
  return (second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x)
}

function crossPoint(start: Vector2, end: Vector2, point: SurfaceVertex): number {
  return (end.x - start.x) * (point.z - start.y) - (end.y - start.y) * (point.x - start.x)
}

function crossVector2(first: Vector2, second: Vector2, third: Vector2): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

function averageWaterHeight(positions: readonly number[]): number {
  let sum = 0
  for (let index = 1; index < positions.length; index += 3) sum += positions[index]!
  return sum / (positions.length / 3)
}

function waterQuality(value: string): WaterQuality {
  return value === 'pure' || value === 'deep' || value === 'swampy' ? value : 'clear'
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return amount * amount * (3 - 2 * amount)
}
