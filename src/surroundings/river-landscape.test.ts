import {
  createTerrainField,
  encodeTerrainField,
  terrainFieldOf,
  SiteNode,
  type SiteNode as SiteNodeType,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { RiverNode, type RiverNode as RiverNodeType } from '../river/schema'
import { riverSurfaceInset, sampleRiverPath } from '../river/terrain'
import {
  createRenderedTerrainSampler,
  exteriorTerrainSectionAddressAt,
  type ExteriorTerrainSampler,
  type ExteriorTerrainSectionAddress,
} from './exterior-terrain'
import type { Point2 } from './frontages'
import type { LandscapeRegion } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'
import { createRiverLandscape } from './river-landscape'

const BOUNDARY = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
] as const satisfies readonly Point2[]

const CONCAVE_BOUNDARY = [
  [-10, -8],
  [10, -8],
  [10, 8],
  [2, 8],
  [2, 1],
  [-2, 1],
  [-2, 8],
  [-10, 8],
] as const satisfies readonly Point2[]

function site(boundary: readonly Point2[] = BOUNDARY): SiteNodeType {
  const terrain = createTerrainField({
    origin: [-16, -16],
    spacing: 0.5,
    cols: 65,
    rows: 65,
    step: 0.01,
  })
  return SiteNode.parse({
    id: 'site_river_landscape',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: { type: 'polygon', points: boundary },
    terrain: encodeTerrainField(terrain),
    children: [],
  })
}

function river(overrides: Partial<RiverNodeType> = {}): RiverNodeType {
  return RiverNode.parse({
    id: 'river_landscape',
    type: 'environment:river',
    object: 'node',
    parentId: 'site_river_landscape',
    visible: true,
    metadata: {},
    name: 'Connected river',
    points: [
      [-8, 0],
      [8, 0],
    ],
    width: 4,
    depth: 1.4,
    source: 'mountain',
    outlet: 'sea',
    flowDirection: 'forward',
    flowSpeed: 0.8,
    quality: 'clear',
    shoreline: 'soft',
    ...overrides,
  })
}

function regionalFixture(coast = true): LandscapeRegion {
  return {
    kind: coast ? 'coastal-highland' : 'foothills',
    coast: coast ? { angle: 0, distance: 110, bays: 0, wavelength: 140, phase: 0 } : null,
    river: null,
    peaks: [{ angle: Math.PI, distance: 180, width: 100, depth: 120, height: 80 }],
    cityAngle: Math.PI / 2,
    cityDistance: 350,
    cityDistricts: 1,
    forestRotation: 0,
    forestDensity: 0.8,
    forestHeight: 1,
    screenCount: 4,
    screenDistance: 120,
    openAngle: 0,
    openHalfAngle: 0.5,
    palette: {
      grass: '#889966',
      stone: '#999999',
      sand: '#ccbb99',
      water: '#558899',
      foliage: ['#557755'],
    },
  }
}

function exteriorTerrain(): ExteriorTerrainSampler {
  const heightAt = (x: number, z: number) => {
    const mountain = x < -40 ? Math.min(42, (-x - 40) * 0.32) : 0
    const coast = x > 40 ? -Math.min(12, (x - 40) * 0.1) : 0
    return mountain + coast + Math.sin(z / 30) * 0.2
  }
  return {
    heightAt,
    normalAt: (x, z) => {
      const distance = 0.2
      const dx = heightAt(x - distance, z) - heightAt(x + distance, z)
      const dz = heightAt(x, z - distance) - heightAt(x, z + distance)
      const length = Math.hypot(dx, distance * 2, dz)
      return [dx / length, (distance * 2) / length, dz / length]
    },
  }
}

function strictlyInside(boundary: readonly Point2[], x: number, z: number): boolean {
  if (
    boundary.some((start, index) => {
      const end = boundary[(index + 1) % boundary.length]!
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const lengthSquared = dx * dx + dz * dz
      const amount = Math.max(
        0,
        Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared),
      )
      return Math.hypot(x - start[0] - dx * amount, z - start[1] - dz * amount) < 1e-7
    })
  )
    return false
  let inside = false
  for (
    let current = 0, previous = boundary.length - 1;
    current < boundary.length;
    previous = current, current += 1
  ) {
    const a = boundary[current]!
    const b = boundary[previous]!
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

describe('procedural exterior river landscape', () => {
  test('joins the native seam exactly, preserves Site interior, and reaches a broad sea mouth', () => {
    const source = exteriorTerrain()
    const node = river()
    const landscape = createRiverLandscape(site(), [node], source, regionalFixture())

    expect(landscape.channelCount).toBe(2)
    expect(landscape.exclusions).toHaveLength(landscape.centerlineSegments)
    expect(landscape.sampler.heightAt(0, 0)).toBe(source.heightAt(0, 0))
    expect(landscape.sampler.normalAt(0, 0)).toEqual(source.normalAt(0, 0))
    expect(landscape.waterLevelAt(0, 0)).toBeNull()
    expect(landscape.sampler.heightAt(-10, 0)).toBeCloseTo(-node.depth, 6)
    expect(landscape.waterLevelAt(-10, 0)).toBeCloseTo(-riverSurfaceInset(node.depth) + 0.012, 6)

    const positions = landscape.waters.flatMap((batch) => Array.from(batch.geometry.positions))
    let mouthMinZ = Infinity
    let mouthMaxZ = -Infinity
    let mouthVertices = 0
    for (let offset = 0; offset < positions.length; offset += 3) {
      const x = positions[offset]!
      const y = positions[offset + 1]!
      const z = positions[offset + 2]!
      expect(strictlyInside(BOUNDARY, x, z)).toBeFalse()
      if (Math.abs(y - SEA_LEVEL) < 1e-6) {
        mouthMinZ = Math.min(mouthMinZ, z)
        mouthMaxZ = Math.max(mouthMaxZ, z)
        mouthVertices += 1
      }
    }
    expect(mouthVertices).toBeGreaterThan(2)
    expect(mouthMaxZ - mouthMinZ).toBeGreaterThan(node.width * 2)
    expect(landscape.triangleCount).toBeLessThan(10_000)
  })

  test('detects a footprint crossed through its interior when every corner is dry', () => {
    const node = river()
    const landscape = createRiverLandscape(site(), [node], exteriorTerrain(), regionalFixture())
    const corridor = landscape.exclusions[Math.floor(landscape.exclusions.length / 4)]!
    const start: Point2 = [
      (corridor[0]![0] + corridor[3]![0]) * 0.5,
      (corridor[0]![1] + corridor[3]![1]) * 0.5,
    ]
    const end: Point2 = [
      (corridor[1]![0] + corridor[2]![0]) * 0.5,
      (corridor[1]![1] + corridor[2]![1]) * 0.5,
    ]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const tangent: Point2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    const normal: Point2 = [-tangent[1], tangent[0]]
    const center: Point2 = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5]
    const along = 0.8
    const across = node.width * 1.5
    const crossing = [
      [
        center[0] - tangent[0] * along + normal[0] * across,
        center[1] - tangent[1] * along + normal[1] * across,
      ],
      [
        center[0] + tangent[0] * along + normal[0] * across,
        center[1] + tangent[1] * along + normal[1] * across,
      ],
      [
        center[0] + tangent[0] * along - normal[0] * across,
        center[1] + tangent[1] * along - normal[1] * across,
      ],
      [
        center[0] - tangent[0] * along - normal[0] * across,
        center[1] - tangent[1] * along - normal[1] * across,
      ],
    ] as const satisfies readonly Point2[]

    expect(crossing.every(([x, z]) => landscape.waterLevelAt(x, z) === null)).toBeTrue()
    expect(landscape.intersectsFootprint(crossing)).toBeTrue()
    expect(
      landscape.intersectsFootprint([
        [0, 30],
        [4, 30],
        [4, 34],
        [0, 34],
      ]),
    ).toBeFalse()
  })

  test('clips connection water against a concave Site without covering authored terrain', () => {
    const landscape = createRiverLandscape(
      site(CONCAVE_BOUNDARY),
      [river()],
      exteriorTerrain(),
      regionalFixture(),
    )

    expect(landscape.waters.length).toBeGreaterThan(0)
    for (const batch of landscape.waters) {
      for (let offset = 0; offset < batch.geometry.positions.length; offset += 3) {
        expect(
          strictlyInside(
            CONCAVE_BOUNDARY,
            batch.geometry.positions[offset]!,
            batch.geometry.positions[offset + 2]!,
          ),
        ).toBeFalse()
      }
    }
  })

  test('is deterministic and leaves its inputs unmodified', () => {
    const source = exteriorTerrain()
    const authoredSite = site()
    const node = river()
    const siteTerrainBefore = Array.from(terrainFieldOf(authoredSite)!.heights)
    const first = createRiverLandscape(authoredSite, [node], source, regionalFixture())
    const second = createRiverLandscape(authoredSite, [node], source, regionalFixture())

    expect(first.waters.map((batch) => Array.from(batch.geometry.positions))).toEqual(
      second.waters.map((batch) => Array.from(batch.geometry.positions)),
    )
    expect(first.waters.map((batch) => Array.from(batch.geometry.indices))).toEqual(
      second.waters.map((batch) => Array.from(batch.geometry.indices)),
    )
    expect(Array.from(terrainFieldOf(authoredSite)!.heights)).toEqual(siteTerrainBefore)
    expect(first.sampler.heightAt(-64, 0)).toBe(second.sampler.heightAt(-64, 0))
  })

  test('keeps endpoint intent geometric and treats flow direction as cosmetic', () => {
    const authoredSite = site()
    const source = exteriorTerrain()
    const forward = createRiverLandscape(authoredSite, [river()], source, regionalFixture())
    const reverse = createRiverLandscape(
      authoredSite,
      [river({ flowDirection: 'reverse' })],
      source,
      regionalFixture(),
    )

    expect(forward.waters.map((batch) => Array.from(batch.geometry.positions))).toEqual(
      reverse.waters.map((batch) => Array.from(batch.geometry.positions)),
    )
    expect(forward.waters.map((batch) => Array.from(batch.geometry.waterFlows))).toEqual(
      reverse.waters.map((batch) => Array.from(batch.geometry.waterFlows)),
    )
    expect(forward.waters.map((batch) => Array.from(batch.geometry.waterCourses))).toEqual(
      reverse.waters.map((batch) => Array.from(batch.geometry.waterCourses)),
    )
    expect(forward.waters.map((batch) => batch.flowDirection)).toEqual([1])
    expect(reverse.waters.map((batch) => batch.flowDirection)).toEqual([-1])
  })

  test('adds deterministic identity-seeded landscape bends while preserving both boundary tangents', () => {
    const authoredSite = site()
    const source = exteriorTerrain()
    const region = regionalFixture()
    const mountain = river({ outlet: 'rounded' })
    const first = createRiverLandscape(authoredSite, [mountain], source, region)
    const repeated = createRiverLandscape(authoredSite, [mountain], source, region)
    const renamed = createRiverLandscape(
      authoredSite,
      [river({ id: 'river_landscape_alternate', outlet: 'rounded' })],
      source,
      region,
    )
    const centers = first.exclusions.map(
      (polygon): Point2 => [
        polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length,
        polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length,
      ],
    )
    const lateral = centers.map((point) => point[1])

    expect(Math.max(...lateral) - Math.min(...lateral)).toBeGreaterThan(mountain.width * 1.5)
    expect(first.exclusions).toEqual(repeated.exclusions)
    expect(first.exclusions).not.toEqual(renamed.exclusions)

    const connectedNode = river()
    const connected = createRiverLandscape(authoredSite, [connectedNode], source, region)
    const nativePath = sampleRiverPath(terrainFieldOf(authoredSite)!, connectedNode, BOUNDARY)!
    const seamSamples: Array<
      Readonly<{
        x: number
        z: number
        flowX: number
        flowZ: number
        courseX: number
        courseY: number
      }>
    > = []
    for (const batch of connected.waters) {
      for (let offset = 0; offset < batch.geometry.positions.length; offset += 3) {
        const x = batch.geometry.positions[offset]!
        const z = batch.geometry.positions[offset + 2]!
        if (Math.abs(Math.abs(x) - 10) > 1e-6 || Math.abs(z) > mountain.width) continue
        const vertex = offset / 3
        seamSamples.push({
          x,
          z,
          flowX: batch.geometry.waterFlows[vertex * 2]!,
          flowZ: batch.geometry.waterFlows[vertex * 2 + 1]!,
          courseX: batch.geometry.waterCourses[vertex * 2]!,
          courseY: batch.geometry.waterCourses[vertex * 2 + 1]!,
        })
      }
    }
    expect(seamSamples.length).toBeGreaterThan(0)
    for (const sample of seamSamples) {
      expect(sample.flowX).toBeCloseTo(1, 6)
      expect(sample.flowZ).toBeCloseTo(0, 6)
      expect(sample.courseX).toBeCloseTo(sample.x < 0 ? 0 : nativePath.length, 5)
      expect(sample.courseY).toBeCloseTo(sample.z, 5)
    }
    expect(connected.waterLevelAt(-10, 0)).not.toBeNull()
    expect(connected.waterLevelAt(10, 0)).not.toBeNull()
    expect(connected.waterLevelAt(-9.99, 0)).toBeNull()
    expect(connected.waterLevelAt(9.99, 0)).toBeNull()
  })

  test('keeps the nested rendered terrain mesh below the visible water surface', () => {
    const source = exteriorTerrain()
    const landscape = createRiverLandscape(site(), [river()], source, regionalFixture())
    const addresses = new Map<string, ExteriorTerrainSectionAddress>()
    for (const batch of landscape.waters) {
      for (let offset = 0; offset < batch.geometry.positions.length; offset += 3) {
        const address = exteriorTerrainSectionAddressAt(
          batch.geometry.positions[offset]!,
          batch.geometry.positions[offset + 2]!,
        )
        addresses.set(address.key, address)
      }
    }
    const renderedTerrain = createRenderedTerrainSampler(landscape.sampler, [...addresses.values()])
    const barycentrics = [
      [1 / 3, 1 / 3, 1 / 3],
      [0.6, 0.2, 0.2],
      [0.2, 0.6, 0.2],
      [0.2, 0.2, 0.6],
    ] as const
    let visibleSamples = 0
    for (const batch of landscape.waters) {
      const { indices, positions, shoreDistances } = batch.geometry
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const vertices = [
          indices[triangle]!,
          indices[triangle + 1]!,
          indices[triangle + 2]!,
        ] as const
        for (const weights of barycentrics) {
          let x = 0
          let y = 0
          let z = 0
          let shoreDistance = 0
          for (let corner = 0; corner < 3; corner += 1) {
            const vertex = vertices[corner]!
            const weight = weights[corner]!
            x += positions[vertex * 3]! * weight
            y += positions[vertex * 3 + 1]! * weight
            z += positions[vertex * 3 + 2]! * weight
            shoreDistance += shoreDistances[vertex]! * weight
          }
          if (shoreDistance < 0.5 || strictlyInside(BOUNDARY, x, z)) continue
          visibleSamples += 1
          expect(y - renderedTerrain.heightAt(x, z)).toBeGreaterThan(0.03)
        }
      }
    }
    expect(visibleSamples).toBeGreaterThan(100)
  })

  test('does not invent inland sea and is a zero-cost identity with no connections', () => {
    const source = exteriorTerrain()
    const noCoast = createRiverLandscape(
      site(),
      [river({ source: 'rounded', outlet: 'sea' })],
      source,
      regionalFixture(false),
    )
    expect(noCoast.sampler).toBe(source)
    expect(noCoast.waters).toEqual([])
    expect(noCoast.exclusions).toEqual([])

    const dryCoast: ExteriorTerrainSampler = {
      heightAt: () => 2,
      normalAt: () => [0, 1, 0],
    }
    const missingSea = createRiverLandscape(
      site(),
      [river({ source: 'rounded', outlet: 'sea' })],
      dryCoast,
      regionalFixture(),
    )
    expect(missingSea.sampler).toBe(dryCoast)
    expect(missingSea.channelCount).toBe(0)

    const disconnected = createRiverLandscape(
      site(),
      [river({ source: 'rounded', outlet: 'rounded' })],
      source,
      regionalFixture(),
    )
    expect(disconnected.sampler).toBe(source)
    expect(disconnected.channelCount).toBe(0)
  })
})
