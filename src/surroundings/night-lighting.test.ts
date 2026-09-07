import { expect, test } from 'bun:test'
import { windowSurface } from './night-lighting'

test('produces stable mixed panes alongside completely unlit households', () => {
  let darkHouseholds = 0
  let mixedHouseholds = 0
  for (let house = 0; house < 1_000; house += 1) {
    const buildingId = `house-${house}`
    let litPanes = 0
    for (let pane = 0; pane < 16; pane += 1) {
      const key = `pane-${pane}`
      const surface = windowSurface(buildingId, key)
      expect(windowSurface(buildingId, key)).toBe(surface)
      litPanes += Number(surface === 'window-lit')
    }
    if (litPanes === 0) darkHouseholds += 1
    else if (litPanes < 16) mixedHouseholds += 1
  }
  // Broad bounds preserve the visual contract without pinning individual seeds.
  // Hashing adjacent pane numbers as a suffix previously correlated entire rows.
  expect(darkHouseholds).toBeGreaterThan(150)
  expect(darkHouseholds).toBeLessThan(350)
  expect(mixedHouseholds).toBeGreaterThan(600)
})
