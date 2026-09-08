'use client'

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { FLOWER_KINDS, type FlowerKind } from '../ground-cover/flower-scatter'
import { createFlowerGeometry } from '../ground-cover/render/flower-geometry'
import { mulberry32 } from '../variant-utils'
import { polygonCentroid } from './exterior-terrain'
import type { Point2 } from './frontages'
import type { HorizonFoliagePlan, HorizonFoliageSpecies } from './horizon-foliage'
import { NaturalGrass, NATURAL_GRASS_BLADE_BUDGET } from './natural-grass'
import type { TreePlan, TreeSize, TreeSpecies, TreeType } from './neighborhood-decoration'
import { dryNaturalHeightAt, signedBoundaryDistance } from './natural-spatial'
import { PresentationMaterial } from './presentation-material'
import { createContextInstances, disposePrimitiveInstances } from './primitive-instances'
import { SURROUNDINGS_PRESET_POLICIES, type NaturalSurroundingsPresetId } from './presets'
import { hashString, seededRange, seededUnit } from './seeded-random'
import { DistantTrees } from './distant-trees'

// EZ-Tree loads browser textures at module scope; preserve its existing SSR boundary.
const NeighborhoodTrees = lazy(() =>
  import('./neighborhood-trees').then((module) => ({ default: module.NeighborhoodTrees })),
)

export const NATURAL_VEGETATION_BUDGET = Object.freeze({
  tiles: 256,
  lowVegetation: 2_048,
  grassBlades: NATURAL_GRASS_BLADE_BUDGET,
  flowers: 768,
  trees: 640,
  detailedTrees: 96,
  distantTrees: 544,
})

export const NATURAL_VEGETATION_TILE_SIZE = 48

export type NaturalFlowerKind = FlowerKind

type NaturalPlacement = Readonly<{
  id: string
  position: readonly [number, number, number]
  rotationY: number
  scale: number
  color: string
  lodRank: number
}>

export type NaturalLowVegetationPlacement = NaturalPlacement

export type NaturalFlowerPlacement = NaturalPlacement &
  Readonly<{
    kind: NaturalFlowerKind
  }>

export type NaturalTreePlacement = NaturalPlacement &
  Readonly<{
    kind: 'deciduous' | 'pine'
    species: TreeSpecies
    height: number
    crownWidth: number
    trunkColor: string
  }>

export type NaturalVegetationTile = Readonly<{
  key: string
  address: readonly [x: number, z: number]
  lowVegetation: readonly NaturalLowVegetationPlacement[]
  flowers: readonly NaturalFlowerPlacement[]
  trees: readonly NaturalTreePlacement[]
}>

export type NaturalVegetationPlan = Readonly<{
  presetId: NaturalSurroundingsPresetId
  tiles: readonly NaturalVegetationTile[]
  lowVegetationCount: number
  flowerCount: number
  treeCount: number
}>

export type NaturalVegetationContext = Readonly<{
  boundary: readonly Point2[]
  seed: string
  presetId: NaturalSurroundingsPresetId
  heightAt: (x: number, z: number) => number
  waterLevelAt?: (x: number, z: number) => number | null
  foliageColors?: readonly string[]
}>

export type NaturalSurroundingsVegetationProps = NaturalVegetationContext

export type NaturalTreeRenderPlan = Readonly<{
  detailed: readonly TreePlan[]
  distant: readonly HorizonFoliagePlan[]
}>

const DEFAULT_FOLIAGE_COLORS: Readonly<Record<NaturalSurroundingsPresetId, readonly string[]>> =
  Object.freeze({
    'open-meadow': ['#759250', '#829d59', '#668545', '#91a962'],
    'woodland-edge': ['#365f3f', '#466d46', '#557a4e', '#2f553b'],
  })
const LOW_COLORS: Readonly<Record<NaturalSurroundingsPresetId, readonly string[]>> = Object.freeze({
  'open-meadow': ['#809552', '#91a55e', '#718746', '#a0ac68'],
  'woodland-edge': ['#496b43', '#58774a', '#3f623d', '#6c8052'],
})
const TRUNK_COLORS = ['#655044', '#765d49', '#54483c'] as const
const UP = new Vector3(0, 1, 0)
const NO_RAYCAST = () => undefined
const LOW_SLOTS_PER_TILE = 24
const FLOWER_SLOTS_PER_TILE = 12
const OPEN_TREE_SLOTS_PER_TILE = 4
const WOODLAND_TREE_SLOTS_PER_TILE = 20
const MAXIMUM_TILE_SEARCH_RADIUS = 12
const MINIMUM_TREE_BOUNDARY_CLEARANCE = 1.35
const MINIMUM_LOW_VEGETATION_CLEARANCE = 0.6
const LOW_VEGETATION_DISTANCE: Readonly<Record<NaturalSurroundingsPresetId, number>> = {
  'open-meadow': 155,
  'woodland-edge': 145,
}

const flowerMaterial = new PresentationMaterial({
  color: '#ffffff',
  roughness: 0.9,
  side: DoubleSide,
  vertexColors: true,
})
const flowerGeometryByKind: Record<FlowerKind, BufferGeometry> = {
  daisy: createFlowerGeometry('daisy'),
  cup: createFlowerGeometry('cup'),
  spike: createFlowerGeometry('spike'),
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return amount * amount * (3 - 2 * amount)
}

function valueNoise(seed: string, domain: string, x: number, z: number, spacing: number): number {
  const cellX = Math.floor(x / spacing)
  const cellZ = Math.floor(z / spacing)
  const localX = smoothstep(0, 1, x / spacing - cellX)
  const localZ = smoothstep(0, 1, z / spacing - cellZ)
  const valueAt = (offsetX: number, offsetZ: number) =>
    seededUnit(seed, `${domain}:${cellX + offsetX}:${cellZ + offsetZ}`)
  const south = valueAt(0, 0) * (1 - localX) + valueAt(1, 0) * localX
  const north = valueAt(0, 1) * (1 - localX) + valueAt(1, 1) * localX
  return south * (1 - localZ) + north * localZ
}

function paletteColor(palette: readonly string[], seed: string, domain: string): string {
  const index = Math.min(palette.length - 1, Math.floor(seededUnit(seed, domain) * palette.length))
  return palette[index]!
}

function tileAddresses(
  boundary: readonly Point2[],
  maximumDistance: number,
): readonly (readonly [number, number])[] {
  const center = polygonCentroid(boundary)
  let maximumBoundaryRadius = 0
  for (const point of boundary) {
    maximumBoundaryRadius = Math.max(
      maximumBoundaryRadius,
      Math.hypot(point[0] - center[0], point[1] - center[1]),
    )
  }
  const searchRadius = Math.min(
    MAXIMUM_TILE_SEARCH_RADIUS,
    Math.ceil((maximumBoundaryRadius + maximumDistance) / NATURAL_VEGETATION_TILE_SIZE),
  )
  const centerTileX = Math.floor(center[0] / NATURAL_VEGETATION_TILE_SIZE)
  const centerTileZ = Math.floor(center[1] / NATURAL_VEGETATION_TILE_SIZE)
  const addresses: (readonly [number, number])[] = []
  for (let tileZ = centerTileZ - searchRadius; tileZ <= centerTileZ + searchRadius; tileZ += 1) {
    for (let tileX = centerTileX - searchRadius; tileX <= centerTileX + searchRadius; tileX += 1) {
      addresses.push([tileX, tileZ])
    }
  }
  addresses.sort((first, second) => {
    const firstX = (first[0] + 0.5) * NATURAL_VEGETATION_TILE_SIZE - center[0]
    const firstZ = (first[1] + 0.5) * NATURAL_VEGETATION_TILE_SIZE - center[1]
    const secondX = (second[0] + 0.5) * NATURAL_VEGETATION_TILE_SIZE - center[0]
    const secondZ = (second[1] + 0.5) * NATURAL_VEGETATION_TILE_SIZE - center[1]
    return (
      firstX * firstX + firstZ * firstZ - secondX * secondX - secondZ * secondZ ||
      first[1] - second[1] ||
      first[0] - second[0]
    )
  })
  return addresses.slice(0, NATURAL_VEGETATION_BUDGET.tiles)
}

function candidatePosition(
  seed: string,
  presetId: NaturalSurroundingsPresetId,
  tileX: number,
  tileZ: number,
  category: string,
  slot: number,
): Point2 {
  const domain = `natural:${presetId}:tile:${tileX}:${tileZ}:${category}:${slot}`
  const random = mulberry32(hashString(`${seed}:${domain}`))
  return [
    (tileX + random()) * NATURAL_VEGETATION_TILE_SIZE,
    (tileZ + random()) * NATURAL_VEGETATION_TILE_SIZE,
  ]
}

function acceptedHeight(
  boundary: readonly Point2[],
  position: Point2,
  maximumDistance: number,
  heightAt: (x: number, z: number) => number,
  waterLevelAt: ((x: number, z: number) => number | null) | undefined,
): number | null {
  const distance = signedBoundaryDistance(boundary, position[0], position[1])
  if (distance < MINIMUM_LOW_VEGETATION_CLEARANCE || distance > maximumDistance) return null
  return dryNaturalHeightAt(position[0], position[1], heightAt, waterLevelAt)
}

function treeSpecies(
  seed: string,
  domain: string,
  presetId: NaturalSurroundingsPresetId,
): TreeSpecies {
  const value = seededUnit(seed, `${domain}:species`)
  const pineShare = presetId === 'woodland-edge' ? 0.3 : 0.16
  if (value < pineShare) return 'pine'
  const deciduous = (value - pineShare) / (1 - pineShare)
  if (deciduous < 0.42) return 'oak'
  if (deciduous < 0.72) return 'ash'
  return 'aspen'
}

export function deriveNaturalVegetationPlan({
  boundary,
  seed,
  presetId,
  heightAt,
  foliageColors,
  waterLevelAt,
}: NaturalVegetationContext): NaturalVegetationPlan {
  if (
    boundary.length < 3 ||
    boundary.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
  ) {
    return {
      presetId,
      tiles: [],
      lowVegetationCount: 0,
      flowerCount: 0,
      treeCount: 0,
    }
  }
  const policy = SURROUNDINGS_PRESET_POLICIES[presetId].vegetation!
  const lowPalette = LOW_COLORS[presetId]
  const treePalette = foliageColors?.length ? foliageColors : DEFAULT_FOLIAGE_COLORS[presetId]
  const tiles: NaturalVegetationTile[] = []
  let lowVegetationCount = 0
  let flowerCount = 0
  let treeCount = 0

  for (const [tileX, tileZ] of tileAddresses(boundary, policy.maximumDistance)) {
    const tileDomain = `natural:${presetId}:tile:${tileX}:${tileZ}`
    const lowVegetation: NaturalLowVegetationPlacement[] = []
    const flowers: NaturalFlowerPlacement[] = []
    const trees: NaturalTreePlacement[] = []

    for (
      let slot = 0;
      slot < LOW_SLOTS_PER_TILE && lowVegetationCount < NATURAL_VEGETATION_BUDGET.lowVegetation;
      slot += 1
    ) {
      const position = candidatePosition(seed, presetId, tileX, tileZ, 'low', slot)
      const forest = valueNoise(seed, `natural:${presetId}:forest`, position[0], position[1], 82)
      const cluster = smoothstep(policy.forestThreshold, 1, forest)
      const coverage =
        presetId === 'open-meadow'
          ? policy.lowCoverage
          : policy.lowCoverage * (0.82 + cluster * 0.18)
      const domain = `${tileDomain}:low:${slot}`
      if (seededUnit(seed, `${domain}:accepted`) >= coverage) continue
      const height = acceptedHeight(
        boundary,
        position,
        Math.min(policy.maximumDistance, LOW_VEGETATION_DISTANCE[presetId]),
        heightAt,
        waterLevelAt,
      )
      if (height === null) continue
      lowVegetation.push({
        id: domain,
        position: [position[0], height, position[1]],
        rotationY: seededRange(seed, `${domain}:rotation`, -Math.PI, Math.PI),
        scale: seededRange(
          seed,
          `${domain}:scale`,
          presetId === 'open-meadow' ? 0.72 : 0.58,
          presetId === 'open-meadow' ? 1.28 : 1.05,
        ),
        color: paletteColor(lowPalette, seed, `${domain}:color`),
        lodRank: seededUnit(seed, `${domain}:lod`),
      })
      lowVegetationCount += 1
    }

    for (
      let slot = 0;
      slot < FLOWER_SLOTS_PER_TILE && flowerCount < NATURAL_VEGETATION_BUDGET.flowers;
      slot += 1
    ) {
      const position = candidatePosition(seed, presetId, tileX, tileZ, 'flower', slot)
      const forest = valueNoise(seed, `natural:${presetId}:forest`, position[0], position[1], 82)
      const opening = 1 - smoothstep(policy.forestThreshold, 1, forest)
      const coverage = policy.flowerCoverage * (0.24 + opening * 0.76)
      const domain = `${tileDomain}:flower:${slot}`
      if (seededUnit(seed, `${domain}:accepted`) >= coverage) continue
      const height = acceptedHeight(
        boundary,
        position,
        policy.maximumDistance * 0.72,
        heightAt,
        waterLevelAt,
      )
      if (height === null) continue
      const kind =
        FLOWER_KINDS[Math.floor(seededUnit(seed, `${domain}:kind`) * FLOWER_KINDS.length)]!
      flowers.push({
        id: domain,
        kind,
        position: [position[0], height, position[1]],
        rotationY: seededRange(seed, `${domain}:rotation`, -Math.PI, Math.PI),
        scale: seededRange(seed, `${domain}:scale`, 0.78, 1.34),
        color: '#ffffff',
        lodRank: seededUnit(seed, `${domain}:lod`),
      })
      flowerCount += 1
    }

    const treeSlots =
      presetId === 'open-meadow' ? OPEN_TREE_SLOTS_PER_TILE : WOODLAND_TREE_SLOTS_PER_TILE
    for (let slot = 0; slot < treeSlots && treeCount < NATURAL_VEGETATION_BUDGET.trees; slot += 1) {
      const position = candidatePosition(seed, presetId, tileX, tileZ, 'tree', slot)
      const distance = signedBoundaryDistance(boundary, position[0], position[1])
      if (
        distance < MINIMUM_TREE_BOUNDARY_CLEARANCE ||
        distance > policy.maximumDistance ||
        (presetId === 'open-meadow' && distance < policy.maximumDistance * 0.46)
      ) {
        continue
      }
      const forest = valueNoise(seed, `natural:${presetId}:forest`, position[0], position[1], 82)
      const cluster = smoothstep(policy.forestThreshold, 1, forest)
      const acceptance =
        presetId === 'open-meadow'
          ? policy.treeCoverage * (0.55 + cluster * 0.45)
          : policy.treeCoverage * (0.08 + cluster * 0.92)
      const domain = `${tileDomain}:tree:${slot}`
      if (seededUnit(seed, `${domain}:accepted`) >= acceptance) continue
      const height = dryNaturalHeightAt(position[0], position[1], heightAt, waterLevelAt)
      if (height === null) continue
      const treeHeight = seededRange(
        seed,
        `${domain}:height`,
        presetId === 'open-meadow' ? 8 : 9.5,
        presetId === 'open-meadow' ? 15 : 23,
      )
      const species = treeSpecies(seed, domain, presetId)
      trees.push({
        id: domain,
        kind: species === 'pine' ? 'pine' : 'deciduous',
        species,
        position: [position[0], height, position[1]],
        rotationY: seededRange(seed, `${domain}:rotation`, -Math.PI, Math.PI),
        scale: 1,
        height: treeHeight,
        crownWidth: treeHeight * seededRange(seed, `${domain}:crown`, 0.3, 0.49),
        color: paletteColor(treePalette, seed, `${domain}:color`),
        trunkColor: paletteColor(TRUNK_COLORS, seed, `${domain}:trunk`),
        lodRank: seededUnit(seed, `${domain}:lod`),
      })
      treeCount += 1
    }

    if (lowVegetation.length || flowers.length || trees.length) {
      tiles.push({
        key: `${tileX}:${tileZ}`,
        address: [tileX, tileZ],
        lowVegetation,
        flowers,
        trees,
      })
    }
  }

  return {
    presetId,
    tiles,
    lowVegetationCount,
    flowerCount,
    treeCount,
  }
}

function treeSize(height: number): TreeSize {
  if (height < 10) return 'small'
  if (height < 17) return 'medium'
  return 'large'
}

const TREE_TYPE: Readonly<Record<TreeSpecies, TreeType>> = {
  oak: 'deciduous',
  ash: 'deciduous',
  aspen: 'deciduous',
  pine: 'evergreen',
}

export function deriveNaturalTreeRenderPlan(
  plan: NaturalVegetationPlan,
  boundary: readonly Point2[],
): NaturalTreeRenderPlan {
  const trees = plan.tiles.flatMap((tile) => tile.trees)
  const ranked = [...trees].sort((first, second) => {
    const firstDistance = signedBoundaryDistance(boundary, first.position[0], first.position[2])
    const secondDistance = signedBoundaryDistance(boundary, second.position[0], second.position[2])
    return (
      firstDistance +
        first.lodRank * 28 -
        first.height * 0.18 -
        (secondDistance + second.lodRank * 28 - second.height * 0.18) ||
      first.id.localeCompare(second.id)
    )
  })
  const detailedPlacements = ranked.slice(0, NATURAL_VEGETATION_BUDGET.detailedTrees)
  const detailedIds = new Set(detailedPlacements.map((tree) => tree.id))
  const detailed: TreePlan[] = detailedPlacements.map((tree) => ({
    id: tree.id,
    species: tree.species,
    size: treeSize(tree.height),
    treeType: TREE_TYPE[tree.species],
    foliageDensity: 1,
    leafColor: tree.color,
    seed: Math.floor(seededRange(tree.id, `${tree.id}:prototype`, 1, 145)),
    position: [tree.position[0], tree.position[2]],
    rotationY: tree.rotationY,
    height: tree.height,
  }))
  const distant = ranked
    .filter((tree) => !detailedIds.has(tree.id))
    .slice(0, NATURAL_VEGETATION_BUDGET.distantTrees)
    .map((tree): HorizonFoliagePlan => {
      const species: HorizonFoliageSpecies = tree.species === 'aspen' ? 'ash' : tree.species
      return {
        id: tree.id,
        clusterId: tree.id.slice(0, tree.id.lastIndexOf(':tree:')),
        archetype: `dense-${species}`,
        species,
        position: tree.position,
        rotationY: tree.rotationY,
        height: tree.height,
        leafColor: tree.color,
      }
    })
  return { detailed, distant }
}

type BatchPlacement = Readonly<{
  position: readonly [number, number, number]
  rotationY: number
  dimensions: readonly [number, number, number]
  color: string
}>

function addBatch(
  root: Group,
  name: string,
  geometry: BufferGeometry,
  material: Material,
  placements: readonly BatchPlacement[],
): void {
  if (!placements.length) return
  const instances = createContextInstances(geometry, material, placements.length)
  instances.name = name
  instances.raycast = NO_RAYCAST
  instances.castShadow = false
  instances.receiveShadow = false
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const color = new Color()
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index]!
    position.fromArray(placement.position)
    rotation.setFromAxisAngle(UP, placement.rotationY)
    scale.fromArray(placement.dimensions)
    instances.setMatrixAt(index, matrix.compose(position, rotation, scale))
    instances.setColorAt(index, color.set(placement.color))
  }
  instances.instanceMatrix.needsUpdate = true
  instances.instanceColor!.needsUpdate = true
  instances.computeBoundingSphere()
  root.add(instances)
}

function flowerBatch(
  placements: readonly NaturalFlowerPlacement[],
  kind: FlowerKind,
): BatchPlacement[] {
  return placements
    .filter((placement) => placement.kind === kind)
    .map((placement) => ({
      position: placement.position,
      rotationY: placement.rotationY,
      dimensions: [placement.scale, placement.scale, placement.scale],
      color: placement.color,
    }))
}

export function buildNaturalVegetationInstances(
  plan: NaturalVegetationPlan,
  root = new Group(),
): Group {
  disposePrimitiveInstances(root)
  root.name = 'environment-natural-flower-accents'
  const flowers = plan.tiles.flatMap((tile) => tile.flowers)
  for (const kind of FLOWER_KINDS) {
    addBatch(
      root,
      `environment-natural-flower-${kind}`,
      flowerGeometryByKind[kind],
      flowerMaterial,
      flowerBatch(flowers, kind),
    )
  }
  root.userData = {
    presetId: plan.presetId,
    tileCount: plan.tiles.length,
    lowVegetationCount: plan.lowVegetationCount,
    flowerCount: plan.flowerCount,
    treeCount: plan.treeCount,
    maximumDrawCallCount: root.children.length,
  }
  return root
}

export function NaturalSurroundingsVegetation(props: NaturalSurroundingsVegetationProps) {
  const { boundary, seed, presetId, heightAt, waterLevelAt, foliageColors } = props
  const plan = useMemo(
    () =>
      deriveNaturalVegetationPlan({
        boundary,
        seed,
        presetId,
        heightAt,
        waterLevelAt,
        foliageColors,
      }),
    [boundary, seed, presetId, heightAt, waterLevelAt, foliageColors],
  )
  const treeRenderPlan = useMemo(
    () => deriveNaturalTreeRenderPlan(plan, boundary),
    [plan, boundary],
  )
  const grassPatches = useMemo(() => plan.tiles.flatMap((tile) => tile.lowVegetation), [plan])
  const accentRoot = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    buildNaturalVegetationInstances(plan, accentRoot)
    invalidate()
  }, [plan, accentRoot, invalidate])
  useEffect(() => () => disposePrimitiveInstances(accentRoot), [accentRoot])

  return (
    <>
      <NaturalGrass
        boundary={boundary}
        heightAt={heightAt}
        waterLevelAt={waterLevelAt}
        patches={grassPatches}
        presetId={presetId}
      />
      <Suspense fallback={null}>
        <NeighborhoodTrees plans={treeRenderPlan.detailed} heightAt={heightAt} />
      </Suspense>
      <DistantTrees plans={treeRenderPlan.distant} />
      <primitive object={accentRoot} dispose={null} />
    </>
  )
}
