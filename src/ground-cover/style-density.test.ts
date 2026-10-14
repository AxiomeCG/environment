import { expect, test } from 'bun:test'
import { Group, MeshBasicMaterial } from 'three'
import { shapeGrassCoverageValue } from './render/blade-shape'
import { createGrassTiles, getGrassTilesRuntime } from './render/grass-tiles'
import { GrassFieldNode } from './schema'
import { visitGrassCandidates } from './scatter'

const boundary = [[0, 0], [8, 0], [8, 8], [0, 8]] as const
const bounds = { minX: 0, maxX: 8, minZ: 0, maxZ: 8 }
const areaM2 = 64

test('density 100 has 156.25 candidate blade instances per m² on a flat aligned patch', () => {
  const material = new MeshBasicMaterial()
  const tiles = createGrassTiles(GrassFieldNode.parse({}), boundary, bounds, null, material)
  const runtime = getGrassTilesRuntime(new Group().add(tiles))
  if (!runtime) throw new Error('Grass tiles runtime missing')
  try {
    const counts = runtime.tiles.reduce((sum, tile) => ({
      full: sum.full + tile.full.count,
      mid: sum.mid + tile.mid.count,
      far: sum.far + tile.far.count,
    }), { full: 0, mid: 0, far: 0 })
    expect(counts).toEqual({ full: 10000, mid: 5000, far: 2500 })
    expect(counts.full / areaM2).toBe(156.25)
    expect(counts.mid / areaM2).toBe(78.125)
    expect(counts.far / areaM2).toBe(39.0625)
  } finally {
    for (const tile of runtime.tiles) {
      tile.full.geometry.dispose()
      tile.mid.geometry.dispose()
      tile.far.geometry.dispose()
    }
    material.dispose()
  }
})

test('wider or longer blades do not add roots or tighten their spacing', () => {
  const rootsOf = (bladeWidth: number, bladeHeight: number) => {
    const roots: number[] = []
    visitGrassCandidates(GrassFieldNode.parse({ bladeWidth, bladeHeight }), boundary, bounds, null,
      (x, y, z) => { roots.push(x, y, z) })
    return roots
  }
  expect(rootsOf(0.05, 0.4)).toEqual(rootsOf(0.035, 0.3))
})

test('density 50 uses smoothstep rather than half the candidates', () => {
  let visible = 0
  const density = shapeGrassCoverageValue(0.5)
  visitGrassCandidates(GrassFieldNode.parse({}), boundary, bounds, null,
    (_x, _y, _z, _yaw, _width, _height, threshold) => {
      if (threshold <= density) visible += 1
    })
  // Seeded finite-area count fluctuates about the nominal 71.96 instances/m².
  expect(visible / areaM2).toBeCloseTo(156.25 * density, 0)
  expect(density ** 2).toBeCloseTo(0.212118, 6)
})
