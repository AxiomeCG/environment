import { expect, test } from 'bun:test'
import { createTerrainField } from '@pascal-app/core'
import { Group, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera } from 'three'
import { GrassFieldNode } from '../schema'
import { createGrassTiles, getGrassTilesRuntime, updateGrassTileLod, updateGrassTileTerrain, type GrassTilesRuntime } from './grass-tiles'

const boundary = [[0, 0], [8.2, 0], [8.2, 0.2], [0, 0.2]] as const
const bounds = { minX: 0, maxX: 8.2, minZ: 0, maxZ: 0.2 }
const field = GrassFieldNode.parse({ bladeHeight: 0.2, bladeHeightVariation: 100 })

function fixture() {
  const material = new MeshBasicMaterial()
  const tiles = createGrassTiles(field, boundary, bounds, null, material)
  const root = new Group().add(tiles)
  const runtime = getGrassTilesRuntime(root)!
  return { root, runtime, dispose() {
    for (const tile of runtime.tiles) {
      tile.full.geometry.dispose()
      tile.mid.geometry.dispose()
      tile.far.geometry.dispose()
    }
    material.dispose()
  } }
}

function submittedTriangles(runtime: GrassTilesRuntime) {
  let triangles = 0
  for (const tile of runtime.tiles) for (const mesh of [tile.full, tile.mid, tile.far]) {
    if (mesh.visible) triangles += mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
  }
  return triangles
}

test('projected-size LOD reduces submitted work with stable nested candidates and hysteresis', () => {
  const { root, runtime, dispose } = fixture()
  try {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 10000)
    camera.position.set(4, 10, 20)
    camera.lookAt(4, 0, 0)
    const roots = runtime.tiles.map(tile => tile.attributes.root.array)
    const setZoom = (zoom: number) => {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
      updateGrassTileLod(root, camera, 1000)
    }
    setZoom(1)
    const nearTriangles = submittedTriangles(runtime)
    setZoom(0.03)
    expect(runtime.tiles.every(tile => tile.lod === 'far')).toBe(true)
    expect(submittedTriangles(runtime)).toBeLessThan(nearTriangles / 20)
    setZoom(0.1)
    expect(runtime.tiles.every(tile => tile.lod === 'far')).toBe(true)
    setZoom(0.15)
    expect(runtime.tiles.every(tile => tile.lod === 'mid')).toBe(true)
    setZoom(0.3)
    expect(runtime.tiles.every(tile => tile.lod === 'mid')).toBe(true)
    setZoom(0.4)
    expect(runtime.tiles.every(tile => tile.lod === 'full')).toBe(true)
    for (const [index, tile] of runtime.tiles.entries()) {
      expect(tile.attributes.root.array).toBe(roots[index]!)
      expect(tile.far.instanceMatrix).toBe(tile.full.instanceMatrix)
      expect(tile.mid.instanceMatrix).toBe(tile.full.instanceMatrix)
    }
    const perspective = new PerspectiveCamera(45, 1, 0.1, 10000)
    perspective.position.set(4, 1000, 1000)
    perspective.lookAt(4, 0, 0)
    updateGrassTileLod(root, perspective, 1000)
    expect(runtime.tiles.every(tile => tile.lod === 'far')).toBe(true)
  } finally { dispose() }
})

test('terrain edits refresh every hidden candidate and preserve maximum deformation bounds', () => {
  const { root, runtime, dispose } = fixture()
  try {
    const camera = new OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 10000)
    camera.position.set(0, 100, 100)
    camera.lookAt(0, 0, 0)
    updateGrassTileLod(root, camera, 640)
    const terrain = createTerrainField({ origin: [0, 0], spacing: 10, cols: 2, rows: 2, step: 0.01 })
    terrain.heights.fill(2000)
    expect(updateGrassTileTerrain(root, terrain)).toBe(true)
    for (const tile of runtime.tiles) {
      expect(tile.lod).toBe('far')
      for (let index = 0; index < tile.candidateCount; index++) {
        expect(tile.attributes.root.getY(index)).toBe(20)
        expect(tile.full.instanceMatrix.array[index * 16 + 13]).toBe(20)
      }
      expect(tile.bounds.min.y).toBe(20)
      expect(tile.bounds.max.y).toBeCloseTo(20 + runtime.maxBladeHeight)
      expect(runtime.radialPadding).toBeGreaterThanOrEqual(runtime.maxBladeHeight + 2)
    }
  } finally { dispose() }
})
