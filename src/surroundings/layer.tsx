'use client'

import { type SiteNode, useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import { Color, DoubleSide, FrontSide } from 'three'
import { useEnvironmentStore } from '../store'
import {
  deriveSurroundingsLayout,
  type NeighborCellDescriptor,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments } from './frontages'
import { buildMeshGeometryBuffers } from './mesh-geometry'
import { HouseNeighborhood } from './house-neighborhood'
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
import { seededUnit } from './seeded-random'
import {
  buildRoadPresentationPlan,
  type RoadPresentationPlan,
  type RoadPresentationSurface,
} from './streetscape-road-presentation'

// Suburban lawn tones: mown grass with seeded per-lot drift so the ring of
// properties never reads as one carpet. Muted to sit with the road verge.
const LAWN_BASE = new Color('#7f9268')
const LAWN_VARIANCE = 0.055

type PresentedLayout = Readonly<{
  neighborCells: readonly ClassifiedNeighborCell[]
  houses: readonly HousePlan[]
  road: RoadPresentationPlan
  decorations: NeighborhoodDecorationPlan
}>

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
  neighborCells: [],
  road: EMPTY_ROAD_PLAN,
}

function disableRaycast(): void {}

/**
 * Every visible lot lawn in a single mesh: one draw call, one material,
 * per-lot tint baked into vertex colours.
 */
function LotLawnMesh({ cells }: { cells: readonly ClassifiedNeighborCell[] }) {
  const geometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const tint = new Color()
    for (const cell of cells) {
      const base = positions.length / 3
      const drift = (seededUnit('pascal-lawn', cell.id) - 0.5) * 2 * LAWN_VARIANCE
      tint.copy(LAWN_BASE).offsetHSL(drift * 0.25, drift * 0.6, drift)
      // Roadside transport slivers get the same lawn: a verge, not a void.
      if (cell.use === 'transport') tint.offsetHSL(0, -0.08, -0.03)
      else if (cell.occupancy === 'garden') tint.offsetHSL(0.025, 0.06, 0.025)
      else if (cell.occupancy === 'grove') tint.offsetHSL(-0.015, 0.05, -0.035)
      // Lots share exact edges in one mesh, so no inset: adjacent tints meet
      // on a hard property line instead of a lighter ground seam.
      for (const [x, z] of cell.polygon) {
        positions.push(x, 0.03, z)
        colors.push(tint.r, tint.g, tint.b)
      }
      for (let index = 1; index < cell.polygon.length - 1; index += 1) {
        indices.push(base, base + index, base + index + 1)
      }
    }
    return { ...buildMeshGeometryBuffers(positions, indices), colors: new Float32Array(colors) }
  }, [cells])

  return (
    <mesh
      name="environment-lot-lawns"
      raycast={disableRaycast}
      receiveShadow
    >
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="attributes-normal" args={[geometry.normals, 3]} />
        <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshStandardMaterial roughness={1} side={DoubleSide} vertexColors />
    </mesh>
  )
}

function RoadSurfaceMesh({ surface }: { surface: RoadPresentationSurface }) {
  const geometry = useMemo(
    () => buildMeshGeometryBuffers(surface.geometry.positions, surface.geometry.indices),
    [surface.geometry],
  )
  const side = surface.doubleSided ? DoubleSide : FrontSide

  return (
    <mesh
      castShadow={surface.castShadow}
      name={surface.name}
      raycast={disableRaycast}
      receiveShadow={surface.receiveShadow}
    >
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="attributes-normal" args={[geometry.normals, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      {surface.material === 'basic'
        ? (
            <meshBasicMaterial
              color={surface.color}
              depthWrite={surface.depthWrite}
              polygonOffset
              polygonOffsetFactor={surface.polygonOffsetFactor}
              side={side}
            />
          )
        : (
            <meshStandardMaterial
              color={surface.color}
              depthWrite={surface.depthWrite}
              metalness={surface.metalness}
              polygonOffset
              polygonOffsetFactor={surface.polygonOffsetFactor}
              roughness={surface.roughness}
              side={side}
            />
          )}
    </mesh>
  )
}

export default function SurroundingsLayer() {
  const active = useEnvironmentStore((state) => state.surroundingsEnabled)
  const frontageContexts = useEnvironmentStore((state) => state.frontageContexts)
  const site = useScene((state) => {
    const siteId = state.rootNodeIds.find((id) => state.nodes[id]?.type === 'site')
    return siteId ? (state.nodes[siteId] as SiteNode) : undefined
  })
  const presentedLayout = useMemo(() => {
    if (!active || !site) return EMPTY_PRESENTED_LAYOUT

    let segments: ReturnType<typeof deriveBoundarySegments>
    let layout: ReturnType<typeof deriveSurroundingsLayout>
    try {
      segments = deriveBoundarySegments({
        points: site.polygon.points,
        contexts: frontageContexts,
      })
      layout = deriveSurroundingsLayout(
        segments,
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      )
    } catch {
      return EMPTY_PRESENTED_LAYOUT
    }

    try {
      const network = deriveRuntimeRoadNetwork(layout)
      const neighborCells = deriveNeighborCellClassifications(segments, layout, network)
      const houses = deriveHousePlans(neighborCells)
      return {
        decorations: deriveNeighborhoodDecorations(
          neighborCells,
          houses,
          layout.corridors,
        ),
        neighborCells,
        houses,
        road: buildRoadPresentationPlan(network),
      }
    } catch {
      return {
        neighborCells: layout.neighborCells.map((cell): ClassifiedNeighborCell => ({
          ...cell,
          lotIndex: 0,
          roadCoverage: 0,
          use: 'residual',
          occupancy: 'none',
        })),
        decorations: EMPTY_DECORATION_PLAN,
        houses: [],
        road: EMPTY_ROAD_PLAN,
      }
    }
  }, [active, frontageContexts, site])
  const hasPresentation = active && (
    presentedLayout.neighborCells.length > 0
    || presentedLayout.road.surfaces.length > 0
  )

  if (!hasPresentation) return null

  return (
    <group name="environment-surroundings-root">
      <LotLawnMesh cells={presentedLayout.neighborCells} />

      <HouseNeighborhood plans={presentedLayout.houses} />
      <NeighborhoodDecorations plan={presentedLayout.decorations} />


      <group name="environment-streetscape-roads">
        {presentedLayout.road.surfaces.map((surface) => (
          <RoadSurfaceMesh key={surface.id} surface={surface} />
        ))}
      </group>
    </group>
  )
}
