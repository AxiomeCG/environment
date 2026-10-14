import { createTerrainField, encodeTerrainField, SiteNode, surfaceHeightAt, useLiveTerrain, useScene } from '@pascal-app/core'
import type { TerrainField } from '@pascal-app/core'
import type { AnyNode } from '@pascal-app/core'
import * as PascalViewer from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { Fragment, StrictMode } from 'react'
import { CanvasTexture, DataTexture, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import type { BufferAttribute, InstancedMesh } from 'three'
import { useEnvironmentStore } from '../store'
import * as SurfaceMaterials from '../surface-material/materials'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from '../surface-material/field'
import { SurfaceMaterialNode } from '../surface-material/schema'
import * as MaterialBaker from '../export/material-baker'
import { exportEnvironmentConfiguration } from '../presentation-configuration'

const originalDocument = globalThis.document
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElementNS: () => ({
      addEventListener() {},
      removeEventListener() {},
      set src(_value: string) {},
    }),
  } as unknown as Document,
  writable: true,
})
const neighborhoodTreeModule = await import('./neighborhood-trees')
if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
else Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: originalDocument,
  writable: true,
})

mock.module('@pascal-app/viewer', () => ({
  ...PascalViewer,
  useGLTFKTX2: () => ({ scene: new Group() }),
}))
mock.module('./neighborhood-trees', () => ({
  ...neighborhoodTreeModule,
  NeighborhoodTrees: () => null,
}))

// Bun must register the viewer/tree mocks before evaluating the layer module.

const OBJECT3D_ADD_ERROR = 'THREE.Object3D.add: object not an instance of THREE.Object3D. undefined'
let restoreAlbedos: () => void

function loweredBoundarySite() {
  const terrain = createTerrainField({ origin: [-16, -16], spacing: 0.5, cols: 65, rows: 65, step: 0.01 })
  for (let row = 0; row < terrain.rows; row += 1) terrain.heights[row * terrain.cols + 62] = -200
  const site = SiteNode.parse({
    polygon: { type: 'polygon', points: [[-15, -15], [15, -15], [15, 15], [-15, 15]] },
    terrain: encodeTerrainField(terrain),
  })
  return { site, terrain }
}

function expectEastBoundaryJoin(ground: Mesh, terrain: TerrainField): void {
  const positions = ground.geometry.getAttribute('position')
  const indices = ground.geometry.getIndex()
  if (!indices) throw new Error('Expected indexed exterior geometry')
  let boundaryVertices = 0
  for (const index of new Set(indices.array)) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    if (Math.abs(x - 15) > 1e-6 || Math.abs(z) > 15 + 1e-6) continue
    boundaryVertices += 1
    expect(Math.abs(positions.getY(index) + ground.position.y - surfaceHeightAt(terrain, x, z)))
      .toBeLessThan(0.03) // The skirt spans the existing 0.02 m render offset.
  }
  expect(boundaryVertices).toBeGreaterThan(0)
}

beforeEach(() => {
  useLiveTerrain.getState().endAll()
  // Test the scene lifecycle with decoded textures, not browser image loading.
  const albedo = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  const loader = spyOn(SurfaceMaterials, 'loadPresentationAlbedos')
    .mockResolvedValue({ grass: albedo, sand: albedo, soil: albedo, paved: albedo })
  restoreAlbedos = () => { loader.mockRestore(); albedo.dispose() }
  const site = SiteNode.parse({ id: 'site_surroundings_test' })
  useScene.setState({
    nodes: { [site.id]: site },
    rootNodeIds: [site.id],
  })
  useEnvironmentStore.setState({
    frontageContexts: {},
    surroundingsEnabled: true,
    surroundingsPreset: 'regional',
  })
})

afterEach(() => {
  useLiveTerrain.getState().endAll()
  restoreAlbedos()
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  useEnvironmentStore.setState({ frontageContexts: {}, surroundingsEnabled: true, surroundingsPreset: 'regional' })
})

describe('Surroundings presentation layer', () => {
  test('open-meadow runtime joins the lowered authoritative lot boundary', async () => {
    const { site, terrain } = loweredBoundarySite()
    useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
    useEnvironmentStore.setState({ surroundingsPreset: 'open-meadow' })
    const { default: SurroundingsLayer } = await import('./layer')
    const renderer = await create(<SurroundingsLayer groundReplacementComponent={Fragment} />)
    try {
      const ground = renderer.scene.findByProps({ name: 'environment-exterior-ground' }).instance
      if (!(ground instanceof Mesh)) throw new Error('Expected runtime exterior mesh')
      expectEastBoundaryJoin(ground, terrain)
    } finally { await renderer.unmount() }
  })

  test('open-meadow portable export joins the lowered authoritative lot boundary', async () => {
    const { site, terrain } = loweredBoundarySite()
    // Only GPU material baking is stubbed; the exported sampler and geometry are real.
    const bake = spyOn(MaterialBaker, 'bakeMaterialChannels').mockImplementation(async ({ channels }) => ({
      width: 1,
      height: 1,
      backend: 'webgpu',
      channels: new Map(channels.map((channel) => [channel.name, {
        name: channel.name,
        texture: new CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement),
        pixels: new Uint8ClampedArray(4),
      }])),
    }))
    const { buildStaticSurroundings } = await import('./static-export')
    const configuration = { ...exportEnvironmentConfiguration(), preset: 'open-meadow' as const }
    let root: Group | null = null
    try {
      root = await buildStaticSurroundings({
        nodes: { [site.id]: site }, configuration: null, onlyVisible: true, excludedNodeTypes: [],
      }, configuration, false)
      const ground = root?.getObjectByName('environment-static-exterior-ground')
      if (!(ground instanceof Mesh)) throw new Error('Expected exported exterior mesh')
      expectEastBoundaryJoin(ground, terrain)
    } finally {
      bake.mockRestore()
      root?.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
      })
    }
  })

  test('mounts the initial roadless scene slot without adding an undefined Object3D', async () => {
    const consoleError = mock(() => {})
    const originalConsoleError = console.error
    console.error = consoleError

    try {
      const { default: SurroundingsLayer } = await import('./layer')
      const renderer = await create(
        <group name="viewer-scene-slot">
          <SurroundingsLayer groundReplacementComponent={Fragment} />
        </group>,
      )
      await renderer.unmount()
    } finally {
      console.error = originalConsoleError
    }

    const object3DErrors = consoleError.mock.calls.filter((args) =>
      args.map(String).join(' ').includes(OBJECT3D_ADD_ERROR))
    expect(object3DErrors).toEqual([])
  })

  test('renders houses and batches the outer road ring', async () => {
    const { default: SurroundingsLayer } = await import('./layer')
    const renderer = await create(
      <StrictMode>
        <SurroundingsLayer groundReplacementComponent={Fragment} />
      </StrictMode>,
    )

    await act(async () => {
      useEnvironmentStore.setState({
        frontageContexts: {
          2: { separator: 'secondary-road', access: 'none' },
        },
      })
    })

    try {
      const roads = renderer.scene.findByProps({
        name: 'environment-streetscape-roads',
      }).instance
      expect(roads.userData.sourceSurfaceCount).toBeGreaterThan(50)
      expect(roads.userData.drawCallCount).toBeLessThan(
        roads.userData.sourceSurfaceCount,
      )
      expect(roads.children).toHaveLength(roads.userData.drawCallCount)
      const houses = renderer.scene.find(
        ({ instance }) => instance.name === 'surroundings-house-neighborhood',
      ).instance
      expect(houses.userData.houseCount).toBeGreaterThan(0)
      expect(houses.children.length).toBeGreaterThan(0)
    } finally {
      await renderer.unmount()
    }
  })

  test('keeps the lot padding drawn during the first live Terrain mount and cancellation', async () => {
    const boundary = [
      [-15, -15],
      [15, -15],
      [15, 15],
      [-15, 15],
    ] as const
    const liveTerrain = createTerrainField({
      cols: 65,
      origin: [-16, -16],
      rows: 65,
      spacing: 0.5,
      step: 0.01,
    })
    const site = SiteNode.parse({
      id: 'site_surroundings_live_terrain_footprint',
      children: [],
      polygon: { type: 'polygon', points: boundary },
    })
    useScene.setState({
      nodes: { [site.id]: site },
      rootNodeIds: [site.id],
    })

    const { default: SurroundingsLayer } = await import('./layer')
    const renderer = await create(
      <SurroundingsLayer groundReplacementComponent={Fragment} />,
    )
    const probeMaterial = new MeshBasicMaterial()
    const exteriorHitAt = (x: number) => {
      const ground = renderer.scene.findByProps({
        name: 'environment-exterior-ground',
      }).instance as Mesh
      const probe = new Mesh(ground.geometry, probeMaterial)
      probe.updateMatrixWorld()
      const ray = new Raycaster(new Vector3(x, 100, 0), new Vector3(0, -1, 0))
      return ray.intersectObject(probe, false)[0]
    }
    try {
      expect(exteriorHitAt(15.5)).toBeDefined()

      await act(async () => {
        useLiveTerrain.getState().begin(site.id, liveTerrain)
      })
      expect(exteriorHitAt(15.5)).toBeDefined()
      expect(exteriorHitAt(16.01)).toBeDefined()

      await act(async () => {
        useLiveTerrain.getState().end(site.id)
      })
      expect(exteriorHitAt(15.5)).toBeDefined()
    } finally {
      useLiveTerrain.getState().end(site.id)
      probeMaterial.dispose()
      await renderer.unmount()
    }
  })

  test('keeps terrain buffers and neighborhood instances stable across property paint and theme edits', async () => {
    const surfaceId = 'surface-material_surroundings_transition'
    const site = SiteNode.parse({
      id: 'site_surroundings_transition',
      children: [surfaceId],
    })
    const field = createSurfaceMaterialField({
      minX: -20,
      maxX: 20,
      minZ: -20,
      maxZ: 20,
    })
    const surface = SurfaceMaterialNode.parse({
      id: surfaceId,
      parentId: site.id,
      paintMap: encodeSurfaceMaterialField(field),
    })
    useScene.setState({
      nodes: {
        [site.id]: site,
        [surface.id]: surface as unknown as AnyNode,
      },
      rootNodeIds: [site.id],
    })

    const { default: SurroundingsLayer } = await import('./layer')
    const renderer = await create(
      <SurroundingsLayer groundReplacementComponent={Fragment} />,
    )
    const previousTheme = PascalViewer.useViewer.getState().sceneTheme
    await act(async () => {
      await Promise.resolve()
    })
    try {
      const ground = renderer.scene.findByProps({
        name: 'environment-exterior-ground',
      }).instance as Mesh
      const geometry = ground.geometry
      const material = ground.material
      const houses = renderer.scene.find(
        ({ instance }) => instance.name === 'surroundings-house-neighborhood',
      ).instance as Group
      const houseBatches = [...houses.children]
      const houseMatrixVersions = houseBatches.map(
        (batch) => (batch as InstancedMesh).instanceMatrix.version,
      )
      const groundPosition = geometry.getAttribute('position') as BufferAttribute
      const groundPositionVersion = groundPosition.version

      field.values.fill(255)
      const updatedSurface = SurfaceMaterialNode.parse({
        ...surface,
        textureSize: 125,
        paintMap: encodeSurfaceMaterialField(field),
      })
      await act(async () => {
        useScene.setState((state) => ({
          nodes: {
            ...state.nodes,
            [updatedSurface.id]: updatedSurface as unknown as AnyNode,
          },
        }))
      })
      await act(async () => {
        PascalViewer.useViewer.getState().setSceneTheme(
          previousTheme === 'paper' ? 'studio' : 'paper',
        )
      })

      expect(renderer.scene.findByProps({
        name: 'environment-exterior-ground',
      }).instance).toBe(ground)
      expect(ground.geometry).toBe(geometry)
      expect(ground.material).toBe(material)
      expect(houses.children).toEqual(houseBatches)
      expect(
        houses.children.map(
          (batch) => (batch as InstancedMesh).instanceMatrix.version,
        ),
      ).toEqual(houseMatrixVersions)
      expect(geometry.getAttribute('position')).toBe(groundPosition)
      expect(groundPosition.version).toBe(groundPositionVersion)
    } finally {
      await act(async () => {
        PascalViewer.useViewer.getState().setSceneTheme(previousTheme)
      })
      await renderer.unmount()
    }
  })

  test('releases replaced ground buffers while retaining the scene object', async () => {
    const { default: SurroundingsLayer } = await import('./layer')
    const previousSeed = useEnvironmentStore.getState().surroundingsSeed
    const renderer = await create(<SurroundingsLayer groundReplacementComponent={Fragment} />)
    const currentGeometryDisposed = mock(() => {})
    const materialDisposed = mock(() => {})
    try {
      await act(async () => {
        useEnvironmentStore.setState({ frontageContexts: {
          0: { separator: 'secondary-road', access: 'none' },
          2: { separator: 'primary-road', access: 'none' },
        } })
      })
      const ground = renderer.scene.findByProps({ name: 'environment-exterior-ground' }).instance as Mesh
      const geometry = ground.geometry
      const disposed = mock(() => {})
      geometry.addEventListener('dispose', disposed)
      await act(async () => { useEnvironmentStore.setState({ surroundingsSeed: 'surface-buffer-replacement' }) })
      expect(renderer.scene.findByProps({ name: 'environment-exterior-ground' }).instance).toBe(ground)
      expect(ground.geometry).not.toBe(geometry)
      expect(disposed).toHaveBeenCalledTimes(1)
      ground.geometry.addEventListener('dispose', currentGeometryDisposed)
      const material = Array.isArray(ground.material) ? ground.material[0]! : ground.material
      material.addEventListener('dispose', materialDisposed)
    } finally {
      await renderer.unmount()
      useEnvironmentStore.setState({ surroundingsSeed: previousSeed })
    }
    expect(currentGeometryDisposed).toHaveBeenCalledTimes(1)
    expect(materialDisposed).toHaveBeenCalledTimes(1)
  })
})
