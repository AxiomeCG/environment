import { createTerrainField, surfaceHeightAt } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { InstancedMesh, Material } from 'three'
import { uniform } from 'three/tsl'
import type { FlowerPlacement } from '../flower-scatter'
import {
  createAnimatedFlowerBatches,
  createFlowerGeometry,
  disposeFlowerBatches,
  updateFlowerBatchTerrain,
} from './flower-geometry'

const PLACEMENTS: FlowerPlacement[] = [
  { kind: 'daisy', position: [0.2, 0, 0.3], rotationY: 0.2, scale: 0.9 },
  { kind: 'cup', position: [0.7, 0, 0.8], rotationY: 1.3, scale: 1.1 },
  { kind: 'spike', position: [1.2, 0, 1.1], rotationY: 2.1, scale: 1 },
]

describe('flower geometry batches', () => {
  test('provides three distinct, root-anchored, vertex-colored silhouettes', () => {
    const geometries = PLACEMENTS.map(({ kind }) => createFlowerGeometry(kind))
    try {
      expect(
        new Set(geometries.map((geometry) => geometry.getAttribute('position').count)).size,
      ).toBe(3)
      for (const geometry of geometries) {
        const positions = geometry.getAttribute('position')
        const colors = geometry.getAttribute('color')
        const progress = geometry.getAttribute('flowerProgress')
        expect(colors.count).toBe(positions.count)
        expect(progress.count).toBe(positions.count)
        expect(Math.min(...Array.from(progress.array as ArrayLike<number>))).toBeCloseTo(0, 6)
        expect(Math.max(...Array.from(progress.array as ArrayLike<number>))).toBeCloseTo(1, 6)
        expect(geometry.boundingBox?.min.y).toBeCloseTo(0, 6)
      }
    } finally {
      for (const geometry of geometries) geometry.dispose()
    }
  })

  test('shares one material across bounded species batches and updates terrain roots', () => {
    const group = createAnimatedFlowerBatches(PLACEMENTS, uniform(1), uniform(1))
    const meshes = group.children.filter(
      (child): child is InstancedMesh => child instanceof InstancedMesh,
    )
    expect(meshes).toHaveLength(3)
    expect(new Set(meshes.map(({ material }) => material)).size).toBe(1)

    const terrain = createTerrainField({
      origin: [0, 0],
      spacing: 0.5,
      cols: 4,
      rows: 4,
      step: 0.01,
    })
    terrain.heights.set([0, 10, 20, 30, 5, 15, 25, 35, 10, 20, 30, 40, 15, 25, 35, 45])
    expect(updateFlowerBatchTerrain(group, terrain)).toBe(true)
    for (const mesh of meshes) {
      const roots = mesh.geometry.getAttribute('flowerRoot')
      for (let index = 0; index < roots.count; index += 1) {
        expect(roots.getY(index)).toBeCloseTo(
          surfaceHeightAt(terrain, roots.getX(index), roots.getZ(index)),
          6,
        )
      }
    }

    const geometries = meshes.map(({ geometry }) => geometry)
    const material = meshes[0]!.material as Material
    let geometryDisposals = 0
    let materialDisposals = 0
    for (const geometry of geometries) {
      geometry.addEventListener('dispose', () => {
        geometryDisposals += 1
      })
    }
    material.addEventListener('dispose', () => {
      materialDisposals += 1
    })

    disposeFlowerBatches(group)
    expect(geometryDisposals).toBe(3)
    expect(materialDisposals).toBe(1)
  })
})
