import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  surfaceHeightAt,
  type TerrainField,
} from '@pascal-app/core'
import { buildRiverSurface, RIVER_MAX_WATER_TRIANGLES } from './geometry'
import { RiverNode, type RiverNode as RiverNodeType } from './schema'
import { rebuildRiverTerrain } from './terrain'

const CONCAVE_BOUNDARY: Array<[number, number]> = [
  [-10, -8],
  [10, -8],
  [10, 8],
  [2, 8],
  [2, 1],
  [-2, 1],
  [-2, 8],
  [-10, 8],
]

const RECTANGULAR_BOUNDARY: Array<[number, number]> = [
  [-10, -8],
  [10, -8],
  [10, 8],
  [-10, 8],
]

function terrain(): TerrainField {
  return createTerrainField({
    origin: [-10, -8],
    spacing: 0.5,
    cols: 41,
    rows: 33,
    step: 0.01,
  })
}

function site(field = terrain(), boundary: Array<[number, number]> = CONCAVE_BOUNDARY) {
  return SiteNode.parse({
    id: 'site_river_geometry',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: { type: 'polygon', points: boundary },
    terrain: encodeTerrainField(field),
    children: [],
  })
}

function river(
  points: Array<[number, number]> = [
    [-9, 0],
    [0, 0],
    [9, 4],
  ],
): RiverNodeType {
  return RiverNode.parse({
    id: 'river_geometry',
    type: 'environment:river',
    object: 'node',
    parentId: 'site_river_geometry',
    visible: true,
    metadata: {},
    name: 'River',
    points,
    width: 4,
    depth: 1.4,
    flowDirection: 'forward',
    flowSpeed: 0.8,
    quality: 'clear',
    shoreline: 'soft',
  })
}

function pointInPolygon(
  boundary: readonly (readonly [number, number])[],
  x: number,
  z: number,
): boolean {
  let inside = false
  for (
    let index = 0, previous = boundary.length - 1;
    index < boundary.length;
    previous = index, index += 1
  ) {
    const start = boundary[previous]!
    const end = boundary[index]!
    const cross = (x - start[0]) * (end[1] - start[1]) - (z - start[1]) * (end[0] - start[0])
    if (
      Math.abs(cross) <= 1e-6 &&
      x >= Math.min(start[0], end[0]) - 1e-6 &&
      x <= Math.max(start[0], end[0]) + 1e-6 &&
      z >= Math.min(start[1], end[1]) - 1e-6 &&
      z <= Math.max(start[1], end[1]) + 1e-6
    ) {
      return true
    }
    if (end[1] > z !== start[1] > z) {
      const crossingX = end[0] + ((z - end[1]) * (start[0] - end[0])) / (start[1] - end[1])
      if (x < crossingX) inside = !inside
    }
  }
  return inside
}

function waterTriangleHeightAt(positions: Float32Array, x: number, z: number): number | null {
  for (let offset = 0; offset < positions.length; offset += 9) {
    const ax = positions[offset]!
    const ay = positions[offset + 1]!
    const az = positions[offset + 2]!
    const bx = positions[offset + 3]!
    const by = positions[offset + 4]!
    const bz = positions[offset + 5]!
    const cx = positions[offset + 6]!
    const cy = positions[offset + 7]!
    const cz = positions[offset + 8]!
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(denominator) <= 1e-9) continue
    const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator
    const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator
    const c = 1 - a - b
    if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) {
      return ay * a + by * b + cy * c
    }
  }
  return null
}

describe('river geometry boundaries', () => {
  test('clips every water triangle to a concave Site and stays within its budget', () => {
    const sourceSite = site()
    const node = river([
      [-9, 0],
      [0, 4],
      [9, 4],
    ])
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const surface = buildRiverSurface(node, carvedSite, rebuilt.terrain, terrain())

    expect(surface).not.toBeNull()
    expect((surface?.positions.length ?? 0) / 9).toBeLessThanOrEqual(RIVER_MAX_WATER_TRIANGLES)
    for (let offset = 0; offset < (surface?.positions.length ?? 0); offset += 3) {
      const x = surface!.positions[offset]!
      const z = surface!.positions[offset + 2]!
      expect(pointInPolygon(CONCAVE_BOUNDARY, x, z)).toBe(true)
    }
  })

  test('keeps deep water inside banks and front-facing above its bed', () => {
    const sourceSite = site()
    const node = RiverNode.parse({ ...river(), depth: 8 })
    const source = terrain()
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const surface = buildRiverSurface(node, carvedSite, rebuilt.terrain, source)

    expect(surface).not.toBeNull()
    for (let index = 0; index < (surface?.depths.length ?? 0); index += 1) {
      const x = surface!.positions[index * 3]!
      const y = surface!.positions[index * 3 + 1]!
      const z = surface!.positions[index * 3 + 2]!
      expect(y).toBeGreaterThan(surfaceHeightAt(rebuilt.terrain, x, z))
      expect(y).toBeLessThanOrEqual(surfaceHeightAt(source, x, z) + 1e-5)
    }
    const positions = surface!.positions
    for (let index = 0; index < positions.length; index += 9) {
      const abX = positions[index + 3]! - positions[index]!
      const abZ = positions[index + 5]! - positions[index + 2]!
      const acX = positions[index + 6]! - positions[index]!
      const acZ = positions[index + 8]! - positions[index + 2]!
      expect(abZ * acX - abX * acZ).toBeGreaterThanOrEqual(-1e-7)
    }
  })

  test('uses one rounded extent for excavation and water without an endpoint dry wedge', () => {
    const sourceSite = site()
    const source = terrain()
    const node = river([
      [-4, 0],
      [4, 0],
    ])
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const surface = buildRiverSurface(node, carvedSite, rebuilt.terrain, source)
    const xCoordinates = Array.from(
      { length: (surface?.positions.length ?? 0) / 3 },
      (_, index) => surface!.positions[index * 3]!,
    )

    expect(surface?.sampledPath.points[0]?.[0]).toBeCloseTo(-6, 6)
    expect(surface?.sampledPath.points.at(-1)?.[0]).toBeCloseTo(6, 6)
    expect(surfaceHeightAt(rebuilt.terrain, -5.5, 0)).toBeLessThan(-0.1)
    expect(Math.min(...xCoordinates)).toBeLessThan(-5)
    expect(Math.min(...xCoordinates)).toBeGreaterThanOrEqual(-6 - 1e-5)
    expect(Math.max(...xCoordinates)).toBeLessThanOrEqual(6 + 1e-5)
    expect(waterTriangleHeightAt(surface!.positions, -5.5, 0.5)).not.toBeNull()
  })

  test('reversing visible flow does not reshape or re-elevate the channel surface', () => {
    const sourceSite = site()
    const source = terrain()
    const forward = river([
      [-7, -2],
      [0, 3],
      [7, -1],
    ])
    const rebuilt = rebuildRiverTerrain(sourceSite, [forward])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const forwardSurface = buildRiverSurface(forward, carvedSite, rebuilt.terrain, source)
    const reverseSurface = buildRiverSurface(
      RiverNode.parse({ ...forward, flowDirection: 'reverse' }),
      carvedSite,
      rebuilt.terrain,
      source,
    )

    expect(reverseSurface?.positions).toEqual(forwardSurface?.positions)
    expect(reverseSurface?.depths).toEqual(forwardSurface?.depths)
    expect(reverseSurface?.sampledPath).toEqual(forwardSurface?.sampledPath)
    expect(reverseSurface?.waterCourse).toEqual(forwardSurface?.waterCourse)
  })

  test('carries source-relative metre coordinates through native clipping', () => {
    const source = terrain()
    const sourceSite = site(source, RECTANGULAR_BOUNDARY)
    const node = RiverNode.parse({
      ...river([
        [-4, 0],
        [4, 0],
      ]),
      width: 2,
      source: 'mountain',
      outlet: 'sea',
    })
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const surface = buildRiverSurface(node, carvedSite, rebuilt.terrain, source)

    expect(surface).not.toBeNull()
    expect(surface!.waterCourse.length).toBe((surface!.positions.length / 3) * 2)
    let minimumCourse = Number.POSITIVE_INFINITY
    let maximumCourse = Number.NEGATIVE_INFINITY
    for (let index = 0; index < surface!.waterCourse.length; index += 2) {
      const course = surface!.waterCourse[index]!
      const lateral = surface!.waterCourse[index + 1]!
      minimumCourse = Math.min(minimumCourse, course)
      maximumCourse = Math.max(maximumCourse, course)
      expect(lateral).toBeGreaterThanOrEqual(-1 - 1e-6)
      expect(lateral).toBeLessThanOrEqual(1 + 1e-6)
    }
    expect(minimumCourse).toBeCloseTo(0, 5)
    expect(maximumCourse).toBeCloseTo(surface!.sampledPath.length, 5)
  })

  test('keeps native terrain triangles submerged across a narrow six-point bend', () => {
    const source = createTerrainField({
      origin: [-10, -8],
      spacing: 2,
      cols: 11,
      rows: 9,
      step: 0.01,
    })
    const sourceSite = site(source, RECTANGULAR_BOUNDARY)
    const node = RiverNode.parse({
      ...river([
        [-7, -5],
        [-5, -1],
        [-3, 3],
        [1, 5],
        [5, 1],
        [7, -3],
      ]),
      width: 1,
      depth: 0.8,
    })
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const carvedSite = SiteNode.parse({
      ...sourceSite,
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    })
    const surface = buildRiverSurface(node, carvedSite, rebuilt.terrain, source)

    expect(surface).not.toBeNull()
    const path = surface!.sampledPath
    const authoredSegments = path.distances
      .map((distance, index) => ({ distance, index }))
      .filter(
        ({ distance, index }) =>
          index > 0 &&
          distance >= path.authoredStartDistance &&
          distance <= path.authoredEndDistance,
      )
    const probeEntries = [0.15, 0.35, 0.55, 0.75, 0.9].map(
      (fraction) => authoredSegments[Math.floor((authoredSegments.length - 1) * fraction)]!,
    )

    for (const { index } of probeEntries) {
      const start = path.points[index - 1]!
      const end = path.points[index]!
      const tangentX = end[0] - start[0]
      const tangentZ = end[2] - start[2]
      const tangentLength = Math.hypot(tangentX, tangentZ)
      const centerX = (start[0] + end[0]) * 0.5
      const centerZ = (start[2] + end[2]) * 0.5
      const normalX = -tangentZ / tangentLength
      const normalZ = tangentX / tangentLength

      for (const lateral of [-0.18, 0, 0.18]) {
        const x = centerX + normalX * lateral
        const z = centerZ + normalZ * lateral
        const waterY = waterTriangleHeightAt(surface!.positions, x, z)
        expect(waterY).not.toBeNull()
        expect(surfaceHeightAt(rebuilt.terrain, x, z)).toBeLessThan(waterY!)
      }
    }
    expect(surfaceHeightAt(rebuilt.terrain, -9, 7)).toBe(0)
  })

  test('handles repeated, very short, and self-near paths without unbounded geometry', () => {
    const sourceSite = site()
    const source = terrain()
    const repeated = river([
      [0, 0],
      [0, 0],
    ])
    expect(buildRiverSurface(repeated, sourceSite, source, source)).toBeNull()

    const pathological = river([
      [-0.01, 0],
      [0, 0],
      [0.01, 0],
      [0, 0.01],
      [-0.01, 0],
      [0, -0.01],
      [0.01, 0],
    ])
    const rebuilt = rebuildRiverTerrain(sourceSite, [pathological])
    const surface = buildRiverSurface(pathological, sourceSite, rebuilt.terrain, source)
    expect((surface?.positions.length ?? 0) / 9).toBeLessThanOrEqual(RIVER_MAX_WATER_TRIANGLES)
  })
})
