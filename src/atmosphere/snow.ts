import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  type UniformNode,
} from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { WeatherSettings } from '../store'

const SNOW_GRID_SIZE = 16
const FLAKES_PER_CELL = 5
const FLAKE_COUNT = SNOW_GRID_SIZE * SNOW_GRID_SIZE * FLAKES_PER_CELL
const SNOW_CELL_SIZE = 2
const SNOW_RADIUS = (SNOW_GRID_SIZE * SNOW_CELL_SIZE) / 2
const SNOW_EDGE_FADE = 3
const SNOW_HEIGHT = 20
const NO_RAYCAST = () => undefined

type SnowUniforms = {
  intensity: UniformNode<'float', number>
  wind: UniformNode<'float', number>
}

export type SnowFieldResources = {
  mesh: InstancedMesh
  uniforms: SnowUniforms
}

function createFlakeGeometry(): BufferGeometry {
  const radius = 0.045
  const positions = new Float32Array([
    -radius,
    -radius,
    0,
    radius,
    -radius,
    0,
    radius,
    radius,
    0,
    -radius,
    -radius,
    0,
    radius,
    radius,
    0,
    -radius,
    radius,
    0,
    0,
    -radius,
    -radius,
    0,
    -radius,
    radius,
    0,
    radius,
    radius,
    0,
    -radius,
    -radius,
    0,
    radius,
    radius,
    0,
    radius,
    -radius,
    -radius,
    0,
    -radius,
    radius,
    0,
    -radius,
    radius,
    0,
    radius,
    -radius,
    0,
    -radius,
    radius,
    0,
    radius,
    -radius,
    0,
    radius,
  ])
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0,
    1, 1, 0, 1,
  ])
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}

export function createSnowFieldResources(
  settings: Pick<WeatherSettings, 'snow' | 'wind'>,
): SnowFieldResources {
  const intensity = TSL.uniform(settings.snow)
  const wind = TSL.uniform(settings.wind)
  const instance = TSL.float(TSL.instanceIndex)
  const cellInstance = TSL.floor(instance.div(FLAKES_PER_CELL))
  const slot = instance.sub(cellInstance.mul(FLAKES_PER_CELL))
  const latticeZ = TSL.floor(cellInstance.div(SNOW_GRID_SIZE))
  const latticeX = cellInstance.sub(latticeZ.mul(SNOW_GRID_SIZE))
  const cameraCellX = TSL.floor(TSL.cameraPosition.x.div(SNOW_CELL_SIZE))
  const cameraCellZ = TSL.floor(TSL.cameraPosition.z.div(SNOW_CELL_SIZE))
  const cellX = cameraCellX.add(latticeX).sub(SNOW_GRID_SIZE / 2)
  const cellZ = cameraCellZ.add(latticeZ).sub(SNOW_GRID_SIZE / 2)

  const unsignedCellX = TSL.abs(cellX).mul(2).add(TSL.step(0.5, cellX.negate()))
  const unsignedCellZ = TSL.abs(cellZ).mul(2).add(TSL.step(0.5, cellZ.negate()))
  const seed = TSL.hash(
    TSL.hash(unsignedCellX.add(0.5))
      .mul(4093)
      .add(TSL.hash(unsignedCellZ.add(1.5)).mul(131071))
      .add(slot.mul(8191)),
  )
  const offsetX = TSL.hash(seed.mul(65521).add(17))
  const offsetZ = TSL.hash(seed.mul(65521).add(43))
  const worldX = cellX.mul(SNOW_CELL_SIZE).add(offsetX.mul(SNOW_CELL_SIZE))
  const worldZ = cellZ.mul(SNOW_CELL_SIZE).add(offsetZ.mul(SNOW_CELL_SIZE))

  const fallSpeed = TSL.mix(0.58, 1.05, TSL.hash(seed.mul(65521).add(71)))
  const unwrappedY = TSL.hash(seed.mul(65521).add(97)).mul(SNOW_HEIGHT).sub(TSL.time.mul(fallSpeed))
  const windowTop = TSL.cameraPosition.y.add(SNOW_HEIGHT * 0.55)
  const wrappedY = unwrappedY.add(
    TSL.floor(windowTop.sub(unwrappedY).div(SNOW_HEIGHT)).mul(SNOW_HEIGHT),
  )

  const driftPhase = TSL.time
    .mul(TSL.mix(0.34, 0.52, TSL.hash(seed.mul(65521).add(127))))
    .add(TSL.hash(seed.mul(65521).add(151)).mul(Math.PI * 2))
  const driftStrength = wind.mul(TSL.mix(0.14, 0.38, TSL.hash(seed.mul(65521).add(179))))
  const driftX = TSL.sin(driftPhase).mul(driftStrength)
  const driftZ = TSL.sin(
    driftPhase.mul(0.73).add(TSL.hash(seed.mul(65521).add(211)).mul(Math.PI * 2)),
  ).mul(driftStrength.mul(0.35))
  const flakeX = worldX.add(driftX)
  const flakeZ = worldZ.add(driftZ)
  const scale = TSL.mix(0.65, 1.3, TSL.hash(seed.mul(65521).add(239)))
  const local = TSL.positionGeometry.mul(scale)

  const material = new MeshBasicNodeMaterial({
    depthWrite: false,
    fog: true,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
  })
  material.name = 'environment-snow-material'
  material.colorNode = TSL.vec3(0.9, 0.95, 1)
  const visible = TSL.step(TSL.hash(seed.mul(65521).add(263)), intensity)
  const radial = TSL.uv().sub(0.5).length()
  const softness = TSL.float(1).sub(TSL.smoothstep(0.12, 0.5, radial))
  const edgeDistance = TSL.max(
    TSL.abs(flakeX.sub(TSL.cameraPosition.x)),
    TSL.abs(flakeZ.sub(TSL.cameraPosition.z)),
  )
  const edgeFade = TSL.float(1).sub(
    TSL.smoothstep(SNOW_RADIUS - SNOW_EDGE_FADE, SNOW_RADIUS, edgeDistance),
  )
  const opacity = softness.mul(visible).mul(edgeFade).mul(intensity.mul(0.38).add(0.12))
  material.opacityNode = opacity
  material.maskNode = opacity.greaterThan(0.01)
  material.positionNode = TSL.vec3(flakeX.add(local.x), wrappedY.add(local.y), flakeZ.add(local.z))

  const mesh = new InstancedMesh(createFlakeGeometry(), material, FLAKE_COUNT)
  mesh.name = 'environment-world-snow'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.raycast = NO_RAYCAST
  mesh.userData = {
    pascalExport: 'strip',
    flakeCapacity: FLAKE_COUNT,
    snowRadius: SNOW_RADIUS,
    snowHeight: SNOW_HEIGHT,
  }
  return { mesh, uniforms: { intensity, wind } }
}

export function disposeSnowFieldResources(resources: SnowFieldResources): void {
  resources.mesh.dispose()
  resources.mesh.geometry.dispose()
  const material = resources.mesh.material
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose()
  } else {
    material.dispose()
  }
}
