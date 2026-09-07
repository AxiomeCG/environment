import { expect, test } from 'bun:test'
import { evaluateGrassBladeCurve } from './blade-shape'

test('rest bend follows a fixed-root circular arc', () => {
  const point = { horizontal: Number.NaN, vertical: Number.NaN }
  evaluateGrassBladeCurve(0, 0, 0.22, point)
  expect(point).toEqual({ horizontal: 0, vertical: 0 })

  evaluateGrassBladeCurve(1, 0.15, 0.22, point)
  expect(point.horizontal).toBeCloseTo(
    (0.15 * (1 - Math.cos(0.22))) / 0.22,
    8,
  )
  expect(point.vertical).toBeCloseTo((0.15 * Math.sin(0.22)) / 0.22, 8)
  expect(point.vertical).toBeLessThan(0.15)
})

test('zero rest bend keeps a finite straight centerline', () => {
  const point = { horizontal: Number.NaN, vertical: Number.NaN }
  evaluateGrassBladeCurve(0.667, 0.10005, 0, point)

  expect(point.horizontal).toBe(0)
  expect(point.vertical).toBe(0.10005)
  expect(Number.isFinite(point.horizontal)).toBe(true)
  expect(Number.isFinite(point.vertical)).toBe(true)
})
