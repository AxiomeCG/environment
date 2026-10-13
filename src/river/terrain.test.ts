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
  planRiver,
  rebuildRiverTerrain,
  riverTerrainBaseline,
  riverTerrainIsApplied,
  riverSurfaceInset,
  riverTerrainPayloadBytes,
  sampleRiverPath,
  type RiverPlan,
  type RiverPlanSample,
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
  overrides: Partial<
    Pick<
      RiverNodeType,
      | 'points'
      | 'width'
      | 'depth'
      | 'pointWidths'
      | 'pointDepths'
      | 'source'
      | 'outlet'
      | 'flow'
      | 'maxSlopePct'
      | 'section'
      | 'ends'
    >
  > = {},
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
    ...(overrides.pointWidths ? { pointWidths: overrides.pointWidths } : {}),
    ...(overrides.pointDepths ? { pointDepths: overrides.pointDepths } : {}),
    source: overrides.source ?? 'rounded',
    outlet: overrides.outlet ?? 'rounded',
    flowDirection: 'forward',
    flowSpeed: 0.6,
    quality: 'clear',
    shoreline: 'soft',
    ...(overrides.flow ? { flow: overrides.flow } : {}),
    ...(overrides.maxSlopePct !== undefined ? { maxSlopePct: overrides.maxSlopePct } : {}),
    ...(overrides.section ? { section: overrides.section } : {}),
    ...(overrides.ends ? { ends: overrides.ends } : {}),
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

describe('river v3 model', () => {
  // Carving such a river exactly as the pre-v3 carver did is proven against
  // that carver itself in legacy-carve.test.ts.
  test('a pre-v3 river parses with as-drawn defaults', () => {
    const legacy = RiverNode.parse({
      id: 'river_legacy',
      type: 'environment:river',
      object: 'node',
      parentId: 'site_river_terrain',
      visible: true,
      metadata: {},
      name: 'River',
      points: [
        [-8, 0],
        [8, 0],
      ],
      width: 4,
      depth: 1,
      source: 'rounded',
      outlet: 'rounded',
      flowDirection: 'forward',
      flowSpeed: 0.6,
      quality: 'clear',
      shoreline: 'soft',
    })
    expect(legacy.flow).toBe('as_drawn')
    expect(legacy.pointWidths).toEqual([])
    expect(legacy.section.shape).toBe('curved')
    expect(legacy.ends).toEqual({ start: 'rounded', end: 'rounded' })
  })

  test('per-point width and depth shape the channel along the path', () => {
    const site = siteWith()
    const node = river('river_per_point', {
      points: [
        [-8, 0],
        [0, 0],
        [8, 0],
      ],
      width: 2,
      depth: 0.5,
      pointWidths: [2, 10, 2],
      pointDepths: [0.5, 3, 0.5],
    })
    const rebuilt = rebuildRiverTerrain(site, [node])
    // Deep and wide in the middle, shallow and narrow near the ends.
    expect(surfaceHeightAt(rebuilt.terrain, 0, 0)).toBeLessThan(-2.5)
    expect(surfaceHeightAt(rebuilt.terrain, 0, 4)).toBeLessThan(-0.1)
    expect(surfaceHeightAt(rebuilt.terrain, -7.5, 0)).toBeGreaterThan(-1.5)
    expect(surfaceHeightAt(rebuilt.terrain, -7.5, 0)).toBeGreaterThan(
      surfaceHeightAt(rebuilt.terrain, 0, 0) + 1,
    )
    expect(surfaceHeightAt(rebuilt.terrain, -7.5, 2.5)).toBeCloseTo(0, 6)
  })

  test('downhill water cuts through a ridge and fills across a dip', () => {
    const groundAt = (x: number) =>
      2 - 0.1 * (x + 8) + (Math.abs(x) < 2 ? 2 : 0) + (x >= 4 && x <= 6 ? -2 : 0)
    const terrain = terrainFromFunction(groundAt)
    const site = siteWith(terrain)
    const node = river('river_downhill', { flow: 'downhill', maxSlopePct: 2, depth: 1 })
    const plan = planRiver(terrain, node, site.polygon.points)!
    expect(plan.upstreamAtStart).toBe(true)
    for (let index = 1; index < plan.samples.length; index += 1) {
      expect(plan.samples[index]!.waterY).toBeLessThanOrEqual(plan.samples[index - 1]!.waterY + 1e-9)
    }
    expect(plan.facts.cutVolumeM3).toBeGreaterThan(0)
    expect(plan.facts.fillVolumeM3).toBeGreaterThan(0)
    expect(plan.facts.embankedLengthM).toBeGreaterThan(0)
    expect(plan.facts.maxEmbankmentM).toBeGreaterThan(0.5)
    expect(plan.facts.lengthM).toBeCloseTo(16, 0)

    const rebuilt = rebuildRiverTerrain(site, [node])
    // The ridge is cut well below its crest; the dip is filled above its floor.
    expect(surfaceHeightAt(rebuilt.terrain, 0, 0)).toBeLessThan(groundAt(0) - 1.5)
    expect(surfaceHeightAt(rebuilt.terrain, 5, 0)).toBeGreaterThan(groundAt(5) + 0.3)
  })

  test('spring shallows the start and fan widens and shallows the end', () => {
    const terrain = flatTerrain()
    const site = siteWith(terrain)
    const node = river('river_ends', {
      points: [
        [-4, 0],
        [4, 0],
      ],
      ends: { start: 'spring', end: 'fan' },
    })
    const plan = planRiver(terrain, node, site.polygon.points)!
    const authoredStart = plan.samples.find(
      (sample) => sample.distanceM >= plan.path.authoredStartDistance,
    )!
    expect(plan.samples[0]!.depthM).toBeLessThan(authoredStart.depthM)
    expect(plan.samples.at(-1)!.widthM).toBeGreaterThan(node.width)
    expect(plan.samples.at(-1)!.depthM).toBeLessThan(node.depth)
  })

  test('an applied carve is recognised, so reconciliation writes nothing again', () => {
    const site = siteWith()
    const node = river('river_applied', { flow: 'downhill' })
    const applied = rebuildRiverTerrain(site, [node])
    const appliedSite = siteAfter(site, applied)
    expect(riverTerrainIsApplied(appliedSite, [node])).toBe(true)
    expect(riverTerrainIsApplied(site, [node])).toBe(false)
    const revised = river('river_applied', { flow: 'downhill', depth: 2 })
    expect(riverTerrainIsApplied(appliedSite, [revised])).toBe(false)
    expect(riverTerrainPayloadBytes(applied)).toBeGreaterThan(1_000)
  })
})

function terrainFromFunction(heightAtX: (x: number) => number): TerrainField {
  const terrain = createTerrainField({
    origin: [-10, -10],
    spacing: 0.5,
    cols: 41,
    rows: 41,
    step: 0.01,
  })
  const heights = new Int16Array(terrain.heights.length)
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const x = terrain.origin[0] + col * terrain.spacing
      heights[row * terrain.cols + col] = Math.round(heightAtX(x) / terrain.step)
    }
  }
  return { ...terrain, heights }
}

function sampleNearest(plan: RiverPlan, distanceM: number): RiverPlanSample {
  return plan.samples.reduce((best, sample) =>
    Math.abs(sample.distanceM - distanceM) < Math.abs(best.distanceM - distanceM) ? sample : best,
  )
}

describe('per-point sizes keep their spline span', () => {
  // Sol's review input: the path crosses itself, so a spatial nearest-segment
  // lookup confuses the narrow first reach with the wide last one.
  const crossingPoints: [number, number][] = [
    [-8, -8],
    [8, 8],
    [-8, 8],
    [8, -8],
  ]

  test('a self-crossing river keeps each reach on its own width', () => {
    const terrain = flatTerrain()
    const node = river('river_crossing', {
      points: crossingPoints,
      pointWidths: [2, 2, 12, 12],
      pointDepths: [1, 1, 4, 4],
    })
    const plan = planRiver(terrain, node, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    // Stations from the review: 12.17 m lies on the first (narrow) reach near
    // the crossing, 52.42 m on the last (wide) reach.
    expect(sampleNearest(plan, 12.17).widthM).toBeCloseTo(2, 6)
    expect(sampleNearest(plan, 52.42).widthM).toBeCloseTo(12, 6)
    expect(sampleNearest(plan, 12.17).depthM).toBeCloseTo(1, 6)
    expect(sampleNearest(plan, 52.42).depthM).toBeCloseTo(4, 6)
  })

  test('a loop closing on its first point keeps distinct end sizes', () => {
    const terrain = flatTerrain()
    const node = river('river_loop', {
      points: [
        [0, -8],
        [8, 0],
        [0, 8],
        [-8, 0],
        [0, -8],
      ],
      pointWidths: [2, 6, 6, 6, 12],
    })
    const plan = planRiver(terrain, node, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    expect(plan.authoredStartWidthM).toBeCloseTo(2, 6)
    expect(plan.authoredEndWidthM).toBeCloseTo(12, 6)
  })
})

describe('downhill caps follow the authored ends', () => {
  test('the higher authored end is upstream even when a cap tip beyond the other end is higher', () => {
    // Review input: 2 m before x = -8, falling to 1 m at x = 8, then rising to
    // 5 m at x = 10, under the end cap.
    const groundAt = (x: number) => (x <= -8 ? 2 : x <= 8 ? 2 - (x + 8) / 16 : 1 + (x - 8) * 2)
    const terrain = terrainFromFunction(groundAt)
    const node = river('river_upstream', { flow: 'downhill' })
    const plan = planRiver(terrain, node, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    expect(plan.upstreamAtStart).toBe(true)
  })

  test('the profile starts at the authored upstream end and the upstream cap holds its level', () => {
    // The ground drops to 0 m under the start cap: solving from the cap tip
    // would pin the whole river 2 m low.
    const groundAt = (x: number) => (x < -8 ? 0 : 2 - (x + 8) / 16)
    const terrain = terrainFromFunction(groundAt)
    const node = river('river_cap_dip', { flow: 'downhill' })
    const plan = planRiver(terrain, node, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    const authoredStart = plan.samples[plan.path.authoredStartIndex]
    if (!authoredStart) throw new Error('expected an authored start sample')
    expect(plan.upstreamAtStart).toBe(true)
    expect(authoredStart.waterY).toBeCloseTo(groundAt(-8) - riverSurfaceInset(node.depth), 2)
    for (const capSample of plan.samples.slice(0, plan.path.authoredStartIndex)) {
      expect(capSample.waterY).toBe(authoredStart.waterY)
    }
  })
})

describe('river facts', () => {
  test('lengths integrate only the authored reach they report, never the caps', () => {
    // Review input: ground falling 30 % under a 2 % river, so the whole
    // authored reach runs embanked at the maximum slope.
    const terrain = terrainFromFunction((x) => -0.3 * x)
    const node = river('river_facts', { flow: 'downhill', maxSlopePct: 2 })
    const plan = planRiver(terrain, node, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    expect(plan.facts.lengthM).toBeCloseTo(16, 6)
    expect(plan.facts.embankedLengthM).toBeCloseTo(plan.facts.lengthM, 6)
    expect(plan.facts.rapidLengthM).toBeCloseTo(plan.facts.lengthM, 6)
  })
})

describe('trapezoid sections', () => {
  test('facts report how much shallower a too-narrow trapezoid had to be', () => {
    const terrain = flatTerrain()
    const section = { shape: 'trapezoid', bankSlope: 2, bendAsymmetry: 0, bermM: 0, blendM: 2 } as const
    const narrowDeep = river('river_narrow_deep', { width: 4, depth: 8, section })
    const plan = planRiver(terrain, narrowDeep, siteWith(terrain).polygon.points)
    if (!plan) throw new Error('expected a plan')
    // 2 m half-width at a 2:1 bank slope reaches 1 m: 7 m short of the authored 8 m.
    expect(plan.facts.depthShortfallM).toBeCloseTo(7, 6)
    const fits = river('river_fits', { width: 4, depth: 0.5, section })
    expect(planRiver(terrain, fits, siteWith(terrain).polygon.points)?.facts.depthShortfallM).toBe(0)
  })
})
