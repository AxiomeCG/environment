import { useLayoutEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Mesh } from 'three'
import type { Material } from 'three'
import type { MeshGeometryBuffers } from './mesh-geometry'
import { cloneContextMaterial } from './primitive-instances'

/** One stable scene object; replaced buffers and render bindings have one owner. */
export function useSurfaceMesh(buffers: MeshGeometryBuffers, sourceMaterial: Material) {
  const mesh = useMemo(() => new Mesh<BufferGeometry, Material>(), [])
  useLayoutEffect(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3))
    if (buffers.colors) geometry.setAttribute('color', new BufferAttribute(buffers.colors, 3))
    geometry.setIndex(new BufferAttribute(buffers.indices, 1))
    mesh.geometry = geometry
    // Dispose before assigning the next geometry: Three's RenderObject must
    // still reference these attributes when it releases their GPU buffers.
    return () => geometry.dispose()
  }, [mesh, buffers])
  useLayoutEffect(() => {
    const material = cloneContextMaterial(sourceMaterial)
    mesh.material = material
    return () => material.dispose()
  }, [mesh, sourceMaterial])
  return mesh
}
