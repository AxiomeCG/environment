import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type AnyNode,
  type FloorplanGeometry,
  type GeometryContext,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { buildRiverFloorplan } from './floorplan'
import { buildRiverSurface } from './geometry'
import { RiverNode } from './schema'

/** The 20 m test lot on ground falling 10 % toward +x. */
function fallingSite() {
  const terrain = createTerrainField({ origin: [-10, -10], spacing: 0.5, cols: 41, rows: 41, step: 0.01 })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const x = terrain.origin[0] + col * terrain.spacing
      terrain.heights[row * terrain.cols + col] = Math.round((2 - 0.1 * x) / terrain.step)
    }
  }
  return SiteNode.parse({
    id: 'site_river_floorplan',
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    terrain: encodeTerrainField(terrain),
  })
}

function downhillRiver(points: readonly (readonly [number, number])[]) {
  return RiverNode.parse({ id: 'river_floorplan', parentId: 'site_river_floorplan', points, flow: 'downhill' })
}

// Review round 2 input: a path crossing itself at the origin on falling ground.
const crossing = downhillRiver([
  [-8, -8],
  [8, 8],
  [-8, 8],
  [8, -8],
])
const straight = downhillRiver([
  [-8, 0],
  [8, 0],
])

function outlineOf(node: RiverNode): FloorplanGeometry | undefined {
  const context = { parent: fallingSite() as AnyNode } as GeometryContext
  const floorplan = buildRiverFloorplan(node, context)
  return floorplan?.kind === 'group' ? floorplan.children[0] : undefined
}

describe('a river refused for meeting itself at two water levels', () => {
  test('has no water', () => {
    expect(buildRiverSurface(crossing, fallingSite())).toBeNull()
    expect(buildRiverSurface(straight, fallingSite())).not.toBeNull()
  })

  test('keeps a selectable floorplan outline, drawn empty and dashed', () => {
    expect(outlineOf(crossing)).toMatchObject({ kind: 'polygon', fill: 'none', strokeDasharray: '4 3' })
    expect(outlineOf(straight)).not.toMatchObject({ fill: 'none' })
    expect(outlineOf(straight)).not.toHaveProperty('strokeDasharray')
  })
})
