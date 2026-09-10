import { terrainFieldOf, type AnyNode, type SiteNode } from '@pascal-app/core'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import { resolveAssetUrl } from '@pascal-app/viewer'
import type { ViewerPresentationExportContext } from '@pascal-app/viewer'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import type { Material, Object3D } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { attribute, sRGBTransferOETF, texture, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  applyPlanarBakeUvs,
  bakeMaterialChannels,
  materialBakeBounds,
  planMaterialBakeSize,
} from '../export/material-baker'
import { bakeWaterMaterial } from '../export/water-material-bake'
import { POND_WATER_APPEARANCE } from '../pond/appearance'
import type { EnvironmentConfiguration } from '../presentation'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import { riverTerrainBaseline } from '../river/terrain'
import { loadPresentationAlbedos } from '../surface-material/materials'
import type { PresentationAlbedos } from '../surface-material/materials'
import { buildBoulderInstances } from './boulders'
import { buildSeaGeometry } from './coastal-sea-geometry'
import type { SeaGeometryBuffers } from './coastal-sea-geometry'
import {
  buildDistantBirdFlightPlan,
  createDistantBirdGeometry,
  DISTANT_BIRD_TRIANGLES,
  evaluateDistantBirdFlight,
  type DistantBirdPose,
} from './distant-birds'
import {
  deriveRoadPresentationAlignments,
  deriveSurroundingsLayout,
  deriveSurroundingsLevelTerrainDistance,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  type RoadPresentationAlignmentDescriptor,
  type SurroundingsCorridorDescriptor,
  type SurroundingsLayoutDescriptor,
} from './corridor'
import {
  buildExteriorTerrainSection,
  createExteriorTerrainSampler,
  createRenderedTerrainSampler,
  createTerrainSubdivisionSampler,
  deriveExteriorTerrainSectionAddresses,
  mergeExteriorTerrainSections,
  EXTERIOR_TERRAIN_GROUND_OFFSET,
  type ExteriorTerrainGeometry,
  type ExteriorTerrainSampler,
  type ExteriorTerrainSectionAddress,
} from './exterior-terrain'
import { deriveBoundarySegments, type BoundarySegment, type Point2 } from './frontages'
import { deriveHorizonFoliagePlan } from './horizon-foliage'
import { buildPascalHouseInstances } from './house-neighborhood'
import { deriveLandscapeRegion, type LandscapeRegion } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'
import {
  buildMailboxInstances,
  buildParkedCarInstances,
  buildPavingMeshes,
  buildShrubInstances,
  buildStreetLightInstances,
  buildFenceInstances,
} from './neighborhood-decoration-renderer'
import {
  deriveNeighborhoodDecorations,
  type CatalogPropPlan,
  type NeighborhoodDecorationPlan,
} from './neighborhood-decoration'
import { deriveHousePlans, deriveNeighborCellClassifications, type HousePlan } from './neighborhood'
import {
  deriveNaturalTreeRenderPlan,
  deriveNaturalVegetationPlan,
  type NaturalVegetationPlan,
} from './natural-vegetation'
import { seededRange } from './seeded-random'
import { visitNaturalGrassCandidates } from './natural-grass'
import { deriveOuterRoads } from './outer-roads'
import { getPresentationSurfaceTexture } from './presentation-material'
import { buildBridgeInstances } from './river-bridges-renderer'
import { createRiverBridges } from './river-bridges'
import { createRiverLandscape } from './river-landscape'
import type { RiverLandscape } from './river-landscape'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { buildTerrainRoadGeometry } from './terrain-road-geometry'
import {
  buildRoadPresentationPlan,
  type RoadPresentationPlan,
} from './streetscape-road-presentation'
import type { RoadNetworkNode } from './streetscape/schema'
import { deriveThirdRingPlan, type FieldPatch, type ThirdRingPlan } from './third-ring'
import { buildThirdRingInstances } from './third-ring-renderer'
import {
  DISTANT_TREE_TILE_SIZE,
  DISTANT_TREE_VARIANTS,
  DISTANT_TREE_VIEWS,
  getDistantTreeAtlas,
} from './distant-tree-atlas'
import type { HorizonFoliagePlan } from './horizon-foliage'
import { createBakedFlowerBatches } from '../ground-cover/render/flower-geometry'

const STATIC_ROOT_NAME = 'environment-static-surroundings'
const CATEGORY_NAMES = {
  terrain: 'environment-static-terrain',
  roads: 'environment-static-roads',
  structures: 'environment-static-structures',
  thirdRing: 'environment-static-third-ring',
  trees: 'environment-static-trees',
  naturalVegetation: 'environment-static-natural-vegetation',
  props: 'environment-static-props',
  bridges: 'environment-static-bridges',
  water: 'environment-static-water',
} as const
const MAX_TERRAIN_SECTIONS = 1_024
const MAX_EXPANDED_TRIANGLES = 5_000_000
const MAX_TEXTURE_TEXELS = 64 * 1024 * 1024
const STATIC_TERRAIN_PIXELS_PER_METRE = 4
const STATIC_WATER_PIXELS_PER_METRE = 4
const STATIC_WATER_SECTION_CHUNK_SIZE = 4
const UP = new Vector3(0, 1, 0)

const EMPTY_ROAD_PLAN: RoadPresentationPlan = {
  id: 'environment-streetscape-road-network',
  junctions: [],
  surfaces: [],
}
const EMPTY_DECORATION_PLAN: NeighborhoodDecorationPlan = {
  catalogProps: [],
  fences: [],
  streetLights: [],
  paving: [],
  mailboxes: [],
  trees: [],
}

type PresentedLayout = Readonly<{
  houses: readonly HousePlan[]
  road: RoadPresentationPlan
  decorations: NeighborhoodDecorationPlan
  corridors: readonly SurroundingsCorridorDescriptor[]
  outerRoads: readonly RoadPresentationAlignmentDescriptor[]
  nearRoads: readonly RoadPresentationAlignmentDescriptor[]
  levelTerrainDistance: number
  network: RoadNetworkNode | null
  contextLandscape: RiverLandscape | null
  outputLandscape: RiverLandscape | null
}>

type StaticCategories = {
  [Key in keyof typeof CATEGORY_NAMES]: Group
}

type TextureCloneState = Readonly<{
  textures: Map<Texture, Texture>
  materials: Map<string, Material>
}>

function createCategories(root: Group): StaticCategories {
  const categories = Object.fromEntries(
    Object.entries(CATEGORY_NAMES).map(([key, name]) => {
      const group = new Group()
      group.name = name
      root.add(group)
      return [key, group]
    }),
  ) as StaticCategories
  return categories
}

function finiteBoundary(boundary: readonly Point2[]): boolean {
  if (boundary.length < 3) return false
  let area = 0
  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!
    const next = boundary[(index + 1) % boundary.length]!
    if (!Number.isFinite(current[0]) || !Number.isFinite(current[1])) return false
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) > 1e-8
}

function selectedRivers(
  context: ViewerPresentationExportContext,
  site: SiteNode,
  forOutput: boolean,
): RiverNode[] {
  const excluded = new Set(context.excludedNodeTypes)
  const nodes: Readonly<Record<string, AnyNode | RiverNode>> = context.nodes
  const rivers: RiverNode[] = []
  for (const childId of site.children) {
    const child = nodes[childId]
    if (!child || child.type !== RIVER_KIND) continue
    if (
      forOutput &&
      (excluded.has(RIVER_KIND) || (context.onlyVisible && child.visible === false))
    ) {
      continue
    }
    rivers.push(child)
  }
  return rivers
}

function deriveLayout(
  context: ViewerPresentationExportContext,
  configuration: EnvironmentConfiguration,
  site: SiteNode,
  region: LandscapeRegion,
): PresentedLayout {
  const boundary = site.polygon.points as readonly Point2[]
  const policy =
    configuration.preset === 'regional'
      ? {
          suppressBuiltContext: false,
          levelTerrainDistance: null,
          reliefAmplitudeScale: 1,
        }
      : configuration.preset === 'open-meadow'
        ? {
            suppressBuiltContext: true,
            levelTerrainDistance: 58,
            reliefAmplitudeScale: 0.52,
          }
        : {
            suppressBuiltContext: true,
            levelTerrainDistance: 42,
            reliefAmplitudeScale: 0.88,
          }
  const allRivers = selectedRivers(context, site, false)
  const outputRivers = selectedRivers(context, site, true)

  if (policy.suppressBuiltContext) {
    const levelTerrainDistance = policy.levelTerrainDistance ?? 0
    const baseTerrain = createExteriorTerrainSampler({
      boundary,
      levelTerrainDistance,
      terrain: riverTerrainBaseline(site),
      seed: configuration.seed,
      region,
      reliefAmplitudeScale: policy.reliefAmplitudeScale,
    })
    return {
      houses: [],
      road: EMPTY_ROAD_PLAN,
      decorations: EMPTY_DECORATION_PLAN,
      corridors: [],
      outerRoads: [],
      nearRoads: [],
      levelTerrainDistance,
      network: null,
      contextLandscape: createRiverLandscape(site, allRivers, baseTerrain, region),
      outputLandscape: createRiverLandscape(site, outputRivers, baseTerrain, region),
    }
  }

  const segments: BoundarySegment[] = deriveBoundarySegments({
    points: boundary,
    contexts: configuration.frontages,
  })
  const surroundingsLayout: SurroundingsLayoutDescriptor = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    { seed: configuration.seed, depthVariation: 0.2 },
  )
  const levelTerrainDistance = deriveSurroundingsLevelTerrainDistance(
    segments,
    surroundingsLayout,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const baseTerrain = createExteriorTerrainSampler({
    boundary,
    levelTerrainDistance,
    terrain: riverTerrainBaseline(site),
    seed: configuration.seed,
    region,
  })
  const contextLandscape = createRiverLandscape(site, allRivers, baseTerrain, region)
  const outputLandscape = createRiverLandscape(site, outputRivers, baseTerrain, region)
  const outerRoads = deriveOuterRoads(surroundingsLayout, {
    seed: configuration.seed,
    heightAt: contextLandscape.sampler.heightAt,
  })
  const network = deriveRuntimeRoadNetwork(surroundingsLayout, outerRoads)
  const neighborCells = deriveNeighborCellClassifications(
    surroundingsLayout,
    network,
    configuration.seed,
  ).filter((cell) => !contextLandscape.intersectsFootprint(cell.polygon, 1.5))
  const houses = deriveHousePlans(neighborCells, configuration.seed)
  const road = buildRoadPresentationPlan(network)
  const derivedDecorations = deriveNeighborhoodDecorations(
    neighborCells,
    houses,
    surroundingsLayout.corridors,
    network,
    road,
    configuration.seed,
  )
  const decorations: NeighborhoodDecorationPlan = {
    ...derivedDecorations,
    catalogProps: derivedDecorations.catalogProps.filter(
      ({ position }) => contextLandscape.waterLevelAt(position[0], position[1]) === null,
    ),
    streetLights: derivedDecorations.streetLights.filter(
      ({ position }) => contextLandscape.waterLevelAt(position[0], position[1]) === null,
    ),
    trees: derivedDecorations.trees.filter(
      ({ position }) => contextLandscape.waterLevelAt(position[0], position[1]) === null,
    ),
    paving: derivedDecorations.paving.filter(
      ({ polygon }) => !contextLandscape.intersectsFootprint(polygon),
    ),
  }
  return {
    houses,
    road,
    decorations,
    corridors: surroundingsLayout.corridors,
    outerRoads,
    nearRoads: deriveRoadPresentationAlignments(surroundingsLayout),
    levelTerrainDistance,
    network,
    contextLandscape,
    outputLandscape,
  }
}

function cloneTexture(source: Texture, state: TextureCloneState): Texture {
  const cached = state.textures.get(source)
  if (cached) return cached
  const clone = source.clone()
  clone.name = source.name
  clone.needsUpdate = true
  state.textures.set(source, clone)
  return clone
}

function optionalTexture(
  source: Material & Record<string, unknown>,
  slot: string,
  state: TextureCloneState,
): Texture | null {
  const texture = source[slot]
  return texture instanceof Texture ? cloneTexture(texture, state) : null
}

function portableMaterial(
  source: Material,
  geometry: BufferGeometry,
  state: TextureCloneState,
): Material {
  const hasVertexColors = geometry.hasAttribute('color')
  const key = `${source.uuid}:${hasVertexColors ? 'colors' : 'plain'}`
  const cached = state.materials.get(key)
  if (cached) return cached
  const materialSource = source as Material & Record<string, unknown>
  const sourceColor =
    materialSource.color instanceof Color ? materialSource.color : new Color('#ffffff')
  const sourceEmissive =
    materialSource.emissive instanceof Color ? materialSource.emissive : new Color('#000000')
  const mapName = source.name.match(/^surroundings-(paint|roof|ground|facade|window-lit)$/)?.[1]
  const detailSurface =
    mapName === 'paint' || mapName === 'roof' || mapName === 'ground'
      ? mapName
      : mapName === 'facade' || mapName === 'window-lit'
        ? 'paint'
        : null
  const detailMap = detailSurface
    ? cloneTexture(getPresentationSurfaceTexture(detailSurface), state)
    : optionalTexture(materialSource, 'map', state)
  const standard = new MeshStandardMaterial({
    alphaMap: optionalTexture(materialSource, 'alphaMap', state),
    alphaTest: source.alphaTest,
    aoMap: optionalTexture(materialSource, 'aoMap', state),
    color: sourceColor,
    depthWrite: source.depthWrite,
    emissive: sourceEmissive,
    emissiveIntensity:
      typeof materialSource.emissiveIntensity === 'number' ? materialSource.emissiveIntensity : 1,
    map: detailMap,
    metalness: typeof materialSource.metalness === 'number' ? materialSource.metalness : 0,
    metalnessMap: optionalTexture(materialSource, 'metalnessMap', state),
    normalMap: optionalTexture(materialSource, 'normalMap', state),
    opacity: source.opacity,
    roughness: typeof materialSource.roughness === 'number' ? materialSource.roughness : 0.9,
    roughnessMap: optionalTexture(materialSource, 'roughnessMap', state),
    side: source.side,
    transparent: source.transparent,
    vertexColors: hasVertexColors,
  })
  standard.name = source.name || 'environment-static-standard-material'
  const sourceNormalScale = materialSource.normalScale
  if (sourceNormalScale instanceof Vector2) standard.normalScale.copy(sourceNormalScale)
  state.materials.set(key, standard)
  return standard
}

function portableizeRoot(root: Group, state: TextureCloneState): Group {
  const replaced = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const previous = Array.isArray(object.material) ? object.material : [object.material]
    const next = previous.map((material) => portableMaterial(material, object.geometry, state))
    object.material = Array.isArray(object.material) ? next : next[0]!
    object.geometry.deleteAttribute('facadeSize')
    for (const material of previous) replaced.add(material)
  })
  for (const material of replaced) material.dispose()
  return root
}

async function meshFromExteriorTerrain(
  terrain: ExteriorTerrainGeometry,
  fields: readonly FieldPatch[],
  region: LandscapeRegion,
  albedos: PresentationAlbedos,
): Promise<Mesh> {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(terrain.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(terrain.normals, 3))
  geometry.setIndex(new BufferAttribute(terrain.indices, 1))
  const colors = new Float32Array((terrain.positions.length / 3) * 3)
  const uvs = new Float32Array((terrain.positions.length / 3) * 2)
  const color = new Color()
  const grass = new Color(region.palette.grass)
  const stone = new Color(region.palette.stone)
  const sand = new Color(region.palette.sand)
  const wheat = new Color('#bba152')
  for (let vertex = 0; vertex < terrain.positions.length / 3; vertex += 1) {
    const offset = vertex * 3
    const x = terrain.positions[offset]!
    const y = terrain.positions[offset + 1]!
    const z = terrain.positions[offset + 2]!
    const normalY = Math.abs(terrain.normals[offset + 1]!)
    color.copy(grass)
    const shore =
      region.coast || region.river ? 1 - smoothstep(SEA_LEVEL + 0.5, SEA_LEVEL + 2.5, y) : 0
    const rock = Math.max(smoothstep(0.12, 0.42, 1 - normalY), smoothstep(45, 120, y) * 0.65)
    color.lerp(stone, rock)
    color.lerp(sand, shore)
    const field = fieldAt(fields, x, z)
    if (field?.kind === 'wheat') color.lerp(wheat, 0.78)
    else if (field?.kind === 'woodland') color.multiplyScalar(0.88)
    else if (field?.kind === 'meadow') color.multiplyScalar(0.94)
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
    uvs[vertex * 2] = x * 0.5
    uvs[vertex * 2 + 1] = z * 0.5
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  const detailMap = albedos.grass
  const bounds = materialBakeBounds(geometry)
  const size = planMaterialBakeSize(
    bounds,
    STATIC_TERRAIN_PIXELS_PER_METRE,
    { maxEdge: 8192 },
  )
  const detail = texture(detailMap)
  const intrinsicColor = attribute<'vec3'>('color', 'vec3')
  const encodedColor = sRGBTransferOETF(detail.rgb.mul(intrinsicColor)) as Node<'vec3'>
  const baked = await bakeMaterialChannels({
    geometry,
    bounds,
    size,
    channels: [{
      name: 'environment-static-regional-terrain-base-coverage',
      colorSpace: SRGBColorSpace,
      outputNode: vec4(encodedColor, detail.a),
    }],
  })
  const base = baked.channels.get('environment-static-regional-terrain-base-coverage')
  if (!base) {
    for (const channel of baked.channels.values()) channel.texture.dispose()
    geometry.dispose()
    throw new Error('Regional terrain material bake omitted its base-coverage channel')
  }
  applyPlanarBakeUvs(geometry, bounds)
  geometry.deleteAttribute('color')
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    map: base.texture,
    metalness: 0,
    roughness: 0.96,
    vertexColors: false,
  })
  material.name = 'environment-static-regional-terrain-material'
  const mesh = new Mesh(geometry, material)
  mesh.name = 'environment-static-exterior-ground'
  mesh.position.y = EXTERIOR_TERRAIN_GROUND_OFFSET
  return mesh
}

function fieldAt(fields: readonly FieldPatch[], x: number, z: number): FieldPatch | undefined {
  for (const field of fields) {
    const cosine = Math.cos(field.rotationY)
    const sine = Math.sin(field.rotationY)
    const dx = x - field.center[0]
    const dz = z - field.center[1]
    const localX = dx * cosine - dz * sine
    const localZ = dx * sine + dz * cosine
    if (Math.abs(localX) <= field.width / 2 && Math.abs(localZ) <= field.depth / 2) {
      return field
    }
  }
  return undefined
}

function smoothstep(start: number, end: number, value: number): number {
  if (start === end) return value < start ? 0 : 1
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return amount * amount * (3 - 2 * amount)
}

function buildRoads(
  plan: RoadPresentationPlan,
  terrain: ExteriorTerrainSampler,
  bridgeHeightAt: ((x: number, z: number) => number) | undefined,
  state: TextureCloneState,
): Group {
  const root = new Group()
  root.name = CATEGORY_NAMES.roads
  for (const [index, surface] of plan.surfaces.entries()) {
    const buffers = buildTerrainRoadGeometry(
      surface.geometry.positions,
      surface.geometry.indices,
      terrain.heightAt,
      undefined,
      { terrain, bridgeHeightAt },
    )
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3))
    if (surface.material === 'standard') {
      const uvs = new Float32Array((buffers.positions.length / 3) * 2)
      for (let vertex = 0; vertex < buffers.positions.length / 3; vertex += 1) {
        uvs[vertex * 2] = buffers.positions[vertex * 3]! * 0.83
        uvs[vertex * 2 + 1] = buffers.positions[vertex * 3 + 2]! * 0.83
      }
      geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
    }
    geometry.setIndex(new BufferAttribute(buffers.indices, 1))
    const material = new MeshStandardMaterial({
      color: surface.color,
      map:
        surface.material === 'standard'
          ? cloneTexture(getPresentationSurfaceTexture('ground'), state)
          : null,
      depthWrite: surface.depthWrite,
      metalness: surface.metalness,
      roughness: surface.roughness,
      side: surface.doubleSided ? DoubleSide : FrontSide,
      vertexColors: false,
    })
    material.name = `environment-static-road-${surface.material}`
    const mesh = new Mesh(geometry, material)
    mesh.name = `environment-static-road-surface-${index}`
    root.add(mesh)
  }
  return root
}

function buildPortableNaturalGrass(
  plan: NaturalVegetationPlan,
  boundary: readonly Point2[],
  heightAt: (x: number, z: number) => number,
  waterLevelAt: (x: number, z: number) => number | null,
): Group {
  const root = new Group()
  root.name = 'environment-static-natural-grass'
  const patches = plan.tiles.flatMap((tile) => tile.lowVegetation)
  const context = { boundary, heightAt, waterLevelAt, patches, presetId: plan.presetId }
  let bladeCount = 0
  visitNaturalGrassCandidates(context, (_x, _y, _z, _yaw, _width, _height, density) => {
    if (density <= 0.92) bladeCount += 1
  })
  if (bladeCount === 0) {
    root.userData = { bladeCount: 0 }
    return root
  }
  const bladePositions = [
    -0.625, 0, 0, 0.625, 0, 0, -0.375, 0.333, 0, 0.375, 0.333, 0, -0.167, 0.667, 0, 0.167, 0.667, 0,
    0, 1, 0, 0, 0, -0.625, 0, 0, 0.625, 0, 0.333, -0.375, 0, 0.333, 0.375, 0, 0.667, -0.167, 0,
    0.667, 0.167, 0, 1, 0,
  ] as const
  const bladeIndices = [
    0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 7, 8, 9, 8, 10, 9, 9, 10, 11, 10, 12, 11, 11, 12,
    13,
  ] as const
  const verticesPerBlade = bladePositions.length / 3
  const positions = new Float32Array(bladeCount * bladePositions.length)
  const colors = new Float32Array(bladeCount * bladePositions.length)
  const indices = new Uint32Array(bladeCount * bladeIndices.length)
  const base = new Color(plan.presetId === 'woodland-edge' ? '#38583a' : '#688343')
  const tip = new Color(plan.presetId === 'woodland-edge' ? '#78905a' : '#a4b965')
  const vertexColor = new Color()
  const restBend = plan.presetId === 'woodland-edge' ? 0.32 : 0.22
  let bladeIndex = 0
  visitNaturalGrassCandidates(context, (x, y, z, yaw, widthFactor, heightFactor, density, tint) => {
    if (density > 0.92) return
    const width = 0.042 * widthFactor
    const height = 0.3 * heightFactor
    const cosine = Math.cos(yaw)
    const sine = Math.sin(yaw)
    const tintScale = Math.max(0.82, Math.min(1.12, 1 + tint * 0.1))
    for (let vertex = 0; vertex < verticesPerBlade; vertex += 1) {
      const sourceOffset = vertex * 3
      const localX = bladePositions[sourceOffset]! * width
      const progress = bladePositions[sourceOffset + 1]!
      const localZ = bladePositions[sourceOffset + 2]! * width
      const straightHeight = progress * height
      const bendAngle = restBend * progress
      const curvedHorizontal =
        bendAngle > 1e-5 ? (straightHeight * (1 - Math.cos(bendAngle))) / bendAngle : 0
      const curvedHeight =
        bendAngle > 1e-5 ? (straightHeight * Math.sin(bendAngle)) / bendAngle : straightHeight
      const outputOffset = (bladeIndex * verticesPerBlade + vertex) * 3
      positions[outputOffset] = x + cosine * localX + sine * localZ + sine * curvedHorizontal
      positions[outputOffset + 1] = y + curvedHeight
      positions[outputOffset + 2] = z - sine * localX + cosine * localZ + cosine * curvedHorizontal
      const tipMix = smoothstep(0.12, 0.92, progress)
      const rootShade = 0.78 + (1 - 0.78) * progress ** 0.65
      vertexColor
        .copy(base)
        .lerp(tip, tipMix)
        .multiplyScalar(tintScale * rootShade)
      colors[outputOffset] = vertexColor.r
      colors[outputOffset + 1] = vertexColor.g
      colors[outputOffset + 2] = vertexColor.b
    }
    for (let index = 0; index < bladeIndices.length; index += 1) {
      indices[bladeIndex * bladeIndices.length + index] =
        bladeIndex * verticesPerBlade + bladeIndices[index]!
    }
    bladeIndex += 1
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  })
  material.name = 'environment-static-natural-grass-material'
  const mesh = new Mesh(geometry, material)
  mesh.name = 'environment-static-natural-grass-blades'
  root.add(mesh)
  root.userData = { bladeCount }
  return root
}

function portableDistantTreeGeometry(variant: number): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const tileU = variant / DISTANT_TREE_VARIANTS
  const uScale = (DISTANT_TREE_TILE_SIZE - 1) / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VARIANTS)
  const vScale = (DISTANT_TREE_TILE_SIZE - 1) / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VIEWS)
  const uInset = 0.5 / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VARIANTS)
  const vInset = 0.5 / (DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VIEWS)
  for (let view = 0; view < DISTANT_TREE_VIEWS; view += 1) {
    const angle = (view * Math.PI) / 2
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const start = positions.length / 3
    for (const [localX, localY, u, v] of [
      [-0.425, 0, 0, 0],
      [0.425, 0, 1, 0],
      [-0.425, 1, 0, 1],
      [0.425, 1, 1, 1],
    ] as const) {
      positions.push(localX * cosine, localY, -localX * sine)
      uvs.push(tileU + uInset + u * uScale, view / DISTANT_TREE_VIEWS + vInset + v * vScale)
    }
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildPortableDistantTrees(
  plans: readonly HorizonFoliagePlan[],
  state: TextureCloneState,
): Group {
  const root = new Group()
  root.name = 'environment-static-distant-trees'
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const tint = new Color()
  const buckets = Array.from({ length: DISTANT_TREE_VARIANTS }, (): HorizonFoliagePlan[] => [])
  for (const pine of [false, true]) {
    const atlas = getDistantTreeAtlas(pine)
    const map = cloneTexture(atlas.color, state)
    const normalMap = cloneTexture(atlas.normal, state)
    for (const bucket of buckets) bucket.length = 0
    for (const plan of plans) {
      if ((plan.species === 'pine') !== pine) continue
      const domain = `${plan.position[0]}:${plan.position[2]}`
      const variant = Math.floor(
        seededRange(plan.id, `${domain}:atlas-variant`, 0, DISTANT_TREE_VARIANTS),
      )
      buckets[variant]!.push(plan)
    }
    for (let variant = 0; variant < DISTANT_TREE_VARIANTS; variant += 1) {
      const placements = buckets[variant]!
      if (placements.length === 0) continue
      const geometry = portableDistantTreeGeometry(variant)
      const material = new MeshStandardMaterial({
        alphaTest: 0.4,
        color: '#ffffff',
        map,
        normalMap,
        normalScale: new Vector2(1, 1),
        roughness: 1,
        side: FrontSide,
        transparent: false,
      })
      material.name = `environment-static-distant-tree-${pine ? 'pine' : 'deciduous'}`
      const mesh = new InstancedMesh(geometry, material, placements.length)
      mesh.name = `environment-static-distant-tree-${pine ? 'pine' : 'deciduous'}-${variant}`
      for (const [index, plan] of placements.entries()) {
        const domain = `${plan.position[0]}:${plan.position[2]}`
        const widthScale = seededRange(plan.id, `${domain}:width-scale`, 0.86, 1.14)
        mesh.setMatrixAt(
          index,
          matrix.compose(
            position.fromArray(plan.position),
            rotation.setFromAxisAngle(UP, plan.rotationY),
            scale.set(plan.height * widthScale, plan.height, plan.height * widthScale),
          ),
        )
        mesh.setColorAt(index, tint.set(plan.leafColor))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      root.add(mesh)
    }
  }
  root.userData = { treeCount: plans.length }
  return root
}

function buildPortableDistantBirds(
  boundary: readonly Point2[],
  heightAt: (x: number, z: number) => number,
  seed: string,
): Mesh {
  const plan = buildDistantBirdFlightPlan({ boundary, heightAt, seed })
  const template = createDistantBirdGeometry()
  const base = template.getAttribute('position')
  const raised = template.morphAttributes.position?.[0]
  if (!raised || raised.itemSize !== 3) {
    template.dispose()
    throw new Error('[Environment] Static distant birds require the production wing morph')
  }

  const positions = new Float32Array(plan.birds.length * base.count * 3)
  const point = new Vector3()
  const wingDelta = new Vector3()
  const position = new Vector3()
  const rotation = new Euler(0, 0, 0, 'YXZ')
  const orientation = new Quaternion()
  const scale = new Vector3()
  const pose: DistantBirdPose = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    wingLift: 0.5,
    scale: 1,
  }
  const matrix = new Matrix4()
  let offset = 0
  for (const bird of plan.birds) {
    evaluateDistantBirdFlight(bird, 0, pose)
    position.fromArray(pose.position)
    rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], 'YXZ')
    orientation.setFromEuler(rotation)
    scale.setScalar(pose.scale)
    matrix.compose(position, orientation, scale)
    for (let index = 0; index < base.count; index += 1) {
      point.fromBufferAttribute(base, index)
      wingDelta.fromBufferAttribute(raised, index)
      point.addScaledVector(wingDelta, pose.wingLift).applyMatrix4(matrix)
      positions[offset++] = point.x
      positions[offset++] = point.y
      positions[offset++] = point.z
    }
  }
  template.dispose()

  const geometry = new BufferGeometry()
  geometry.name = 'environment-static-distant-birds-geometry'
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = new MeshStandardMaterial({
    color: '#354047',
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  })
  material.name = 'environment-static-distant-birds-material'
  const mesh = new Mesh(geometry, material)
  mesh.name = 'environment-static-distant-birds'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData = {
    birdCount: plan.birds.length,
    trianglesPerBird: DISTANT_BIRD_TRIANGLES,
    visibleTriangleCount: plan.birds.length * DISTANT_BIRD_TRIANGLES,
    phaseSeconds: 0,
    frozenWingPose: true,
    cameraDependent: false,
  }
  return mesh
}

async function buildCatalogProps(
  plans: readonly CatalogPropPlan[],
  heightAt: (x: number, z: number) => number,
  state: TextureCloneState,
): Promise<Group> {
  const root = new Group()
  root.name = 'environment-static-catalog-props'
  const hydrants = plans.filter(({ assetId }) => assetId === 'hydrant')
  if (hydrants.length === 0) return root
  const asset = CATALOG_ITEMS.find(({ id }) => id === 'hydrant')
  if (!asset)
    throw new Error('[Environment] Static surroundings catalog asset "hydrant" is unavailable')
  const url = await resolveAssetUrl(asset.src)
  if (!url)
    throw new Error('[Environment] Static surroundings could not resolve catalog asset "hydrant"')
  const draco = new DRACOLoader()
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/')
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  try {
    const gltf = await loader.loadAsync(url)
    gltf.scene.updateMatrixWorld(true)
    const assetTransform = new Matrix4().compose(
      new Vector3(...(asset.offset ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(asset.rotation ?? [0, 0, 0]))),
      new Vector3(...(asset.scale ?? [1, 1, 1])),
    )
    const placement = new Matrix4()
    const combined = new Matrix4()
    const position = new Vector3()
    const scale = new Vector3()
    const rotation = new Quaternion()
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      const portable = materials.map((material) =>
        portableMaterial(material, object.geometry, state),
      )
      const instances = new InstancedMesh(
        object.geometry.clone(),
        Array.isArray(object.material) ? portable : portable[0]!,
        hydrants.length,
      )
      instances.name = 'environment-static-catalog-hydrant'
      for (const [index, plan] of hydrants.entries()) {
        placement.compose(
          position.set(
            plan.position[0],
            heightAt(plan.position[0], plan.position[1]),
            plan.position[1],
          ),
          rotation.setFromAxisAngle(UP, plan.rotationY),
          scale.setScalar(plan.scale),
        )
        combined.copy(placement).multiply(assetTransform).multiply(object.matrixWorld)
        instances.setMatrixAt(index, combined)
      }
      instances.instanceMatrix.needsUpdate = true
      root.add(instances)
    })
    disposeGeneratedObject(gltf.scene)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    throw new Error(`[Environment] Static surroundings asset "hydrant" failed to load: ${message}`)
  } finally {
    draco.dispose()
  }
  return root
}

async function buildTrees(
  nearPlans: NeighborhoodDecorationPlan['trees'],
  horizonPlans: readonly HorizonFoliagePlan[],
  distantPlans: readonly HorizonFoliagePlan[],
  naturalPlan: NaturalVegetationPlan | null,
  boundary: readonly Point2[],
  heightAt: (x: number, z: number) => number,
  state: TextureCloneState,
): Promise<Group> {
  const root = new Group()
  root.name = CATEGORY_NAMES.trees
  // @pascal-app/tree performs browser-only image work, so keep it out of the server module graph.
  const treeModule = await import('./neighborhood-trees')
  if (naturalPlan) {
    const naturalTrees = deriveNaturalTreeRenderPlan(naturalPlan, boundary)
    root.add(portableizeRoot(treeModule.buildTreeInstances(naturalTrees.detailed, heightAt), state))
    root.add(buildPortableDistantTrees(naturalTrees.distant, state))
  } else {
    root.add(
      portableizeRoot(
        treeModule.buildTreeInstances(nearPlans, heightAt, new Group(), horizonPlans),
        state,
      ),
    )
    root.add(buildPortableDistantTrees(distantPlans, state))
  }
  return root
}

function disposeGeneratedObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of objectMaterials) {
      materials.add(material)
      const source = material as Material & Record<string, unknown>
      for (const slot of [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'aoMap',
        'alphaMap',
      ]) {
        const texture = source[slot]
        if (texture instanceof Texture) textures.add(texture)
      }
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}

function buildDecorationProps(
  plan: NeighborhoodDecorationPlan,
  heightAt: (x: number, z: number) => number,
  state: TextureCloneState,
): Group {
  const root = new Group()
  root.name = CATEGORY_NAMES.props
  root.add(buildShrubInstances(plan.catalogProps, heightAt))
  root.add(buildParkedCarInstances(plan.catalogProps, heightAt))
  root.add(buildFenceInstances(plan.fences, heightAt))
  const streetLights = buildStreetLightInstances(plan.streetLights, heightAt)
  const lightPool = streetLights.getObjectByName('streetscape-roadway-led-ground-pool-instances')
  if (lightPool) streetLights.remove(lightPool)
  root.add(streetLights)
  root.add(buildPavingMeshes(plan.paving, heightAt))
  root.add(buildMailboxInstances(plan.mailboxes, heightAt))
  const portable = portableizeRoot(root, state)
  if (lightPool) disposeGeneratedObject(lightPool)
  return portable
}

async function buildPortableWater(
  seas: readonly SeaGeometryBuffers[],
  landscape: RiverLandscape | null,
  waterColor: string,
): Promise<Group> {
  const root = new Group()
  root.name = 'environment-static-water-surfaces'
  const bakeRecords: Array<
    Readonly<{
      name: string
      backend: 'webgpu' | 'webgl2'
      width: number
      height: number
      pixelsPerMetre: number
      tileSize: number
      phaseSeconds: number
    }>
  > = []

  for (const [index, sea] of seas.entries()) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(sea.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(sea.normals, 3))
    geometry.setAttribute('waterDepth', new BufferAttribute(sea.depths, 1))
    geometry.setIndex(new BufferAttribute(sea.indices, 1))
    const name = `environment-static-coastal-sea-${index + 1}`
    const baked = await bakeWaterMaterial(
      geometry,
      {
        name,
        color: waterColor,
        depthRange: [0.15, 9],
        roughness: 0.28,
        shoreRoughness: 0.8,
        rippleStrength: 1,
        foamStrength: 1,
      },
      { pixelsPerMetre: STATIC_WATER_PIXELS_PER_METRE },
    )
    const mesh = new Mesh(geometry, baked.material)
    mesh.name = name
    root.add(mesh)
    bakeRecords.push({
      name,
      backend: baked.backend,
      width: baked.width,
      height: baked.height,
      pixelsPerMetre: baked.pixelsPerMeter,
      tileSize: baked.tileSize,
      phaseSeconds: baked.phaseSeconds,
    })
  }

  for (const batch of landscape?.waters ?? []) {
    const appearance = POND_WATER_APPEARANCE[batch.quality]
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(batch.geometry.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(batch.geometry.normals, 3))
    geometry.setAttribute('waterDepth', new BufferAttribute(batch.geometry.waterDepths, 1))
    geometry.setAttribute('waterFlow', new BufferAttribute(batch.geometry.waterFlows, 2))
    geometry.setAttribute('waterCourse', new BufferAttribute(batch.geometry.waterCourses, 2))
    geometry.setAttribute('shoreDistance', new BufferAttribute(batch.geometry.shoreDistances, 1))
    geometry.setIndex(new BufferAttribute(batch.geometry.indices, 1))
    const name = `environment-static-river-water-${batch.quality}`
    const baked = await bakeWaterMaterial(
      geometry,
      {
        name,
        color: appearance.shallowColor,
        deepColor: appearance.deepColor,
        foamColor: appearance.foamColor,
        foamStrength: appearance.foamStrength,
        flow: { speed: batch.flowSpeed, direction: batch.flowDirection },
        depthRange: appearance.depthRange,
        roughness: appearance.roughness,
        shoreRoughness: appearance.shoreRoughness,
        rippleStrength: appearance.rippleStrength,
        waveScale: appearance.waveScale,
        speedScale: appearance.speedScale,
        shoreFade: [0.72, appearance.shoreAbsorptionDepth],
        opacity: appearance.opacity,
      },
      { pixelsPerMetre: STATIC_WATER_PIXELS_PER_METRE },
    )
    const mesh = new Mesh(geometry, baked.material)
    mesh.name = name
    root.add(mesh)
    bakeRecords.push({
      name,
      backend: baked.backend,
      width: baked.width,
      height: baked.height,
      pixelsPerMetre: baked.pixelsPerMeter,
      tileSize: baked.tileSize,
      phaseSeconds: baked.phaseSeconds,
    })
  }
  root.userData = { materialBakes: bakeRecords }
  return root
}

function countObjects(group: Group): number {
  let count = 0
  group.traverse((object) => {
    if (object instanceof Mesh) count += object instanceof InstancedMesh ? object.count : 1
  })
  return count
}

function attachStaticExportManifest(
  root: Group,
  categories: StaticCategories,
  configuration: EnvironmentConfiguration,
  terrainSectionCount: number,
): void {
  root.userData.staticExport = {
    schemaVersion: 1,
    providerId: 'pascal:environment',
    presetId: configuration.preset,
    seed: configuration.seed,
    terrainSectionCount,
    resourceProfile: {
      maxTerrainSections: MAX_TERRAIN_SECTIONS,
      maxExpandedTriangles: MAX_EXPANDED_TRIANGLES,
      maxTextureTexels: MAX_TEXTURE_TEXELS,
      waterPixelsPerMetre: STATIC_WATER_PIXELS_PER_METRE,
      waterSectionChunkSize: STATIC_WATER_SECTION_CHUNK_SIZE,
    },
    categories: Object.fromEntries(
      Object.entries(categories).map(([id, group]) => [
        id,
        { name: group.name, objectCount: countObjects(group) },
      ]),
    ),
  }
}
function assertResourceLimits(root: Group): void {
  let expandedTriangles = 0
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const triangles =
      (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3
    expandedTriangles += triangles * (object instanceof InstancedMesh ? object.count : 1)
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      const source = material as Material & Record<string, unknown>
      for (const slot of [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'aoMap',
        'alphaMap',
      ]) {
        const texture = source[slot]
        if (texture instanceof Texture) textures.add(texture)
      }
    }
  })
  if (expandedTriangles > MAX_EXPANDED_TRIANGLES) {
    const message =
      `[Environment] Static surroundings require ${Math.ceil(expandedTriangles).toLocaleString()} triangles; ` +
      `portable limit is ${MAX_EXPANDED_TRIANGLES.toLocaleString()}`
    disposeGeneratedObject(root)
    throw new Error(message)
  }
  let texels = 0
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | undefined
    if (image?.width && image.height) texels += image.width * image.height
  }
  if (texels > MAX_TEXTURE_TEXELS) {
    const message =
      `[Environment] Static surroundings require ${texels.toLocaleString()} texture texels; ` +
      `portable limit is ${MAX_TEXTURE_TEXELS.toLocaleString()}`
    disposeGeneratedObject(root)
    throw new Error(message)
  }
}

export async function buildStaticSurroundings(
  context: ViewerPresentationExportContext,
  configuration: EnvironmentConfiguration,
  birdsEnabled: boolean,
): Promise<Group | null> {
  if (!configuration.visibility.surroundings) return null
  if (context.excludedNodeTypes.includes('site')) return null
  const root = new Group()
  root.name = STATIC_ROOT_NAME
  const categories = createCategories(root)
  const site = Object.values(context.nodes).find((node): node is SiteNode => node?.type === 'site')
  if (!site) {
    attachStaticExportManifest(root, categories, configuration, 0)
    return root
  }
  if (context.onlyVisible && site.visible === false) return null
  const boundary = site.polygon.points as readonly Point2[]
  if (!finiteBoundary(boundary)) {
    throw new Error(
      '[Environment] Static surroundings require a finite, non-degenerate Site boundary',
    )
  }
  const state: TextureCloneState = { textures: new Map(), materials: new Map() }
  const regional = deriveLandscapeRegion(configuration.seed)
  const region =
    configuration.preset === 'regional'
      ? regional
      : { ...regional, kind: 'foothills' as const, coast: null, river: null }
  const layout = deriveLayout(context, configuration, site, region)
  const sections = deriveExteriorTerrainSectionAddresses(boundary)
  if (sections.length > MAX_TERRAIN_SECTIONS) {
    throw new Error(
      `[Environment] Static surroundings require ${sections.length} terrain sections; portable limit is ${MAX_TERRAIN_SECTIONS}`,
    )
  }
  const outputLandscape = layout.outputLandscape
  const sourceTerrain =
    outputLandscape?.sampler ??
    createExteriorTerrainSampler({
      boundary,
      levelTerrainDistance: layout.levelTerrainDistance,
      terrain: terrainFieldOf(site),
      seed: configuration.seed,
      region,
      reliefAmplitudeScale:
        configuration.preset === 'open-meadow'
          ? 0.52
          : configuration.preset === 'woodland-edge'
            ? 0.88
            : 1,
    })
  const renderedTerrain = createRenderedTerrainSampler(
    createTerrainSubdivisionSampler(sourceTerrain, boundary),
    sections,
  )
  const contextLandscape = layout.contextLandscape
  const waterLevelAt = (x: number, z: number) =>
    contextLandscape?.waterLevelAt(x, z) ??
    (renderedTerrain.heightAt(x, z) < SEA_LEVEL ? SEA_LEVEL : null)
  const bridges = layout.network
    ? createRiverBridges(
        layout.network,
        renderedTerrain,
        (x, z) =>
          outputLandscape?.waterLevelAt(x, z) ??
          (renderedTerrain.heightAt(x, z) < SEA_LEVEL ? SEA_LEVEL : null),
      )
    : { heightAt: renderedTerrain.heightAt, spans: [] }
  const thirdRing: ThirdRingPlan =
    configuration.preset === 'regional'
      ? deriveThirdRingPlan({
          boundary,
          roads: layout.outerRoads,
          nearRoads: layout.nearRoads,
          exclusions: [
            ...layout.houses.map((house) => house.footprint),
            ...(contextLandscape?.exclusions ?? []),
          ],
          heightAt: renderedTerrain.heightAt,
          seed: configuration.seed,
        })
      : {
          buildings: [],
          commercialSites: [],
          skyline: [],
          trees: [],
          fields: [],
          region,
          boulders: [],
          lighthouse: null,
        }

  let albedos: PresentationAlbedos
  try {
    albedos = await loadPresentationAlbedos()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    throw new Error(`[Environment] Static surroundings albedo assets failed to load: ${message}`)
  }
  const terrainGeometry = mergeExteriorTerrainSections(
    sections.map((address) => buildExteriorTerrainSection(address, renderedTerrain, boundary)),
  )
  categories.terrain.add(
    await meshFromExteriorTerrain(terrainGeometry, thirdRing.fields, region, albedos),
  )

  const roadRoot = buildRoads(
    layout.road,
    renderedTerrain,
    bridges.spans.length ? bridges.heightAt : undefined,
    state,
  )
  categories.roads.add(...roadRoot.children)
  categories.structures.add(
    portableizeRoot(buildPascalHouseInstances(layout.houses, renderedTerrain.heightAt), state),
  )
  categories.thirdRing.add(
    portableizeRoot(buildThirdRingInstances(thirdRing), state),
    portableizeRoot(buildBoulderInstances(thirdRing.boulders), state),
  )
  categories.bridges.add(portableizeRoot(buildBridgeInstances(bridges.spans), state))

  const horizonPlans =
    configuration.preset === 'regional'
      ? deriveHorizonFoliagePlan({
          boundary,
          corridors: layout.corridors,
          roads: layout.outerRoads,
          nearRoads: layout.nearRoads,
          heightAt: renderedTerrain.heightAt,
          levelTerrainDistance: layout.levelTerrainDistance,
          seed: configuration.seed,
        }).filter(({ position }) => waterLevelAt(position[0], position[2]) === null)
      : []
  const naturalPlan =
    configuration.preset === 'regional'
      ? null
      : deriveNaturalVegetationPlan({
          boundary,
          seed: configuration.seed,
          presetId: configuration.preset,
          heightAt: renderedTerrain.heightAt,
          waterLevelAt,
          foliageColors: region.palette.foliage,
        })
  categories.trees.add(
    await buildTrees(
      layout.decorations.trees,
      horizonPlans,
      thirdRing.trees,
      naturalPlan,
      boundary,
      renderedTerrain.heightAt,
      state,
    ),
  )
  if (naturalPlan) {
    const grass = buildPortableNaturalGrass(
      naturalPlan,
      boundary,
      renderedTerrain.heightAt,
      waterLevelAt,
    )
    const flowers = naturalPlan.tiles.flatMap((tile) => tile.flowers)
    const flowerRoot = createBakedFlowerBatches(flowers)
    flowerRoot.name = 'environment-static-natural-flowers'
    categories.naturalVegetation.add(grass, flowerRoot)
    categories.naturalVegetation.userData = {
      bladeCount: grass.userData.bladeCount,
      flowerCount: naturalPlan.flowerCount,
      retainedPopulation: (grass.userData.bladeCount as number) + naturalPlan.flowerCount,
    }
  }

  categories.props.add(buildDecorationProps(layout.decorations, renderedTerrain.heightAt, state))
  categories.props.add(
    await buildCatalogProps(layout.decorations.catalogProps, renderedTerrain.heightAt, state),
  )
  if (birdsEnabled) {
    categories.props.add(
      buildPortableDistantBirds(boundary, renderedTerrain.heightAt, configuration.seed),
    )
  }
  const seaSectionChunks = new Map<string, ExteriorTerrainSectionAddress[]>()
  for (const section of sections) {
    const chunkX = Math.floor(section.x / STATIC_WATER_SECTION_CHUNK_SIZE)
    const chunkZ = Math.floor(section.z / STATIC_WATER_SECTION_CHUNK_SIZE)
    const key = `${chunkX}:${chunkZ}`
    const chunk = seaSectionChunks.get(key)
    if (chunk) chunk.push(section)
    else seaSectionChunks.set(key, [section])
  }
  const seas = Array.from(seaSectionChunks.values())
    .map((chunk) =>
      buildSeaGeometry(chunk, renderedTerrain, boundary, region.coast, {
        includeOffshoreApron: false,
      }),
    )
    .filter(({ indices }) => indices.length > 0)
  const water = await buildPortableWater(seas, outputLandscape, region.palette.water)
  water.userData = {
    ...water.userData,
    coastalTriangleCount: seas.reduce((sum, sea) => sum + sea.indices.length / 3, 0),
    riverTriangleCount: outputLandscape?.triangleCount ?? 0,
  }
  categories.water.add(water)

  attachStaticExportManifest(root, categories, configuration, sections.length)
  assertResourceLimits(root)
  return root
}
