import { describe, expect, test } from 'bun:test'
import { environmentPlugin, environmentPresentation } from './index'
import { environmentPresentation as renderPresentation, environmentRenderPlugin } from './render'

// Definition fields only an editing host reads (the editor's edit-contribution
// field list); none may appear on a render definition.
const EDIT_FIELDS = [
  'extensions',
  'facingIndicator',
  'drafting',
  'connectedMove',
  'parametrics',
  'placementNotice',
  'quickActions',
  'quickActionNodeScope',
  'tool',
  'affordanceTools',
  'affordances',
  'toolHints',
  'affordanceHints',
  'toolOptions',
  'snapProfile',
  'snapDraftDirectional',
  'preview',
  'keyboardActions',
  'handles',
  'floorplanDependencies',
  'floorplanDependsOnSiblings',
  'floorplanAffectedIds',
  'floorplanSiblingOverrides',
  'floorplanAffordances',
  'floorplanMoveTarget',
]

type Definition = Record<string, unknown> & { kind: string; defaults: () => unknown }

const renderNodes = (environmentRenderPlugin.nodes ?? []) as unknown as Definition[]
const rootNodes = (environmentPlugin.nodes ?? []) as unknown as Definition[]
// Paint tiles have no look, tools or plan of their own: their Ground cover or Surface draws them.
const NO_LOOK = new Set(['environment:paint-tile'])

describe('render-only plugin', () => {
  test('keeps the root plugin identity and registers the same kinds', () => {
    expect(environmentRenderPlugin.id).toBe(environmentPlugin.id)
    expect(environmentRenderPlugin.apiVersion).toBe(environmentPlugin.apiVersion)
    expect(renderNodes.map((def) => def.kind)).toEqual([
      'environment:ground-cover',
      'environment:surface-material',
      'environment:pond',
      'environment:river',
      'environment:paint-tile',
    ])
    expect(renderNodes.map((def) => def.kind)).toEqual(rootNodes.map((def) => def.kind))
  })

  test('each kind loads and draws the same documents as in the editor', () => {
    for (const [i, render] of renderNodes.entries()) {
      const root = rootNodes[i]!
      for (const key of ['schema', 'schemaVersion', 'migrate', 'category', 'bake', 'capabilities']) {
        expect(render[key]).toBe(root[key])
      }
      expect(render.defaults()).toEqual(root.defaults() as never)
      if (NO_LOOK.has(render.kind)) continue
      for (const key of [
        'geometry',
        'system',
        'bakeGeometry',
        'bakeGeometryAsync',
        'bakeReplaceRenderer',
        'floorplan',
        'floorplanScope',
      ]) {
        expect(render[key]).toBeDefined()
        expect(render[key]).toBe(root[key])
      }
    }
  })

  test('render definitions carry no editing fields; the root definitions still do', () => {
    for (const [i, render] of renderNodes.entries()) {
      expect({ kind: render.kind, fields: EDIT_FIELDS.filter((field) => field in render) }).toEqual(
        { kind: render.kind, fields: [] },
      )
      const root = rootNodes[i]!
      if (NO_LOOK.has(render.kind)) continue
      for (const field of ['tool', 'toolHints', 'extensions']) {
        expect(root[field]).toBeDefined()
      }
    }
  })

  test('exports the same atmosphere and surroundings presentation', () => {
    expect(renderPresentation).toBe(environmentPresentation)
    expect(renderPresentation.pluginId).toBe(environmentRenderPlugin.id)
  })
})

/**
 * A host's generic placement (place_plugin_nodes) takes "the kind's defaults carry a position" for
 * "this kind is placed at a point", and creates the node under the level. The lot's ground cover
 * and surface are one node each under the Site, drawn from paint: placed at a point they are an
 * empty node that draws nothing. Like the pond, the river and a paint tile they declare no
 * position, so that host refuses them, and their description names what lays them.
 */
describe('the lot-wide kinds are not placed at a point', () => {
  const kinds = ['environment:ground-cover', 'environment:surface-material']
  test.each(kinds)('%s declares no position, and still loads at the origin', (kind) => {
    const definition = rootNodes.find((def) => def.kind === kind)!
    const defaults = definition.defaults() as Record<string, unknown>
    expect(Array.isArray(defaults.position)).toBe(false)
    const node = (definition.schema as { parse(value: unknown): { position: number[] } }).parse(defaults)
    expect(node.position).toEqual([0, 0, 0])
  })

  test.each(kinds)('%s tells an agent what lays it', (kind) => {
    const definition = rootNodes.find((def) => def.kind === kind)!
    const description = (definition as { mcp?: { description?: string } }).mcp?.description ?? ''
    expect(description).toContain('lay_ground')
    expect(description).toContain('not placed')
  })

  test('no Environment kind is placed at a point', () => {
    for (const definition of rootNodes) {
      expect(Array.isArray((definition.defaults() as Record<string, unknown>).position), definition.kind).toBe(false)
    }
  })
})
