import {
  BlockNode,
  BuildingNode,
  createBoxBlockTopology,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  quantize,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import type { SiteNode as SiteNodeValue, TerrainField } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'
import { DEFAULT_SKY_SETTINGS, SKY_PRESETS } from '../atmosphere/settings'
import type { SkySettings } from '../atmosphere/settings'
import { resetThunderAudioSession } from '../atmosphere/weather-audio'
import { DEFAULT_GRASS_BLADE_HEIGHT, GrassFieldNode } from '../ground-cover/schema'
import { createGrassHeightField } from '../ground-cover/height-field'
import {
  createGrassPaintField,
  encodeGrassPaintField,
  rgbToHex,
  siteBounds,
} from '../ground-cover/paint-field'
import { DEFAULT_PAINT_STROKE_SETTINGS } from '../ground-cover/paint-stroke'
import { analyzePondBasin } from '../pond/basin'
import type { PondBasin } from '../pond/basin'
import { PondNode } from '../pond/schema'
import type { PondProp, WaterQuality } from '../pond/schema'
import {
  ENVIRONMENT_CONFIGURATION_VERSION,
  EnvironmentConfigurationSchema,
  importEnvironmentConfiguration,
} from '../presentation-configuration'
import type { EnvironmentConfiguration } from '../presentation-configuration'
import { clearRiverAuthoring } from '../river/store'
import { RiverNode } from '../river/schema'
import type { RiverOutlet, RiverSource } from '../river/schema'
import { rebuildRiverTerrain } from '../river/terrain'
import { useEnvironmentStore } from '../store'
import { deriveLandscapeRegion } from '../surroundings/landscape-region'
import type { FrontageContexts } from '../surroundings/frontages'
import {
  DEFAULT_SURFACE_MATERIAL,
  SURFACE_MATERIAL_PAINT_COLOR,
} from '../surface-material/material-types'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from '../surface-material/field'
import { SurfaceMaterialNode } from '../surface-material/schema'
import { getEnvironmentLabCase } from './catalog'
import type { EnvironmentLabCamera, EnvironmentLabCase } from './catalog'

export type EnvironmentLabFixture = {
  scene: SceneGraph
  configuration: EnvironmentConfiguration
  camera: EnvironmentLabCamera
}

type TerrainKind = 'flat' | 'surface' | 'bowl' | 'mixed' | 'regional' | 'combined'
type BuildPlan = {
  terrain: TerrainKind
  surface?: boolean
  grass?: boolean
  pond?: boolean
  river?: boolean
  structure?: boolean
}

type LabMarker = {
  version: 1
  caseId: string
  variantId: string
}

const STANDARD_BOUNDARY = [
  [0, 0],
  [16, 0],
  [16, 16],
  [0, 16],
] as const
const BOWL_BOUNDARY = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
] as const
const CONCAVE_BOUNDARY = [
  [0, 0],
  [32, 0],
  [32, 18],
  [24, 18],
  [24, 32],
  [0, 32],
] as const
const COASTAL_SEED = 'pascal-suburbs'
const INLAND_SEED = 'environment-lab-8'
const NIGHT_SEED = 'environment-lab-night-2295'

function selectionFor(
  caseId: string,
  variantId?: string,
): { labCase: EnvironmentLabCase; variantId: string } {
  const labCase = getEnvironmentLabCase(caseId)
  if (!labCase) throw new RangeError(`Unknown Environment lab case: ${caseId}`)
  const resolved = variantId ?? labCase.variants[0]?.id
  if (!resolved || !labCase.variants.some((variant) => variant.id === resolved)) {
    throw new RangeError(
      `Unknown variant "${String(variantId)}" for Environment lab case "${caseId}"`,
    )
  }
  return { labCase, variantId: resolved }
}

function boundaryFor(kind: TerrainKind): ReadonlyArray<readonly [number, number]> {
  if (kind === 'bowl') return BOWL_BOUNDARY
  if (kind === 'regional' || kind === 'combined') return CONCAVE_BOUNDARY
  return STANDARD_BOUNDARY
}

function createFixtureTerrain(kind: TerrainKind): TerrainField {
  if (kind === 'bowl') {
    const field = createTerrainField({ origin: [0, 0], spacing: 1, cols: 5, rows: 5, step: 0.01 })
    field.heights.set([
      600, 600, 400, 600, 600, 600, 300, 200, 300, 600, 600, 200, 0, 200, 600, 600, 300, 200, 300,
      600, 600, 600, 600, 600, 600,
    ])
    return field
  }

  const large = kind === 'regional' || kind === 'combined'
  const spacing = kind === 'mixed' || kind === 'combined' ? 0.5 : 1
  const extent = large ? 32 : 16
  const side = extent / spacing + 1
  const field = createTerrainField({
    origin: [0, 0],
    spacing,
    cols: side,
    rows: side,
    step: 0.01,
  })

  for (let row = 0; row < field.rows; row += 1) {
    const z = row * spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = col * spacing
      let height = 0
      if (kind === 'surface') {
        height = 0.45 + Math.sin(x * 0.52) * 0.28 + Math.cos(z * 0.43) * 0.2
      } else if (kind === 'mixed') {
        height = 6
      } else if (kind === 'regional') {
        height = 0.6 + x * 0.055 + z * 0.025
      } else if (kind === 'combined') {
        height = 6 + Math.max(0, x - 14) * 0.08 + z * 0.015
      }
      field.heights[row * field.cols + col] = quantize(field, height)
    }
  }

  if (kind === 'mixed') sculptIslandBasin(field, 4, 11)
  if (kind === 'combined') sculptIslandBasin(field, 7, 18)
  return field
}

function sculptIslandBasin(field: TerrainField, centerX: number, centerZ: number): void {
  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      const dx = x - centerX
      const dz = z - centerZ
      if (Math.hypot(dx, dz) > 4) continue
      const basin =
        6.1 * Math.exp(-(dx * dx + dz * dz) / (2 * 2.2 * 2.2))
      const islandDx = dx - 0.5
      const island =
        5.8 * Math.exp(-(islandDx * islandDx + dz * dz) / (2 * 1.3 * 1.3))
      const height = Math.max(0.35, Math.min(6, 6 - basin + island))
      field.heights[row * field.cols + col] = quantize(field, height)
    }
  }
}

function createSurfaceNode(
  caseId: string,
  variantId: string,
  siteId: string,
  boundary: ReadonlyArray<readonly [number, number]>,
) {
  const bounds = siteBounds(boundary)
  const field = createSurfaceMaterialField(bounds)
  const midX = (bounds.minX + bounds.maxX) * 0.5
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5

  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      const offset = (row * field.cols + col) * 4
      let red = x < midX && z < midZ ? 1 : 0
      let green = x >= midX && z < midZ ? 1 : 0
      let blue = x < midX && z >= midZ ? 1 : 0
      if (x >= midX && z >= midZ) red = green = blue = 1
      if (Math.abs(x - midX) < 0.75 || Math.abs(z - midZ) < 0.75) {
        red = green = blue = 0.5
      }
      field.values[offset] = Math.round(red * 255)
      field.values[offset + 1] = Math.round(green * 255)
      field.values[offset + 2] = Math.round(blue * 255)
      field.values[offset + 3] = 255
    }
  }

  const textureSize = variantId === 'fine-scale' ? 25 : variantId === 'coarse-scale' ? 200 : 100
  return SurfaceMaterialNode.parse({
    id: `surface-material_lab-${caseId}`,
    parentId: siteId,
    name: 'Environment Lab Surface',
    textureSize,
    paintMap: encodeSurfaceMaterialField(field),
  })
}

function createGrassNode(
  caseId: string,
  variantId: string,
  siteId: string,
  boundary: ReadonlyArray<readonly [number, number]>,
) {
  const bounds = siteBounds(boundary)
  const paint = createGrassPaintField(bounds, '#315f2f', 1, 0.5)
  const height = createGrassHeightField(bounds)
  const midX = (bounds.minX + bounds.maxX) * 0.5
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5

  for (let row = 0; row < paint.rows; row += 1) {
    const z = paint.origin[1] + row * paint.spacing
    for (let col = 0; col < paint.cols; col += 1) {
      const x = paint.origin[0] + col * paint.spacing
      const offset = (row * paint.cols + col) * 4
      const wave = (Math.sin(x * 0.8) + Math.cos(z * 0.65)) * 0.08
      const density = Math.max(0.12, Math.min(1, (x < midX ? 0.92 : 0.46) + wave))
      paint.values[offset + 3] = Math.round(density * 255)
    }
  }

  for (let row = 0; row < height.rows; row += 1) {
    const z = height.origin[1] + row * height.spacing
    for (let col = 0; col < height.cols; col += 1) {
      const scale = z < midZ - 2 ? 0.62 : z > midZ + 2 ? 1.58 : 1
      const channel = Math.round(scale < 1 ? scale * 128 : 128 + (scale - 1) * 127)
      const offset = (row * height.cols + col) * 4
      height.values[offset] = channel
      height.values[offset + 1] = channel
      height.values[offset + 2] = channel
      height.values[offset + 3] = 255
    }
  }

  return GrassFieldNode.parse({
    id: `grass-field_lab-${caseId}`,
    parentId: siteId,
    name: 'Environment Lab Ground Cover',
    bladeWidth: 0.035,
    bladeWidthVariation: 36,
    bladeHeight: DEFAULT_GRASS_BLADE_HEIGHT,
    bladeHeightVariation: 42,
    bladeRestBend: 0.32,
    bladeTintVariation: 34,
    bladeTipBrightness: 255,
    density: variantId === 'low-density' ? 36 : 86,
    flowerDensity: 32,
    windStrength: variantId === 'high-wind' ? 190 : 92,
    grassWindInfluence: variantId === 'high-wind' ? 240 : 115,
    obstacleBendRadius: 0.85,
    obstacleBendStrength: 0.26,
    obstacleFlattening: 72,
    paintMap: encodeGrassPaintField(paint),
    heightMap: encodeGrassPaintField(height),
  })
}

function pondSeed(kind: TerrainKind): [number, number] {
  if (kind === 'bowl') return [2, 2]
  if (kind === 'combined') return [5, 18]
  return [2, 11]
}

function requireBasin(
  terrain: TerrainField,
  boundary: ReadonlyArray<readonly [number, number]>,
  seed: readonly [number, number],
): PondBasin {
  const basin = analyzePondBasin(terrain, boundary, seed)
  if (!basin)
    throw new Error(`Environment lab terrain has no valid pond basin at ${seed.join(', ')}`)
  return basin
}

function pondProps(kind: TerrainKind): PondProp[] {
  if (kind === 'bowl') {
    return [
      { id: 'water-lily_lab-a', kind: 'water-lily', position: [1.25, 2], yaw: 0.35, scale: 0.9 },
      { id: 'water-lily_lab-b', kind: 'water-lily', position: [2.75, 2.2], yaw: 1.4, scale: 0.72 },
      { id: 'koi_lab-a', kind: 'koi', position: [2.1, 1.85], yaw: 2.2, scale: 0.88 },
    ]
  }
  const centerX = kind === 'combined' ? 7 : 4
  const centerZ = kind === 'combined' ? 18 : 11
  return [
    {
      id: 'water-lily_lab-a',
      kind: 'water-lily',
      position: [centerX - 1.65, centerZ + 0.55],
      yaw: 0.5,
      scale: 0.82,
    },
    {
      id: 'koi_lab-a',
      kind: 'koi',
      position: [centerX - 1.85, centerZ - 0.2],
      yaw: 1.6,
      scale: 0.92,
    },
  ]
}

function createPondNodes(
  caseId: string,
  variantId: string,
  siteId: string,
  kind: TerrainKind,
  boundary: ReadonlyArray<readonly [number, number]>,
  terrain: TerrainField,
) {
  const seed = pondSeed(kind)
  const basin = requireBasin(terrain, boundary, seed)
  const dry =
    variantId === 'dry-retained' ||
    variantId === 'drained-pond' ||
    variantId === 'dry-authored-water' ||
    variantId === 'dry-pond'
  const stepped = variantId === 'stepped'
  const quality: WaterQuality = variantId.startsWith('pure')
    ? 'pure'
    : variantId.startsWith('deep')
      ? 'deep'
      : variantId.startsWith('swampy')
        ? 'swampy'
        : 'clear'
  const hasLife =
    caseId === 'pond-life' ||
    caseId === 'portability' ||
    caseId === 'living-landscape' ||
    (caseId === 'pond-basins' && variantId === 'dry-retained')
  const waterLevel = dry
    ? null
    : stepped
      ? (basin.levels[Math.floor(basin.levels.length / 2)] ?? basin.spillLevel)
      : basin.spillLevel
  const primary = PondNode.parse({
    id: `pond_lab-${caseId}`,
    parentId: siteId,
    name: 'Environment Lab Pond',
    seed,
    waterLevel,
    quality,
    shoreline:
      variantId.includes('rocky') || variantId === 'swampy-life' || caseId === 'living-landscape'
        ? 'rocky'
        : 'soft',
    props: hasLife ? pondProps(kind) : [],
  })
  if (variantId !== 'connected-seeds') return [primary]

  return [
    primary,
    PondNode.parse({
      id: `pond_lab-${caseId}-connected`,
      parentId: siteId,
      name: 'Environment Lab Connected Pond Seed',
      seed: [2.65, 2.1],
      waterLevel: basin.spillLevel,
      quality: 'clear',
      shoreline: 'soft',
      props: [],
    }),
  ]
}

function riverEndpoints(
  caseId: string,
  variantId: string,
): {
  points: [number, number][]
  source: RiverSource
  outlet: RiverOutlet
} {
  if (caseId === 'regional-surroundings') {
    return {
      points: [
        [2, 0],
        [10, 7],
        [20, 13],
        [32, 16],
      ],
      source: 'mountain',
      outlet: 'sea',
    }
  }
  if (caseId === 'living-landscape') {
    return {
      points: [
        [18, 4],
        [23, 8],
        [27, 13],
        [32, 16],
      ],
      source: 'rounded',
      outlet: 'sea',
    }
  }
  if (caseId !== 'river-endpoints') {
    return {
      points: [
        [2, 2],
        [7, 5],
        [10, 9],
        [14, 13],
      ],
      source: 'rounded',
      outlet: 'rounded',
    }
  }

  const source: RiverSource = variantId.includes('mountain') ? 'mountain' : 'rounded'
  const outlet: RiverOutlet = variantId.endsWith('-sea') ? 'sea' : 'rounded'
  return {
    points: [
      source === 'mountain' ? [2, 0] : [2, 2],
      [8, 5],
      [9, 11],
      outlet === 'sea' ? [16, 14] : [14, 13],
    ],
    source,
    outlet,
  }
}

function createRiverNode(caseId: string, variantId: string, siteId: string) {
  const endpoints = riverEndpoints(caseId, variantId)
  return RiverNode.parse({
    id: `river_lab-${caseId}`,
    parentId: siteId,
    name: 'Environment Lab River',
    points: endpoints.points,
    width: variantId === 'narrow-shallow' ? 1.5 : variantId === 'wide-deep' ? 10 : 4,
    depth: variantId === 'narrow-shallow' ? 0.25 : variantId === 'wide-deep' ? 3 : 1,
    source: endpoints.source,
    outlet: endpoints.outlet,
    flowDirection: variantId === 'reverse-fast' ? 'reverse' : 'forward',
    flowSpeed: variantId === 'reverse-fast' ? 2.4 : 0.75,
    quality: caseId === 'living-landscape' ? 'deep' : 'clear',
    shoreline: caseId === 'living-landscape' ? 'rocky' : 'soft',
  })
}

function createStructure(caseId: string, siteId: string, baseElevation: number) {
  const buildingId = `building_lab-${caseId}`
  const levelId = `level_lab-${caseId}`
  const slabId = `slab_lab-${caseId}`
  const blockId = `block_lab-${caseId}`
  const slab = SlabNode.parse({
    id: slabId,
    parentId: levelId,
    name: 'Obstacle slab',
    polygon: [
      [8, 9],
      [13, 9],
      [13, 14],
      [8, 14],
    ],
    elevation: 0.08,
    thickness: 0.12,
  })
  const block = BlockNode.parse({
    id: blockId,
    parentId: levelId,
    name: 'Freestanding obstacle block',
    position: [11, 0.08, 7],
    rotation: Math.PI / 8,
    topology: createBoxBlockTopology(2.2, 2.4, 1.5),
  })
  const level = LevelNode.parse({
    id: levelId,
    parentId: buildingId,
    name: 'Ground level',
    baseElevation,
    height: 3,
    children: [slabId, blockId],
  })
  const building = BuildingNode.parse({
    id: buildingId,
    parentId: siteId,
    name: 'Environment Lab Building',
    children: [levelId],
  })
  return [building, level, slab, block]
}

function createFloorplanContext(caseId: string, siteId: string, baseElevation: number) {
  const buildingId = `building_lab-${caseId}`
  const levelId = `level_lab-${caseId}`
  const level = LevelNode.parse({
    id: levelId,
    parentId: buildingId,
    name: 'Environment Lab Level',
    baseElevation,
    height: 3,
    children: [],
  })
  const building = BuildingNode.parse({
    id: buildingId,
    parentId: siteId,
    name: 'Environment Lab Building',
    children: [levelId],
  })
  return [building, level]
}

function planFor(caseId: string, variantId: string): BuildPlan {
  switch (caseId) {
    case 'surface-materials':
      return { terrain: 'surface', surface: true }
    case 'ground-cover-brushes':
      return { terrain: 'flat', grass: true }
    case 'grass-obstacles':
      return {
        terrain: 'mixed',
        grass: true,
        pond: variantId !== 'water-removed',
        river: variantId !== 'water-removed',
        structure: true,
      }
    case 'pond-basins':
      return { terrain: 'bowl', pond: true }
    case 'pond-life':
      return { terrain: 'bowl', pond: true }
    case 'river-authoring':
      return { terrain: 'flat', river: true }
    case 'river-endpoints':
      return { terrain: 'flat', river: true }
    case 'regional-surroundings':
      return { terrain: 'regional', surface: true, river: true }
    case 'natural-presets':
      return { terrain: 'regional' }
    case 'night-landmarks':
      return { terrain: 'regional' }
    case 'sky-and-sun':
      return { terrain: 'surface', structure: true }
    case 'weather':
      return {
        terrain: 'mixed',
        surface: true,
        grass: true,
        pond: true,
        river: true,
        structure: true,
      }
    case 'portability':
      return {
        terrain: 'mixed',
        surface: true,
        grass: true,
        pond: true,
        river: true,
        structure: true,
      }
    case 'living-landscape':
      return {
        terrain: 'combined',
        surface: true,
        grass: true,
        pond: true,
        river: true,
        structure: true,
      }
  }
  throw new RangeError(`Unknown Environment lab case: ${caseId}`)
}

function buildScene(caseId: string, variantId: string): SceneGraph {
  const plan = planFor(caseId, variantId)
  const boundary = boundaryFor(plan.terrain)
  const siteId = `site_lab-${caseId}`
  const marker: LabMarker = { version: 1, caseId, variantId }
  let terrain = createFixtureTerrain(plan.terrain)
  let site: SiteNodeValue = SiteNode.parse({
    id: siteId,
    name: `Environment Lab · ${caseId}`,
    polygon: { type: 'polygon', points: boundary },
    terrain: encodeTerrainField(terrain),
    children: [],
    metadata: { environmentLab: marker },
  })

  const nodes: Record<string, unknown> = {}
  const siteChildren: string[] = []
  const river = plan.river ? createRiverNode(caseId, variantId, siteId) : null
  if (river) {
    const rebuilt = rebuildRiverTerrain(site, [river])
    terrain = rebuilt.terrain
    site = SiteNode.parse({ ...site, terrain: rebuilt.terrainData, metadata: rebuilt.metadata })
    nodes[river.id] = river
    siteChildren.push(river.id)
  }

  if (plan.surface) {
    const surface = createSurfaceNode(caseId, variantId, siteId, boundary)
    nodes[surface.id] = surface
    siteChildren.push(surface.id)
  }
  if (plan.grass) {
    const grass = createGrassNode(caseId, variantId, siteId, boundary)
    nodes[grass.id] = grass
    siteChildren.push(grass.id)
  }
  if (plan.pond) {
    for (const pond of createPondNodes(
      caseId,
      variantId,
      siteId,
      plan.terrain,
      boundary,
      terrain,
    )) {
      nodes[pond.id] = pond
      siteChildren.push(pond.id)
    }
  }
  const baseElevation = plan.terrain === 'mixed' || plan.terrain === 'combined' ? 6 : 0
  const structure = plan.structure
    ? createStructure(caseId, siteId, baseElevation)
    : createFloorplanContext(caseId, siteId, baseElevation)
  for (const node of structure) nodes[node.id] = node
  siteChildren.push(structure[0]!.id)

  site = SiteNode.parse({ ...site, children: siteChildren })
  nodes[site.id] = site
  return {
    nodes,
    rootNodeIds: [site.id],
    installedPlugins: ['pascal:environment'],
  } as unknown as SceneGraph
}

function fixedInlandSeed(): string {
  if (deriveLandscapeRegion(INLAND_SEED).coast) {
    throw new Error('Environment lab needs a fixed seed whose derived regional landscape is inland')
  }
  return INLAND_SEED
}

function frontagesFor(caseId: string, variantId: string): FrontageContexts {
  if (caseId === 'river-endpoints') {
    if (variantId === 'inland-rounded') return {}
    const bridgeEdge = variantId === 'coastal-rounded-sea' ? 1 : 0
    return {
      [bridgeEdge]: {
        separator: 'primary-road',
        access: 'none',
        roadStyleId: 'collector',
      },
    }
  }
  if (caseId === 'night-landmarks') {
    return {
      0: { separator: 'primary-road', access: 'driveway', roadStyleId: 'collector' },
    }
  }
  if (
    caseId !== 'regional-surroundings' &&
    caseId !== 'night-landmarks' &&
    caseId !== 'living-landscape'
  ) {
    return {}
  }
  if (variantId === 'no-roads') {
    return {
      0: { separator: 'none', access: 'none' },
      1: { separator: 'none', access: 'none' },
      2: { separator: 'none', access: 'none' },
      3: { separator: 'none', access: 'none' },
      4: { separator: 'none', access: 'none' },
      5: { separator: 'none', access: 'none' },
    }
  }
  if (variantId === 'primary-access') {
    return {
      0: { separator: 'primary-road', access: 'driveway', roadStyleId: 'collector' },
      1: { separator: 'primary-road', access: 'pedestrian-path', roadStyleId: 'local-street' },
      2: { separator: 'secondary-road', access: 'none', roadStyleId: 'alley' },
    }
  }
  return {
    0: { separator: 'primary-road', access: 'driveway', roadStyleId: 'collector' },
    1: { separator: 'secondary-road', access: 'pedestrian-path', roadStyleId: 'local-street' },
    2: { separator: 'none', access: 'none' },
    3: { separator: 'secondary-road', access: 'none', roadStyleId: 'alley' },
    4: { separator: 'none', access: 'none' },
    5: { separator: 'primary-road', access: 'none', roadStyleId: 'arterial' },
  }
}

function skyFor(caseId: string, variantId: string): SkySettings {
  let sky: SkySettings = { ...DEFAULT_SKY_SETTINGS }
  const presetId =
    variantId === 'cloudy'
      ? 'cloudy'
      : variantId === 'golden-hour'
        ? 'golden'
        : variantId === 'blue-hour'
          ? 'dusk'
          : variantId === 'moonlit' ||
              variantId === 'night' ||
              (caseId === 'night-landmarks' && variantId === 'sky-disabled')
            ? 'night'
            : 'clear'
  const preset = SKY_PRESETS.find((entry) => entry.id === presetId)
  if (preset) sky = { ...sky, ...preset.settings }

  if (variantId === 'gradient') sky.provider = 'gradient'
  if (variantId === 'manual-sun') {
    sky.sunMode = 'manual'
    sky.sunElevation = 18
    sky.sunAzimuth = 135
    sky.northOffset = 25
  }
  if (variantId === 'luminance-debug') {
    sky.debug = 'luminance'
    sky.cloudCoverage = 0.62
    sky.fogStart = 80
    sky.fogEnd = 650
  }
  if (variantId === 'meadow-still') sky.cloudSpeed = 0
  if (caseId === 'weather' && variantId !== 'clear') {
    sky.cloudCoverage = Math.max(sky.cloudCoverage, 0.72)
    sky.turbidity = Math.max(sky.turbidity, 4)
    sky.fogStart = 110
    sky.fogEnd = 720
  }
  return sky
}

function weatherFor(variantId: string): EnvironmentConfiguration['weather'] {
  switch (variantId) {
    case 'light-rain':
      return { rain: 0.35, snow: 0, wind: 0.45, storm: false }
    case 'rain':
      return { rain: 0.7, snow: 0, wind: 0.62, storm: false }
    case 'snow':
      return { rain: 0, snow: 0.65, wind: 0.42, storm: false }
    case 'wind':
      return { rain: 0, snow: 0, wind: 1, storm: false }
    case 'storm':
      return { rain: 1, snow: 0, wind: 0.86, storm: true }
    case 'mixed':
      return { rain: 0.55, snow: 0.4, wind: 0.72, storm: false }
    default:
      return { rain: 0, snow: 0, wind: 0.35, storm: false }
  }
}

function configurationFor(caseId: string, variantId: string): EnvironmentConfiguration {
  const natural = caseId === 'natural-presets'
  const preset = natural
    ? variantId === 'woodland-edge'
      ? 'woodland-edge'
      : 'open-meadow'
    : 'regional'
  const inland = caseId === 'river-endpoints' && variantId === 'inland-rounded'
  const hidden = variantId === 'presentation-hidden'
  const skyDisabled = variantId === 'sky-disabled'
  const seed = caseId === 'night-landmarks' ? NIGHT_SEED : inland ? fixedInlandSeed() : COASTAL_SEED
  return EnvironmentConfigurationSchema.parse({
    version: ENVIRONMENT_CONFIGURATION_VERSION,
    preset,
    seed,
    frontages: frontagesFor(caseId, variantId),
    sky: skyFor(caseId, variantId),
    visibility: {
      surroundings: !hidden,
      sky: !hidden && !skyDisabled,
    },
    weather: weatherFor(variantId),
  }) as EnvironmentConfiguration
}

export function createEnvironmentLabFixture(
  caseId: string,
  variantId?: string,
): EnvironmentLabFixture {
  const selection = selectionFor(caseId, variantId)
  return {
    scene: buildScene(caseId, selection.variantId),
    configuration: configurationFor(caseId, selection.variantId),
    camera: {
      position: [...selection.labCase.camera.position],
      target: [...selection.labCase.camera.target],
    },
  }
}

function sectionFor(
  caseId: string,
): 'ground-cover' | 'atmosphere' | 'surroundings' | 'path' | 'water' | undefined {
  if (caseId === 'surface-materials') return 'path'
  if (caseId === 'ground-cover-brushes' || caseId === 'grass-obstacles') return 'ground-cover'
  if (
    caseId === 'pond-basins' ||
    caseId === 'pond-life' ||
    caseId === 'river-authoring' ||
    caseId === 'river-endpoints'
  )
    return 'water'
  if (
    caseId === 'regional-surroundings' ||
    caseId === 'natural-presets' ||
    caseId === 'night-landmarks'
  )
    return 'surroundings'
  if (caseId === 'sky-and-sun' || caseId === 'weather' || caseId === 'living-landscape')
    return 'atmosphere'
  return undefined
}

export function initializeEnvironmentLabFixture(
  caseId: string,
  fixture: EnvironmentLabFixture,
): void {
  if (!getEnvironmentLabCase(caseId))
    throw new RangeError(`Unknown Environment lab case: ${caseId}`)
  clearRiverAuthoring()
  resetThunderAudioSession()
  importEnvironmentConfiguration(fixture.configuration)

  const siteId = fixture.scene.rootNodeIds[0]
  const site = siteId
    ? (fixture.scene.nodes[siteId] as { metadata?: { environmentLab?: LabMarker } } | undefined)
    : undefined
  const variantId = site?.metadata?.environmentLab?.variantId
  const surfaceColor = rgbToHex(SURFACE_MATERIAL_PAINT_COLOR[DEFAULT_SURFACE_MATERIAL])
  useEnvironmentStore.setState({
    activeSection: sectionFor(caseId),
    catalogueView: 'site',
    waterTab: caseId === 'river-authoring' || caseId === 'river-endpoints' ? 'river' : 'pond',
    weatherSettings: { ...fixture.configuration.weather, thunderAudio: false },
    ambientMotion: variantId !== 'meadow-still',
    birdsEnabled: true,
    groundCoverBrush: { ...DEFAULT_PAINT_STROKE_SETTINGS, falloff: 0.5 },
    groundCoverTool: 'paint-density',
    groundCoverHeightAmount: 50,
    surfaceBrush: {
      ...DEFAULT_PAINT_STROKE_SETTINGS,
      falloff: 0.5,
      color: surfaceColor,
      mode: 'paint',
      targetDensity: 1,
    },
    surfaceMaterial: DEFAULT_SURFACE_MATERIAL,
    skyPlaying: false,
    skyMotion: false,
    pondToolMode: 'select-basin',
    pondTarget: null,
    pondQuality: 'clear',
    pondFeedback: '',
  })
  useEnvironmentStore.getState().resetPondTool()
}
