import { type AnyNode, SiteNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { changedGrassObstacleSiteIds } from './ground-cover/obstacle-adapter'
import { GrassFieldNode } from './ground-cover/schema'
import { grassFieldSiteChanges } from './ground-cover/system'
import { PondNode } from './pond/schema'
import { pondSiteChanges } from './pond/system'
import { SurfaceMaterialNode } from './surface-material/schema'
import { surfaceSiteChanges } from './surface-material/system'
import { sitesWithChangedTerrainNodes } from './terrain-nodes'

type Nodes = Record<string, AnyNode>

/** Ground as the host's terrain tools leave it: nodes under the Site, `site.terrain` untouched. */
const tile = (id: string, siteId: string, heights: string) =>
  ({ id, type: 'terrain-tile', parentId: siteId, ix: 0, iz: 0, step: 0.01, heights }) as unknown as AnyNode
const terrainBreak = (id: string, siteId: string, left: number) =>
  ({ id, type: 'terrain-break', parentId: siteId, line: [[0, 0], [4, 0]], left, right: 0 }) as unknown as AnyNode

const site = SiteNode.parse({
  id: 'site_reshaped',
  polygon: { type: 'polygon', points: [[0, 0], [8, 0], [8, 8], [0, 8]] },
  children: [],
})
const other = SiteNode.parse({ ...site, id: 'site_other' })
const grass = GrassFieldNode.parse({ id: 'grass-field_lawn', parentId: site.id }) as unknown as AnyNode
const surface = SurfaceMaterialNode.parse({ id: 'surface-material_lawn', parentId: site.id }) as unknown as AnyNode
const pond = PondNode.parse({ id: 'pond_basin', parentId: site.id, seed: [4, 4], waterLevel: 0 }) as unknown as AnyNode

const scene = (...nodes: AnyNode[]): Nodes => Object.fromEntries(nodes.map((node) => [node.id, node]))
const base = [site as AnyNode, other as AnyNode, grass, surface, pond]
const before = scene(...base, tile('terrain-tile_a', site.id, 'AAAA'))

/** The same Site object before and after: nothing but the terrain nodes differs. */
const reshapes: [string, Nodes, Nodes][] = [
  ['a tile is rewritten', before, scene(...base, tile('terrain-tile_a', site.id, 'BBBB'))],
  ['a tile is added', scene(...base), before],
  ['a tile is removed', before, scene(...base)],
  ['a break is added', before, scene(...base, before['terrain-tile_a'] as AnyNode, terrainBreak('terrain-break_wall', site.id, 1.2))],
  ['a break is moved', scene(...base, terrainBreak('terrain-break_wall', site.id, 1.2)), scene(...base, terrainBreak('terrain-break_wall', site.id, 0.6))],
]

describe('ground the host reshapes through terrain nodes', () => {
  test.each(reshapes)('%s: the lawn, the surface and the pond follow', (_name, previous, current) => {
    expect(sitesWithChangedTerrainNodes(current, previous)).toEqual(new Set([site.id]))
    expect(grassFieldSiteChanges(current, previous)).toEqual([
      { id: grass.id, boundaryChanged: false, terrainChanged: true },
    ])
    expect(surfaceSiteChanges(current, previous)).toEqual([
      { id: surface.id, boundaryChanged: false, terrainChanged: true },
    ])
    expect(pondSiteChanges(current, previous)).toEqual([
      { id: pond.id, boundaryChanged: false, terrainChanged: true },
    ])
    // The water's edge moves with the ground: the grass mask of a site with water is redrawn.
    expect(changedGrassObstacleSiteIds(current, previous)).toEqual(new Set([site.id]))
  })

  test('the ids the store says changed are enough to find the reshaped site', () => {
    const current = scene(...base, tile('terrain-tile_a', site.id, 'BBBB'))
    expect(sitesWithChangedTerrainNodes(current, before, new Set(['terrain-tile_a']))).toEqual(new Set([site.id]))
    expect(sitesWithChangedTerrainNodes(current, before, new Set([grass.id]))).toEqual(new Set())
    expect(grassFieldSiteChanges(current, before, new Set(['terrain-tile_a']))).toEqual([
      { id: grass.id, boundaryChanged: false, terrainChanged: true },
    ])
  })

  test('another site\'s ground, an untouched tile and other nodes move nothing', () => {
    const elsewhere = scene(...base, before['terrain-tile_a'] as AnyNode, tile('terrain-tile_b', other.id, 'CCCC'))
    expect(sitesWithChangedTerrainNodes(elsewhere, before)).toEqual(new Set([other.id]))
    expect(grassFieldSiteChanges(elsewhere, before)).toEqual([])
    expect(surfaceSiteChanges(elsewhere, before)).toEqual([])
    expect(pondSiteChanges(elsewhere, before)).toEqual([])
    expect(changedGrassObstacleSiteIds(elsewhere, before)).toEqual(new Set())

    const renamed = { ...before, [grass.id]: { ...grass, name: 'Lawn' } as AnyNode }
    expect(sitesWithChangedTerrainNodes(renamed, before)).toEqual(new Set())
    expect(grassFieldSiteChanges(renamed, before)).toEqual([])
  })

  test('a site without water keeps its grass mask when only the ground moves', () => {
    const dry = [site as AnyNode, grass]
    expect(
      changedGrassObstacleSiteIds(
        scene(...dry, tile('terrain-tile_a', site.id, 'BBBB')),
        scene(...dry, tile('terrain-tile_a', site.id, 'AAAA')),
      ),
    ).toEqual(new Set())
  })
})
