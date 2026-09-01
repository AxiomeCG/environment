import { expect, test } from 'bun:test'
import { buildBladeGeometry } from './blade-geometry'

test('the first blade defines seven manual vertex positions', () => {
  const geometry = buildBladeGeometry({ width: 0.6, height: 2 })
  const position = geometry.getAttribute('position')

  expect(position?.count).toBe(7)
  geometry.dispose()
})
