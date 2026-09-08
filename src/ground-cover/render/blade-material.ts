import { DoubleSide } from 'three'
import type { Node } from 'three/webgpu'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export type GrassBladeMaterialNodes = Readonly<{
  position: Node<'vec3'>
  visible: Node<'bool'>
  color: Node<'vec3'>
  emissive: Node<'vec3'>
  normal: Node<'vec3'>
}>

/** Shared renderer seam for authored fields and presentation-only vegetation. */
export function createGrassBladeMaterial(nodes: GrassBladeMaterialNodes): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ side: DoubleSide })
  material.positionNode = nodes.position
  material.maskNode = nodes.visible
  material.colorNode = nodes.color
  material.emissiveNode = nodes.emissive
  material.normalNode = nodes.normal
  return material
}
