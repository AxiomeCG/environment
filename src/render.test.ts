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

describe('render-only plugin', () => {
  test('keeps the root plugin identity and registers the same kinds', () => {
    expect(environmentRenderPlugin.id).toBe(environmentPlugin.id)
    expect(environmentRenderPlugin.apiVersion).toBe(environmentPlugin.apiVersion)
    expect(renderNodes.map((def) => def.kind)).toEqual([
      'environment:ground-cover',
      'environment:surface-material',
      'environment:pond',
      'environment:river',
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
