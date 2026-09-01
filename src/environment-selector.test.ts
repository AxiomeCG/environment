import { describe, expect, test } from 'bun:test'
import { ENVIRONMENT_TOOL_LABELS, ENVIRONMENT_TOOLS } from './environment-selector'

describe('Environment selector catalogue', () => {
  test('keeps the illustrated tool identities stable', () => {
    expect(ENVIRONMENT_TOOLS).toEqual([
      'ground-cover',
      'atmosphere',
      'surroundings',
      'build',
      'terrain',
      'path',
      'water',
    ])
  })

  test('provides a text fallback label for every illustrated tool', () => {
    expect(Object.keys(ENVIRONMENT_TOOL_LABELS).sort()).toEqual([...ENVIRONMENT_TOOLS].sort())
  })
})
