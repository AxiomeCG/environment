import {
  applyHeightPatch,
  commitTerrainField,
  createTerrainField,
  SiteNode,
  type HeightPatch,
  type TerrainField,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  type BufferAttribute,
  Group,
  InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
} from 'three'
import { uniform } from 'three/tsl'
import { buildGrassFieldGeometry, updateGrassFieldTerrain } from './geometry'
import {
  createAnimatedFlowerBatches,
  disposeFlowerBatches,
  updateFlowerBatchTerrain,
} from './render/flower-geometry'
import {
  createGrassTiles,
  getGrassTilesRuntime,
  updateGrassTileLod,
  updateGrassTileTerrain,
} from './render/grass-tiles'
import { GrassFieldNode } from './schema'

// Analytical fixtures use a single raised sample on an otherwise flat triangular grid.
// The host deliberately transfers builder children, matching GeometrySystem rather than
// retaining a runtime-bearing builder root that the real viewer never mounts.
function field(cols = 17, rows = 5): TerrainField {
  return createTerrainField({ origin: [0, 0], spacing: 1, cols, rows, step: 1 })
}

function patch(col0: number, row0: number, height: number): HeightPatch {
  return { col0, row0, cols: 1, rows: 1, heights: new Int16Array([height]) }
}

function countedTerrain(terrain: TerrainField) {
  const reads: number[] = []
  const heights = new Proxy(terrain.heights, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key))
      return Reflect.get(target, key, target)
    },
  })
  return { terrain: { ...terrain, heights }, reads }
}

function covers(attribute: BufferAttribute, component: number): boolean {
  return attribute.updateRanges.some(({ start, count }) => component >= start && component < start + count)
}

function dispose(root: Group) {
  const geometries = new Set<Mesh['geometry']>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function tiles(points: readonly (readonly [number, number])[], terrain = field()) {
  const material = new MeshBasicMaterial()
  const root = createGrassTiles(
    GrassFieldNode.parse({ bladeHeight: 0.2 }),
    [[-8, -8], [24, -8], [24, 8], [-8, 8]],
    { minX: -8, maxX: 24, minZ: -8, maxZ: 8 },
    terrain,
    material,
    { candidates: (visit) => {
      for (const [x, z] of points) visit(x, 0, z, 0, 1, 1, 0.5, 0)
    } },
  )
  const runtime = getGrassTilesRuntime(root)!
  function rootAt(x: number) {
    for (const tile of runtime.tiles) {
      for (let index = 0; index < tile.candidateCount; index++) {
        if (Math.abs(tile.attributes.root.getX(index) - x) < 1e-5) return { tile, index }
      }
    }
    throw new Error(`Missing candidate ${x}`)
  }
  return { root, runtime, rootAt }
}

function mountedField(
  terrain = field(7, 7),
  boundary: [number, number][] = [[-2, -2], [8, -2], [8, 8], [-2, 8]],
) {
  const site = SiteNode.parse({
    id: 'site_terrain_acceptance',
    polygon: { type: 'polygon', points: boundary },
    terrain: commitTerrainField(terrain),
  })
  const node = GrassFieldNode.parse({ parentId: site.id, flowerDensity: 0 })
  const built = buildGrassFieldGeometry(node, {
    parent: site, children: [], siblings: [], resolve: () => undefined,
  })
  const host = new Group()
  for (const child of [...built.children]) host.add(child)
  const ground = host.getObjectByName('grass-field-ground') as Mesh
  return { site, host, ground }
}

describe('terrain patch acceptance: grass tiles', () => {
  test('updates interpolation support, not distant roots/tiles, preserving resources and partial uploads', () => {
    const fixture = tiles([[0.75, 0.75], [4.25, 0.25], [12.25, 0.25]])
    try {
      const near = fixture.rootAt(0.75)
      const far = fixture.rootAt(12.25)
      const roots = near.tile.attributes.root
      const matrices = near.tile.full.instanceMatrix
      const oldGeometry = near.tile.full.geometry
      const oldMaterial = near.tile.full.material
      const rootBuffer = roots.array
      const matrixBuffer = matrices.array
      const farRootVersion = far.tile.attributes.root.version
      const farMatrixVersion = far.tile.full.instanceMatrix.version
      const change = patch(1, 1, 4)
      const observed = countedTerrain(applyHeightPatch(field(), change))

      expect(updateGrassTileTerrain(fixture.root, observed.terrain, change)).toBe(true)
      expect(roots.getY(near.index)).toBeCloseTo(2, 6)
      expect(matrices.array[near.index * 16 + 13]).toBeCloseTo(2, 6)
      expect(near.tile.full.geometry).toBe(oldGeometry)
      expect(near.tile.full.material).toBe(oldMaterial)
      expect(roots.array).toBe(rootBuffer)
      expect(matrices.array).toBe(matrixBuffer)
      expect(far.tile.attributes.root.version).toBe(farRootVersion)
      expect(far.tile.full.instanceMatrix.version).toBe(farMatrixVersion)
      expect(observed.reads.length).toBeGreaterThan(0)
      expect(observed.reads.every((index) => index % observed.terrain.cols < 3)).toBe(true)
      expect(covers(roots, near.index * 3 + 1)).toBe(true)
      expect(covers(matrices, near.index * 16 + 13)).toBe(true)
    } finally { dispose(fixture.root) }
  })

  test('same-value dabs do not upload, and pending ranges survive a second changed dab', () => {
    const fixture = tiles([[0.75, 0.75], [4.75, 0.75], [12.25, 0.25]])
    try {
      const first = fixture.rootAt(0.75)
      const second = fixture.rootAt(4.75)
      const roots = first.tile.attributes.root
      const matrices = first.tile.full.instanceMatrix
      const a = patch(1, 1, 4)
      const afterA = applyHeightPatch(field(), a)
      updateGrassTileTerrain(fixture.root, afterA, a)
      const versions = [roots.version, matrices.version]
      const ranges = roots.updateRanges.map((range) => ({ ...range }))
      updateGrassTileTerrain(fixture.root, afterA, a)
      expect([roots.version, matrices.version]).toEqual(versions)
      expect(roots.updateRanges).toEqual(ranges)

      const b = patch(5, 1, 6)
      updateGrassTileTerrain(fixture.root, applyHeightPatch(afterA, b), b)
      expect(roots.getY(first.index)).toBeCloseTo(2, 6)
      expect(roots.getY(second.index)).toBeCloseTo(3, 6)
      for (const index of [first.index, second.index]) {
        expect(covers(roots, index * 3 + 1)).toBe(true)
        expect(covers(matrices, index * 16 + 13)).toBe(true)
      }
    } finally { dispose(fixture.root) }
  })

  test.each(['left', 'right', 'bottom', 'top'] as const)('clipped %s-edge patches update roots clamped outside the field', (edge) => {
    const horizontal = edge === 'left' || edge === 'right'
    const lower = edge === 'left' || edge === 'bottom'
    const outside = lower ? -4 : 12
    const point: [number, number] = horizontal ? [outside, 0.25] : [0.25, outside]
    const fixture = tiles([point], field(5, 5))
    try {
      const change: HeightPatch = horizontal
        ? { col0: lower ? -1 : 4, row0: 0, cols: 2, rows: 1, heights: new Int16Array(lower ? [99, 4] : [4, 99]) }
        : { col0: 0, row0: lower ? -1 : 4, cols: 1, rows: 2, heights: new Int16Array(lower ? [99, 4] : [4, 99]) }
      const next = applyHeightPatch(field(5, 5), change)
      updateGrassTileTerrain(fixture.root, next, change)
      const tile = fixture.runtime.tiles[0]!
      expect(tile.attributes.root.getY(0)).toBeCloseTo(3, 6)
      expect(tile.full.instanceMatrix.array[13]).toBeCloseTo(3, 6)
    } finally { dispose(fixture.root) }
  })

  test('a wholly out-of-grid patch has no reads/uploads; full reconciliation restores and tightens bounds', () => {
    const fixture = tiles([[0.75, 0.75], [12.25, 0.25]])
    try {
      const near = fixture.rootAt(0.75)
      const a = patch(1, 1, 20)
      updateGrassTileTerrain(fixture.root, applyHeightPatch(field(), a), a)
      const high = near.tile.bounds.max.y
      const versions = fixture.runtime.tiles.map((tile) => tile.attributes.root.version)
      const outside = patch(-4, -4, 99)
      const observed = countedTerrain(applyHeightPatch(applyHeightPatch(field(), a), outside))
      updateGrassTileTerrain(fixture.root, observed.terrain, outside)
      expect(observed.reads).toHaveLength(0)
      expect(fixture.runtime.tiles.map((tile) => tile.attributes.root.version)).toEqual(versions)
      updateGrassTileTerrain(fixture.root, field())
      expect(near.tile.attributes.root.getY(near.index)).toBe(0)
      expect(near.tile.bounds.max.y).toBeLessThan(high)
      expect(near.tile.bounds.max.y).toBeCloseTo(fixture.runtime.maxBladeHeight, 6)
    } finally { dispose(fixture.root) }
  })
})

describe('terrain patch acceptance: mounted ground', () => {
  test('viewer child-transfer retains terrain updates and working LOD without replacing resources', () => {
    const { site, host, ground } = mountedField()
    try {
      const runtime = getGrassTilesRuntime(host)
      expect(runtime).not.toBeNull()
      const geometry = ground.geometry
      const material = ground.material
      const next = field(7, 7)
      next.heights.fill(3)
      expect(updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) })).toBe(true)
      expect(ground.geometry).toBe(geometry)
      expect(ground.material).toBe(material)
      expect(ground.geometry.getAttribute('position').getY(0)).toBeCloseTo(3.005, 6)
      const camera = new OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 10000)
      camera.position.set(0, 100, 100)
      camera.lookAt(0, 0, 0)
      updateGrassTileLod(host, camera, 640)
      expect(runtime!.tiles.every((tile) => tile.lod === 'far' && tile.far.visible && !tile.full.visible)).toBe(true)
    } finally { dispose(host) }
  })

  test('ground updates two-cell normal support, preserves remote vertices and pending position ranges', () => {
    const { site, host, ground } = mountedField()
    try {
      const positions = ground.geometry.getAttribute('position') as BufferAttribute
      const normals = ground.geometry.getAttribute('normal') as BufferAttribute
      const originalPositions = new Float32Array(positions.array)
      const originalNormals = new Float32Array(normals.array)
      const positionArray = positions.array
      const normalArray = normals.array
      const a = patch(2, 2, 4)
      const next = applyHeightPatch(field(7, 7), a)
      expect(updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) }, a)).toBe(true)
      expect(positions.array).toBe(positionArray)
      expect(normals.array).toBe(normalArray)
      const raised: number[] = []
      const normalOnly: number[] = []
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index)
        const z = positions.getZ(index)
        if (x === 2 && z === 2) {
          raised.push(index)
          expect(positions.getY(index)).toBeCloseTo(4.005, 6)
          expect(covers(positions, index * 3 + 1)).toBe(true)
        }
        if (x === 3 && z === 2) {
          normalOnly.push(index)
          expect(positions.getY(index)).toBeCloseTo(0.005, 6)
          expect(normals.getX(index)).toBeCloseTo(2 / Math.sqrt(5), 6)
          expect(normals.getY(index)).toBeCloseTo(1 / Math.sqrt(5), 6)
          expect(covers(normals, index * 3)).toBe(true)
        }
        if (x >= 5 && z >= 5) {
          expect(positions.getY(index)).toBe(originalPositions[index * 3 + 1]!)
          expect(normals.getX(index)).toBe(originalNormals[index * 3]!)
          expect(covers(positions, index * 3 + 1)).toBe(false)
          expect(covers(normals, index * 3)).toBe(false)
        }
      }
      expect(raised.length).toBeGreaterThan(0)
      expect(normalOnly.length).toBeGreaterThan(0)
      const versions = [positions.version, normals.version]
      updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) }, a)
      expect([positions.version, normals.version]).toEqual(versions)
      const b = patch(4, 4, 2)
      updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(applyHeightPatch(next, b)) }, b)
      for (const index of raised) expect(covers(positions, index * 3 + 1)).toBe(true)
      updateGrassFieldTerrain(host, site)
      for (let index = 0; index < positions.count; index++) {
        expect(positions.getY(index)).toBeCloseTo(0.005, 6)
        expect(normals.getY(index)).toBeCloseTo(1, 6)
      }
    } finally { dispose(host) }
  })

  test('fractional boundary normals include support beyond the height interpolation cell', () => {
    const { site, host, ground } = mountedField(field(7, 7), [[-2, -2], [3.5, -2], [3.5, 8], [-2, 8]])
    try {
      const change = patch(2, 2, 4)
      const next = applyHeightPatch(field(7, 7), change)
      updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) }, change)
      const positions = ground.geometry.getAttribute('position') as BufferAttribute
      const normals = ground.geometry.getAttribute('normal') as BufferAttribute
      const matches = Array.from({ length: positions.count }, (_, index) => index)
        .filter((index) => positions.getX(index) === 3.5 && positions.getZ(index) === 2)
      expect(matches.length).toBeGreaterThan(0)
      for (const index of matches) {
        // Height is zero here, but the central difference samples height 2 at x=2.5.
        expect(positions.getY(index)).toBeCloseTo(0.005, 6)
        expect(normals.getX(index)).toBeCloseTo(1 / Math.sqrt(2), 6)
        expect(normals.getY(index)).toBeCloseTo(1 / Math.sqrt(2), 6)
        expect(normals.getZ(index)).toBeCloseTo(0, 6)
        expect(covers(positions, index * 3 + 1)).toBe(false)
        expect(covers(normals, index * 3)).toBe(true)
      }
    } finally { dispose(host) }
  })

  test('clamped outside-ground normals still sample the interior across a clipped edge', () => {
    const { site, host, ground } = mountedField(field(7, 7), [[-0.5, -2], [8, -2], [8, 8], [-0.5, 8]])
    try {
      const change: HeightPatch = { col0: -1, row0: 2, cols: 2, rows: 1, heights: new Int16Array([99, 4]) }
      const next = applyHeightPatch(field(7, 7), change)
      updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) }, change)
      const positions = ground.geometry.getAttribute('position')
      const normals = ground.geometry.getAttribute('normal')
      const matches = Array.from({ length: positions.count }, (_, index) => index)
        .filter((index) => positions.getX(index) === -0.5 && positions.getZ(index) === 2)
      expect(matches.length).toBeGreaterThan(0)
      for (const index of matches) {
        expect(positions.getY(index)).toBeCloseTo(4.005, 6)
        expect(normals.getX(index)).toBeCloseTo(1 / Math.sqrt(2), 6)
        expect(normals.getY(index)).toBeCloseTo(1 / Math.sqrt(2), 6)
        expect(normals.getZ(index)).toBeCloseTo(0, 6)
      }
    } finally { dispose(host) }
  })

  test('ground outside the terrain grid follows a clipped edge sample', () => {
    const { site, host, ground } = mountedField()
    try {
      const change: HeightPatch = { col0: -1, row0: 2, cols: 2, rows: 1, heights: new Int16Array([99, 4]) }
      const next = applyHeightPatch(field(7, 7), change)
      updateGrassFieldTerrain(host, { ...site, terrain: commitTerrainField(next) }, change)
      const positions = ground.geometry.getAttribute('position')
      const matches = Array.from({ length: positions.count }, (_, index) => index)
        .filter((index) => positions.getX(index) === -2 && positions.getZ(index) === 2)
      expect(matches.length).toBeGreaterThan(0)
      for (const index of matches) expect(positions.getY(index)).toBeCloseTo(4.005, 6)
    } finally { dispose(host) }
  })
})

describe('terrain patch acceptance: flowers', () => {
  test('updates only affected roots/batches, reuses resources, preserves ranges, and fully restores on cancel', () => {
    const group = createAnimatedFlowerBatches([
      { kind: 'daisy', position: [0.75, 0, 0.75], rotationY: 0, scale: 1 },
      { kind: 'daisy', position: [4.75, 0, 0.75], rotationY: 0, scale: 1 },
      { kind: 'cup', position: [12.25, 0, 0.25], rotationY: 0, scale: 1 },
    ], uniform(1), uniform(1))
    try {
      const near = group.getObjectByName('grass-field-flower-daisy') as InstancedMesh
      const far = group.getObjectByName('grass-field-flower-cup') as InstancedMesh
      const roots = near.geometry.getAttribute('flowerRoot') as BufferAttribute
      const farRoots = far.geometry.getAttribute('flowerRoot') as BufferAttribute
      const geometry = near.geometry
      const material = near.material
      const rootArray = roots.array
      const matrixArray = near.instanceMatrix.array
      const farVersions = [farRoots.version, far.instanceMatrix.version]
      const a = patch(1, 1, 4)
      const next = applyHeightPatch(field(), a)
      const observed = countedTerrain(next)
      expect(updateFlowerBatchTerrain(group, observed.terrain, a)).toBe(true)
      expect(roots.getY(0)).toBeCloseTo(2, 6)
      expect(roots.getY(1)).toBe(0)
      expect([farRoots.version, far.instanceMatrix.version]).toEqual(farVersions)
      expect(observed.reads.every((index) => index % observed.terrain.cols < 3)).toBe(true)
      const versions = [roots.version, near.instanceMatrix.version]
      updateFlowerBatchTerrain(group, next, a)
      expect([roots.version, near.instanceMatrix.version]).toEqual(versions)
      const b = patch(5, 1, 6)
      updateFlowerBatchTerrain(group, applyHeightPatch(next, b), b)
      expect(roots.getY(1)).toBeCloseTo(3, 6)
      for (const index of [0, 1]) {
        expect(covers(roots, index * 3 + 1)).toBe(true)
        expect(covers(near.instanceMatrix, index * 16 + 13)).toBe(true)
      }
      expect(near.geometry).toBe(geometry)
      expect(near.material).toBe(material)
      expect(roots.array).toBe(rootArray)
      expect(near.instanceMatrix.array).toBe(matrixArray)
      updateFlowerBatchTerrain(group, field())
      expect(roots.getY(0)).toBe(0)
      expect(roots.getY(1)).toBe(0)
    } finally { disposeFlowerBatches(group) }
  })

  test('a clipped edge patch includes clamped flowers outside the field', () => {
    const group = createAnimatedFlowerBatches([
      { kind: 'daisy', position: [-4, 0, 0.25], rotationY: 0, scale: 1 },
    ], uniform(1), uniform(1))
    try {
      const change: HeightPatch = { col0: -1, row0: 0, cols: 2, rows: 1, heights: new Int16Array([99, 4]) }
      updateFlowerBatchTerrain(group, applyHeightPatch(field(5, 5), change), change)
      const mesh = group.getObjectByName('grass-field-flower-daisy') as InstancedMesh
      expect(mesh.geometry.getAttribute('flowerRoot').getY(0)).toBeCloseTo(3, 6)
      expect(mesh.instanceMatrix.array[13]).toBeCloseTo(3, 6)
    } finally { disposeFlowerBatches(group) }
  })
})
