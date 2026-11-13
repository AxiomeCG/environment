import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
} from '@pascal-app/core'
import { expect, test } from 'bun:test'
import { PondNode } from '../pond/schema'
import { resolveSurfaceMaterialField } from './field'
import { surfaceSheetCut, updateSurfaceSheetCut } from './geometry'
import { SurfaceMaterialNode } from './schema'
import {
  createSurfacePaintTexture,
  disposeSurfacePaintTexture,
  setSurfaceSheetCut,
  updateSurfacePaintTextures,
} from './texture'

/**
 * The Surface is a sheet draped 5 mm over the whole lot. Where another node opens the ground (a
 * pool cut into the lot) the sheet would lie over it as a lid, so its own paint is cut out there.
 * The cut is made in the paint texture the sheet already samples, not with one more texture: the
 * material is at the limit a fragment stage may sample. What only stands on the lot (a hedge, a
 * rock) and Environment's own water leave the sheet whole: the ground under a hedge stays green
 * and a pond keeps its bed.
 */

type Nodes = Record<string, AnyNode>

function withPoolKind(run: () => void): void {
  const registryDefinitions = Array.from(nodeRegistry.entries(), ([, definition]) => definition)
  try {
    registerNode({
      kind: 'pool:pool',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'utility',
      defaults: () => ({}) as never,
      capabilities: {
        floorPlaced: {
          footprint: (node: { rotation: [number, number, number] }) => ({
            dimensions: [4.6, 1.5, 2.6],
            rotation: node.rotation,
          }),
        },
      },
    } as unknown as AnyNodeDefinition)
    run()
  } finally {
    nodeRegistry._reset()
    for (const definition of registryDefinitions) registerNode(definition)
  }
}

const surface = SurfaceMaterialNode.parse({ id: 'surface-material_lot', parentId: 'site_lot' })
const pool = {
  id: 'pool_lot', type: 'pool:pool', object: 'node', parentId: 'level_lot', visible: true,
  metadata: {}, position: [6, 0, 4], rotation: [0, 0, 0], copingWidth: 0.3,
  polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]],
} as unknown as AnyNode

function lot(...extra: AnyNode[]): Nodes {
  const site = SiteNode.parse({
    id: 'site_lot', children: ['building_lot', surface.id],
    polygon: { type: 'polygon', points: [[0, 0], [12, 0], [12, 12], [0, 12]] },
  })
  const building = BuildingNode.parse({
    id: 'building_lot', parentId: site.id, children: ['level_lot'], position: [1, 0, 1],
  })
  const level = LevelNode.parse({
    id: 'level_lot', parentId: building.id, level: 0,
    children: extra.filter((node) => node.parentId === 'level_lot').map((node) => node.id),
  })
  const nodes = [site, building, level, surface as unknown as AnyNode, ...extra] as AnyNode[]
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

/** A surface painted all over: every cell holds the first material at full weight. */
function paintedField() {
  const field = resolveSurfaceMaterialField(undefined, { minX: 0, maxX: 12, minZ: 0, maxZ: 12 })
  const values = new Uint8Array(field.values.length)
  for (let offset = 0; offset < values.length; offset += 4) values[offset] = 255
  return { ...field, values }
}

const paintAtCell = (texture: { image: { data: unknown } }, field: { origin: readonly number[]; spacing: number; cols: number }, x: number, z: number) => {
  const col = Math.round((x - (field.origin[0] ?? 0)) / field.spacing)
  const row = Math.round((z - (field.origin[1] ?? 0)) / field.spacing)
  return (texture.image.data as Uint8Array)[(row * field.cols + col) * 4] ?? 0
}

test('the sheet is cut out over a pool and nowhere else, whichever came first', () => {
  withPoolKind(() => {
    // Level (6, 4) is site (7, 5): water 5..9 x 4..6, coping 0.3 round it.
    const withPool = lot(pool)
    const without = lot()
    const field = paintedField()
    setSurfaceSheetCut(surface.id, surfaceSheetCut(field, withPool.site_lot as SiteNode, withPool))
    const sheet = createSurfacePaintTexture(surface.id, field, true)
    // The lawn's underlay reads the same paint, uncut: the lawn has its own mask.
    const underlay = createSurfacePaintTexture(surface.id, field)
    try {
      expect(paintAtCell(sheet, field, 7, 5)).toBe(0)
      expect(paintAtCell(sheet, field, 9.2, 5)).toBe(0)
      expect(paintAtCell(sheet, field, 10, 5)).toBe(255)
      expect(paintAtCell(sheet, field, 7, 8)).toBe(255)
      expect(paintAtCell(underlay, field, 7, 5)).toBe(255)

      // A paint stroke redraws both from the paint; the sheet keeps its cut.
      expect(updateSurfacePaintTextures(surface.id, field)).toBe(true)
      expect(paintAtCell(sheet, field, 7, 5)).toBe(0)
      expect(paintAtCell(underlay, field, 7, 5)).toBe(255)

      // The pool goes: the sheet is whole again, without a rebuild. And comes back.
      expect(updateSurfaceSheetCut(surface, without.site_lot as SiteNode, without)).toBe(true)
      expect(paintAtCell(sheet, field, 7, 5)).toBe(255)
      expect(updateSurfaceSheetCut(surface, withPool.site_lot as SiteNode, withPool)).toBe(true)
      expect(paintAtCell(sheet, field, 7, 5)).toBe(0)
      expect(paintAtCell(sheet, field, 10, 5)).toBe(255)
    } finally {
      disposeSurfacePaintTexture(surface.id, sheet)
      disposeSurfacePaintTexture(surface.id, underlay)
    }
  })
})

test('a hedge, a rock and a paved slab leave the sheet whole: the ground under them stays', () => {
  withPoolKind(() => {
    const hedge = ItemNode.parse({
      id: 'item_hedge', parentId: 'level_lot', position: [6, 0, 4],
      asset: { id: 'asset_hedge', category: 'outdoor', name: 'Hedge', thumbnail: '', src: 'asset://hedge', dimensions: [3, 1.2, 0.8] },
    }) as AnyNode
    const rock = { id: 'rock_lot', type: 'rock', object: 'node', parentId: 'site_lot', visible: true, metadata: {}, polygon: [[2, 8], [4, 8], [3, 10]] } as unknown as AnyNode
    const nodes = lot(hedge, rock)
    expect(surfaceSheetCut(paintedField(), nodes.site_lot as SiteNode, nodes)).toBeNull()
  })
})

test('the sheet stays under an Environment pond: the water keeps its bed', () => {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 2, cols: 7, rows: 7, step: 1 })
  terrain.heights.set([
    5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0,
    0, 0, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5,
  ])
  const pond = PondNode.parse({ id: 'pond_lot', parentId: 'site_lot', seed: [6, 6], waterLevel: 2 }) as unknown as AnyNode
  const nodes = lot(pond)
  nodes.site_lot = {
    ...(nodes.site_lot as SiteNode),
    children: ['building_lot', surface.id, pond.id],
    terrain: encodeTerrainField(terrain),
  } as AnyNode
  expect(surfaceSheetCut(paintedField(), nodes.site_lot as SiteNode, nodes)).toBeNull()
})
