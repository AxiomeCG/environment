import type { AnyNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  createGrassPaintField,
  DEFAULT_GRASS_PAINT_COLOR,
  siteBounds,
  type GrassPaintField,
} from '../ground-cover/paint-field'
import { advancePaintStroke, beginPaintStroke, currentPaintField } from '../ground-cover/paint-stroke'
import {
  changedPaintTileTargets,
  composePaintTiles,
  paintTileFloorplanDependencies,
  paintTilesOf,
} from './compose'
import {
  paintTileId,
  planPaintTileChanges,
  type PaintTileChanges,
  type PaintTileTarget,
} from './plan'
import { decodePixelRuns, encodePixelRuns } from './runs'
import { PAINT_TILE_SIDE, PaintTileData } from './schema'

type Nodes = Record<string, AnyNode>

/** What a collaboration operation may carry, less the room its request envelope keeps. */
const OPERATION_CHANGE_BYTES = 64 * 1024 - 2 * 1024

const square = (side: number) =>
  [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ] as Array<[number, number]>

function lotField(side: number): GrassPaintField {
  return createGrassPaintField(siteBounds(square(side)), DEFAULT_GRASS_PAINT_COLOR, 0)
}

function applyTiles(nodes: Nodes, changes: PaintTileChanges): Nodes {
  const next: Nodes = { ...nodes }
  for (const { node } of changes.create ?? []) next[String(node.id)] = node
  for (const { id, data } of changes.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  for (const id of changes.delete ?? []) delete next[id]
  return next
}

/** A person's stroke across the middle of a lot, as the grass brush lays it. */
function strokeAcross(field: GrassPaintField, side: number, settings = {}) {
  const stroke = beginPaintStroke({ field, boundary: square(side), settings: { radius: 2, ...settings } })
  for (let x = side * 0.25; x <= side * 0.75; x += 0.25) advancePaintStroke(stroke, x, side / 2)
  return stroke
}

const target = (map: PaintTileTarget['map'] = 'paintMap'): PaintTileTarget => ({
  siteId: 'site_tiles',
  targetId: 'grass-field_tiles',
  map,
})

function composed(nodes: Nodes, base: GrassPaintField): GrassPaintField {
  return composePaintTiles(base, paintTilesOf(Object.values(nodes), 'grass-field_tiles', 'paintMap'))
}

/** Bytes of each tile change as a shared operation carries it: the old tile and the new. */
function tileChangeBytes(nodes: Nodes, changes: PaintTileChanges): number[] {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length
  return [
    ...(changes.create ?? []).map(({ node }) => bytes(node)),
    ...(changes.update ?? []).map(({ id, data }) => bytes(nodes[id]) + bytes(data)),
    ...(changes.delete ?? []).map((id) => bytes(nodes[id])),
  ]
}

describe('pixel runs', () => {
  test('round-trip any pixels exactly', () => {
    const values = new Uint8Array(37 * 4)
    for (let index = 0; index < values.length; index += 1) values[index] = (index * 7919) % 251
    values.fill(9, 40, 80)
    const runs = encodePixelRuns(values)
    expect(decodePixelRuns(runs, 37)).toEqual(values)
  })

  test('code a uniform tile in a few bytes and the worst tile in about its raw size', () => {
    const pixels = PAINT_TILE_SIDE * PAINT_TILE_SIDE
    expect(encodePixelRuns(new Uint8Array(pixels * 4)).length).toBeLessThan(200)
    const noise = new Uint8Array(pixels * 4)
    for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 31) % 256
    // One header byte per 128 literal pixels on top of the raw bytes.
    expect(encodePixelRuns(noise).length).toBe(pixels * 4 + pixels / 128)
  })

  test('refuse runs that do not hold exactly the expected pixels', () => {
    const runs = encodePixelRuns(new Uint8Array(8 * 4))
    expect(decodePixelRuns(runs, 7)).toBeNull()
    expect(decodePixelRuns(runs, 9)).toBeNull()
    expect(decodePixelRuns(runs.subarray(0, runs.length - 1), 8)).toBeNull()
    expect(PaintTileData.safeParse({
      type: 'paint-tile', origin: [0, 0], spacing: 1, cols: 2, rows: 2, runs: 'AAAAAAA=',
    }).success).toBe(false)
  })
})

describe('paint tiles', () => {
  for (const side of [16, 100]) {
    test(`a ${side} m stroke recomposed from its tiles is the stroke's own field, byte for byte`, () => {
      const base = lotField(side)
      const stroke = strokeAcross(base, side)
      const changes = planPaintTileChanges(target(), [], stroke.snapshot, currentPaintField(stroke))
      const nodes = applyTiles({}, changes)
      expect(composed(nodes, base).values).toEqual(currentPaintField(stroke).values)
    })
  }

  test('a stroke writes only the tiles it touched', () => {
    const base = lotField(16)
    const stroke = beginPaintStroke({ field: base, boundary: square(16), settings: { radius: 0.5 } })
    advancePaintStroke(stroke, 1, 1)
    const changes = planPaintTileChanges(target(), [], stroke.snapshot, currentPaintField(stroke))
    // A 1 m dab at [1, 1] (cells 0-30 at 0.05 m) lies inside the first 64-cell block.
    expect(changes.create?.map(({ node }) => String(node.id))).toEqual([
      'paint-tile_grass-field_tiles:paintMap:0:0',
    ])
    expect(changes.update).toBeUndefined()
  })

  test('tile ids are ids a shared scene operation accepts', () => {
    const id = paintTileId({ targetId: 'grass-field_0123456789abcdef', map: 'heightMap' }, -12, 7)
    expect(id).toMatch(/^[A-Za-z0-9:_-]{1,128}$/)
  })

  test('a repeated stroke updates the same tiles, and an unchanged field writes nothing', () => {
    const base = lotField(16)
    const first = strokeAcross(base, 16)
    const created = applyTiles({}, planPaintTileChanges(target(), [], first.snapshot, currentPaintField(first)))
    const tiles = paintTilesOf(Object.values(created), 'grass-field_tiles', 'paintMap')
    const before = composed(created, base)
    const second = strokeAcross(before, 16, { color: '#5a8f3c' })
    const changes = planPaintTileChanges(target(), tiles, second.snapshot, currentPaintField(second))
    expect(changes.create).toBeUndefined()
    expect(changes.update?.length).toBeGreaterThan(0)
    expect(planPaintTileChanges(target(), tiles, before, before)).toEqual({})
  })

  test('every tile change, old and new, fits one shared operation, even for noise', () => {
    for (const side of [16, 100]) {
      const base = lotField(side)
      const noisy = { radius: side, noiseAmount: 1, noiseScale: 0.05, falloff: 1 }
      const first = strokeAcross(base, side, noisy)
      const created = planPaintTileChanges(target(), [], first.snapshot, currentPaintField(first))
      const nodes = applyTiles({}, created)
      const second = strokeAcross(composed(nodes, base), side, { ...noisy, seed: 7, color: '#80a040' })
      const tiles = paintTilesOf(Object.values(nodes), 'grass-field_tiles', 'paintMap')
      const updated = planPaintTileChanges(target(), tiles, second.snapshot, currentPaintField(second))
      expect(updated.update?.length).toBeGreaterThan(0)
      for (const bytes of [...tileChangeBytes({}, created), ...tileChangeBytes(nodes, updated)]) {
        expect(bytes).toBeLessThan(OPERATION_CHANGE_BYTES)
      }
    }
  })

  test('tiles from a lot that has since grown are resampled, then folded away by the next write', () => {
    // A 20 m lot paints at 0.05 m; grown to 40 m, its lattice coarsens past 513 cells a side.
    const small = lotField(20)
    const stroke = strokeAcross(small, 20)
    let nodes = applyTiles({}, planPaintTileChanges(target(), [], stroke.snapshot, currentPaintField(stroke)))
    const grown = lotField(40)
    expect(grown.spacing).toBeGreaterThan(small.spacing)
    const resampled = composed(nodes, grown)
    const at = (field: GrassPaintField, x: number, z: number) => {
      const col = Math.round((x - field.origin[0]) / field.spacing)
      const row = Math.round((z - field.origin[1]) / field.spacing)
      return field.values[(row * field.cols + col) * 4 + 3]
    }
    expect(at(resampled, 10, 10)).toBe(255)
    expect(at(resampled, 30, 30)).toBe(0)

    const next = beginPaintStroke({ field: resampled, boundary: square(40), settings: { radius: 1 } })
    advancePaintStroke(next, 35, 35)
    const stale = paintTilesOf(Object.values(nodes), 'grass-field_tiles', 'paintMap')
    const changes = planPaintTileChanges(target(), stale, next.snapshot, currentPaintField(next))
    nodes = applyTiles(nodes, changes)
    const remaining = paintTilesOf(Object.values(nodes), 'grass-field_tiles', 'paintMap')
    expect(remaining.every((tile) => tile.tile.spacing === grown.spacing)).toBe(true)
    expect(composed(nodes, grown).values).toEqual(currentPaintField(next).values)
  })

  test('a tile commit names the node to redraw, in 3D and in plan', () => {
    const base = lotField(16)
    const stroke = strokeAcross(base, 16)
    const nodes = applyTiles({}, planPaintTileChanges(target(), [], stroke.snapshot, currentPaintField(stroke)))
    const ids = Object.keys(nodes)
    expect(changedPaintTileTargets(nodes, {}, ids)).toEqual(new Set(['grass-field_tiles']))
    expect(changedPaintTileTargets({}, nodes, ids)).toEqual(new Set(['grass-field_tiles']))
    expect(paintTileFloorplanDependencies({ id: 'grass-field_tiles' }, nodes).map(String)).toEqual(
      ids.sort(),
    )
  })
})
