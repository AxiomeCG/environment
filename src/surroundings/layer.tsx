'use client'

import { type SiteNode, useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import { useEnvironmentStore } from '../store'
import {
  deriveSurroundingsLayout,
  type RoadJunctionDescriptor,
  type SurroundingsLayoutDescriptor,
} from './corridor'
import { deriveBoundarySegments } from './frontages'

const PROPERTY_COLORS = ['#7d8d70', '#899879'] as const
const EMPTY_LAYOUT: SurroundingsLayoutDescriptor = {
  corridors: [],
  roadJunctions: [],
}

function RoadJunctionMesh({ junction }: { junction: RoadJunctionDescriptor }) {
  const shape = useMemo(() => {
    const result = new Shape()
    const first = junction.corners[0]
    if (!first) return result

    result.moveTo(first[0], first[1])
    for (const corner of junction.corners.slice(1)) {
      result.lineTo(corner[0], corner[1])
    }
    result.closePath()
    return result
  }, [junction])

  return (
    <mesh position={[0, 0.085, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#464a4d" roughness={1} side={DoubleSide} />
    </mesh>
  )
}

export default function SurroundingsLayer() {
  const active = useEnvironmentStore((state) => state.activeSection === 'surroundings')
  const frontageContexts = useEnvironmentStore((state) => state.frontageContexts)
  const site = useScene((state) => {
    const siteId = state.rootNodeIds.find((id) => state.nodes[id]?.type === 'site')
    return siteId ? (state.nodes[siteId] as SiteNode) : undefined
  })
  const layout = useMemo(() => {
    if (!site) return EMPTY_LAYOUT

    try {
      return deriveSurroundingsLayout(
        deriveBoundarySegments({
          points: site.polygon.points,
          contexts: frontageContexts,
        }),
      )
    } catch {
      return EMPTY_LAYOUT
    }
  }, [frontageContexts, site])

  if (!active || layout.corridors.length === 0) return null

  return (
    <group name="environment-surroundings-root">
      {layout.corridors.map((corridor) => {
        const rotationY = -Math.atan2(
          corridor.frame.tangent[1],
          corridor.frame.tangent[0],
        )

        return (
          <group key={corridor.id}>
            <mesh
              position={[corridor.road.center[0], 0.04, corridor.road.center[1]]}
              rotation={[0, rotationY, 0]}
            >
              <boxGeometry
                args={[corridor.road.length, 0.08, corridor.road.width]}
              />
              <meshStandardMaterial color="#464a4d" roughness={1} />
            </mesh>

            {corridor.properties.map((property, index) => (
              <mesh
                key={property.id}
                position={[property.center[0], 0.03, property.center[1]]}
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
      {layout.roadJunctions.map((junction) => (
        <RoadJunctionMesh junction={junction} key={junction.id} />
      ))}
    </group>
  )
}
