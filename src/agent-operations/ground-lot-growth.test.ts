import { SiteNode, type AnyNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { GRASS_FIELD_KIND, type GrassFieldNode } from '../ground-cover/schema'
import {
  hexToRgb,
  paintAt,
  siteBounds,
  type GrassPaintField,
} from '../ground-cover/paint-field'
import { decodeLocalHeightScale } from '../ground-cover/height-field'
import {
  resolveGroundCoverHeight,
  resolveGroundCoverPaint,
  resolveSurfacePaint,
} from '../paint-tiles/layers'
import { surfaceMaterialWeightsAt } from '../surface-material/field'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from '../surface-material/schema'
import { environmentAgentOperations } from './index'
import type { SceneChanges } from './types'

// Coolum's order (27 Oct): lay_ground on a 30 x 30 m lot, then set_site_lot made it 7 m deeper
// at the front. set_site_lot (and a drag of the property line) writes only the site's polygon, so
// the ground paint stopped at the old edge and the new land drew as bare ground.

type Nodes = Record<string, AnyNode>

const TINT = '#668251'
const SIDE = 30
const GROWN = 37
const lot = (depth: number) => [
  [0, 0],
  [SIDE, 0],
  [SIDE, depth],
  [0, depth],
]

function lotOf(depth: number): Nodes {
  const site = SiteNode.parse({
    id: 'site_lot',
    polygon: { type: 'polygon', points: lot(depth) },
    children: [],
  })
  return { [site.id]: site as AnyNode }
}

function applyChanges(nodes: Nodes, changes: SceneChanges | undefined): Nodes {
  const next: Nodes = { ...nodes }
  for (const { node, parentId } of changes?.create ?? []) {
    next[String(node.id)] = node
    const parent = parentId ? (next[parentId] as AnyNode & { children?: string[] }) : undefined
    if (parent?.children)
      next[parent.id] = { ...parent, children: [...parent.children, String(node.id)] } as AnyNode
  }
  for (const { id, data } of changes?.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes?.delete ?? []) delete next[id]
  return next
}

function layGround(nodes: Nodes, areas: unknown[]) {
  const operation = environmentAgentOperations.lay_ground
  if (!operation) throw new Error('lay_ground missing')
  const outcome = operation(nodes, { areas } as never, { activeLevelId: null })
  return { ...outcome, nodes: applyChanges(nodes, outcome.changes) }
}

/** What `set_site_lot` and a drag of the property line do: the polygon, and nothing else. */
function growLot(nodes: Nodes, depth: number): Nodes {
  return {
    ...nodes,
    site_lot: {
      ...nodes.site_lot,
      polygon: { type: 'polygon', points: lot(depth) },
    } as unknown as AnyNode,
  }
}

/** The lawn laid over the whole lot, and a paving strip along its front edge (the footpath). */
function lawnAndFootpath(): Nodes {
  return layGround(lotOf(SIDE), [
    { site: true, ground: 'grass', tint: TINT, grassHeight: 0.8 },
    { polygon: [[0, SIDE - 0.66], [SIDE, SIDE - 0.66], [SIDE, SIDE], [0, SIDE]], ground: 'paving' },
  ]).nodes
}

type Layers = {
  paint: GrassPaintField
  height: GrassPaintField
  surface: GrassPaintField
}

function layersOf(nodes: Nodes): Layers {
  const all = Object.values(nodes)
  const site = nodes.site_lot as SiteNode
  const bounds = siteBounds(site.polygon.points)
  const grass = all.find((node) => String(node.type) === GRASS_FIELD_KIND) as unknown as GrassFieldNode
  const surface = all.find(
    (node) => String(node.type) === SURFACE_MATERIAL_KIND,
  ) as unknown as SurfaceMaterialNode
  return {
    paint: resolveGroundCoverPaint(grass, all, bounds),
    height: resolveGroundCoverHeight(grass, all, bounds),
    surface: resolveSurfacePaint(surface, all, bounds),
  }
}

/** The lawn's cells and the lot's own: sampled where the person would look. */
const STRIP = { x: 15, z: 33 }
const OLD_LAWN = { x: 15, z: 10 }
const FOOTPATH = { x: 15, z: SIDE - 0.3 }

describe('ground laid over the whole lot, then the lot grows', () => {
  test('the new land reads as the lot’s ground: its grass, its tint, its height, its surface', () => {
    const grown = layersOf(growLot(lawnAndFootpath(), GROWN))

    const grass = paintAt(grown.paint, STRIP.x, STRIP.z)
    const tint = hexToRgb(TINT)
    expect(grass.a).toBe(1)
    expect([grass.r * 255, grass.g * 255, grass.b * 255].map(Math.round)).toEqual([
      tint.r,
      tint.g,
      tint.b,
    ])
    expect(decodeLocalHeightScale(paintAt(grown.height, STRIP.x, STRIP.z).r)).toBeCloseTo(0.8, 1)
    expect(paintAt(grown.surface, STRIP.x, STRIP.z).a).toBe(1)
    expect(surfaceMaterialWeightsAt(grown.surface, STRIP.x, STRIP.z)).toEqual([1, 0, 0, 0])
  })

  test('the whole new strip is covered, to the new edge, with no seam at the old one', () => {
    const grown = layersOf(growLot(lawnAndFootpath(), GROWN))

    for (let z = SIDE + 0.05; z <= GROWN; z += 0.05) {
      for (const x of [0.5, 7, 15, 22.5, 29.5]) {
        expect(paintAt(grown.paint, x, z).a).toBe(1)
        expect(paintAt(grown.surface, x, z).a).toBe(1)
      }
    }
  })

  test('the lot as it was is left alone: the lawn stays, the footpath stays paved and is not smeared', () => {
    const before = layersOf(lawnAndFootpath())
    const grown = layersOf(growLot(lawnAndFootpath(), GROWN))

    for (const at of [OLD_LAWN, FOOTPATH]) {
      expect(paintAt(grown.paint, at.x, at.z).a).toBeCloseTo(paintAt(before.paint, at.x, at.z).a, 1)
      expect(surfaceMaterialWeightsAt(grown.surface, at.x, at.z)).toEqual(
        surfaceMaterialWeightsAt(before.surface, at.x, at.z),
      )
    }
    expect(surfaceMaterialWeightsAt(grown.surface, FOOTPATH.x, FOOTPATH.z)[3]).toBeGreaterThan(0.8)
    // The strip beyond the footpath is lawn, not the footpath's paving carried on.
    expect(surfaceMaterialWeightsAt(grown.surface, STRIP.x, STRIP.z)[3]).toBe(0)
  })

  test('the lot’s edge is not feathered into nothing: its last cells are as covered as the lawn', () => {
    const laid = layGround(lotOf(SIDE), [{ site: true, ground: 'grass' }]).nodes
    const { paint, surface } = layersOf(laid)

    for (const z of [0.01, SIDE - 0.01]) {
      expect(paintAt(paint, 15, z).a).toBe(1)
      expect(paintAt(surface, 15, z).a).toBe(1)
    }
  })

  test('land painted later on the new strip, or erased from it, stays as it was painted', () => {
    const grown = growLot(lawnAndFootpath(), GROWN)
    const path = layGround(grown, [
      { path: { points: [[4, SIDE + 1], [4, GROWN - 1]], widthM: 2 }, ground: 'path', featherM: 0 },
      { polygon: [[20, 31], [26, 31], [26, 35], [20, 35]], ground: 'none', featherM: 0 },
    ]).nodes
    const { paint, surface } = layersOf(path)

    expect(surfaceMaterialWeightsAt(surface, 4, 33)[1]).toBeGreaterThan(0.9)
    expect(paintAt(paint, 4, 33).a).toBe(0)
    expect(paintAt(paint, 23, 33).a).toBe(0)
    expect(paintAt(surface, 23, 33).a).toBe(0)
    expect(paintAt(paint, 12, 33).a).toBe(1)
  })

  test('laying the whole lot again names the ground the next growth reads as', () => {
    const paved = layGround(growLot(lawnAndFootpath(), GROWN), [{ site: true, ground: 'paving' }])
    expect((paved.result.lotGround as { ground: string }).ground).toBe('paving')

    const regrown = layersOf(growLot(paved.nodes, 44))
    expect(surfaceMaterialWeightsAt(regrown.surface, 15, 41)[3]).toBe(1)
    expect(paintAt(regrown.paint, 15, 41).a).toBe(0)

    const cleared = layGround(growLot(lawnAndFootpath(), GROWN), [{ site: true, ground: 'none' }])
    const bare = layersOf(growLot(cleared.nodes, 44))
    expect(paintAt(bare.surface, 15, 41).a).toBe(0)
    expect(paintAt(bare.paint, 15, 41).a).toBe(0)
  })

  test('ground laid over part of the lot is not carried over onto land the lot grows into', () => {
    const partial = layGround(lotOf(SIDE), [
      { polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], ground: 'grass' },
    ]).nodes
    const grown = layersOf(growLot(partial, GROWN))

    expect(paintAt(grown.paint, 5, 5).a).toBe(1)
    expect(paintAt(grown.paint, STRIP.x, STRIP.z).a).toBe(0)
    expect(paintAt(grown.surface, STRIP.x, STRIP.z).a).toBe(0)
  })

  test('a lot that is not a rectangle reads its new land the same way', () => {
    const grown = growLot(lawnAndFootpath(), GROWN)
    const lShaped = {
      ...grown,
      site_lot: {
        ...grown.site_lot,
        polygon: {
          type: 'polygon',
          points: [[0, 0], [SIDE, 0], [SIDE, GROWN], [12, GROWN], [12, SIDE + 3], [0, SIDE + 3]],
        },
      },
    } as unknown as Nodes
    const { paint } = layersOf(lShaped)

    expect(paintAt(paint, 20, 34).a).toBe(1)
    expect(paintAt(paint, 15, 10).a).toBe(1)
  })

  test('a project laid before the lot’s ground was kept keeps its strip bare until lay_ground runs again', () => {
    const legacy = lawnAndFootpath()
    for (const node of Object.values(legacy)) {
      if (String(node.type) === GRASS_FIELD_KIND || String(node.type) === SURFACE_MATERIAL_KIND) {
        delete (node as { lotGround?: unknown }).lotGround
      }
    }
    const grown = layersOf(growLot(legacy, GROWN))

    expect(paintAt(grown.paint, STRIP.x, STRIP.z).a).toBe(0)
    expect(paintAt(grown.surface, STRIP.x, STRIP.z).a).toBe(0)
  })

  test('records the lot’s ground on both nodes, and says so in the result', () => {
    const laid = layGround(lotOf(SIDE), [
      { site: true, ground: 'grass', tint: TINT, grassHeight: 0.8 },
    ])
    expect(laid.result.lotGround).toEqual({ ground: 'grass', tint: TINT, grassHeight: 0.8 })
    for (const kind of [GRASS_FIELD_KIND, SURFACE_MATERIAL_KIND]) {
      const node = Object.values(laid.nodes).find((entry) => String(entry.type) === kind)
      expect((node as { lotGround?: unknown }).lotGround).toMatchObject({
        ground: 'grass',
        lot: lot(SIDE),
      })
    }

    const partial = layGround(lotOf(SIDE), [
      { polygon: [[0, 0], [5, 0], [5, 5], [0, 5]], ground: 'grass' },
    ])
    expect(partial.result.lotGround).toBeUndefined()
  })
})
