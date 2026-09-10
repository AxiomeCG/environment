import {
  type AnyNode,
  type AnyNodeId,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  type SiteNode as SiteNodeValue,
  SiteNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { Mesh, type Object3D } from 'three'
import { buildPondGeometry } from './geometry'
import { buildPondFloorplan } from './floorplan'
import { PondNode } from './schema'

const BASIN_HEIGHTS = [
  [6, 6, 4, 6, 6],
  [6, 3, 2, 3, 6],
  [6, 2, 0, 2, 6],
  [6, 3, 2, 3, 6],
  [6, 6, 6, 6, 6],
] as const

describe('pond floorplan geometry', () => {
  test('a hidden connected pond cannot erase or alter visible water', () => {
    const terrain = createTerrainField({
      origin: [0, 0],
      spacing: 1,
      cols: BASIN_HEIGHTS[0].length,
      rows: BASIN_HEIGHTS.length,
      step: 1,
    })
    terrain.heights.set(BASIN_HEIGHTS.flat())
    const site = SiteNode.parse({
      id: 'site_pond_floorplan',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
      terrain: encodeTerrainField(terrain),
    })
    const visible = PondNode.parse({
      id: 'pond_visible_floorplan',
      parentId: site.id,
      seed: [2, 2],
      visible: true,
      waterLevel: 1,
    })
    const hidden = PondNode.parse({
      id: 'pond_hidden_floorplan',
      parentId: site.id,
      seed: [2, 2],
      visible: false,
      waterLevel: 3,
      props: [
        {
          id: 'hidden_lily',
          kind: 'water-lily',
          position: [2, 2],
          yaw: 0,
          scale: 1,
        },
      ],
    })

    const withoutHidden = buildPondFloorplan(visible, contextFor(site, [visible], [visible]))
    const withHidden = buildPondFloorplan(
      visible,
      contextFor(site, [visible, hidden], [visible, hidden]),
    )

    expectVisibleWater(withoutHidden)
    expectVisibleWater(withHidden)
    expect(withHidden).toEqual(withoutHidden)
    const runtimeWithoutHidden = buildPondGeometry(visible, contextFor(site, [visible], [visible]))
    const runtimeWithHidden = buildPondGeometry(
      visible,
      contextFor(site, [visible, hidden], [visible, hidden]),
    )
    expect(runtimeWithHidden.userData).toEqual(runtimeWithoutHidden.userData)
    expect(meshSummary(runtimeWithHidden)).toEqual(meshSummary(runtimeWithoutHidden))
  })
})

function expectVisibleWater(geometry: FloorplanGeometry | null): void {
  expect(geometry?.kind).toBe('group')
  if (!geometry || geometry.kind !== 'group') return
  const water = geometry.children.find(
    (child) => child.kind === 'path' && child.fill !== undefined && child.fill !== 'none',
  )
  expect(water?.kind).toBe('path')
  if (!water || water.kind !== 'path') return
  expect(water.d.length).toBeGreaterThan(0)
  const area = water.metadata?.pondArea
  expect(typeof area).toBe('number')
  if (typeof area === 'number') expect(area).toBeGreaterThan(0)
}

function meshSummary(root: Object3D): Array<{ name: string; vertices: number }> {
  const summary: Array<{ name: string; vertices: number }> = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    summary.push({
      name: object.name,
      vertices: object.geometry.getAttribute('position').count,
    })
  })
  return summary
}

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
