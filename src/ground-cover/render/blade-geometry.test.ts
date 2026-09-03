import { expect, test } from 'bun:test'
import { buildBladeGeometry } from './blade-geometry'

test('builds two crossed blades with flared roots', () => {
  const geometry = buildBladeGeometry({ width: 0.6, height: 2 })
  const position = geometry.getAttribute('position')

  expect(position.count).toBe(14)
  expect(geometry.getIndex()?.count).toBe(30)
  expect(position.getX(0)).toBeCloseTo(-0.625)
  expect(position.getX(1)).toBeCloseTo(0.625)
  expect(position.getZ(7)).toBeCloseTo(-0.625)
  expect(position.getZ(8)).toBeCloseTo(0.625)
  expect(position.getY(6)).toBe(1)
  expect(position.getY(13)).toBe(1)
  geometry.dispose()
})
