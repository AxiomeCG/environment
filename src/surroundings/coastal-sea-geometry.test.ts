import { describe, expect, test } from 'bun:test'
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildSeaGeometry, type SeaGeometryBuffers } from './coastal-sea-geometry'
import { createExteriorTerrainSampler, deriveExteriorTerrainSectionAddresses, polygonCentroid } from './exterior-terrain'
import type { Point2 } from './frontages'
import { deriveLandscapeRegion, regionPoint } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'

function surfaceProbe(buffers: SeaGeometryBuffers) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
  geometry.setIndex(new BufferAttribute(buffers.indices, 1))
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld()
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0))
  return {
    hit([x, z]: Point2) {
      ray.ray.origin.set(x, 100, z)
      return ray.intersectObject(mesh)[0]?.point.y
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}

const boundary: readonly Point2[] = [[740, -330], [790, -330], [790, -280], [740, -280]]

describe('coastal surface coverage', () => {
  test('joins the near sea to the horizon without flooding the inland half-plane', () => {
    const seed = 'pascal-suburbs'
    const region = deriveLandscapeRegion(seed)
    if (!region.coast) throw new Error('The coastal regression fixture must have a coast')
    const center = polygonCentroid(boundary)
    const sampler = createExteriorTerrainSampler({ boundary, terrain: null, seed })
    const sections = deriveExteriorTerrainSectionAddresses(boundary)
    const near = buildSeaGeometry(sections, sampler, boundary, null)
    const extended = buildSeaGeometry(sections, sampler, boundary, region.coast)
    const probe = surfaceProbe(extended)
    try {
      // Cross the detailed-window seam and the old 1 km camera range.
      for (const distance of [450, 575, 640, 1500, 8000, 18_000]) {
        expect(probe.hit(regionPoint(center, region.coast.angle, distance))).toBeCloseTo(SEA_LEVEL, 5)
      }
      expect(probe.hit(regionPoint(center, region.coast.angle, -1500))).toBeUndefined()
      expect(extended.indices.length - near.indices.length).toBeLessThanOrEqual(24 * 3)
    } finally { probe.dispose() }
  })

  test('a river-only landscape never acquires offshore ocean coverage', () => {
    const sampler = { heightAt: (x: number) => Math.abs(x - 760) < 18 ? SEA_LEVEL - 3 : 4, normalAt: (): readonly [number, number, number] => [0, 1, 0] }
    const buffers = buildSeaGeometry(deriveExteriorTerrainSectionAddresses(boundary), sampler, boundary, null)
    const probe = surfaceProbe(buffers)
    try {
      expect(probe.hit([760, -200])).toBeCloseTo(SEA_LEVEL, 5)
      expect(probe.hit([760, 2000])).toBeUndefined()
      expect(probe.hit([900, -200])).toBeUndefined()
    } finally { probe.dispose() }
  })
})
