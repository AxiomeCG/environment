import { describe, expect, test } from 'bun:test'
import { environmentHostPanel, environmentPlugin, groundCoverDefinition } from './index'

describe('Environment plugin manifest', () => {
  test('exports the stable plugin identity and Ground Cover kind', () => {
    expect(environmentPlugin.id).toBe('pascal:environment')
    expect(environmentPlugin.apiVersion).toBe(1)
    expect(environmentPlugin.nodes?.map((definition) => definition.kind)).toEqual([
      'environment:ground-cover',
    ])
    expect(groundCoverDefinition.kind).toBe('environment:ground-cover')
  })

  test('associates the Environment panel with the plugin', () => {
    expect(environmentHostPanel.pluginId).toBe(environmentPlugin.id)
    expect(environmentHostPanel.kinds).toEqual(['environment:ground-cover'])
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
