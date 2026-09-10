import { describe, expect, test } from 'bun:test'
import {
  activateGroundCoverTool,
  activatePondTool,
  activateRiverTool,
  activateSurfaceMaterialTool,
  applyPascalShortcut,
  GROUND_COVER_TOOL,
  POND_TOOL,
  RIVER_TOOL,
  SURFACE_MATERIAL_TOOL,
  type PascalToolActionTarget,
} from './pascal-tool-actions'

function actionTarget(calls: string[]): PascalToolActionTarget {
  return {
    setActiveSidebarPanel: (panel) => calls.push(`panel:${panel}`),
    setMode: (mode) => calls.push(`mode:${mode}`),
  }
}

function environmentToolTarget() {
  const state: {
    mode: 'build' | 'select'
    tool: string | null
    viewMode: '2d' | 'split'
  } = {
    mode: 'select',
    tool: null,
    viewMode: '2d',
  }
  return {
    state,
    target: {
      get mode() {
        return state.mode
      },
      get tool() {
        return state.tool
      },
      get viewMode() {
        return state.viewMode
      },
      setMode: (mode: 'build' | 'select') => {
        state.mode = mode
      },
      setTool: (tool: string | null) => {
        state.tool = tool
      },
      setViewMode: (mode: 'split') => {
        state.viewMode = mode
      },
    },
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

describe('Environment canvas tool view lifecycle', () => {
  test('keeps a deliberate 2D view active for every Environment workflow', () => {
    const { state, target } = environmentToolTarget()
    const workflows = [
      ['ground cover', GROUND_COVER_TOOL, activateGroundCoverTool],
      ['surface material', SURFACE_MATERIAL_TOOL, activateSurfaceMaterialTool],
      ['pond', POND_TOOL, activatePondTool],
      ['river', RIVER_TOOL, activateRiverTool],
    ] as const

    for (const [name, tool, activate] of workflows) {
      state.mode = 'select'
      state.tool = null
      state.viewMode = '2d'

      activate(target)

      expect(state, name).toEqual({ mode: 'build', tool, viewMode: '2d' })
    }
  })
})
