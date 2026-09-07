import { describe, expect, test } from 'bun:test'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import {
  buildExteriorTerrainSection,
  createRenderedTerrainSampler,
  exteriorTerrainSectionKey,
  mergeExteriorTerrainSections,
  type ExteriorTerrainSampler,
} from './exterior-terrain'
import type { MeshGeometryBuffers } from './mesh-geometry'
import { buildTerrainRoadGeometry } from './terrain-road-geometry'
import { createRiverBridges, RIVER_BRIDGE_CLEARANCE } from './river-bridges'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'

const heightAt = (x: number, z: number) => Math.sin(x / 5) * 1.7 + Math.cos(z / 7) * 2 + z * 0.012

function meshOf(buffers: MeshGeometryBuffers) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
  geometry.setIndex(new BufferAttribute(buffers.indices, 1))
  return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
}

function groundMesh() {
  return meshOf(
    mergeExteriorTerrainSections(
      [-1, 0].flatMap((x) =>
        [-1, 0].map((z) =>
          buildExteriorTerrainSection(
            { key: `${x}:${z}`, x, z },
            { heightAt, normalAt: () => [0, 1, 0] },
            [],
          ),
        ),
      ),
    ),
  )
}

function groundHeight(ground: Mesh, x: number, z: number) {
  const hit = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObject(
    ground,
  )[0]
  expect(hit).toBeDefined()
  return hit!.point.y
}

function dispose(mesh: Mesh<BufferGeometry, MeshBasicMaterial>) {
  mesh.geometry.dispose()
  mesh.material.dispose()
}

describe('terrain-conforming road surfaces', () => {
  test('grounds off-grid props on the rendered triangles across chunk seams', () => {
    const addresses = [-1, 0].flatMap((x) => [-1, 0].map((z) => ({ key: `${x}:${z}`, x, z })))
    const sampler = createRenderedTerrainSampler({ heightAt, normalAt: () => [0, 1, 0] }, addresses)
    const ground = groundMesh()
    try {
      for (const [x, z] of [
        [-13.7, -11.2],
        [0, -5],
        [-0.001, 3.4],
        [0.001, 3.4],
        [20.2, 7.1],
        [31.9, 50.6],
      ]) {
        expect(sampler.heightAt(x!, z!)).toBeCloseTo(groundHeight(ground, x!, z!), 4)
      }
    } finally {
      dispose(ground)
    }
  })

  test('keeps entire junction triangles above the rendered ground, not just sampled vertices', () => {
    const ground = groundMesh()
    const road = buildTerrainRoadGeometry(
      [-13, 0.1, -11, 42, 0.1, -9, 5, 0.1, 39],
      [0, 2, 1],
      heightAt,
    )
    try {
      for (let index = 0; index < road.indices.length; index += 3) {
        const a = road.indices[index]! * 3,
          b = road.indices[index + 1]! * 3,
          c = road.indices[index + 2]! * 3
        for (const [wa, wb, wc] of [
          [1 / 3, 1 / 3, 1 / 3],
          [0.6, 0.2, 0.2],
          [0.2, 0.6, 0.2],
        ] as const) {
          const x = road.positions[a]! * wa + road.positions[b]! * wb + road.positions[c]! * wc
          const y =
            road.positions[a + 1]! * wa + road.positions[b + 1]! * wb + road.positions[c + 1]! * wc
          const z =
            road.positions[a + 2]! * wa + road.positions[b + 2]! * wb + road.positions[c + 2]! * wc
          expect(y - groundHeight(ground, x, z)).toBeCloseTo(0.14, 4)
        }
      }
    } finally {
      dispose(ground)
    }
  })

  test('retains vertical curb faces when clipping across grid boundaries', () => {
    const ground = groundMesh()
    const curb = meshOf(
      buildTerrainRoadGeometry(
        [0, 0.1, -12, 0, 0.25, -12, 0, 0.1, 12, 0, 0.25, 12],
        [0, 1, 2, 1, 3, 2],
        heightAt,
      ),
    )
    try {
      for (const z of [-11, -6, -0.4, 3, 8, 11]) {
        const y = groundHeight(ground, 0, z) + 0.2
        const hit = new Raycaster(new Vector3(-2, y, z), new Vector3(1, 0, 0)).intersectObject(
          curb,
        )[0]
        expect(hit?.distance).toBeCloseTo(2, 5)
      }
    } finally {
      dispose(ground)
      dispose(curb)
    }
  })

  test('follows refined channel terrain without cutting through fine-grid hills', () => {
    const addresses = [-1, 0].flatMap((x) =>
      [-1, 0].map((z) => ({
        key: exteriorTerrainSectionKey(x, z),
        x,
        z,
      })),
    )
    const source: ExteriorTerrainSampler = {
      heightAt,
      normalAt: () => [0, 1, 0],
      sectionSegments: ({ x }) => (x >= 0 ? 32 : 10),
    }
    const sampler = createRenderedTerrainSampler(source, addresses)
    const ground = meshOf(
      mergeExteriorTerrainSections(
        addresses.map((address) => buildExteriorTerrainSection(address, source, [])),
      ),
    )
    const road = buildTerrainRoadGeometry(
      [-13, 0.1, -11, 42, 0.1, -9, 5, 0.1, 39],
      [0, 2, 1],
      sampler.heightAt,
      undefined,
      { terrain: sampler },
    )
    try {
      for (let index = 0; index < road.indices.length; index += 3) {
        let x = 0,
          y = 0,
          z = 0
        for (let corner = 0; corner < 3; corner += 1) {
          const offset = road.indices[index + corner]! * 3
          x += road.positions[offset]! / 3
          y += road.positions[offset + 1]! / 3
          z += road.positions[offset + 2]! / 3
        }
        expect(y - groundHeight(ground, x, z)).toBeCloseTo(0.14, 4)
      }
    } finally {
      dispose(ground)
    }
  })

  test('keeps a narrow bridge deck level across the full road width', () => {
    const terrain: ExteriorTerrainSampler = {
      heightAt: (_x, z) => (Math.abs(z) < 3 ? -1 : 0),
      normalAt: () => [0, 1, 0],
    }
    const network = deriveRuntimeRoadNetwork(
      { corridors: [], neighborCells: [], roadJunctions: [] },
      [
        {
          id: 'crossing',
          separator: 'secondary-road',
          centerline: [
            [5, -80],
            [5, 80],
          ],
          corridorIds: [],
          junctionIds: [],
        },
      ],
    )
    const bridges = createRiverBridges(network, terrain, (_x, z) =>
      Math.abs(z) < 3 ? -0.12 : null,
    )
    expect(bridges.spans).toHaveLength(1)
    const road = meshOf(
      buildTerrainRoadGeometry(
        [1, 0.1, -3, 9, 0.1, -3, 1, 0.1, 3, 9, 0.1, 3],
        [0, 2, 1, 1, 2, 3],
        terrain.heightAt,
        undefined,
        { terrain, bridgeHeightAt: bridges.heightAt },
      ),
    )
    try {
      for (const x of [1.25, 4.9, 8.75]) {
        expect(groundHeight(road, x, 0)).toBeCloseTo(-0.12 + RIVER_BRIDGE_CLEARANCE + 0.14, 4)
      }
    } finally {
      dispose(road)
    }
  })
})
