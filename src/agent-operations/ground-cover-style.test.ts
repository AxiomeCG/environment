import { SiteNode, type AnyNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ENVIRONMENT_AGENT_TOOLS, setGroundCoverStyleTool } from '../agent-tools'
import { createGroundCoverNode } from '../ground-cover/create-node'
import { grassFieldParametrics } from '../ground-cover/parametrics'
import { GrassFieldNode } from '../ground-cover/schema'
import { environmentAgentOperations, refusalCode } from './index'
import type { SceneChanges, SceneNodes } from './types'

// Inspector bounds and node defaults, deliberately independent of the tool's schema.
const fields = [
  ['density', 0, 100, 100],
  ['flowerDensity', 0, 100, 0],
  ['bladeHeight', 0.05, 1, 0.3],
  ['bladeWidth', 0.005, 0.2, 0.035],
  ['bladeRestBend', 0, 1, 0.22],
  ['bladeTipBrightness', 0, 500, 130],
  ['bladeHeightVariation', 0, 100, 20],
  ['bladeWidthVariation', 0, 100, 20],
  ['bladeTintVariation', 0, 100, 20],
  ['windStrength', 0, 200, 100],
  ['grassWindInfluence', 0, 300, 100],
  ['obstacleBendRadius', 0, 3, 0.75],
  ['obstacleBendStrength', 0, 0.5, 0.12],
  ['obstacleFlattening', 0, 100, 60],
] as const

type StyleKey = (typeof fields)[number][0]

function fixture(withCover = true) {
  const site = SiteNode.parse({
    id: 'site_style',
    polygon: { type: 'polygon', points: [[0, 0], [8, 0], [8, 8], [0, 8]] },
    children: [],
  })
  const cover = createGroundCoverNode(site)
  const nodes: Record<string, AnyNode> = { [site.id]: site }
  if (withCover) nodes[cover.id] = cover as unknown as AnyNode
  return { site, cover, nodes }
}

function setStyle(nodes: SceneNodes, input: unknown) {
  return environmentAgentOperations.set_ground_cover_style(nodes, input as never, { activeLevelId: null })
}

function applyChanges(nodes: SceneNodes, changes: SceneChanges | undefined) {
  const next = { ...nodes }
  for (const { node } of changes?.create ?? []) next[node.id] = node
  for (const { id, data } of changes?.update ?? []) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

function readCover(nodes: SceneNodes) {
  return environmentAgentOperations.read_environment(nodes, { hollowsLimit: 0 }, { activeLevelId: null })
    .result.groundCover as { present: boolean; style: Record<StyleKey, number> | null; units: Record<string, unknown> | null }
}

function refusalOf(nodes: SceneNodes, input: unknown) {
  try { setStyle(nodes, input) } catch (error) { return refusalCode(error) }
  return null
}

describe('set_ground_cover_style', () => {
  test('is a shared operation contract available to both agent lanes', () => {
    expect(ENVIRONMENT_AGENT_TOOLS.tools).toContain(setGroundCoverStyleTool)
    expect(setGroundCoverStyleTool.runsIn).toBe('operation')
    expect('chatOnly' in setGroundCoverStyleTool).toBe(false)
    expect(setGroundCoverStyleTool.annotations.idempotentHint).toBe(true)
  })

  for (const [key, min, max, defaultValue] of fields) {
    test(`${key} keeps the inspector bounds and node default`, () => {
      const descriptor = grassFieldParametrics.groups?.flatMap((group) => group.fields).find((field) => field.key === key)
      expect(descriptor).toMatchObject({ min, max })
      expect(GrassFieldNode.parse({})[key]).toBe(defaultValue)
    })

    test(`${key} accepts both bounds and returns the node's complete style`, () => {
      const { nodes, cover } = fixture()
      for (const value of [min, (min + max) / 2, max]) {
        expect(z.object(setGroundCoverStyleTool.input).safeParse({ [key]: value }).success).toBe(true)
        const { result, changes } = setStyle(nodes, { [key]: value })
        const changed = applyChanges(nodes, changes)
        const node = changed[cover.id] as unknown as GrassFieldNode
        expect(node[key]).toBe(value)
        expect(result.groundCoverId).toBe(cover.id)
        const style = result.style as Record<StyleKey, number>
        for (const [field] of fields) expect(style[field]).toBe(node[field])
        expect(readCover(changed).style).toEqual(style)
        expect(readCover(changed).units).toEqual(result.units as Record<string, unknown>)
      }
      expect(nodes[cover.id] as unknown).toBe(cover)
    })

    test(`${key} refuses out-of-range and non-finite values without clamping`, () => {
      const { nodes, cover } = fixture()
      for (const value of [min - 0.001, max + 0.001, NaN, Infinity, -Infinity, '1', null]) {
        expect(z.object(setGroundCoverStyleTool.input).safeParse({ [key]: value }).success).toBe(false)
        expect(refusalOf(nodes, { [key]: value })).toBe('invalid_ground_cover_style')
      }
      expect(nodes[cover.id] as unknown).toBe(cover)
    })
  }

  test('updates all fields together without touching paint or transforms', () => {
    const { nodes, cover } = fixture()
    const patch = Object.fromEntries(fields.map(([key, min, max]) => [key, (min + max) / 2]))
    const { changes } = setStyle(nodes, patch)
    expect(changes?.create).toBeUndefined()
    expect(changes?.update).toEqual([{ id: cover.id, data: patch }])
  })

  test('omitted fields keep existing non-default values on repeated calls', () => {
    const { nodes, cover } = fixture()
    const first = setStyle(nodes, { bladeHeight: 0.45, density: 80 })
    const changed = applyChanges(nodes, first.changes)
    const second = setStyle(changed, { bladeWidth: 0.05 })
    expect(second.result.style).toMatchObject({ bladeHeight: 0.45, density: 80, bladeWidth: 0.05 })
    const styled = applyChanges(changed, second.changes)
    const repeated = setStyle(styled, { bladeWidth: 0.05 })
    expect(repeated.result.created).toBe(false)
    expect(repeated.result.style).toEqual(second.result.style)
    expect(repeated.result.groundCoverId).toBe(cover.id)
  })

  test('creates an unpainted cover with unchanged defaults for omitted fields', () => {
    const { nodes, site } = fixture(false)
    const { result, changes } = setStyle(nodes, { bladeHeight: 0.4 })
    const created = changes?.create?.[0]
    expect(created?.parentId).toBe(site.id)
    const node = created?.node as unknown as GrassFieldNode
    expect(node.unpaintedCoverage).toBe(0)
    for (const [key, , , defaultValue] of fields) {
      expect(node[key]).toBe(key === 'bladeHeight' ? 0.4 : defaultValue)
    }
    expect(result.created).toBe(true)
    expect(readCover(applyChanges(nodes, changes)).style).toEqual(result.style as Record<StyleKey, number>)
  })

  test('reports nominal metres and nonlinear full-paint blade density, not actual visible counts', () => {
    const { nodes } = fixture()
    const { result } = setStyle(nodes, { bladeHeight: 0.4, bladeWidth: 0.05, density: 50 })
    const fraction = (0.5 - 0.05) / 0.95
    const effectiveDensity = fraction * fraction * (3 - 2 * fraction)
    expect(result.units).toMatchObject({
      bladeHeightM: 0.4,
      bladeWidthM: 0.05,
      candidateCellM: 0.08,
      maxBladesPerM2: 156.25,
    })
    const units = result.units as { bladesPerM2: number; densityHeightScale: number; unvariedHeightM: number; meaning: string }
    expect(units.bladesPerM2).toBeCloseTo(156.25 * effectiveDensity, 6)
    expect(units.densityHeightScale).toBeCloseTo(effectiveDensity ** 2, 6)
    expect(units.unvariedHeightM).toBeCloseTo(0.4 * effectiveDensity ** 2, 6)
    expect(units.meaning).toContain('full paint')
    expect(units.meaning).toContain('LOD')
    for (const density of [0, 5, 100]) {
      const units = setStyle(nodes, { density }).result.units as { bladesPerM2: number }
      expect(units.bladesPerM2).toBe(density === 100 ? 156.25 : 0)
    }
  })

  test('refuses empty, unknown and partially invalid patches atomically', () => {
    const { nodes } = fixture()
    for (const input of [{}, { spacing: 0.04 }, { bladeHeight: 0.4, density: 101 }]) {
      expect(refusalOf(nodes, input)).toBe('invalid_ground_cover_style')
    }
  })

  test('names the invalid field in the coded refusal details', () => {
    const { nodes } = fixture()
    try {
      setStyle(nodes, { bladeHeight: 1.1 })
      throw new Error('Expected a style refusal')
    } catch (error) {
      expect(refusalCode(error)).toBe('invalid_ground_cover_style')
      expect(error).toMatchObject({ details: { issues: [{ field: 'bladeHeight' }] } })
    }
  })

  test('refuses when there is no site', () => {
    expect(refusalOf({}, { density: 100 })).toBe('no_site')
  })
})

test('read_environment reports no style when ground cover is absent', () => {
  const { nodes } = fixture(false)
  expect(readCover(nodes)).toMatchObject({ present: false, style: null, units: null })
})

test('read_environment fills legacy missing style fields with node defaults without mutating', () => {
  const { nodes, cover } = fixture()
  const legacy = { ...cover } as Partial<GrassFieldNode>
  delete legacy.bladeHeight
  delete legacy.density
  nodes[cover.id] = legacy as unknown as AnyNode
  expect(readCover(nodes).style).toMatchObject({ bladeHeight: 0.3, density: 100 })
  expect(legacy.bladeHeight).toBeUndefined()
})
