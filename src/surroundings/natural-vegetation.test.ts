import { expect, test } from 'bun:test'
import { InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createBakedFlowerBatches, createFlowerGeometry } from '../ground-cover/render/flower-geometry'
import { getGrassTilesRuntime } from '../ground-cover/render/grass-tiles'
import { buildNaturalGrassInstances, visitNaturalGrassCandidates } from './natural-grass'
import {
  buildNaturalVegetationInstances,
  deriveNaturalTreeRenderPlan,
  deriveNaturalVegetationPlan,
  NATURAL_VEGETATION_BUDGET,
  NATURAL_VEGETATION_TILE_SIZE,
} from './natural-vegetation'

const boundary = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const

function bankNormal(degrees: number, south = 1): readonly [number, number, number] {
  const angle = degrees * Math.PI / 180
  return [0, Math.cos(angle), south * Math.sin(angle)]
}

const terrainContext = {
  boundary,
  seed: 'pascal',
  presetId: 'woodland-edge' as const,
  heightAt: () => 3,
}

test('natural planting preserves the exact flat population with an explicit up normal', () => {
  const legacy = deriveNaturalVegetationPlan(terrainContext)
  const flat = deriveNaturalVegetationPlan({
    ...terrainContext,
    normalAt: () => [0, 1, 0],
  })
  expect(flat).toEqual(legacy)
  expect(flat.lowVegetationCount).toBeGreaterThan(0)
  expect(flat.flowerCount).toBeGreaterThan(0)
  expect(flat.treeCount).toBeGreaterThan(0)
  expect(flat.lowVegetationCount).toBeLessThanOrEqual(NATURAL_VEGETATION_BUDGET.lowVegetation)
  expect(flat.flowerCount).toBeLessThanOrEqual(NATURAL_VEGETATION_BUDGET.flowers)
  expect(flat.treeCount).toBeLessThanOrEqual(NATURAL_VEGETATION_BUDGET.trees)
})

test('natural planting thins banks and refuses each category at its slope limit', () => {
  const flat = deriveNaturalVegetationPlan(terrainContext)
  const bank = deriveNaturalVegetationPlan({ ...terrainContext, normalAt: () => bankNormal(30) })
  expect(bank.lowVegetationCount).toBeLessThan(flat.lowVegetationCount)
  expect(bank.flowerCount).toBeLessThan(flat.flowerCount)
  expect(bank.treeCount).toBeLessThan(flat.treeCount)
  for (const [degrees, category] of [
    [40, 'treeCount'],
    [55, 'flowerCount'],
    [70, 'lowVegetationCount'],
  ] as const) {
    const plan = deriveNaturalVegetationPlan({
      ...terrainContext,
      normalAt: () => bankNormal(degrees),
    })
    expect(plan[category]).toBe(0)
  }
})

test('natural placements and tree render plans retain sampled slope heights and normals', () => {
  const normal = bankNormal(25)
  const heightAt = (_x: number, z: number) => 4 - z * Math.tan(25 * Math.PI / 180)
  const plan = deriveNaturalVegetationPlan({ ...terrainContext, heightAt, normalAt: () => normal })
  for (const tile of plan.tiles) {
    for (const placement of [...tile.lowVegetation, ...tile.flowers, ...tile.trees]) {
      expect(placement.position[1]).toBe(heightAt(placement.position[0], placement.position[2]))
      placement.normal.forEach((component, index) => {
        expect(component).toBeCloseTo(normal[index] ?? 0, 12)
      })
    }
  }
  const treePlan = deriveNaturalTreeRenderPlan(plan, boundary)
  expect(treePlan.detailed.length).toBeGreaterThan(0)
  for (const tree of treePlan.detailed) {
    expect(tree.heightM).toBe(heightAt(tree.position[0], tree.position[1]))
    expect(tree.normal?.[0]).toBeCloseTo(normal[0], 12)
    expect(tree.normal?.[1]).toBeCloseTo(normal[1], 12)
    expect(tree.normal?.[2]).toBeCloseTo(normal[2], 12)
  }
  for (const tree of treePlan.distant) {
    expect(tree.position[1]).toBe(heightAt(tree.position[0], tree.position[2]))
  }
})

test('natural flowers align with the sampled normal in runtime and portable geometry', () => {
  const normal = bankNormal(25)
  const plan = deriveNaturalVegetationPlan({ ...terrainContext, normalAt: () => normal })
  const flowers = plan.tiles.flatMap((tile) => tile.flowers)
  expect(flowers.length).toBeGreaterThan(0)
  const root = buildNaturalVegetationInstances(plan)
  const matrix = new Matrix4()
  for (const child of root.children) {
    if (!(child instanceof InstancedMesh)) continue
    child.getMatrixAt(0, matrix)
    const up = new Vector3(0, 1, 0).transformDirection(matrix)
    expect(up.x).toBeCloseTo(normal[0], 6)
    expect(up.y).toBeCloseTo(normal[1], 6)
    expect(up.z).toBeCloseTo(normal[2], 6)
  }
  // The portable flower builder consumes the same normal-bearing placements.
  const baked = createBakedFlowerBatches(flowers)
  expect(baked.children.length).toBeGreaterThan(0)
  for (const child of root.children) {
    if (!(child instanceof InstancedMesh)) continue
    const kind = flowers.find((flower) => child.name.endsWith(flower.kind))?.kind
    if (!kind) throw new Error('Missing natural flower kind')
    const portable = baked.getObjectByName(`grass-field-static-flowers-${kind}`)
    if (!(portable instanceof Mesh)) throw new Error('Missing baked flower mesh')
    const source = createFlowerGeometry(kind)
    const sourcePositions = source.getAttribute('position')
    const bakedPositions = portable.geometry.getAttribute('position')
    child.getMatrixAt(0, matrix)
    for (let index = 0; index < sourcePositions.count; index += 1) {
      const expected = new Vector3().fromBufferAttribute(sourcePositions, index).applyMatrix4(matrix)
      expect(bakedPositions.getX(index)).toBeCloseTo(expected.x, 4)
      expect(bakedPositions.getY(index)).toBeCloseTo(expected.y, 4)
      expect(bakedPositions.getZ(index)).toBeCloseTo(expected.z, 4)
    }
    source.dispose()
  }
})

test('natural species respond to slope/aspect without moving candidate identities', () => {
  const north = deriveNaturalVegetationPlan({
    ...terrainContext,
    normalAt: () => bankNormal(25, -1),
  })
  const south = deriveNaturalVegetationPlan({
    ...terrainContext,
    normalAt: () => bankNormal(25),
  })
  const northTrees = new Map(north.tiles.flatMap((tile) => tile.trees).map((tree) => [tree.id, tree]))
  expect(south.tiles.flatMap((tile) => tile.trees)
    .some((tree) => northTrees.get(tree.id)?.species !== tree.species)).toBe(true)
  const northFlowers = new Map(north.tiles.flatMap((tile) => tile.flowers)
    .map((flower) => [flower.id, flower]))
  expect(south.tiles.flatMap((tile) => tile.flowers)
    .some((flower) => northFlowers.get(flower.id)?.kind !== flower.kind)).toBe(true)
})

test('natural grass samples every blade, preserves flat replay, and suppresses steep roots', () => {
  const plan = deriveNaturalVegetationPlan(terrainContext)
  const context = {
    ...terrainContext,
    waterLevelAt: undefined,
    patches: plan.tiles.flatMap((tile) => tile.lowVegetation),
  }
  const legacy: number[][] = []
  const flat: number[][] = []
  visitNaturalGrassCandidates(context, (...candidate) => legacy.push(candidate))
  visitNaturalGrassCandidates({ ...context, normalAt: () => [0, 1, 0] },
    (...candidate) => flat.push(candidate))
  expect(flat).toEqual(legacy)
  expect(flat.length).toBeGreaterThan(0)
  let slopeCount = 0
  const heightAt = (x: number, z: number) => x * 0.12 - z * 0.08
  visitNaturalGrassCandidates({
    ...context,
    heightAt,
    normalAt: () => bankNormal(45),
  }, (x, y, z) => {
    expect(y).toBe(heightAt(x, z))
    slopeCount += 1
  })
  expect(slopeCount).toBeGreaterThan(0)
  expect(slopeCount).toBeLessThan(flat.length)
  expect(visitNaturalGrassCandidates({
    ...context,
    normalAt: () => bankNormal(70),
  }, () => { throw new Error('Steep grass root emitted') })).toBe(0)
})

test('natural runtime grass aligns every LOD with sampled normals and does not double-thin', () => {
  const normal = bankNormal(30)
  const plan = deriveNaturalVegetationPlan({ ...terrainContext, normalAt: () => normal })
  const context = {
    ...terrainContext,
    normalAt: () => normal,
    waterLevelAt: undefined,
    patches: plan.tiles.flatMap((tile) => tile.lowVegetation),
  }
  const accepted = visitNaturalGrassCandidates(context, () => {})
  const material = new MeshStandardMaterial()
  const root = buildNaturalGrassInstances(context, material)
  const runtime = getGrassTilesRuntime(root)
  if (!runtime) throw new Error('Missing natural grass runtime')
  expect(runtime.tiles.reduce((sum, tile) => sum + tile.candidateCount, 0)).toBe(accepted)
  const matrix = new Matrix4()
  for (const tile of runtime.tiles) {
    for (const mesh of [tile.full, tile.mid, tile.far]) {
      mesh.getMatrixAt(0, matrix)
      const up = new Vector3(0, 1, 0).transformDirection(matrix)
      expect(up.x).toBeCloseTo(normal[0], 6)
      expect(up.y).toBeCloseTo(normal[1], 6)
      expect(up.z).toBeCloseTo(normal[2], 6)
      expect(matrix.elements[13]).toBeCloseTo(3, 6)
      mesh.geometry.dispose()
      mesh.dispose()
    }
  }
  material.dispose()
})

test('natural grass occupies tile interiors instead of repeated diagonal rows', () => {
  for (const presetId of ['open-meadow', 'woodland-edge'] as const) {
    const context = { boundary, seed: 'pascal', presetId, heightAt: () => 0 }
    const plan = deriveNaturalVegetationPlan(context)
    let diagonalCount = 0
    let edgeCount = 0
    const cells = new Array<number>(16).fill(0)
    for (const tile of plan.tiles) {
      for (const patch of tile.lowVegetation) {
        const x = patch.position[0] / NATURAL_VEGETATION_TILE_SIZE - tile.address[0]
        const z = patch.position[2] / NATURAL_VEGETATION_TILE_SIZE - tile.address[1]
        if (Math.abs(x - z) < 0.04) diagonalCount += 1
        if (x < 0.04 || x > 0.96 || z < 0.04 || z > 0.96) edgeCount += 1
        cells[Math.floor(z * 4) * 4 + Math.floor(x * 4)]! += 1
      }
    }
    // Independent coordinates put about 8% in this diagonal band, not whole rows.
    expect(diagonalCount / plan.lowVegetationCount).toBeLessThan(0.2)
    expect(edgeCount / plan.lowVegetationCount).toBeGreaterThan(0.08)
    for (const count of cells) {
      expect(count / plan.lowVegetationCount).toBeGreaterThan(0.02)
      expect(count / plan.lowVegetationCount).toBeLessThan(0.12)
    }
    expect(deriveNaturalVegetationPlan(context)).toEqual(plan)
  }
})
