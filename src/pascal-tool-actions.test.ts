import { describe, expect, test } from 'bun:test'
import { applyPascalShortcut, type PascalToolActionTarget } from './pascal-tool-actions'

function actionTarget(calls: string[]): PascalToolActionTarget {
  return {
    setActiveSidebarPanel: (panel) => calls.push(`panel:${panel}`),
    setMode: (mode) => calls.push(`mode:${mode}`),
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
