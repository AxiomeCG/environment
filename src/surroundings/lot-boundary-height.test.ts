import { createTerrainField, surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import type { Point2 } from './frontages'
import {
  buildExteriorTerrainSection,
  createExteriorTerrainSampler,
  createRenderedTerrainSampler,
  createTerrainSubdivisionSampler,
  deriveExteriorTerrainSectionAddresses,
  EXTERIOR_TERRAIN_GROUND_OFFSET,
  type ExteriorTerrainSection,
} from './exterior-terrain'

const LOT = [[-15, -15], [15, -15], [15, 15], [-15, 15]] as const
const ADDRESSES = deriveExteriorTerrainSectionAddresses(LOT, 0)
const JOIN_TOLERANCE_M = 0.03 // Covers the existing 0.02 m exterior render offset.

function field(): TerrainField {
  return createTerrainField({ origin: [-16, -16], spacing: 0.5, cols: 65, rows: 65, step: 0.01 })
}

function productionSections(terrain: TerrainField | null, boundary: readonly Point2[] = LOT) {
  const context = { boundary, terrain, levelTerrainDistance: 0 }
  const source = createTerrainSubdivisionSampler(createExteriorTerrainSampler(context), boundary)
  const sampler = createRenderedTerrainSampler(source, ADDRESSES, context)
  return { sampler, sections: ADDRESSES.map((address) => buildExteriorTerrainSection(address, sampler, boundary)) }
}

function onLotEdge(point: Point2, start: Point2, end: Point2): boolean {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const projected = (point[0] - start[0]) * dx + (point[1] - start[1]) * dz
  const cross = dx * (point[1] - start[1]) - dz * (point[0] - start[0])
  // Float32 mesh XZ coordinates round off the double-precision polygon.
  return Math.abs(cross) < Math.hypot(dx, dz) * 1e-5 &&
    projected >= -1e-5 && projected <= dx * dx + dz * dz + 1e-5
}

function expectObliqueEdgeProfile(
  sections: readonly ExteriorTerrainSection[], terrain: TerrainField, boundary: readonly Point2[],
): void {
  let checkedEdges = 0
  for (const section of sections) {
    for (let offset = 0; offset < section.indices.length; offset += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const startIndex = (section.indices[offset + corner] ?? 0) * 3
        const endIndex = (section.indices[offset + (corner + 1) % 3] ?? 0) * 3
        const start: Point2 = [section.positions[startIndex] ?? 0, section.positions[startIndex + 2] ?? 0]
        const end: Point2 = [section.positions[endIndex] ?? 0, section.positions[endIndex + 2] ?? 0]
        if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 1e-6) continue
        const isBoundary = boundary.some((edgeStart, index) => {
          const edgeEnd = boundary[(index + 1) % boundary.length]
          return edgeEnd && onLotEdge(start, edgeStart, edgeEnd) && onLotEdge(end, edgeStart, edgeEnd)
        })
        if (!isBoundary) continue
        checkedEdges += 1
        for (const progress of [0.25, 0.5, 0.75]) {
          const x = start[0] + (end[0] - start[0]) * progress
          const z = start[1] + (end[1] - start[1]) * progress
          const startHeight = section.positions[startIndex + 1] ?? 0
          const endHeight = section.positions[endIndex + 1] ?? 0
          const height = startHeight + (endHeight - startHeight) * progress + EXTERIOR_TERRAIN_GROUND_OFFSET
          expect(Math.abs(height - surfaceHeightAt(terrain, x, z))).toBeLessThan(JOIN_TOLERANCE_M)
        }
      }
    }
  }
  expect(checkedEdges).toBeGreaterThan(0)
}

function eastBoundaryVertices(sections: readonly ExteriorTerrainSection[]) {
  const vertices: Array<{ z: number; heightM: number }> = []
  for (const section of sections) {
    for (const index of new Set(section.indices)) {
      const x = section.positions[index * 3] ?? 0
      const z = section.positions[index * 3 + 2] ?? 0
      if (Math.abs(x - 15) > 1e-6 || Math.abs(z) > 15 + 1e-6) continue
      vertices.push({ z, heightM: (section.positions[index * 3 + 1] ?? 0) + EXTERIOR_TERRAIN_GROUND_OFFSET })
    }
  }
  return vertices
}

function expectEastEdgeProfile(sections: readonly ExteriorTerrainSection[], terrain: TerrainField): void {
  for (const section of sections) {
    for (let offset = 0; offset < section.indices.length; offset += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const start = (section.indices[offset + corner] ?? 0) * 3
        const end = (section.indices[offset + (corner + 1) % 3] ?? 0) * 3
        if (Math.abs((section.positions[start] ?? 0) - 15) > 1e-6 ||
          Math.abs((section.positions[end] ?? 0) - 15) > 1e-6) continue
        const startZ = section.positions[start + 2] ?? 0
        const endZ = section.positions[end + 2] ?? 0
        if (Math.abs(startZ) > 15 + 1e-6 || Math.abs(endZ) > 15 + 1e-6 ||
          Math.abs(startZ - endZ) < 1e-6) continue
        for (const progress of [0.25, 0.5, 0.75]) {
          const z = startZ + (endZ - startZ) * progress
          const startHeight = section.positions[start + 1] ?? 0
          const endHeight = section.positions[end + 1] ?? 0
          const height = startHeight + (endHeight - startHeight) * progress + EXTERIOR_TERRAIN_GROUND_OFFSET
          expect(Math.abs(height - surfaceHeightAt(terrain, 15, z))).toBeLessThan(JOIN_TOLERANCE_M)
        }
      }
    }
  }
}

describe('production lot terrain join', () => {
  test('the reviewer lowered boundary follows authoritative heights within 0.03 m', () => {
    const terrain = field()
    // Column 62 is x=15: a -2 m groove missed by the exterior's 3.2 m grid.
    for (let row = 0; row < terrain.rows; row += 1) terrain.heights[row * terrain.cols + 62] = -200
    const { sampler, sections } = productionSections(terrain)
    expect(surfaceHeightAt(terrain, 15, 0)).toBe(-2)
    const vertices = eastBoundaryVertices(sections)
    expect(vertices.length).toBeGreaterThan(0)
    for (const vertex of vertices) {
      expect(Math.abs(vertex.heightM - surfaceHeightAt(terrain, 15, vertex.z))).toBeLessThan(JOIN_TOLERANCE_M)
    }
    expect(Math.abs(sampler.heightAt(15, 0) + 2)).toBeLessThan(JOIN_TOLERANCE_M)
  })

  test('a local boundary sculpt retains its half-metre profile in referenced mesh edges', () => {
    const terrain = field()
    terrain.heights[32 * terrain.cols + 62] = -200 // The boundary sample at (15, 0).
    const { sections } = productionSections(terrain)
    const vertices = eastBoundaryVertices(sections)
    for (const z of [-0.5, 0, 0.5]) {
      const atSample = vertices.filter((vertex) => Math.abs(vertex.z - z) < 1e-6)
      expect(atSample.length).toBeGreaterThan(0)
      for (const vertex of atSample) {
        expect(Math.abs(vertex.heightM - surfaceHeightAt(terrain, 15, z))).toBeLessThan(JOIN_TOLERANCE_M)
      }
    }
    const coordinates = [...new Set(vertices.map((vertex) => vertex.z))].sort((left, right) => left - right)
    for (let index = 1; index < coordinates.length; index += 1) {
      expect((coordinates[index] ?? 0) - (coordinates[index - 1] ?? 0)).toBeLessThanOrEqual(terrain.spacing + 1e-6)
    }
    expectEastEdgeProfile(sections, terrain)
  })

  test('a flat field preserves production mesh positions, normals and indices exactly', () => {
    const withoutField = productionSections(null).sections
    const flat = productionSections(field()).sections
    expect(flat).toEqual(withoutField)
  })

  test('oblique boundary edges preserve host triangle profiles between grid crossings', () => {
    const terrain = field()
    // Alternating corners force different planes across the host cell diagonals.
    for (let row = 0; row < terrain.rows; row += 1) {
      for (let column = 0; column < terrain.cols; column += 1) {
        terrain.heights[row * terrain.cols + column] = (row + column) % 2 * 200
      }
    }
    const boundary: Point2[] = [[-14.8, -14.6], [14.7, -13.3], [14.2, 14.8], [-13.4, 13.7]]
    expectObliqueEdgeProfile(productionSections(terrain, boundary).sections, terrain, boundary)
  })
})
