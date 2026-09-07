'use client'

import { terrainFieldOf, useScene } from '@pascal-app/core'
import type { AnyNodeId, SiteNode } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useViewer } from '@pascal-app/viewer'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { Color, DoubleSide, FrontSide } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import { riverTerrainBaseline } from '../river/terrain'
import { useEnvironmentStore } from '../store'
import { loadPresentationAlbedos } from '../surface-material/materials'
import type { PresentationAlbedos } from '../surface-material/materials'
import { decodeSurfaceMaterialField } from '../surface-material/field'
import { SURFACE_MATERIAL_KIND } from '../surface-material/schema'
import type { SurfaceMaterialNode } from '../surface-material/schema'
import {
  deriveSurroundingsLayout,
  deriveRoadPresentationAlignments,
  deriveSurroundingsLevelTerrainDistance,
  type NeighborCellDescriptor,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  type SurroundingsCorridorDescriptor,
  type RoadPresentationAlignmentDescriptor,
  type SurroundingsLayoutDescriptor,
} from './corridor'
import {
  buildExteriorTerrainSection,
  EXTERIOR_TERRAIN_GROUND_OFFSET,
  createExteriorTerrainSampler,
  createRenderedTerrainSampler,
  deriveExteriorTerrainSectionAddresses,
  type ExteriorTerrainSectionAddress,
  type ExteriorTerrainSampler,
  mergeExteriorTerrainSections,
} from './exterior-terrain'
import { deriveBoundarySegments } from './frontages'
import type { BoundarySegment } from './frontages'
import { deriveHorizonFoliagePlan } from './horizon-foliage'
import { buildTerrainRoadGeometry } from './terrain-road-geometry'
import { useSurfaceMesh } from './surface-mesh'
import { HouseNeighborhood } from './house-neighborhood'
import { NeighborhoodShadows } from './neighborhood-shadows'
import {
  type ClassifiedNeighborCell,
  deriveHousePlans,
  deriveNeighborCellClassifications,
  type HousePlan,
} from './neighborhood'
import {
  deriveNeighborhoodDecorations,
  type NeighborhoodDecorationPlan,
} from './neighborhood-decoration'
import { NeighborhoodDecorations } from './neighborhood-decoration-renderer'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import {
  buildRoadPresentationPlan,
  type RoadPresentationPlan,
  type RoadPresentationSurface,
} from './streetscape-road-presentation'

import { DistantTrees } from './distant-trees'
import { DistantBirds } from './distant-birds'
// EZ-Tree loads browser textures at module scope; preserve the SSR boundary.
const NeighborhoodTrees = lazy(() =>
  import('./neighborhood-trees').then((module) => ({ default: module.NeighborhoodTrees })),
)
import { deriveThirdRingPlan, type FieldPatch } from './third-ring'
import { ThirdRing } from './third-ring-renderer'
import {
  applyRoadSurfaceDetail,
  createLandscapeGroundMaterial,
  PresentationMaterial,
} from './presentation-material'
import { SurroundingsNightLighting } from './night-lighting'
import { deriveOuterRoads } from './outer-roads'
import { CoastalSea } from './coastal-sea'
import { createRoadGradedTerrain } from './road-elevation'
import type { RoadNetworkNode } from './streetscape/schema'
import { deriveLandscapeRegion, type LandscapeRegion } from './landscape-region'
import { SEA_LEVEL } from './landscape-noise'
import { createRiverLandscape, type RiverLandscape } from './river-landscape'
import { RiverLandscapeWater } from './river-landscape-water'
import { createRiverBridges } from './river-bridges'
import { RiverBridges } from './river-bridges-renderer'
import { Boulders } from './boulders'
import { buildFieldCoverageTexture } from './field-coverage'
import { createPropertySurfaceTransition } from './property-surface'
import type { PropertySurfaceTransition } from './property-surface'

type PresentedLayout = Readonly<{
  neighborCells: readonly ClassifiedNeighborCell[]
  houses: readonly HousePlan[]
  road: RoadPresentationPlan
  decorations: NeighborhoodDecorationPlan
  corridors: readonly SurroundingsCorridorDescriptor[]
  outerRoads: readonly RoadPresentationAlignmentDescriptor[]
  nearRoads: readonly RoadPresentationAlignmentDescriptor[]
  levelTerrainDistance: number
  network: RoadNetworkNode | null
  landscape: RiverLandscape | null
}>

export type RoadSurfaceBatch = Readonly<{
  id: string
  name: string
  triangleColors: readonly number[]
  roughness: number
  metalness: number
  doubleSided: boolean
  castShadow: boolean
  receiveShadow: boolean
  material: 'basic' | 'standard'
  depthWrite: boolean
  polygonOffsetFactor: number
  sourceSurfaceCount: number
  geometry: RoadPresentationSurface['geometry']
}>

type MutableRoadSurfaceBatch = {
  -readonly [Key in keyof RoadSurfaceBatch]: Key extends 'geometry'
    ? { positions: number[]; indices: number[] }
    : Key extends 'triangleColors'
      ? number[]
      : RoadSurfaceBatch[Key]
}

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

const EMPTY_PRESENTED_LAYOUT: PresentedLayout = {
  houses: [],
  decorations: EMPTY_DECORATION_PLAN,
  corridors: [],
  outerRoads: [],
  nearRoads: [],
  neighborCells: [],
  road: EMPTY_ROAD_PLAN,
  levelTerrainDistance: 0,
  network: null,
  landscape: null,
}

function disableRaycast(): void {}

function roadSurfaceBatchKey(surface: RoadPresentationSurface | RoadSurfaceBatch): string {
  return JSON.stringify([
    surface.material,
    surface.roughness,
    surface.metalness,
    surface.doubleSided,
    surface.castShadow,
    surface.receiveShadow,
    surface.depthWrite,
    surface.polygonOffsetFactor,
  ])
}
const roadMaterials = new Map<string, PresentationMaterial>()

function roadMaterial(surface: RoadSurfaceBatch) {
  const key = roadSurfaceBatchKey(surface)
  const cached = roadMaterials.get(key)
  if (cached) return cached
  // Road markings used to choose an unlit Basic material, which made them
  // glaring at night. Both paint and asphalt now use matte scene lighting;
  // only standard road surfaces receive aggregate/weathering detail.
  const material = new PresentationMaterial({
    roughness: surface.roughness,
    metalness: surface.metalness,
  })
  material.vertexColors = true
  material.depthWrite = surface.depthWrite
  material.polygonOffset = true
  material.polygonOffsetFactor = surface.polygonOffsetFactor
  material.side = surface.doubleSided ? DoubleSide : FrontSide
  if (surface.material === 'standard') applyRoadSurfaceDetail(material)
  roadMaterials.set(key, material)
  return material
}

export function buildRoadSurfaceBatches(
  surfaces: readonly RoadPresentationSurface[],
): RoadSurfaceBatch[] {
  const batches: MutableRoadSurfaceBatch[] = []
  const batchesByKey = new Map<string, MutableRoadSurfaceBatch>()
  const color = new Color()

  for (const surface of surfaces) {
    const key = roadSurfaceBatchKey(surface)
    let batch = batchesByKey.get(key)
    if (!batch) {
      batch = {
        id: `environment-road-surface-batch-${batches.length}`,
        name: `environment-road-surface-batch-${batches.length}`,
        triangleColors: [],
        roughness: surface.roughness,
        metalness: surface.metalness,
        doubleSided: surface.doubleSided,
        castShadow: surface.castShadow,
        receiveShadow: surface.receiveShadow,
        material: surface.material,
        depthWrite: surface.depthWrite,
        polygonOffsetFactor: surface.polygonOffsetFactor,
        sourceSurfaceCount: 0,
        geometry: { positions: [], indices: [] },
      }
      batches.push(batch)
      batchesByKey.set(key, batch)
    }

    const vertexOffset = batch.geometry.positions.length / 3
    for (const position of surface.geometry.positions) {
      batch.geometry.positions.push(position)
    }
    for (const index of surface.geometry.indices) {
      batch.geometry.indices.push(index + vertexOffset)
    }
    color.set(surface.color)
    for (let index = 0; index < surface.geometry.indices.length; index += 3) {
      batch.triangleColors.push(color.r, color.g, color.b)
    }
    batch.sourceSurfaceCount += 1
  }

  return batches
}

function ExteriorGroundMesh({
  sampler,
  sections,
  site,
  region,
  seed,
  fields,
  propertyTransition,
}: {
  sampler: ExteriorTerrainSampler
  sections: readonly ExteriorTerrainSectionAddress[]
  site: SiteNode
  region: LandscapeRegion
  seed: string
  fields: readonly FieldPatch[]
  propertyTransition: PropertySurfaceTransition
}) {
  const geometry = useMemo(
    () =>
      mergeExteriorTerrainSections(
        sections.map((address) =>
          buildExteriorTerrainSection(address, sampler, site.polygon.points),
        ),
      ),
    [sections, sampler, site.polygon.points],
  )
  const [albedos, setAlbedos] = useState<PresentationAlbedos | null>(null)
  useEffect(() => {
    let mounted = true
    loadPresentationAlbedos()
      .then((textures) => {
        if (mounted) setAlbedos(textures)
      })
      .catch((error) => console.error('[Environment] Surroundings albedo loading failed', error))
    return () => {
      mounted = false
    }
  }, [])
  const coverage = useMemo(() => buildFieldCoverageTexture(fields), [fields])
  const material = useMemo(
    () =>
      createLandscapeGroundMaterial(
        region,
        coverage,
        albedos,
        site.polygon.points,
        seed,
        propertyTransition,
      ),
    [region, coverage, albedos, site.polygon.points, seed, propertyTransition],
  )
  useEffect(
    () => () => {
      coverage.texture.dispose()
    },
    [coverage],
  )
  useEffect(
    () => () => {
      material.dispose()
    },
    [material],
  )
  const mesh = useSurfaceMesh(geometry, material)

  return (
    <primitive
      object={mesh}
      dispose={null}
      name="environment-exterior-ground"
      position={[0, EXTERIOR_TERRAIN_GROUND_OFFSET, 0]}
      raycast={disableRaycast}
      receiveShadow
      userData={{
        drawCallCount: geometry.sectionCount > 0 ? 1 : 0,
        ownedBufferBytes: geometry.ownedBufferBytes,
        sectionCount: geometry.sectionCount,
        triangleCount: geometry.triangleCount,
      }}
    />
  )
}

function RoadSurfaceMesh({
  surface,
  terrain,
  bridgeHeightAt,
}: {
  surface: RoadSurfaceBatch
  terrain: ExteriorTerrainSampler
  bridgeHeightAt?: (x: number, z: number) => number
}) {
  const geometry = useMemo(
    () =>
      buildTerrainRoadGeometry(
        surface.geometry.positions,
        surface.geometry.indices,
        terrain.heightAt,
        surface.triangleColors,
        { terrain, bridgeHeightAt },
      ),
    [surface.geometry, surface.triangleColors, terrain, bridgeHeightAt],
  )
  const material = roadMaterial(surface)
  const mesh = useSurfaceMesh(geometry, material)

  return (
    <primitive
      object={mesh}
      dispose={null}
      name={surface.name}
      raycast={disableRaycast}
      receiveShadow={surface.receiveShadow}
      userData={{ sourceSurfaceCount: surface.sourceSurfaceCount }}
    />
  )
}

export default function SurroundingsLayer({
  groundReplacementComponent: GroundReplacement,
}: {
  /** Host-owned, scene-scoped replacement of the fallback horizon ground. */
  groundReplacementComponent: ComponentType
}) {
  const active = useEnvironmentStore((state) => state.surroundingsEnabled)
  const frontageContexts = useEnvironmentStore((state) => state.frontageContexts)
  const seed = useEnvironmentStore((state) => state.surroundingsSeed)
  const birdsEnabled = useEnvironmentStore((state) => state.birdsEnabled)
  const ambientMotion = useEnvironmentStore((state) => state.ambientMotion)
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const walkthroughSuspended = useViewer((state) => state.walkthroughSuspended)
  const renderPaused = useViewer((state) => state.renderPaused)
  const site = useScene((state) => {
    const siteId = state.rootNodeIds.find((id) => state.nodes[id]?.type === 'site')
    return siteId ? (state.nodes[siteId] as SiteNode) : undefined
  })
  const boundary = site?.polygon.points
  const rivers = useScene(
    useShallow((state) => {
      const result: RiverNode[] = []
      if (!site) return result
      for (const id of site.children) {
        const child = state.nodes[id as AnyNodeId]
        if ((child?.type as string | undefined) === RIVER_KIND && child?.visible !== false) {
          result.push(child as unknown as RiverNode)
        }
      }
      return result
    }),
  )
  const surfaceMaterial = useScene((state) => {
    if (!site) return undefined
    for (const childId of site.children) {
      const child = state.nodes[childId as AnyNodeId]
      if ((child?.type as string | undefined) === SURFACE_MATERIAL_KIND) {
        return child as unknown as SurfaceMaterialNode
      }
    }
    return undefined
  })
  const surfaceField = useMemo(
    () => decodeSurfaceMaterialField(surfaceMaterial?.paintMap),
    [surfaceMaterial?.paintMap],
  )
  const invalidate = useThree((state) => state.invalidate)
  const activeSiteId = active ? site?.id : undefined
  const [propertySurface, setPropertySurface] = useState<{
    siteId: string
    transition: PropertySurfaceTransition
  } | null>(null)
  useLayoutEffect(() => {
    if (!activeSiteId) {
      setPropertySurface(null)
      return
    }
    const transition = createPropertySurfaceTransition()
    setPropertySurface({ siteId: activeSiteId, transition })
    return () => {
      transition.dispose()
    }
  }, [activeSiteId])
  const propertyTransition =
    propertySurface && propertySurface.siteId === activeSiteId ? propertySurface.transition : null
  useLayoutEffect(() => {
    if (!propertyTransition || !boundary) return
    propertyTransition.update(boundary, surfaceField, surfaceMaterial?.textureSize ?? 100)
    invalidate()
  }, [propertyTransition, boundary, surfaceField, surfaceMaterial?.textureSize, invalidate])
  const exteriorTerrainSections = useMemo(
    () => (active && site ? deriveExteriorTerrainSectionAddresses(site.polygon.points) : []),
    [active, site],
  )
  const presentedLayout = useMemo(() => {
    if (!active || !boundary || !site) return EMPTY_PRESENTED_LAYOUT

    let segments: BoundarySegment[]
    let layout: SurroundingsLayoutDescriptor
    let levelTerrainDistance: number
    try {
      segments = deriveBoundarySegments({
        points: boundary,
        contexts: frontageContexts,
      })
      layout = deriveSurroundingsLayout(segments, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS, {
        seed,
        depthVariation: 0.2,
      })
      levelTerrainDistance = deriveSurroundingsLevelTerrainDistance(
        segments,
        layout,
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      )
    } catch {
      return EMPTY_PRESENTED_LAYOUT
    }

    try {
      const terrain = createExteriorTerrainSampler({
        boundary,
        levelTerrainDistance,
        terrain: riverTerrainBaseline(site),
        seed,
      })
      const landscape = createRiverLandscape(site, rivers, terrain, deriveLandscapeRegion(seed))
      const outerRoads = deriveOuterRoads(layout, { seed, heightAt: terrain.heightAt })
      const network = deriveRuntimeRoadNetwork(layout, outerRoads)
      const neighborCells = deriveNeighborCellClassifications(layout, network, seed).filter(
        (cell) => !landscape.intersectsFootprint(cell.polygon, 1.5),
      )
      const houses = deriveHousePlans(neighborCells, seed)
      let road = EMPTY_ROAD_PLAN
      try {
        road = buildRoadPresentationPlan(network)
      } catch {
        // A presentation failure must not remove independently valid houses.
      }
      let decorations = EMPTY_DECORATION_PLAN
      try {
        decorations = deriveNeighborhoodDecorations(
          neighborCells,
          houses,
          layout.corridors,
          network,
          road,
          seed,
        )
        decorations = {
          ...decorations,
          catalogProps: decorations.catalogProps.filter(
            ({ position }) => landscape.waterLevelAt(position[0], position[1]) === null,
          ),
          streetLights: decorations.streetLights.filter(
            ({ position }) => landscape.waterLevelAt(position[0], position[1]) === null,
          ),
          trees: decorations.trees.filter(
            ({ position }) => landscape.waterLevelAt(position[0], position[1]) === null,
          ),
          paving: decorations.paving.filter(
            ({ polygon }) => !landscape.intersectsFootprint(polygon),
          ),
        }
      } catch {
        // Decorative props must not own the house lifecycle.
      }
      return {
        decorations,
        outerRoads,
        nearRoads: deriveRoadPresentationAlignments(layout),
        corridors: layout.corridors,
        neighborCells,
        houses,
        road,
        levelTerrainDistance,
        network,
        landscape,
      }
    } catch {
      return {
        neighborCells: layout.neighborCells.map(
          (cell): ClassifiedNeighborCell => ({
            ...cell,
            lotIndex: 0,
            roadCoverage: 0,
            use: 'residual',
            occupancy: 'none',
          }),
        ),
        decorations: EMPTY_DECORATION_PLAN,
        outerRoads: [],
        nearRoads: [],
        corridors: layout.corridors,
        houses: [],
        road: EMPTY_ROAD_PLAN,
        levelTerrainDistance,
        network: null,
        landscape: null,
      }
    }
  }, [active, frontageContexts, boundary, seed, site, rivers])
  const distantLandscape = useMemo(() => {
    if (!active || !site) return null
    const landscape = presentedLayout.landscape
    const terrain =
      landscape?.sampler ??
      createExteriorTerrainSampler({
        boundary: site.polygon.points,
        levelTerrainDistance: presentedLayout.levelTerrainDistance,
        terrain: terrainFieldOf(site),
        seed,
      })
    const waterLevelAt = (x: number, z: number) =>
      landscape?.waterLevelAt(x, z) ?? (terrain.heightAt(x, z) < SEA_LEVEL ? SEA_LEVEL : null)
    const sampler = createRenderedTerrainSampler(
      presentedLayout.network
        ? createRoadGradedTerrain(
            presentedLayout.network,
            terrain,
            site.polygon.points,
            waterLevelAt,
          )
        : terrain,
      exteriorTerrainSections,
    )
    const bridges = presentedLayout.network
      ? createRiverBridges(presentedLayout.network, sampler, waterLevelAt)
      : { heightAt: sampler.heightAt, spans: [] }
    const context = {
      boundary: site.polygon.points,
      corridors: presentedLayout.corridors,
      roads: presentedLayout.outerRoads,
      nearRoads: presentedLayout.nearRoads,
      exclusions: [
        ...presentedLayout.houses.map((house) => house.footprint),
        ...(landscape?.exclusions ?? []),
      ],
      heightAt: sampler.heightAt,
      levelTerrainDistance: presentedLayout.levelTerrainDistance,
      seed,
    }
    const thirdRing = deriveThirdRingPlan(context)
    const foliage = deriveHorizonFoliagePlan(context).filter(
      ({ position }) => waterLevelAt(position[0], position[2]) === null,
    )
    return { thirdRing, sampler, bridges, foliage }
  }, [active, site, presentedLayout, seed, exteriorTerrainSections])
  const roadSurfaceBatches = useMemo(
    () => buildRoadSurfaceBatches(presentedLayout.road.surfaces),
    [presentedLayout.road.surfaces],
  )
  const hasPresentation =
    active &&
    (exteriorTerrainSections.length > 0 ||
      presentedLayout.neighborCells.length > 0 ||
      roadSurfaceBatches.length > 0)

  if (!hasPresentation || !site || !distantLandscape || !propertyTransition) return null

  return (
    <group name="environment-surroundings-root">
      <SurroundingsNightLighting />
      <GroundReplacement />
      <group name="exterior-terrain-chunks">
        <ExteriorGroundMesh
          sampler={distantLandscape.sampler}
          sections={exteriorTerrainSections}
          site={site}
          region={distantLandscape.thirdRing.region}
          seed={seed}
          fields={distantLandscape.thirdRing.fields}
          propertyTransition={propertyTransition}
        />
      </group>

      <HouseNeighborhood
        plans={presentedLayout.houses}
        heightAt={distantLandscape.sampler.heightAt}
      />
      <NeighborhoodShadows
        houses={presentedLayout.houses}
        trees={presentedLayout.decorations.trees}
        heightAt={distantLandscape.sampler.heightAt}
      />
      <NeighborhoodDecorations
        plan={presentedLayout.decorations}
        heightAt={distantLandscape.sampler.heightAt}
      />
      {distantLandscape && (
        <>
          <Suspense fallback={null}>
            <NeighborhoodTrees
              plans={presentedLayout.decorations.trees}
              horizonPlans={distantLandscape.foliage}
              heightAt={distantLandscape.sampler.heightAt}
            />
          </Suspense>
          <DistantTrees plans={distantLandscape.thirdRing.trees} />
          {birdsEnabled ? (
            <DistantBirds
              boundary={site.polygon.points}
              heightAt={distantLandscape.sampler.heightAt}
              moving={
                !renderPaused && (ambientMotion || (walkthroughMode && !walkthroughSuspended))
              }
              seed={seed}
            />
          ) : null}
          <CoastalSea
            sections={exteriorTerrainSections}
            sampler={distantLandscape.sampler}
            boundary={site.polygon.points}
            region={distantLandscape.thirdRing.region}
          />
          {presentedLayout.landscape ? (
            <RiverLandscapeWater landscape={presentedLayout.landscape} />
          ) : null}
          <RiverBridges spans={distantLandscape.bridges.spans} />
          <ThirdRing plan={distantLandscape.thirdRing} />
          <Boulders plans={distantLandscape.thirdRing.boulders} />
        </>
      )}

      <group
        name="environment-streetscape-roads"
        userData={{
          drawCallCount: roadSurfaceBatches.length,
          sourceSurfaceCount: presentedLayout.road.surfaces.length,
        }}
      >
        {roadSurfaceBatches.map((surface) => (
          <RoadSurfaceMesh
            key={surface.id}
            surface={surface}
            terrain={distantLandscape.sampler}
            bridgeHeightAt={
              distantLandscape.bridges.spans.length ? distantLandscape.bridges.heightAt : undefined
            }
          />
        ))}
      </group>
    </group>
  )
}
