import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  surfaceHeightAt,
  type AnyNode,
  type AnyNodeId,
  type SiteNode as SiteNodeType,
  type TerrainField,
} from '@pascal-app/core'
import { riverDeleteTerrainUpdates } from './definition'
import { RiverNode, type RiverNode as RiverNodeType } from './schema'
import {
  rebuildRiverTerrain,
  riverTerrainBaseline,
  sampleRiverPath,
  type RiverTerrainResult,
} from './terrain'

function flatTerrain(height = 0): TerrainField {
  const terrain = createTerrainField({
    origin: [-10, -10],
    spacing: 0.5,
    cols: 41,
    rows: 41,
    step: 0.01,
  })
  if (height === 0) return terrain
  const value = Math.round(height / terrain.step)
  const heights = new Int16Array(terrain.heights.length)
  heights.fill(value)
  return { ...terrain, heights }
}

function siteWith(terrain = flatTerrain()): SiteNodeType {
  return SiteNode.parse({
    id: 'site_river_terrain',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: { retained: 'site-metadata' },
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
    children: [],
  })
}

function river(
  id: string,
  overrides: Partial<Pick<RiverNodeType, 'points' | 'width' | 'depth' | 'source' | 'outlet'>> = {},
): RiverNodeType {
  return RiverNode.parse({
    id,
    type: 'environment:river',
    object: 'node',
    parentId: 'site_river_terrain',
    visible: true,
    metadata: {},
    name: 'River',
    points: overrides.points ?? [
      [-8, 0],
      [8, 0],
    ],
    width: overrides.width ?? 4,
    depth: overrides.depth ?? 1,
    source: overrides.source ?? 'rounded',
    outlet: overrides.outlet ?? 'rounded',
    flowDirection: 'forward',
    flowSpeed: 0.6,
    quality: 'clear',
    shoreline: 'soft',
  })
}

function siteAfter(site: SiteNodeType, result: RiverTerrainResult): SiteNodeType {
  return SiteNode.parse({
    ...site,
    terrain: result.terrainData,
    metadata: result.metadata,
  })
}

describe('river terrain reconciliation', () => {
  test('revising depth always regenerates from the original terrain', () => {
    const site = siteWith()
    const shallow = rebuildRiverTerrain(site, [river('river_depth', { depth: 1 })])
    const deep = rebuildRiverTerrain(siteAfter(site, shallow), [river('river_depth', { depth: 2 })])
    const revised = rebuildRiverTerrain(siteAfter(site, deep), [
      river('river_depth', { depth: 0.5 }),
    ])

    expect(surfaceHeightAt(shallow.terrain, 0, 0)).toBeCloseTo(-1, 2)
    expect(surfaceHeightAt(deep.terrain, 0, 0)).toBeCloseTo(-2, 2)
    expect(surfaceHeightAt(revised.terrain, 0, 0)).toBeCloseTo(-0.5, 2)
    expect(riverTerrainBaseline(siteAfter(site, revised))?.heights).toEqual(flatTerrain().heights)
  })

  test('overlapping channels use the deepest cut independent of river order', () => {
    const site = siteWith()
    const horizontal = river('river_horizontal', { depth: 1.25 })
    const vertical = river('river_vertical', {
      points: [
        [0, -8],
        [0, 8],
      ],
      width: 3,
      depth: 2.5,
    })
    const first = rebuildRiverTerrain(site, [horizontal, vertical])
    const second = rebuildRiverTerrain(site, [vertical, horizontal])

    expect(Array.from(first.terrain.heights)).toEqual(Array.from(second.terrain.heights))
    expect(surfaceHeightAt(first.terrain, 0, 0)).toBeCloseTo(-2.5, 2)
  })

  test('keeps authored endpoints full-width and closes each rounded cap compactly', () => {
    const sourceSite = siteWith()
    const source = flatTerrain()
    const node = river('river_rounded_caps', {
      points: [
        [-4, 0],
        [4, 0],
      ],
      width: 8,
    })
    const path = sampleRiverPath(source, node, sourceSite.polygon.points)
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])

    expect(path?.points[0]?.[0]).toBeCloseTo(-8, 6)
    expect(path?.points.at(-1)?.[0]).toBeCloseTo(8, 6)
    expect(path?.authoredStartDistance).toBeCloseTo(4, 6)
    expect(surfaceHeightAt(rebuilt.terrain, -4, 2.5)).toBeLessThan(-0.1)
    expect(surfaceHeightAt(rebuilt.terrain, -7.5, 0)).toBeLessThan(-0.1)
    expect(surfaceHeightAt(rebuilt.terrain, -9, 0)).toBeCloseTo(0, 6)
  })

  test('leaves no uncut shoreline wedges between curved river segments', () => {
    const sourceSite = siteWith()
    const node = river('river_shoreline_joins', {
      points: [
        [-7, -6],
        [-5, -2],
        [-2, 4],
        [3, 5],
        [6, 0],
        [7, -6],
      ],
      width: 4,
      depth: 3,
    })
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])
    const path = sampleRiverPath(flatTerrain(), node, sourceSite.polygon.points)!
    const uncut: [number, number, number][] = []
    for (let row = 0; row < rebuilt.terrain.rows; row += 1) {
      for (let col = 0; col < rebuilt.terrain.cols; col += 1) {
        const x = rebuilt.terrain.origin[0] + col * rebuilt.terrain.spacing
        const z = rebuilt.terrain.origin[1] + row * rebuilt.terrain.spacing
        let nearest = Infinity
        for (let index = 1; index < path.points.length; index += 1) {
          if (
            path.distances[index - 1]! < path.authoredStartDistance ||
            path.distances[index]! > path.authoredEndDistance
          )
            continue
          const a = path.points[index - 1]!,
            b = path.points[index]!
          const dx = b[0] - a[0],
            dz = b[2] - a[2]
          const t = Math.max(
            0,
            Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)),
          )
          nearest = Math.min(nearest, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t))
        }
        if (nearest > node.width * 0.49) continue
        const height = surfaceHeightAt(rebuilt.terrain, x, z)
        if (height >= -0.2) uncut.push([x, z, height])
      }
    }
    expect(uncut).toEqual([])
  })

  test('extends connected endpoints to the first Site boundary and leaves their mouths open', () => {
    const sourceSite = siteWith()
    const source = flatTerrain()
    const node = river('river_connected_ends', {
      points: [
        [-4, 0],
        [4, 0],
      ],
      width: 6,
      source: 'mountain',
      outlet: 'sea',
    })
    const path = sampleRiverPath(source, node, sourceSite.polygon.points)
    const rebuilt = rebuildRiverTerrain(sourceSite, [node])

    expect(path?.points[0]?.[0]).toBeCloseTo(-10, 6)
    expect(path?.points.at(-1)?.[0]).toBeCloseTo(10, 6)
    expect(surfaceHeightAt(rebuilt.terrain, -9.5, 1.5)).toBeLessThan(-0.1)
    expect(surfaceHeightAt(rebuilt.terrain, 9.5, -1.5)).toBeLessThan(-0.1)
  })

  test('uses the nearest concave boundary crossing without changing a rounded opposite end', () => {
    const source = flatTerrain()
    const boundary = [
      [-10, -8],
      [10, -8],
      [10, 8],
      [2, 8],
      [2, 1],
      [-2, 1],
      [-2, 8],
      [-10, 8],
    ] as const
    const node = river('river_concave_connection', {
      points: [
        [0, 0],
        [0, -2],
      ],
      source: 'mountain',
      outlet: 'rounded',
    })
    const path = sampleRiverPath(source, node, boundary)

    expect(path?.points[0]?.[2]).toBeCloseTo(1, 6)
    expect(path?.points.at(-1)?.[2]).toBeCloseTo(-4, 6)
    expect(path?.authoredStartDistance).toBeCloseTo(1, 6)
  })

  test('removing the final river restores the baseline and removes only river metadata', () => {
    const site = siteWith(flatTerrain(1.4))
    const carved = rebuildRiverTerrain(site, [river('river_restore', { depth: 1.8 })])
    const restored = rebuildRiverTerrain(siteAfter(site, carved), [])

    expect(Array.from(restored.terrain.heights)).toEqual(Array.from(flatTerrain(1.4).heights))
    expect(restored.metadata).toEqual({ retained: 'site-metadata' })
    expect(restored.patch).not.toBeNull()
  })

  test('preserves non-object Site metadata through channel revisions and removal', () => {
    const site = SiteNode.parse({ ...siteWith(), metadata: ['survey', { source: 'import' }] })
    const carved = rebuildRiverTerrain(site, [river('river_metadata')])
    const revised = rebuildRiverTerrain(siteAfter(site, carved), [
      river('river_metadata', { depth: 2 }),
    ])
    const restored = rebuildRiverTerrain(siteAfter(site, revised), [])

    expect(restored.metadata).toEqual(site.metadata)
    expect(restored.terrain.heights).toEqual(flatTerrain().heights)
  })

  test('external sculpt deltas survive a later river revision and final restore', () => {
    const site = siteWith()
    const carved = rebuildRiverTerrain(site, [river('river_external')])
    const externallyEdited = applyHeightPatch(carved.terrain, {
      col0: 3,
      row0: 3,
      cols: 1,
      rows: 1,
      heights: new Int16Array([175]),
    })
    const editedSite = SiteNode.parse({
      ...siteAfter(site, carved),
      terrain: encodeTerrainField(externallyEdited),
    })
    const revised = rebuildRiverTerrain(editedSite, [river('river_external', { depth: 2 })])
    const restored = rebuildRiverTerrain(siteAfter(editedSite, revised), [])

    expect(surfaceHeightAt(revised.terrain, -8.5, -8.5)).toBeCloseTo(1.75, 6)
    expect(surfaceHeightAt(restored.terrain, -8.5, -8.5)).toBeCloseTo(1.75, 6)
    expect(surfaceHeightAt(restored.terrain, 0, 0)).toBeCloseTo(0, 6)
  })

  test('a replaced terrain grid becomes the new safe baseline instead of applying stale samples', () => {
    const site = siteWith()
    const carved = rebuildRiverTerrain(site, [river('river_grid')])
    const replacement = createTerrainField({
      origin: [-12, -12],
      spacing: 1,
      cols: 25,
      rows: 25,
      step: 0.02,
    })
    const replacedSite = SiteNode.parse({
      ...siteAfter(site, carved),
      terrain: encodeTerrainField(replacement),
    })
    const rebuilt = rebuildRiverTerrain(replacedSite, [river('river_grid')])

    expect(rebuilt.terrain.cols).toBe(25)
    expect(rebuilt.terrain.rows).toBe(25)
    expect(rebuilt.terrain.spacing).toBe(1)
    expect(surfaceHeightAt(rebuilt.terrain, 0, 0)).toBeCloseTo(-1, 2)
  })

  test('sequential native delete hooks restore all rivers in one multi-delete transaction', () => {
    const sourceSite = siteWith()
    const first = river('river_delete_first', {
      points: [
        [-8, -3],
        [8, -3],
      ],
    })
    const second = river('river_delete_second', {
      points: [
        [-8, 3],
        [8, 3],
      ],
    })
    const carved = rebuildRiverTerrain(sourceSite, [first, second])
    const carvedSite = siteAfter(sourceSite, carved)
    const nodes = {
      [String(carvedSite.id)]: carvedSite as unknown as AnyNode,
      [String(first.id)]: first as unknown as AnyNode,
      [String(second.id)]: second as unknown as AnyNode,
    } as Record<AnyNodeId, AnyNode>

    for (const node of [first, second]) {
      for (const update of riverDeleteTerrainUpdates(node, nodes)) {
        nodes[update.id] = { ...nodes[update.id]!, ...update.data } as AnyNode
      }
    }

    const restored = SiteNode.parse(nodes[carvedSite.id as AnyNodeId])
    expect(surfaceHeightAt(rebuildRiverTerrain(restored, []).terrain, 0, -3)).toBeCloseTo(0, 6)
    expect(surfaceHeightAt(rebuildRiverTerrain(restored, []).terrain, 0, 3)).toBeCloseTo(0, 6)
    expect(restored.metadata).toEqual({ retained: 'site-metadata' })
  })
})
