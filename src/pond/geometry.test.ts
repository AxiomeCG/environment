import {
  type AnyNode,
  type AnyNodeId,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  SiteNode,
  type SiteNode as SiteNodeValue,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import { buildPondGeometry } from './geometry'
import { PondNode } from './schema'

const BASIN_ROWS = [
  [6, 6, 6, 6, 6, 6, 6],
  [6, 2, 1, 4, 2, 2, 6],
  [6, 1, 0, 4, 2, 7, 6],
  [6, 2, 1, 3, 2, 1, 5],
  [6, 2, 1, 4, 2, 1, 6],
  [6, 3, 2, 4, 3, 2, 6],
  [6, 6, 6, 6, 6, 6, 6],
] as const

describe('pond geometry', () => {
  test('renders separate below-saddle pond records at both minima', () => {
    const terrain = createTerrainField({
      origin: [0, 0],
      spacing: 1,
      cols: BASIN_ROWS[0].length,
      rows: BASIN_ROWS.length,
      step: 1,
    })
    terrain.heights.set(BASIN_ROWS.flat())
    const site = SiteNode.parse({
      id: 'site_shallow_ponds',
      children: ['pond_shallow_left', 'pond_shallow_right'],
      polygon: { type: 'polygon', points: [[0, 0], [6, 0], [6, 6], [0, 6]] },
      terrain: encodeTerrainField(terrain),
    })
    const left = PondNode.parse({
      id: 'pond_shallow_left',
      parentId: site.id,
      seed: [2, 2],
      waterLevel: 2,
    })
    const right = PondNode.parse({
      id: 'pond_shallow_right',
      parentId: site.id,
      seed: [5, 3],
      waterLevel: 2,
    })
    const sceneNodes = [site, left, right]
    const siblings = [left, right]

    const leftGeometry = buildPondGeometry(left, contextFor(site, sceneNodes, siblings))
    const rightGeometry = buildPondGeometry(right, contextFor(site, sceneNodes, siblings))

    for (const geometry of [leftGeometry, rightGeometry]) {
      expect(geometry.userData.waterLevel).toBe(2)
      expect(geometry.userData.waterArea).toBeGreaterThan(0)
      expect(geometry.children.some((child) => child instanceof Mesh)).toBe(true)
    }
  })
})

function contextFor(
  site: SiteNodeValue,
  sceneNodes: readonly unknown[],
  siblings: readonly unknown[],
): GeometryContext {
  const pluginNodes = sceneNodes as readonly AnyNode[]
  const nodes = Object.fromEntries(pluginNodes.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  return {
    parent: site,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: siblings as AnyNode[],
  }
}
