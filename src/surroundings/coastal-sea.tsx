import { useEffect, useLayoutEffect, useMemo } from 'react'
import { BufferAttribute } from 'three'
import type { ExteriorTerrainSectionAddress, ExteriorTerrainSampler } from './exterior-terrain'
import type { Point2 } from './frontages'
import type { LandscapeRegion } from './landscape-region'
import { buildSeaGeometry } from './coastal-sea-geometry'
import { createDistantWaterMaterial } from './water-material'
import { useSurfaceMesh } from './surface-mesh'

const NO_RAYCAST = () => undefined
export function CoastalSea({ sections, sampler, boundary, region }: {
  sections: readonly ExteriorTerrainSectionAddress[]
  sampler: ExteriorTerrainSampler
  boundary: readonly Point2[]
  region: LandscapeRegion
}) {
  const geometry = useMemo(() => buildSeaGeometry(sections, sampler, boundary, region.coast), [sections, sampler, boundary, region.coast])
  const material = useMemo(() => createDistantWaterMaterial(region.palette.water), [region.palette.water])
  useEffect(() => () => material.dispose(), [material])
  const mesh = useSurfaceMesh(geometry, material)
  useLayoutEffect(() => {
    // useSurfaceMesh owns this geometry, including the extra bathymetry buffer.
    mesh.geometry.setAttribute('waterDepth', new BufferAttribute(geometry.depths, 1))
  }, [mesh, geometry])
  if (!geometry.indices.length) return null
  return <primitive object={mesh} name="environment-coastal-sea" raycast={NO_RAYCAST} dispose={null} />
}
