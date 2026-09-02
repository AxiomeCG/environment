import { describe, expect, test } from 'bun:test'
import {
  activateGroundCoverTool,
  applyPascalShortcut,
  cancelGroundCoverToolFor2D,
  GROUND_COVER_TOOL,
  type GroundCoverToolActionTarget,
  type PascalToolActionTarget,
} from './pascal-tool-actions'

function actionTarget(calls: string[]): PascalToolActionTarget {
  return {
    setActiveSidebarPanel: (panel) => calls.push(`panel:${panel}`),
    setMode: (mode) => calls.push(`mode:${mode}`),
  }
}

function groundCoverTarget(
  calls: string[],
  state: Pick<GroundCoverToolActionTarget, 'mode' | 'tool' | 'viewMode'>,
): GroundCoverToolActionTarget {
  return {
    ...state,
    setMode: (mode) => calls.push(`mode:${mode}`),
    setTool: (tool) => calls.push(`tool:${tool}`),
    setViewMode: (mode) => calls.push(`view:${mode}`),
  }
}

describe('Pascal environment shortcuts', () => {
  test('opens the existing Build mode and panel from the house', () => {
    const calls: string[] = []

    expect(applyPascalShortcut('build', actionTarget(calls))).toBe(true)
    expect(calls).toEqual(['mode:build', 'panel:build'])
  })

  test('activates the existing Terrain sculpt mode from the mound', () => {
    const calls: string[] = []

    expect(applyPascalShortcut('terrain', actionTarget(calls))).toBe(true)
    expect(calls).toEqual(['mode:terrain-sculpt', 'panel:build'])
  })

  test('leaves plugin-owned tools to the Environment panel', () => {
    const calls: string[] = []

    expect(applyPascalShortcut('ground-cover', actionTarget(calls))).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('Ground Cover tool view lifecycle', () => {
  test('promotes a deliberate 2D view to Split when painting starts', () => {
    const calls: string[] = []
    const editor = groundCoverTarget(calls, {
      mode: 'select',
      tool: null,
      viewMode: '2d',
    })

    activateGroundCoverTool(editor)

    expect(calls).toEqual([
      'view:split',
      `tool:${GROUND_COVER_TOOL}`,
      'mode:build',
    ])
  })

  test('leaving Split for 2D cancels Ground Cover painting', () => {
    const calls: string[] = []
    const editor = groundCoverTarget(calls, {
      mode: 'build',
      tool: GROUND_COVER_TOOL,
      viewMode: '2d',
    })

    expect(cancelGroundCoverToolFor2D(editor)).toBe(true)
    expect(calls).toEqual(['mode:select'])
  })

  test('keeps Ground Cover armed in Split', () => {
    const calls: string[] = []
    const editor = groundCoverTarget(calls, {
      mode: 'build',
      tool: GROUND_COVER_TOOL,
      viewMode: 'split',
    })

    expect(cancelGroundCoverToolFor2D(editor)).toBe(false)
    expect(calls).toEqual([])
  })
})
