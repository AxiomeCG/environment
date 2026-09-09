import { EXTERIOR_TERRAIN_SECTION_SIZE, polygonCentroid } from './exterior-terrain'
import type { ExteriorTerrainSectionAddress, ExteriorTerrainSampler } from './exterior-terrain'
import type { Point2 } from './frontages'
import { SEA_LEVEL } from './landscape-noise'
import { regionPoint, type LandscapeRegion } from './landscape-region'
import { buildMeshGeometryBuffers, type MeshGeometryBuffers } from './mesh-geometry'
import { clipConvexPolygon } from './neighborhood'

export type SeaGeometryBuffers = MeshGeometryBuffers & Readonly<{ depths: Float32Array }>

/** One merged sampled surface; the runtime default also adds a constant-cost offshore apron. */
export function buildSeaGeometry(
  sections: readonly ExteriorTerrainSectionAddress[],
  sampler: ExteriorTerrainSampler,
  boundary: readonly Point2[],
  coast: LandscapeRegion['coast'],
  options: Readonly<{ includeOffshoreApron?: boolean }> = {},
): SeaGeometryBuffers {
  const positions: number[] = [],
    indices: number[] = [],
    depths: number[] = []
  const step = 16
  for (const section of sections) {
    for (let row = 0; row < EXTERIOR_TERRAIN_SECTION_SIZE; row += step) {
      for (let column = 0; column < EXTERIOR_TERRAIN_SECTION_SIZE; column += step) {
        const x = section.x * EXTERIOR_TERRAIN_SECTION_SIZE + column
        const z = section.z * EXTERIOR_TERRAIN_SECTION_SIZE + row
        const a = SEA_LEVEL - sampler.heightAt(x, z)
        const b = SEA_LEVEL - sampler.heightAt(x + step, z)
        const c = SEA_LEVEL - sampler.heightAt(x, z + step)
        const d = SEA_LEVEL - sampler.heightAt(x + step, z + step)
        if (Math.max(a, b, c, d) <= 0) continue
        const start = positions.length / 3
        positions.push(
          x,
          SEA_LEVEL,
          z,
          x + step,
          SEA_LEVEL,
          z,
          x,
          SEA_LEVEL,
          z + step,
          x + step,
          SEA_LEVEL,
          z + step,
        )
        // Signed depths preserve the shore crossing when interpolated across a cell.
        depths.push(a, b, c, d)
        indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
      }
    }
  }

  if (
    options.includeOffshoreApron !== false &&
    coast &&
    sections.length > 0 &&
    boundary.length >= 3
  ) {
    const center = polygonCentroid(boundary)
    const protectedRadius = Math.max(
      ...boundary.map(([x, z]) => Math.hypot(x - center[0], z - center[1])),
    )
    // Beyond every bay/noise excursion and the 65 m coastal transition the field
    // is uniformly submerged. Never extend a river mouth into an inland ocean.
    const offshoreStart = protectedRadius + coast.distance + coast.bays + 24 + 65
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity
    for (const section of sections) {
      minX = Math.min(minX, section.x * EXTERIOR_TERRAIN_SECTION_SIZE)
      minZ = Math.min(minZ, section.z * EXTERIOR_TERRAIN_SECTION_SIZE)
      maxX = Math.max(maxX, (section.x + 1) * EXTERIOR_TERRAIN_SECTION_SIZE)
      maxZ = Math.max(maxZ, (section.z + 1) * EXTERIOR_TERRAIN_SECTION_SIZE)
    }
    const reach = Math.max(25_000, maxX - minX, maxZ - minZ, offshoreStart * 2)
    const offshore = [
      regionPoint(center, coast.angle, offshoreStart, -reach * 2),
      regionPoint(center, coast.angle, reach * 2, -reach * 2),
      regionPoint(center, coast.angle, reach * 2, reach * 2),
      regionPoint(center, coast.angle, offshoreStart, reach * 2),
    ]
    // Four disjoint rectangles exclude the detailed window: no coplanar overlap,
    // no per-frame recentering, and at most 24 extra triangles at any sea extent.
    const left = center[0] - reach,
      right = center[0] + reach
    const bottom = center[1] - reach,
      top = center[1] + reach
    const apronBounds = [
      [left, minZ, minX, maxZ],
      [maxX, minZ, right, maxZ],
      [left, bottom, right, minZ],
      [left, maxZ, right, top],
    ] as const
    for (const [x0, z0, x1, z1] of apronBounds) {
      const polygon = clipConvexPolygon(
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
        offshore,
      )
      const start = positions.length / 3
      for (const [x, z] of polygon) {
        positions.push(x, SEA_LEVEL, z)
        depths.push(14)
      }
      for (let index = 1; index + 1 < polygon.length; index += 1) {
        indices.push(start, start + index + 1, start + index)
      }
    }
  }
  return { ...buildMeshGeometryBuffers(positions, indices), depths: new Float32Array(depths) }
}
