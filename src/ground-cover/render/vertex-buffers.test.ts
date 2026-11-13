import { type GeometryContext, SiteNode } from '@pascal-app/core'
import { expect, test } from 'bun:test'
import { type BufferGeometry, InstancedMesh, type Material, type Object3D, PerspectiveCamera, Scene } from 'three'
import * as TSL from 'three/tsl'
import { WGSLNodeBuilder } from 'three/webgpu'
import { buildGrassFieldGeometry } from '../geometry'
import { GrassFieldNode } from '../schema'

/**
 * WebGPU adapters may bind no more than `maxVertexBuffers` vertex buffers to a render pipeline,
 * and the limit every adapter must offer, which Apple's Metal adapters offer and no more, is 8.
 * A pipeline over it is refused ("Vertex buffer count (9) exceeds the maximum number of vertex
 * buffers (8)") and the blades are not drawn at all.
 */
const WEBGPU_MAX_VERTEX_BUFFERS = 8

type BuiltAttribute = { name: string; node?: { attribute?: object } }
type ShaderBuilder = WGSLNodeBuilder & {
  camera: PerspectiveCamera
  scene: Scene
  build(): unknown
  getAttributesArray(): BuiltAttribute[]
}

/**
 * The synchronous NodeBuilder contract only: no canvas, no GPU. The host this stands for is the
 * worst case three allows: more instances than a uniform buffer holds, so the instance matrices
 * are a vertex buffer, and a velocity target in the frame, so last frame's matrices are another.
 */
function rendererFixture() {
  return {
    contextNode: TSL.context({}),
    library: { fromMaterial: (material: Material) => material },
    backend: {
      capabilities: { getUniformBufferLimit: () => 0 },
      compatibilityMode: false,
      utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
    },
    debug: { diagnostics: { keywords: false } },
    lighting: { enabled: false },
    depth: false,
    currentSamples: 1,
    getRenderTarget: () => null,
    getMRT: () => ({ has: (name: string) => name === 'velocity' }),
    hasFeature: () => false,
  } as unknown as ConstructorParameters<typeof WGSLNodeBuilder>[1]
}

/** The vertex buffers three binds for a mesh: as `RenderObject.getAttributes` groups them. */
function vertexBuffersOf(mesh: InstancedMesh): { buffers: Set<object>; names: string[] } {
  const builder = new WGSLNodeBuilder(mesh, rendererFixture()) as ShaderBuilder
  builder.camera = new PerspectiveCamera()
  builder.scene = new Scene()
  builder.build()
  const geometry = mesh.geometry as BufferGeometry
  const buffers = new Set<object>()
  const names: string[] = []
  for (const built of builder.getAttributesArray()) {
    const attribute = (built.node?.attribute ?? geometry.getAttribute(built.name)) as
      | { isInterleavedBufferAttribute?: boolean; data?: object }
      | undefined
    if (!attribute) continue
    names.push(built.name)
    buffers.add(attribute.isInterleavedBufferAttribute && attribute.data ? attribute.data : attribute)
  }
  return { buffers, names }
}

const context: GeometryContext = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: SiteNode.parse({
    id: 'site_buffers',
    type: 'site',
    polygon: { type: 'polygon', points: [[0, 0], [2, 0], [2, 2], [0, 2]] },
  }),
}

function instancedMeshes(root: Object3D): InstancedMesh[] {
  const meshes: InstancedMesh[] = []
  root.traverse((object) => {
    if (object instanceof InstancedMesh) meshes.push(object)
  })
  return meshes
}

test('every lawn pipeline fits the vertex buffers a WebGPU adapter must offer', () => {
  const lawn = buildGrassFieldGeometry(GrassFieldNode.parse({ flowerDensity: 40 }), context)
  const meshes = instancedMeshes(lawn)
  const blades = meshes.filter((mesh) => mesh.name === 'grass-field-blade')
  // Full, mid and far blades of a tile share the tile's instance data.
  expect(blades.length).toBeGreaterThanOrEqual(3)
  expect(meshes.length).toBeGreaterThan(blades.length)

  for (const mesh of meshes) {
    const { buffers, names } = vertexBuffersOf(mesh)
    expect(names.length, mesh.name).toBeGreaterThan(0)
    expect(
      buffers.size,
      `${mesh.name || 'mesh'} binds ${buffers.size} vertex buffers for ${names.join(', ')}`,
    ).toBeLessThanOrEqual(WEBGPU_MAX_VERTEX_BUFFERS)
  }
})

test('a blade reads every per-instance value it read before', () => {
  const lawn = buildGrassFieldGeometry(GrassFieldNode.parse({}), context)
  const blade = instancedMeshes(lawn).find((mesh) => mesh.name === 'grass-field-blade')
  if (!blade) throw new Error('no blades')
  const { names } = vertexBuffersOf(blade)
  for (const name of [
    'position', 'normal', 'grassRoot', 'grassTerrainNormal', 'grassDensityThreshold',
    'grassTintVariation', 'grassSurfaceSampleBasis',
  ]) {
    expect(names).toContain(name)
  }
})
