import { expect, test } from 'bun:test'
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from 'three'
import * as TSL from 'three/tsl'
import { MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu'
import { buildBladeGeometry } from './blade-geometry'
import {
  createGrassBladePosition,
  createGrassBladeShading,
} from './blade-nodes'

// Three's builder declarations omit these runtime compilation fields.
type ShaderBuilder = WGSLNodeBuilder & {
  camera: PerspectiveCamera
  scene: Scene
  build(): unknown
  vertexShader: string
  fragmentShader: string
  nodes: Set<{ value?: unknown; method?: string }>
}

// Only the synchronous NodeBuilder contract: no canvas, GPU, or provider calls.
function createRendererFixture() {
  return {
    contextNode: TSL.context({}),
    library: {
      fromMaterial: (material: MeshBasicNodeMaterial) => material,
    },
    backend: {
      capabilities: { getUniformBufferLimit: () => 65536 },
      compatibilityMode: false,
    },
    debug: { diagnostics: { keywords: false } },
    lighting: { enabled: false },
    depth: false,
    currentSamples: 1,
    getRenderTarget: () => null,
    getMRT: () => null,
    hasFeature: () => false,
  } as unknown as ConstructorParameters<typeof WGSLNodeBuilder>[1]
}

function buildTerrainShader(
  terrainNormal: Vector3,
  withObstacle = false,
) {
  const geometry = buildBladeGeometry({ width: 0.6, height: 2 })
  const root = new Vector3(3, 7, -2)
  geometry.setAttribute(
    'grassRoot',
    new InstancedBufferAttribute(new Float32Array(root.toArray()), 3),
  )
  geometry.setAttribute(
    'grassSurfaceSampleBasis',
    new InstancedBufferAttribute(new Float32Array([0, 0]), 2),
  )
  geometry.setAttribute(
    'grassTerrainNormal',
    new InstancedBufferAttribute(new Float32Array(terrainNormal.toArray()), 3),
  )

  const material = new MeshBasicNodeMaterial()
  material.positionNode = createGrassBladePosition({
    heightScale: TSL.uniform(0.45),
    restBend: TSL.uniform(0.22),
    windStrength: TSL.uniform(0.8),
    windInfluence: TSL.uniform(1),
    ...(withObstacle
      ? {
          obstacleInfluence: TSL.uniform(0.6),
          obstacleDirection: TSL.uniform(new Vector3(0.8, 0, 0.6)),
          obstacleBendStrength: TSL.uniform(0.3),
        }
      : {}),
  })
  const shading = createGrassBladeShading(TSL.float(0.25))
  material.normalNode = shading.normal
  material.fragmentNode = TSL.vec4(
    shading.normal.mul(0.5).add(0.5).add(shading.transmission)
      .mul(shading.rootShade),
    1,
  )

  const mesh = new InstancedMesh(geometry, material, 1)
  mesh.setMatrixAt(
    0,
    new Matrix4().compose(
      root,
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), terrainNormal),
      new Vector3(0.2, 0.7, 0.2),
    ),
  )
  const builder = new WGSLNodeBuilder(
    mesh,
    createRendererFixture(),
  ) as ShaderBuilder
  builder.camera = new PerspectiveCamera()
  builder.scene = new Scene()
  try {
    builder.build()
    return builder
  } finally {
    geometry.dispose()
    material.dispose()
  }
}

for (const [label, normal] of [
  ['flat', new Vector3(0, 1, 0)],
  ['sloped', new Vector3(0.4, 1, -0.3).normalize()],
] as const) {
  test(`${label} blades build real WGSL with a normalized terrain frame`, () => {
    const builder = buildTerrainShader(normal)
    const shader = builder.vertexShader ?? ''

    expect(shader).toContain('@vertex')
    expect(shader).toContain('grassTerrainNormal')
    expect(shader).toContain('grassRoot')
    expect(shader).toContain('grassSurfaceSampleBasis')
    expect(shader).toMatch(/normalize\(\s*grassTerrainNormal\s*\)/)
    expect(shader).toContain('dot(')
    expect(shader).toContain('sin(')
    expect(shader).toContain('cos(')
    expect(shader).not.toMatch(/\b(?:NaN|Infinity|undefined)\b/)
    expect(builder.fragmentShader).toContain('@fragment')
    // The zero sample basis still receives the existing rest-direction epsilon.
    expect(
      [...builder.nodes].some(
        (node) =>
          'value' in node && node.value === 1e-6,
      ),
    ).toBe(true)
  })
}

test('obstacle displacement adds a terrain-tangent projection to the WGSL graph', () => {
  const normal = new Vector3(0.4, 1, -0.3).normalize()
  const baseline = buildTerrainShader(normal)
  const obstacle = buildTerrainShader(normal, true)
  const countDots = (builder: ShaderBuilder) =>
    [...builder.nodes].filter(
      (node) => 'method' in node && node.method === 'dot',
    ).length

  expect(countDots(obstacle)).toBeGreaterThan(countDots(baseline))
  expect(obstacle.vertexShader).toContain('grassTerrainNormal')
  expect(obstacle.vertexShader).not.toMatch(/\b(?:NaN|Infinity|undefined)\b/)
})
