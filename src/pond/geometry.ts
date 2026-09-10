import {
  terrainFieldOf,
  type GeometryContext,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
} from 'three'
import { POND_WATER_APPEARANCE, type PondWaterAppearance } from './appearance'
import {
  analyzePondBasin,
  buildPondSurface,
  pondSurfaceDepthAt,
  type PondBasin,
  type PondSurface,
} from './basin'
import { buildPondShoreGeometry, createPondShoreDistances } from './shoreline'
import { buildPondPropGeometry } from './props'
import {
  POND_KIND,
  PondNode as PondNodeSchema,
  type PondNode,
  type PondProp,
  type WaterQuality,
} from './schema'
import { bakeWaterMaterial, type BakedWaterMaterial } from '../export/water-material-bake'
import { createWaterMaterial, type WaterMaterialOptions } from '../surroundings/water-material'

const POND_WATER_MESH_NAME = 'environment-pond-water'
const WET_EPSILON = 1e-4

export type ResolvedPond = {
  site: SiteNode
  terrain: TerrainField
  basin: PondBasin
  surface: PondSurface
  appearance: PondWaterAppearance
  props: readonly PondProp[]
}

export function resolvePond(node: PondNode, context: GeometryContext): ResolvedPond | null {
  const parent = context.parent
  if (!parent || parent.type !== 'site') return null
  const terrain = terrainFieldOf(parent)
  if (!terrain) return null
  const basin = analyzePondBasin(terrain, parent.polygon.points, node.seed)
  if (!basin) return null

  const connected = connectedPondsForBasin(node, context.siblings, basin)
  connected.sort((left, right) => {
    const levelOrder =
      (right.waterLevel ?? Number.NEGATIVE_INFINITY) - (left.waterLevel ?? Number.NEGATIVE_INFINITY)
    return levelOrder || String(left.id).localeCompare(String(right.id))
  })
  if (connected[0]?.id !== node.id) return null

  let requestedLevel: number | null = null
  const props: PondProp[] = []
  const propIds = new Set<string>()
  for (const pond of connected) {
    if (pond.waterLevel !== null && (requestedLevel === null || pond.waterLevel > requestedLevel)) {
      requestedLevel = pond.waterLevel
    }
    for (const prop of pond.props) {
      if (propIds.has(prop.id)) continue
      propIds.add(prop.id)
      props.push(prop)
    }
  }

  const quality = isWaterQuality(node.quality) ? node.quality : 'clear'
  return {
    site: parent,
    terrain,
    basin,
    surface: buildPondSurface(basin, requestedLevel),
    appearance: POND_WATER_APPEARANCE[quality],
    props,
  }
}

export function buildPondGeometry(node: PondNode, context: GeometryContext): Group {
  const group = new Group()
  group.name = 'environment-pond'
  const resolved = resolvePond(node, context)
  if (!resolved) return group

  const { basin, surface, appearance, props, terrain } = resolved
  group.userData.bottomLevel = basin.bottomLevel
  group.userData.spillLevel = basin.spillLevel
  group.userData.waterLevel = surface.level
  group.userData.waterArea = surface.area
  if (surface.level === null || surface.positions.length === 0) return group

  const shoreFadeDistance = Math.max(0.22, Math.min(1.2, terrain.spacing * 1.4))
  const geometry = createPondSurfaceGeometry(surface, shoreFadeDistance)
  const material = createWaterMaterial(
    pondWaterMaterialOptions(node, appearance, shoreFadeDistance),
  )
  const water = new Mesh(geometry, material)
  water.name = POND_WATER_MESH_NAME
  water.castShadow = false
  water.receiveShadow = false
  water.renderOrder = 2
  group.add(water)
  if (node.shoreline === 'rocky') {
    group.add(buildPondShoreGeometry(surface, terrain, String(node.id)))
  }
  group.add(buildPondPropGeometry(props, surface))
  return group
}

/** Synchronous geometry-only path for printing and non-material callers. */
export function buildPondBakeGeometry(node: PondNode, context: GeometryContext): Group {
  const group = new Group()
  group.name = node.name || 'Pond'
  const resolved = resolvePond(node, context)
  if (!resolved || resolved.surface.level === null || resolved.surface.positions.length === 0) {
    return group
  }

  const { surface, appearance, terrain } = resolved
  const shoreFadeDistance = Math.max(0.22, Math.min(1.2, terrain.spacing * 1.4))
  const geometry = createPondSurfaceGeometry(surface, shoreFadeDistance)
  const shallow = new Color(appearance.shallowColor)
  const deep = new Color(appearance.deepColor)
  const color = new Color()
  const colors = new Float32Array(surface.depths.length * 4)
  const shoreDistances = geometry.getAttribute('shoreDistance')
  for (let index = 0; index < surface.depths.length; index += 1) {
    const depth = surface.depths[index]!
    const depthMix = smoothStep(appearance.depthRange[0], appearance.depthRange[1], depth)
    color.lerpColors(shallow, deep, depthMix)
    const baseOpacity =
      appearance.opacity[0] + (appearance.opacity[1] - appearance.opacity[0]) * depthMix
    const opticalCoverage = 1 - Math.exp(-depth / appearance.shoreAbsorptionDepth)
    const edgeCoverage = smoothStep(
      0,
      shoreFadeDistance,
      shoreDistances?.getX(index) ?? shoreFadeDistance,
    )
    colors[index * 4] = color.r
    colors[index * 4 + 1] = color.g
    colors[index * 4 + 2] = color.b
    colors[index * 4 + 3] = baseOpacity * opticalCoverage * edgeCoverage
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    depthWrite: false,
    ior: 1.333,
    metalness: 0,
    opacity: 1,
    roughness: appearance.roughness,
    transparent: true,
    vertexColors: true,
  })
  material.name = `Pond water ${node.quality}`
  const water = new Mesh(geometry, material)
  water.name = 'Pond water'
  water.castShadow = false
  water.receiveShadow = false
  group.add(water)
  if (node.shoreline === 'rocky') {
    group.add(buildPondShoreGeometry(surface, terrain, String(node.id), true))
  }
  group.add(buildPondPropGeometry(resolved.props, surface, true))
  return group
}

export async function buildPondBakeGeometryAsync(
  node: PondNode,
  context: GeometryContext,
): Promise<Group> {
  const group = new Group()
  group.name = node.name || 'Pond'
  const resolved = resolvePond(node, context)
  if (!resolved || resolved.surface.level === null || resolved.surface.positions.length === 0) {
    return group
  }

  const { surface, appearance, terrain } = resolved
  const shoreFadeDistance = Math.max(0.22, Math.min(1.2, terrain.spacing * 1.4))
  const geometry = createPondSurfaceGeometry(surface, shoreFadeDistance)
  let baked: BakedWaterMaterial
  try {
    baked = await bakeWaterMaterial(
      geometry,
      pondWaterMaterialOptions(node, appearance, shoreFadeDistance),
    )
  } catch (cause) {
    geometry.dispose()
    throw new Error(`Unable to bake export materials for Pond ${String(node.id)}`, { cause })
  }
  const water = new Mesh(geometry, baked.material)
  water.name = 'Pond water'
  water.castShadow = false
  water.receiveShadow = false
  water.userData.materialBake = {
    backend: baked.backend,
    height: baked.height,
    pixelsPerMeter: baked.pixelsPerMeter,
    phaseSeconds: baked.phaseSeconds,
    tileSize: baked.tileSize,
    width: baked.width,
  }
  group.add(water)
  if (node.shoreline === 'rocky') {
    group.add(buildPondShoreGeometry(surface, terrain, String(node.id), true))
  }
  group.add(buildPondPropGeometry(resolved.props, surface, true))
  return group
}

export function createPondSurfaceGeometry(
  surface: PondSurface,
  shoreFadeDistance = 0,
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(surface.positions, 3))
  geometry.setAttribute('waterDepth', new Float32BufferAttribute(surface.depths, 1))
  if (shoreFadeDistance > 0) {
    geometry.setAttribute(
      'shoreDistance',
      new Float32BufferAttribute(createPondShoreDistances(surface, shoreFadeDistance), 1),
    )
  }
  const normals = new Float32Array(surface.depths.length * 3)
  for (let index = 0; index < surface.depths.length; index += 1) normals[index * 3 + 1] = 1
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function pondWaterMaterialOptions(
  node: PondNode,
  appearance: PondWaterAppearance,
  shoreFadeDistance: number,
): WaterMaterialOptions {
  return {
    name: `environment-pond-water-${node.quality}`,
    color: appearance.shallowColor,
    deepColor: appearance.deepColor,
    foamColor: appearance.foamColor,
    foamStrength: appearance.foamStrength,
    depthRange: appearance.depthRange,
    roughness: appearance.roughness,
    shoreRoughness: appearance.shoreRoughness,
    rippleStrength: appearance.rippleStrength,
    waveScale: appearance.waveScale,
    speedScale: appearance.speedScale,
    shoreFade: [shoreFadeDistance, appearance.shoreAbsorptionDepth],
    opacity: appearance.opacity,
  }
}

function connectedPondsForBasin(
  node: PondNode,
  siblings: GeometryContext['siblings'],
  basin: PondBasin,
): PondNode[] {
  const candidates = [node]
  for (const sibling of siblings) {
    if ((sibling.type as string) !== POND_KIND) continue
    const parsed = PondNodeSchema.safeParse(sibling)
    if (parsed.success && parsed.data.visible && parsed.data.id !== node.id) {
      candidates.push(parsed.data)
    }
  }

  const connected = [node]
  const connectedIds = new Set<string>([String(node.id)])
  let connectedLevel = node.waterLevel
  let added = true
  while (added) {
    added = false
    for (const pond of candidates) {
      if (connectedIds.has(String(pond.id))) continue
      let connectionLevel = connectedLevel
      if (
        pond.waterLevel !== null &&
        (connectionLevel === null || pond.waterLevel > connectionLevel)
      ) {
        connectionLevel = pond.waterLevel
      }
      if (connectionLevel === null) continue
      const surface = buildPondSurface(basin, connectionLevel)
      if (pondSurfaceDepthAt(surface, pond.seed[0], pond.seed[1]) <= WET_EPSILON) continue
      connected.push(pond)
      connectedIds.add(String(pond.id))
      connectedLevel = connectionLevel
      added = true
    }
  }
  return connected
}

function isWaterQuality(value: string): value is WaterQuality {
  return value === 'pure' || value === 'clear' || value === 'deep' || value === 'swampy'
}


function smoothStep(first: number, second: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - first) / Math.max(1e-6, second - first)))
  return amount * amount * (3 - 2 * amount)
}
