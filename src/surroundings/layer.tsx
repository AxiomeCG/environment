'use client'

import { type SiteNode, useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  MeshStandardMaterial,
} from 'three'
import { useEnvironmentStore } from '../store'
import {
  deriveRoadPresentationAlignments,
  deriveSurroundingsLayout,
  type RoadPresentationAlignmentDescriptor,
  type SurroundingsCorridorDescriptor,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments } from './frontages'
import {
  buildRoadPresentationPlan,
  type RoadPresentationPlan,
  type RoadPresentationPoint,
  type RoadPresentationSurface,
} from './streetscape-road-presentation'

const PROPERTY_COLORS = ['#7d8d70', '#899879'] as const

type PresentedRoad = Readonly<{
  alignment: RoadPresentationAlignmentDescriptor
  road: RoadPresentationPlan
}>

type PresentedLayout = Readonly<{
  corridors: readonly SurroundingsCorridorDescriptor[]
  roads: readonly PresentedRoad[]
}>

const EMPTY_PRESENTED_LAYOUT: PresentedLayout = {
  corridors: [],
  roads: [],
}

function disableRaycast(): void {}

function roadAlignmentPoints(
  alignment: RoadPresentationAlignmentDescriptor,
): readonly RoadPresentationPoint[] {
  return alignment.centerline.map(
    ([x, z]): RoadPresentationPoint => [x, 0, z],
  )
}

function RoadSurfaceMesh({ surface }: { surface: RoadPresentationSurface }) {
  const resources = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(surface.geometry.positions, 3),
    )
    geometry.setIndex([...surface.geometry.indices])
    geometry.computeVertexNormals()

    const material = new MeshStandardMaterial({
      color: surface.color,
      metalness: surface.metalness,
      roughness: surface.roughness,
      side: surface.doubleSided ? DoubleSide : FrontSide,
    })

    return { geometry, material }
  }, [surface])

  return (
    <mesh
      castShadow={surface.castShadow}
      geometry={resources.geometry}
      material={resources.material}
      raycast={disableRaycast}
      receiveShadow={surface.receiveShadow}
    />
  )
}

export default function SurroundingsLayer() {
  const active = useEnvironmentStore((state) => state.activeSection === 'surroundings')
  const frontageContexts = useEnvironmentStore((state) => state.frontageContexts)
  const site = useScene((state) => {
    const siteId = state.rootNodeIds.find((id) => state.nodes[id]?.type === 'site')
    return siteId ? (state.nodes[siteId] as SiteNode) : undefined
  })
  const presentedLayout = useMemo(() => {
    if (!site) return EMPTY_PRESENTED_LAYOUT

    try {
      const layout = deriveSurroundingsLayout(
        deriveBoundarySegments({
          points: site.polygon.points,
          contexts: frontageContexts,
        }),
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
      )

      return {
        corridors: layout.corridors,
        roads: deriveRoadPresentationAlignments(layout).map((alignment) => ({
          alignment,
          road: buildRoadPresentationPlan(
            alignment.id,
            alignment.separator,
            roadAlignmentPoints(alignment),
          ),
        })),
      }
    } catch {
      return EMPTY_PRESENTED_LAYOUT
    }
  }, [frontageContexts, site])

  if (
    !active
    || (
      presentedLayout.corridors.length === 0
      && presentedLayout.roads.length === 0
    )
  ) return null

  return (
    <group name="environment-surroundings-root">
      <group name="environment-streetscape-roads">
        {presentedLayout.roads.map(({ alignment, road }) => (
          <group
            key={alignment.id}
            name={alignment.junctionIds.length > 0
              ? 'environment-streetscape-road-bend'
              : 'environment-streetscape-road-straight'}
          >
            {road.surfaces.map((surface) => (
              <RoadSurfaceMesh key={surface.id} surface={surface} />
            ))}
          </group>
        ))}
      </group>

      {presentedLayout.corridors.map((corridor) => {
        const rotationY = -Math.atan2(
          corridor.frame.tangent[1],
          corridor.frame.tangent[0],
        )

        return (
          <group key={corridor.id}>
            {corridor.properties.map((property, index) => (
              <mesh
                key={property.id}
                position={[property.center[0], 0.03, property.center[1]]}
                raycast={disableRaycast}
                rotation={[0, rotationY, 0]}
              >
                <boxGeometry
                  args={[
                    Math.max(0.1, property.frontageWidth - 0.3),
                    0.06,
                    Math.max(0.1, property.depth - 0.3),
                  ]}
                />
                <meshStandardMaterial
                  color={PROPERTY_COLORS[index % PROPERTY_COLORS.length]}
                  roughness={1}
                />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}
