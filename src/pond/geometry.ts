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
  type PondBasin,
  type PondSurface,
} from './basin'
import {
  buildPondShoreGeometry,
  createPondShoreDistances,
} from './shoreline'
import { buildPondPropGeometry } from './props'
import {
  POND_KIND,
  PondNode as PondNodeSchema,
  type PondNode,
  type PondProp,
  type WaterQuality,
} from './schema'
import { createWaterMaterial } from '../surroundings/water-material'

const POND_WATER_MESH_NAME = 'environment-pond-water'

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

  const spillSurface = buildPondSurface(basin, basin.spillLevel)
  const connected = [node]
  for (const sibling of context.siblings) {
    if ((sibling.type as string) !== POND_KIND) continue
    const parsed = PondNodeSchema.safeParse(sibling)
    if (
      parsed.success
      && parsed.data.id !== node.id
      && pondSurfaceContainsSeed(spillSurface, parsed.data.seed)
    ) {
      connected.push(parsed.data)
    }
  }
  connected.sort((left, right) => {
    const levelOrder = (right.waterLevel ?? Number.NEGATIVE_INFINITY)
      - (left.waterLevel ?? Number.NEGATIVE_INFINITY)
    return levelOrder || String(left.id).localeCompare(String(right.id))
  })
  if (connected[0]?.id !== node.id) return null

  let requestedLevel: number | null = null
  const props: PondProp[] = []
  const propIds = new Set<string>()
  for (const pond of connected) {
    if (
      pond.waterLevel !== null
      && (requestedLevel === null || pond.waterLevel > requestedLevel)
    ) {
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
  const material = createWaterMaterial({
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
  })
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

/** Portable, single-pass water and expanded prop geometry for generic GLB export. */
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
    const baseOpacity = appearance.opacity[0]
      + (appearance.opacity[1] - appearance.opacity[0]) * depthMix
    const opticalCoverage = 1 - Math.exp(-depth / appearance.shoreAbsorptionDepth)
    const edgeCoverage = smoothStep(0, shoreFadeDistance, shoreDistances?.getX(index) ?? shoreFadeDistance)
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

function isWaterQuality(value: string): value is WaterQuality {
  return value === 'pure' || value === 'clear' || value === 'deep' || value === 'swampy'
}

function pondSurfaceContainsSeed(
  surface: PondSurface,
  seed: readonly [number, number],
): boolean {
  if (surface.level === null) return false
  for (let offset = 0; offset < surface.positions.length; offset += 9) {
    const ax = surface.positions[offset]!
    const az = surface.positions[offset + 2]!
    const bx = surface.positions[offset + 3]!
    const bz = surface.positions[offset + 5]!
    const cx = surface.positions[offset + 6]!
    const cz = surface.positions[offset + 8]!
    const first = (bx - ax) * (seed[1] - az) - (bz - az) * (seed[0] - ax)
    const second = (cx - bx) * (seed[1] - bz) - (cz - bz) * (seed[0] - bx)
    const third = (ax - cx) * (seed[1] - cz) - (az - cz) * (seed[0] - cx)
    if (
      (first >= -1e-7 && second >= -1e-7 && third >= -1e-7)
      || (first <= 1e-7 && second <= 1e-7 && third <= 1e-7)
    ) {
      return true
    }
  }
  return false
}

function smoothStep(first: number, second: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - first) / Math.max(1e-6, second - first)))
  return amount * amount * (3 - 2 * amount)
}

