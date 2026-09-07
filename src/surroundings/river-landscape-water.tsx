import { useEffect, useLayoutEffect, useMemo } from 'react'
import { BufferAttribute } from 'three'
import { POND_WATER_APPEARANCE } from '../pond/appearance'
import { createWaterMaterial } from './water-material'
import { useSurfaceMesh } from './surface-mesh'
import type { RiverLandscape, RiverLandscapeWaterBatch } from './river-landscape'

const NO_RAYCAST = () => undefined

export function RiverLandscapeWater({ landscape }: { landscape: RiverLandscape }) {
  if (!landscape.waters.length) return null
  return (
    <group name="environment-river-landscape-water">
      {landscape.waters.map((batch) => (
        <RiverLandscapeWaterBatchMesh key={batch.key} batch={batch} />
      ))}
    </group>
  )
}

function RiverLandscapeWaterBatchMesh({ batch }: { batch: RiverLandscapeWaterBatch }) {
  const appearance = POND_WATER_APPEARANCE[batch.quality]
  const shoreFadeDistance = 0.72
  const material = useMemo(
    () =>
      createWaterMaterial({
        name: `environment-river-landscape-water-${batch.quality}`,
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
        shoreFade: [shoreFadeDistance, appearance.shoreAbsorptionDepth],
        opacity: appearance.opacity,
      }),
    [appearance, batch.flowDirection, batch.flowSpeed, batch.quality],
  )
  useEffect(() => () => material.dispose(), [material])
  const mesh = useSurfaceMesh(batch.geometry, material)
  useLayoutEffect(() => {
    mesh.geometry.setAttribute('waterDepth', new BufferAttribute(batch.geometry.waterDepths, 1))
    mesh.geometry.setAttribute('waterFlow', new BufferAttribute(batch.geometry.waterFlows, 2))
    mesh.geometry.setAttribute('waterCourse', new BufferAttribute(batch.geometry.waterCourses, 2))
    mesh.geometry.setAttribute(
      'shoreDistance',
      new BufferAttribute(batch.geometry.shoreDistances, 1),
    )
  }, [batch.geometry, mesh])
  return (
    <primitive
      object={mesh}
      name={`environment-river-landscape-water-${batch.quality}`}
      raycast={NO_RAYCAST}
      castShadow={false}
      receiveShadow={false}
      renderOrder={2}
      dispose={null}
    />
  )
}
