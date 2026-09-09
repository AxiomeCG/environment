import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  type SiteNode as SiteNodeValue,
  SiteNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { Box3, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { planMaterialBakeSize } from '../export/material-baker'
import { buildSurfaceMaterialBakeGeometry } from './bake-geometry'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from './field'
import { SurfaceMaterialNode } from './schema'

describe('Surface material portable geometry', () => {
  test('keeps the authored footprint without substituting average vertex colors', () => {
    const site = SiteNode.parse({
      id: 'site_surface_export',
      children: ['surface_export'],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
    })
    const field = createSurfaceMaterialField({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 })
    for (let index = 0; index < field.values.length; index += 4) {
      const red = (index / 4) % 2 === 0
      field.values.set(red ? [255, 0, 0, 255] : [0, 255, 0, 128], index)
    }
    const node = SurfaceMaterialNode.parse({
      id: 'surface-material_export',
      parentId: site.id,
      paintMap: encodeSurfaceMaterialField(field),
    })

    const mesh = buildSurfaceMaterialBakeGeometry(
      node,
      contextFor(site, [site, node as unknown as AnyNode]),
    )

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
    if (!(mesh.material instanceof MeshStandardMaterial)) return
    expect(mesh.material.side).toBe(DoubleSide)
    expect(mesh.geometry.getAttribute('color')).toBeUndefined()
    const size = new Box3().setFromObject(mesh).getSize(new Vector3())
    expect(size.x).toBeCloseTo(2)
    expect(size.z).toBeCloseTo(2)
  })

  test('reports the exact request that crosses the deterministic map limit', () => {
    expect(planMaterialBakeSize({ minX: 0, minZ: 0, maxX: 64, maxZ: 32 }, 32)).toEqual({
      width: 2048,
      height: 1024,
      pixelsPerMeter: 32,
    })
    expect(() =>
      planMaterialBakeSize({ minX: 0, minZ: 0, maxX: 64 + 1 / 32, maxZ: 32 }, 32),
    ).toThrow('2049x1024')
  })

  test('returns an empty group when the surface context cannot resolve', () => {
    const site = SiteNode.parse({
      id: 'site_unresolved_export',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    })
    const node = SurfaceMaterialNode.parse({
      id: 'surface-material_unresolved_export',
      parentId: site.id,
    })
    const context = contextFor(site, [site])
    context.parent = null

    const root = buildSurfaceMaterialBakeGeometry(node, context)

    expect(root).toBeInstanceOf(Group)
    expect(root.children).toHaveLength(0)
  })
})

function contextFor(site: SiteNodeValue, sceneNodes: AnyNode[]): GeometryContext {
  const nodes = Object.fromEntries(sceneNodes.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  return {
    parent: site,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
  }
}
