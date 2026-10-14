import { createTerrainField, encodeTerrainField, quantize, type TerrainField } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { uniform } from 'three/tsl'
import { samplePlantingTerrain } from '../planting-terrain'
import { collectFlowerPlacements } from './flower-scatter'
import { resolveGroundCoverFields } from './field-context'
import { createAnimatedFlowerBatches, disposeFlowerBatches, updateFlowerBatchTerrain } from './render/flower-geometry'
import { createGrassTiles, getGrassTilesRuntime, updateGrassTileTerrain } from './render/grass-tiles'
import { GrassFieldNode } from './schema'
import { SiteNode } from '@pascal-app/core'
import { buildGrassFieldBakeGeometry } from './bake-geometry'
import { shapeGrassCoverageValue } from './render/blade-shape'

const BOUNDARY: [number, number][] = [[0, 0], [3, 0], [3, 3], [0, 3]]
const BOUNDS = { minX: 0, maxX: 3, minZ: 0, maxZ: 3 }
const NODE = GrassFieldNode.parse({ flowerDensity: 100 })

function plane(gradient: number): TerrainField {
  const field = createTerrainField({ origin: [-2, -2], spacing: 1, cols: 8, rows: 8 })
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.cols; column += 1) {
      field.heights[row * field.cols + column] = quantize(field,
        2 + (field.origin[0] + column * field.spacing) * gradient)
    }
  }
  return field
}

function flowerFields(terrain: TerrainField | null) {
  const site = SiteNode.parse({ polygon: { type: 'polygon', points: BOUNDARY } })
  const fields = resolveGroundCoverFields(NODE, { parent: site, children: [], siblings: [], resolve: () => undefined })
  if (!fields) throw new Error('Expected site planting fields')
  return { ...fields, terrain }
}

function instanceUp(mesh: InstancedMesh, index = 0): Vector3 {
  const matrix = new Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new Vector3(0, 1, 0).transformDirection(matrix)
}

describe('authored planting topography', () => {
  test('baked blades scale along the sampled normal instead of world vertical', () => {
    const terrain = plane(0.5)
    const site = SiteNode.parse({ polygon: { type: 'polygon', points: BOUNDARY }, terrain: encodeTerrainField(terrain) })
    const node = GrassFieldNode.parse({
      density: 50, flowerDensity: 0, bladeRestBend: 0, obstacleBendStrength: 0, bladeHeightVariation: 0,
    })
    const group = buildGrassFieldBakeGeometry(node, { parent: site, children: [], siblings: [], resolve: () => undefined })
    const mesh = group.getObjectByName('grass-field-static-blades')
    if (!(mesh instanceof Mesh)) throw new Error('Expected sloped baked blades')
    try {
      const positions = mesh.geometry.getAttribute('position')
      // The first two vertices form the root edge; vertex 6 is the first blade's tip.
      const root = new Vector3().fromBufferAttribute(positions, 0)
        .add(new Vector3().fromBufferAttribute(positions, 1)).multiplyScalar(0.5)
      const sample = samplePlantingTerrain(terrain, root.x, root.z)
      const tipOffset = new Vector3().fromBufferAttribute(positions, 6).sub(root)
      const normal = new Vector3(...sample.normal)
      expect(root.y).toBeCloseTo(sample.heightM, 6)
      expect(tipOffset.clone().cross(normal).length()).toBeLessThan(1e-6)
      expect(tipOffset.dot(normal)).toBeCloseTo(node.bladeHeight * shapeGrassCoverageValue(0.5) ** 2, 6)
    } finally {
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      })
    }
  })

  test('grass roots and local up follow terrain, and steep edits hide then restore candidates', () => {
    const material = new MeshBasicMaterial()
    const terrain = plane(0.5)
    const group = createGrassTiles(NODE, BOUNDARY, BOUNDS, terrain, material, {
      candidates: (visit) => visit(1, 2.5, 1, 0, 1, 1, 0.5, 0),
    })
    const tile = getGrassTilesRuntime(group)?.tiles[0]
    if (!tile) throw new Error('Expected grass tile')
    try {
      const sample = samplePlantingTerrain(terrain, 1, 1)
      expect(instanceUp(tile.full).distanceTo(new Vector3(...sample.normal))).toBeLessThan(1e-6)
      expect(tile.attributes.root.getY(0)).toBeCloseTo(sample.heightM, 6)
      expect(tile.attributes.densityThreshold.getX(0)).toBeGreaterThan(0.5)
      updateGrassTileTerrain(group, plane(10))
      expect(tile.attributes.densityThreshold.getX(0)).toBeGreaterThan(1)
      updateGrassTileTerrain(group, null)
      expect(tile.attributes.densityThreshold.getX(0)).toBe(0.5)
      expect(instanceUp(tile.full).toArray()).toEqual([0, 1, 0])
    } finally {
      group.traverse((object) => { if (object instanceof InstancedMesh) object.geometry.dispose() })
      material.dispose()
    }
  })

  test('flat flowers preserve placements, banks thin flowers, and faces support none', () => {
    const flat = collectFlowerPlacements(NODE, flowerFields(null))
    const flatField = plane(0)
    flatField.heights.fill(0)
    expect(collectFlowerPlacements(NODE, flowerFields(flatField))).toEqual(flat)
    const bank = collectFlowerPlacements(NODE, flowerFields(plane(0.8)))
    expect(bank.length).toBeGreaterThan(0)
    expect(bank.length).toBeLessThan(flat.length)
    for (const placement of bank) {
      const sample = samplePlantingTerrain(plane(0.8), placement.position[0], placement.position[2])
      expect(placement.position[1]).toBeCloseTo(sample.heightM, 6)
      expect(placement.normal).toEqual(sample.normal)
    }
    expect(collectFlowerPlacements(NODE, flowerFields(plane(10)))).toEqual([])
  })

  test('live flower matrices align to normal and steep edits hide then restore the same pool', () => {
    const fields = flowerFields(plane(10))
    const candidates = collectFlowerPlacements(NODE, fields, true)
    expect(candidates.length).toBeGreaterThan(0)
    const group = createAnimatedFlowerBatches(candidates, uniform(0), uniform(0))
    try {
      const flower = group.children.find((child): child is InstancedMesh => child instanceof InstancedMesh)
      if (!flower) throw new Error('Expected retained flower pool')
      const matrix = new Matrix4()
      flower.getMatrixAt(0, matrix)
      expect(new Vector3().setFromMatrixScale(matrix).length()).toBe(0)
      updateFlowerBatchTerrain(group, plane(0.2))
      flower.getMatrixAt(0, matrix)
      const position = new Vector3().setFromMatrixPosition(matrix)
      const sample = samplePlantingTerrain(plane(0.2), position.x, position.z)
      expect(position.y).toBeCloseTo(sample.heightM, 6)
      expect(instanceUp(flower).distanceTo(new Vector3(...sample.normal))).toBeLessThan(1e-6)
    } finally { disposeFlowerBatches(group) }
  })
})
