'use client'

import {
  heightAtSample,
  terrainFieldOf,
  useLiveNodeOverrides,
  useLiveTerrain,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three'
import { buildPondContourPositions } from './basin'

const NO_RAYCAST = () => undefined
const CONTOUR_Y_OFFSET = 0.014
const CURRENT_LEVEL_Y_OFFSET = 0.028

type Point2 = readonly [number, number]
type ContourPoint = readonly [x: number, z: number, height: number]

type PondContourObjects = {
  group: Group
  geometries: BufferGeometry[]
  materials: LineBasicMaterial[]
}

export function PondContours({
  site,
  levelStep,
  selectedLevel = null,
}: {
  site: SiteNode
  levelStep: number
  selectedLevel?: number | null
}) {
  const liveTerrain = useLiveTerrain((state) =>
    state.strokes.get(site.id)?.field ?? state.remoteStrokes.get(site.id)?.field,
  )
  const livePolygon = useLiveNodeOverrides((state) => state.overrides.get(site.id)?.polygon)
  const boundary = isSitePolygon(livePolygon) ? livePolygon.points : site.polygon.points
  const terrain = liveTerrain ?? terrainFieldOf(site)
  const objects = useMemo(
    () => buildContourObjects(terrain, boundary, levelStep, selectedLevel),
    [boundary, levelStep, selectedLevel, terrain],
  )

  useEffect(() => () => {
    for (const geometry of objects.geometries) geometry.dispose()
    for (const material of objects.materials) material.dispose()
  }, [objects])

  if (objects.group.children.length === 0) return null
  return <primitive object={objects.group} dispose={null} />
}

function buildContourObjects(
  terrain: TerrainField | null,
  boundary: ReadonlyArray<Point2>,
  levelStep: number,
  selectedLevel: number | null,
): PondContourObjects {
  const group = new Group()
  group.name = 'environment-pond-contours'
  group.raycast = NO_RAYCAST
  const geometries: BufferGeometry[] = []
  const materials: LineBasicMaterial[] = []
  if (!terrain || !Number.isFinite(levelStep) || levelStep <= 0 || boundary.length < 3) {
    return { group, geometries, materials }
  }

  const allPositions = buildPondContourPositions(terrain, boundary, levelStep)
  const minor: number[] = []
  const major: number[] = []
  const levelTolerance = Math.max(terrain.step * 0.51, levelStep * 1e-5)
  const majorStep = levelStep * 4
  for (let offset = 0; offset < allPositions.length; offset += 6) {
    const level = allPositions[offset + 1]!
    if (selectedLevel !== null && Math.abs(level - selectedLevel) <= levelTolerance) continue
    const target = Math.abs(level / majorStep - Math.round(level / majorStep)) <= 1e-5
      ? major
      : minor
    target.push(
      allPositions[offset]!, level + CONTOUR_Y_OFFSET, allPositions[offset + 2]!,
      allPositions[offset + 3]!, allPositions[offset + 4]! + CONTOUR_Y_OFFSET, allPositions[offset + 5]!,
    )
  }

  addContourLines(group, geometries, materials, 'environment-pond-contours-minor', minor, '#52645b', 0.26)
  addContourLines(group, geometries, materials, 'environment-pond-contours-major', major, '#3f5148', 0.48)
  if (selectedLevel !== null && Number.isFinite(selectedLevel)) {
    const selected = buildExactContourPositions(terrain, boundary, selectedLevel)
    addContourLines(
      group,
      geometries,
      materials,
      'environment-pond-contours-current-water',
      selected,
      '#67c8dc',
      0.96,
    )
  }
  return { group, geometries, materials }
}

function addContourLines(
  group: Group,
  geometries: BufferGeometry[],
  materials: LineBasicMaterial[],
  name: string,
  positions: readonly number[],
  color: string,
  opacity: number,
): void {
  if (positions.length === 0) return
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new LineBasicMaterial({ color, depthWrite: false, opacity, transparent: true })
  const lines = new LineSegments(geometry, material)
  lines.name = name
  lines.renderOrder = 8
  lines.raycast = NO_RAYCAST
  geometries.push(geometry)
  materials.push(material)
  group.add(lines)
}

function buildExactContourPositions(
  terrain: TerrainField,
  boundary: ReadonlyArray<Point2>,
  level: number,
): number[] {
  const positions: number[] = []
  const x0 = terrain.origin[0]
  const z0 = terrain.origin[1]
  const spacing = terrain.spacing
  for (let row = 0; row < terrain.rows - 1; row += 1) {
    for (let col = 0; col < terrain.cols - 1; col += 1) {
      const p00: ContourPoint = [x0 + col * spacing, z0 + row * spacing, heightAtSample(terrain, col, row)]
      const p10: ContourPoint = [p00[0] + spacing, p00[1], heightAtSample(terrain, col + 1, row)]
      const p01: ContourPoint = [p00[0], p00[1] + spacing, heightAtSample(terrain, col, row + 1)]
      const p11: ContourPoint = [p00[0] + spacing, p00[1] + spacing, heightAtSample(terrain, col + 1, row + 1)]
      appendTriangleContour(positions, [p00, p10, p01], boundary, level)
      appendTriangleContour(positions, [p11, p01, p10], boundary, level)
    }
  }
  return positions
}

function appendTriangleContour(
  positions: number[],
  triangle: readonly [ContourPoint, ContourPoint, ContourPoint],
  boundary: ReadonlyArray<Point2>,
  level: number,
): void {
  const points: Point2[] = []
  for (const [first, second] of [
    [triangle[0], triangle[1]],
    [triangle[1], triangle[2]],
    [triangle[2], triangle[0]],
  ] as const) {
    const firstDelta = first[2] - level
    const secondDelta = second[2] - level
    if (Math.abs(firstDelta) <= 1e-9 && Math.abs(secondDelta) <= 1e-9) continue
    if (Math.abs(firstDelta) <= 1e-9) addUniquePoint(points, [first[0], first[1]])
    else if (Math.abs(secondDelta) <= 1e-9) addUniquePoint(points, [second[0], second[1]])
    else if ((firstDelta < 0) !== (secondDelta < 0)) {
      const ratio = firstDelta / (firstDelta - secondDelta)
      addUniquePoint(points, [
        first[0] + (second[0] - first[0]) * ratio,
        first[1] + (second[1] - first[1]) * ratio,
      ])
    }
  }
  if (points.length < 2) return
  let first = points[0]!
  let second = points[1]!
  if (points.length > 2) {
    let greatestDistance = -1
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const distance = (points[left]![0] - points[right]![0]) ** 2 + (points[left]![1] - points[right]![1]) ** 2
        if (distance > greatestDistance) {
          greatestDistance = distance
          first = points[left]!
          second = points[right]!
        }
      }
    }
  }
  for (const [clippedFirst, clippedSecond] of clipSegmentToPolygon(first, second, boundary)) {
    positions.push(
      clippedFirst[0], level + CURRENT_LEVEL_Y_OFFSET, clippedFirst[1],
      clippedSecond[0], level + CURRENT_LEVEL_Y_OFFSET, clippedSecond[1],
    )
  }
}

function clipSegmentToPolygon(
  first: Point2,
  second: Point2,
  polygon: ReadonlyArray<Point2>,
): Array<readonly [Point2, Point2]> {
  const cuts = [0, 1]
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeFirst = polygon[index]!
    const edgeSecond = polygon[(index + 1) % polygon.length]!
    const ratio = segmentIntersectionRatio(first, second, edgeFirst, edgeSecond)
    if (ratio !== null && ratio > 1e-8 && ratio < 1 - 1e-8) cuts.push(ratio)
  }
  cuts.sort((left, right) => left - right)
  const uniqueCuts = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]!) > 1e-8)
  const result: Array<readonly [Point2, Point2]> = []
  for (let index = 0; index < uniqueCuts.length - 1; index += 1) {
    const start = uniqueCuts[index]!
    const end = uniqueCuts[index + 1]!
    const middle = (start + end) * 0.5
    const midpoint: Point2 = [
      first[0] + (second[0] - first[0]) * middle,
      first[1] + (second[1] - first[1]) * middle,
    ]
    if (!pointInPolygon(midpoint, polygon)) continue
    result.push([
      [first[0] + (second[0] - first[0]) * start, first[1] + (second[1] - first[1]) * start],
      [first[0] + (second[0] - first[0]) * end, first[1] + (second[1] - first[1]) * end],
    ])
  }
  return result
}

function segmentIntersectionRatio(
  first: Point2,
  second: Point2,
  edgeFirst: Point2,
  edgeSecond: Point2,
): number | null {
  const dx = second[0] - first[0]
  const dz = second[1] - first[1]
  const ex = edgeSecond[0] - edgeFirst[0]
  const ez = edgeSecond[1] - edgeFirst[1]
  const denominator = dx * ez - dz * ex
  if (Math.abs(denominator) <= 1e-10) return null
  const qx = edgeFirst[0] - first[0]
  const qz = edgeFirst[1] - first[1]
  const t = (qx * ez - qz * ex) / denominator
  const u = (qx * dz - qz * dx) / denominator
  return t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8 ? t : null
}

function pointInPolygon(point: Point2, polygon: ReadonlyArray<Point2>): boolean {
  let inside = false
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]!
    const b = polygon[previous]!
    const crosses = (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    if (crosses) inside = !inside
  }
  return inside
}

function addUniquePoint(points: Point2[], point: Point2): void {
  if (!points.some((current) => Math.abs(current[0] - point[0]) <= 1e-8 && Math.abs(current[1] - point[1]) <= 1e-8)) {
    points.push(point)
  }
}

function isSitePolygon(value: unknown): value is SiteNode['polygon'] {
  if (!value || typeof value !== 'object' || !('type' in value) || !('points' in value)) {
    return false
  }
  return value.type === 'polygon' && Array.isArray(value.points)
}
