import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  SiteNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { Color, Group, Mesh } from 'three'
import { buildSurfaceMaterialBakeGeometry } from './bake-geometry'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from './field'
import { SURFACE_MATERIAL_AVERAGE_COLOR } from './material-types'
import { SurfaceMaterialNode } from './schema'

describe('Surface material portable geometry', () => {
  test('exports the painted material blend as linear vertex colors', () => {
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
      field.values.set([0, 255, 0, 255], index)
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
    const colors = mesh.geometry.getAttribute('color')
    const road = SURFACE_MATERIAL_AVERAGE_COLOR['road-path']
    const expected = new Color().setRGB(road[0], road[1], road[2], 'srgb')
    expect(colors?.getX(0)).toBeCloseTo(expected.r, 5)
    expect(colors?.getY(0)).toBeCloseTo(expected.g, 5)
    expect(colors?.getZ(0)).toBeCloseTo(expected.b, 5)
    expect(mesh.geometry.getAttribute('uv').count).toBe(
      mesh.geometry.getAttribute('position').count,
    )
  })

  test('exports paved road as linear vertex colors', () => {
    const site = SiteNode.parse({
      id: 'site_paved_export',
      children: ['surface_paved_export'],
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
      field.values.set([255, 255, 255, 255], index)
    }
    const node = SurfaceMaterialNode.parse({
      id: 'surface-material_paved_export',
      parentId: site.id,
      paintMap: encodeSurfaceMaterialField(field),
    })

    const mesh = buildSurfaceMaterialBakeGeometry(
      node,
      contextFor(site, [site, node as unknown as AnyNode]),
    )

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    const colors = mesh.geometry.getAttribute('color')
    const paved = SURFACE_MATERIAL_AVERAGE_COLOR['paved-road']
    const expected = new Color().setRGB(paved[0], paved[1], paved[2], 'srgb')
    expect(colors?.getX(0)).toBeCloseTo(expected.r, 5)
    expect(colors?.getY(0)).toBeCloseTo(expected.g, 5)
    expect(colors?.getZ(0)).toBeCloseTo(expected.b, 5)
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

function contextFor(
  site: ReturnType<typeof SiteNode.parse>,
  sceneNodes: AnyNode[],
): GeometryContext {
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
