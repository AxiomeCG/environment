import { describe, expect, test } from 'bun:test'
import {
  environmentHostPanel,
  environmentPlugin,
  groundCoverDefinition,
  surfaceMaterialDefinition,
  SurroundingsLayer,
} from './index'

describe('Environment plugin manifest', () => {
  test('exports the stable plugin identity and Environment node kinds', () => {
    expect(environmentPlugin.id).toBe('pascal:environment')
    expect(environmentPlugin.apiVersion).toBe(1)
    expect(environmentPlugin.nodes?.map((definition) => definition.kind)).toEqual([
      'environment:ground-cover',
      'environment:surface-material',
    ])
    expect(groundCoverDefinition.kind).toBe('environment:ground-cover')
    expect(surfaceMaterialDefinition.kind).toBe('environment:surface-material')
  })

  test('registers the 2D, portable bake, and Pascal replacement paths', async () => {
    expect(groundCoverDefinition.floorplanScope).toBe('site')
    expect(groundCoverDefinition.floorplan).toBeFunction()
    expect(surfaceMaterialDefinition.floorplanScope).toBe('site')
    expect(surfaceMaterialDefinition.floorplan).toBeFunction()
    expect(groundCoverDefinition.bake).toBe('replace')
    expect(groundCoverDefinition.bakeGeometry).toBeFunction()
    const replacement = await groundCoverDefinition.bakeReplaceRenderer?.module()
    expect(replacement?.default).toBeFunction()
  })

  test('exports a presentation-only Surroundings scene contribution', () => {
    expect(SurroundingsLayer).toBeFunction()
  })

  test('associates the Environment panel with the plugin', () => {
    expect(environmentHostPanel.pluginId).toBe(environmentPlugin.id)
    expect(environmentHostPanel.kinds).toEqual([
      'environment:ground-cover',
      'environment:surface-material',
    ])
    expect(environmentHostPanel.defaultInstalled).toBe(true)
    expect(environmentHostPanel.icon.kind).toBe('url')
    if (environmentHostPanel.icon.kind === 'url') {
      expect(environmentHostPanel.icon.src).toContain('environment-plugin-logo.webp')
    }
    expect(environmentHostPanel.pluginUrl).toBe(
      'https://github.com/pascalorg/plugin-environment',
    )
  })
})
