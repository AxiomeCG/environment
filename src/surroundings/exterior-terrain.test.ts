import { createTerrainField, surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import {
  deriveSurroundingsLayout,
  deriveSurroundingsLevelTerrainDistance,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import {
  buildExteriorTerrainSection,
  buildExteriorTerrainSections,
  createExteriorTerrainSampler,
  createRenderedTerrainSampler,
  createTerrainSubdivisionSampler,
  deriveExteriorTerrainSectionAddresses,
  EXTERIOR_TERRAIN_SECTION_SEGMENTS,
  exteriorTerrainSectionAddressAt,
  mergeExteriorTerrainSections,
} from './exterior-terrain'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { buildRoadPresentationPlan } from './streetscape-road-presentation'
import { clipConvexPolygon } from './neighborhood'

const DEFAULT_SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]

const SECONDARY_ROAD = {
  separator: 'secondary-road',
  access: 'none',
} as const satisfies FrontageContext

const TRANSLATED_IRREGULAR_SITE = [
  [108, -242],
  [139, -247],
  [153, -222],
  [124, -204],
  [103, -219],
] as const satisfies readonly Point2[]

function slopedTerrain(): TerrainField {
  const field = createTerrainField({
    cols: 9,
    origin: [96, -256],
    rows: 9,
    spacing: 8,
    step: 0.01,
  })
  const heights = new Int16Array(field.cols * field.rows)
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.cols; column += 1) {
      heights[row * field.cols + column] = column * 12 + row * 7
    }
  }
  return { ...field, heights }
}

function sectionSignature(section: ReturnType<typeof buildExteriorTerrainSection>) {
  return {
    address: section.address,
    indices: Array.from(section.indices),
    normals: Array.from(section.normals),
    positions: Array.from(section.positions),
  }
}

describe('exterior Terrain section addresses', () => {
  test('uses stable world keys across negative coordinates', () => {
    expect(exteriorTerrainSectionAddressAt(0, 0)).toEqual({
      key: 'exterior-terrain:0:0',
      x: 0,
      z: 0,
    })
    expect(exteriorTerrainSectionAddressAt(-0.001, -64.001)).toEqual({
      key: 'exterior-terrain:-1:-2',
      x: -1,
      z: -2,
    })
  })

  test('preserves existing section addresses when the window expands', () => {
    const initial = deriveExteriorTerrainSectionAddresses(DEFAULT_SITE, 64)
    const expanded = deriveExteriorTerrainSectionAddresses(DEFAULT_SITE, 192)
    const expandedByKey = new Map(expanded.map((address) => [address.key, address]))

    expect(initial.length).toBeGreaterThan(0)
    for (const address of initial) {
      expect(expandedByKey.get(address.key)).toEqual(address)
    }
  })

  test('follows a translated irregular Site instead of assuming an origin-centred rectangle', () => {
    const addresses = deriveExteriorTerrainSectionAddresses(TRANSLATED_IRREGULAR_SITE, 64)

    expect(addresses).toContainEqual({ key: 'exterior-terrain:1:-4', x: 1, z: -4 })
    expect(addresses.every(({ z }) => z < 0)).toBeTrue()
    expect(addresses.some(({ x, z }) => x === 0 && z === 0)).toBeFalse()
  })
})

describe('exterior Terrain sampling', () => {
  test('keeps nearby overlapping ridges low without flattening distant mountains', () => {
    let nearbyMaximum = -Infinity
    let distantMaximum = -Infinity
    const siteRadius = Math.hypot(15, 15)
    for (const seed of ['pascal-suburbs', 'region-1', 'region-2', 'region-13']) {
      const sampler = createExteriorTerrainSampler({ boundary: DEFAULT_SITE, terrain: null, seed })
      for (let distance = 125; distance <= 500; distance += 5) {
        if (distance > 225 && distance < 400) continue
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 48) {
          const height = sampler.heightAt(
            Math.cos(angle) * (siteRadius + distance),
            Math.sin(angle) * (siteRadius + distance),
          )
          if (distance <= 225) nearbyMaximum = Math.max(nearbyMaximum, height)
          else distantMaximum = Math.max(distantMaximum, height)
        }
      }
    }
    expect(nearbyMaximum).toBeLessThan(95)
    expect(distantMaximum).toBeGreaterThan(150)
  })

  test('is independent from section traversal order', () => {
    const addresses = [
      exteriorTerrainSectionAddressAt(70, 12),
      exteriorTerrainSectionAddressAt(-2, 12),
      exteriorTerrainSectionAddressAt(12, -70),
    ]
    const context = { boundary: DEFAULT_SITE, terrain: null }
    const forward = buildExteriorTerrainSections(addresses, context)
    const reverse = buildExteriorTerrainSections([...addresses].reverse(), context)

    expect(forward.map(sectionSignature)).toEqual(reverse.map(sectionSignature))
  })

  test('produces bit-identical positions and normals on a shared section edge', () => {
    const sampler = createExteriorTerrainSampler({ boundary: DEFAULT_SITE, terrain: null })
    const left = buildExteriorTerrainSection(
      exteriorTerrainSectionAddressAt(-1, 10),
      sampler,
      DEFAULT_SITE,
    )
    const right = buildExteriorTerrainSection(
      exteriorTerrainSectionAddressAt(0, 10),
      sampler,
      DEFAULT_SITE,
    )
    const verticesPerSide = EXTERIOR_TERRAIN_SECTION_SEGMENTS + 1

    for (let row = 0; row < verticesPerSide; row += 1) {
      const leftOffset = (row * verticesPerSide + EXTERIOR_TERRAIN_SECTION_SEGMENTS) * 3
      const rightOffset = row * verticesPerSide * 3
      expect(left.positions.slice(leftOffset, leftOffset + 3)).toEqual(
        right.positions.slice(rightOffset, rightOffset + 3),
      )
      expect(left.normals.slice(leftOffset, leftOffset + 3)).toEqual(
        right.normals.slice(rightOffset, rightOffset + 3),
      )
    }
  })

  test('leaves a real opening for the editable Site Terrain', () => {
    const sections = buildExteriorTerrainSections(
      deriveExteriorTerrainSectionAddresses(DEFAULT_SITE, 64),
      { boundary: DEFAULT_SITE, terrain: null },
    )
    const sitePolygon = DEFAULT_SITE.map(([x, z]) => [x, z] as [number, number])

    for (const section of sections) {
      for (let offset = 0; offset < section.indices.length; offset += 3) {
        const triangle = [0, 1, 2].map((corner) => {
          const vertex = section.indices[offset + corner]! * 3
          return [section.positions[vertex]!, section.positions[vertex + 2]!] as [number, number]
        })
        const overlap = clipConvexPolygon(triangle, sitePolygon)
        const doubledArea = overlap.reduce((sum, point, index) => {
          const next = overlap[(index + 1) % overlap.length]!
          return sum + point[0] * next[1] - next[0] * point[1]
        }, 0)
        expect(Math.abs(doubledArea)).toBeLessThan(1e-6)
      }
    }
  })

  test('cuts precisely to rectangular, concave, and sub-cell Site edges', () => {
    const boundaries: readonly (readonly Point2[])[] = [
      DEFAULT_SITE,
      [
        [63.3, -7.1],
        [76.9, -6.2],
        [76.9, 3.6],
        [69.1, 3.6],
        [69.1, 8.4],
        [62.6, 7.1],
      ],
      [
        [1, 1],
        [2, 1],
        [1, 2],
      ],
    ]
    for (const boundary of boundaries) {
      const addresses = deriveExteriorTerrainSectionAddresses(boundary, 0)
      const terrain = mergeExteriorTerrainSections(
        addresses.map((address) =>
          buildExteriorTerrainSection(
            address,
            { heightAt: () => 0, normalAt: () => [0, 1, 0] },
            boundary,
          ),
        ),
      )
      let area = 0
      for (let offset = 0; offset < terrain.indices.length; offset += 3) {
        const a = terrain.indices[offset]! * 3
        const b = terrain.indices[offset + 1]! * 3
        const c = terrain.indices[offset + 2]! * 3
        area +=
          Math.abs(
            (terrain.positions[b]! - terrain.positions[a]!) *
              (terrain.positions[c + 2]! - terrain.positions[a + 2]!) -
              (terrain.positions[b + 2]! - terrain.positions[a + 2]!) *
                (terrain.positions[c]! - terrain.positions[a]!),
          ) / 2
      }
      let siteArea = 0
      for (let index = 0; index < boundary.length; index += 1) {
        const start = boundary[index]!
        const end = boundary[(index + 1) % boundary.length]!
        siteArea += start[0] * end[1] - end[0] * start[1]
      }
      expect(area).toBeCloseTo(addresses.length * 64 ** 2 - Math.abs(siteArea) / 2, 2)

      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(terrain.positions, 3))
      geometry.setIndex(new BufferAttribute(terrain.indices, 1))
      const material = new MeshBasicMaterial()
      const mesh = new Mesh(geometry, material)
      try {
        for (let index = 0; index < boundary.length; index += 1) {
          const start = boundary[index]!
          const end = boundary[(index + 1) % boundary.length]!
          const dx = end[0] - start[0],
            dz = end[1] - start[1]
          const outward = (Math.sign(siteArea) * 0.01) / Math.hypot(dx, dz)
          const ray = new Raycaster(
            new Vector3(
              (start[0] + end[0]) / 2 + dz * outward,
              1,
              (start[1] + end[1]) / 2 - dx * outward,
            ),
            new Vector3(0, -1, 0),
          )
          expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(0, 6)
          const skirtRay = new Raycaster(
            new Vector3(
              (start[0] + end[0]) / 2 - dz * outward,
              0.01,
              (start[1] + end[1]) / 2 + dx * outward,
            ),
            new Vector3(dz, 0, -dx).multiplyScalar(Math.sign(siteArea)).normalize(),
          )
          expect(skirtRay.intersectObject(mesh)[0]?.distance).toBeCloseTo(0.01, 4)
        }
      } finally {
        geometry.dispose()
        material.dispose()
      }
    }
  })

  test('keeps all generated heights and normals finite and normals unit length', () => {
    const sections = buildExteriorTerrainSections(
      deriveExteriorTerrainSectionAddresses(DEFAULT_SITE, 64),
      { boundary: DEFAULT_SITE, terrain: null },
    )

    for (const section of sections) {
      expect(Array.from(section.positions).every(Number.isFinite)).toBeTrue()
      expect(Array.from(section.normals).every(Number.isFinite)).toBeTrue()
      for (let offset = 0; offset < section.normals.length; offset += 3) {
        expect(
          Math.hypot(
            section.normals[offset]!,
            section.normals[offset + 1]!,
            section.normals[offset + 2]!,
          ),
        ).toBeCloseTo(1, 5)
      }
    }
  })

  test('matches the authoritative Pascal Terrain sample at the Site boundary', () => {
    const terrain = slopedTerrain()
    const sampler = createExteriorTerrainSampler({
      boundary: TRANSLATED_IRREGULAR_SITE,
      terrain,
    })
    const [x, z] = TRANSLATED_IRREGULAR_SITE[0]

    expect(sampler.heightAt(x, z)).toBe(surfaceHeightAt(terrain, x, z))
  })

  test('keeps every Ring 2 road surface above the exterior Terrain', () => {
    const layout = deriveSurroundingsLayout(
      deriveBoundarySegments({
        points: DEFAULT_SITE,
        contexts: { 1: SECONDARY_ROAD },
      }),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )
    const road = buildRoadPresentationPlan(deriveRuntimeRoadNetwork(layout))
    const levelTerrainDistance = deriveSurroundingsLevelTerrainDistance(
      deriveBoundarySegments({ points: DEFAULT_SITE }),
      layout,
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    )
    const sampler = createExteriorTerrainSampler({
      boundary: DEFAULT_SITE,
      levelTerrainDistance,
      terrain: null,
    })
    let minimumClearance = Number.POSITIVE_INFINITY

    for (const surface of road.surfaces) {
      for (let offset = 0; offset < surface.geometry.positions.length; offset += 3) {
        const x = surface.geometry.positions[offset]!
        const y = surface.geometry.positions[offset + 1]!
        const z = surface.geometry.positions[offset + 2]!
        minimumClearance = Math.min(minimumClearance, y - (sampler.heightAt(x, z) - 0.02))
      }
    }

    expect(road.surfaces.length).toBeGreaterThan(0)
    expect(minimumClearance).toBeGreaterThanOrEqual(0.01)
  })

  test('resolves nearby curvature more accurately without refining distant terrain', () => {
    const source = {
      heightAt: (x: number, z: number) => Math.sin(x * 0.2) + Math.cos(z * 0.2),
      normalAt: () => [0, 1, 0] as const,
    }
    const addresses = deriveExteriorTerrainSectionAddresses(DEFAULT_SITE)
    const refined = createTerrainSubdivisionSampler(source, DEFAULT_SITE)
    const coarseGrid = createRenderedTerrainSampler(source, addresses)
    const refinedGrid = createRenderedTerrainSampler(refined, addresses)
    let coarseError = 0
    let refinedError = 0
    for (const [x, z] of [
      [19.3, 8.7],
      [-18.6, 3.2],
      [7.7, -23.1],
      [25.7, 18.5],
    ]) {
      const expected = source.heightAt(x!, z!)
      coarseError += Math.abs(coarseGrid.heightAt(x!, z!) - expected)
      refinedError += Math.abs(refinedGrid.heightAt(x!, z!) - expected)
    }
    expect(refinedError).toBeLessThan(coarseError * 0.35)
    const distant = exteriorTerrainSectionAddressAt(480, 480)
    expect(buildExteriorTerrainSection(distant, refinedGrid, DEFAULT_SITE).indices.length).toBe(
      buildExteriorTerrainSection(distant, coarseGrid, DEFAULT_SITE).indices.length,
    )
  })
  test('uses bounded adaptive sections and stitches them to coarser neighbors', () => {
    const adaptiveAddress = exteriorTerrainSectionAddressAt(1, 1)
    const neighborAddress = exteriorTerrainSectionAddressAt(65, 1)
    const source = {
      heightAt: (x: number, z: number) => x * 0.1 + z * z * 0.01,
      normalAt: () => [0, 1, 0] as const,
      sectionSegments: (address: typeof adaptiveAddress) =>
        address.key === adaptiveAddress.key ? 32 : 10,
    }
    const rendered = createRenderedTerrainSampler(source, [adaptiveAddress, neighborAddress])
    const distantBoundary = [
      [800, 800],
      [820, 800],
      [820, 820],
      [800, 820],
    ] as const
    const section = buildExteriorTerrainSection(adaptiveAddress, rendered, distantBoundary)

    const edge = []
    for (let offset = 0; offset < section.positions.length; offset += 3) {
      if (section.positions[offset] === 64) {
        edge.push([section.positions[offset + 2]!, section.positions[offset + 1]!] as const)
      }
    }
    edge.sort((a, b) => a[0] - b[0])
    for (let index = 1; index < edge.length; index += 1) {
      const first = edge[index - 1]!,
        second = edge[index]!
      const z = (first[0] + second[0]) / 2
      const y = (first[1] + second[1]) / 2
      expect(y).toBeCloseTo(rendered.heightAt(64, z), 5)
    }
  })
})

describe('exterior Terrain geometry budget', () => {
  test('merges the default section window into one bounded geometry', () => {
    const addresses = deriveExteriorTerrainSectionAddresses(DEFAULT_SITE)
    const sampler = createRenderedTerrainSampler(
      createTerrainSubdivisionSampler(
        createExteriorTerrainSampler({ boundary: DEFAULT_SITE, terrain: null }),
        DEFAULT_SITE,
      ),
      addresses,
    )
    const geometry = mergeExteriorTerrainSections(
      addresses.map((address) => buildExteriorTerrainSection(address, sampler, DEFAULT_SITE)),
    )

    expect(geometry.sectionCount).toBe(addresses.length)
    // Terrain must leave the rest of the 250k context budget for roads and trees.
    expect(geometry.triangleCount).toBeLessThanOrEqual(100_000)
    expect(geometry.ownedBufferBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  })
})
