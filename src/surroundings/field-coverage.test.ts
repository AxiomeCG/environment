import { expect, test } from 'bun:test'
import { fieldCoverage } from './field-coverage'
import { deriveThirdRingPlan, type FieldPatch } from './third-ring'

const meadow: FieldPatch = {
  id: 'meadow',
  kind: 'meadow',
  center: [0, 0],
  width: 10,
  depth: 8,
  rotationY: 0.4,
  seed: 23,
}

test('meadow terrain tint has broken, non-radial coverage', () => {
  // Points at the same radius need not have the same coverage: not a radial patch.
  const coverage = Array.from({ length: 16 }, (_, i) =>
    fieldCoverage(Math.cos((i * Math.PI) / 8) * 3, Math.sin((i * Math.PI) / 8) * 3, meadow),
  )
  expect(Math.max(...coverage) - Math.min(...coverage)).toBeGreaterThan(0.2)
})

test('forest understory follows accepted city-screening tree roots instead of an enclosing field rectangle', () => {
  const boundary = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ] as const
  const plan = deriveThirdRingPlan({ boundary, roads: [], heightAt: () => 0 })
  const woodland = plan.fields.filter((patch) => patch.roots)
  const screening = plan.trees.filter((tree) => tree.clusterId.startsWith('city-woodland-'))
  const roots = woodland.flatMap((patch) => patch.roots!)
  expect(
    roots.filter(([x, z]) =>
      screening.some((tree) => tree.position[0] === x && tree.position[2] === z),
    ).length,
  ).toBeGreaterThan(screening.length * 0.8)
  for (const patch of woodland) expect(fieldCoverage(0, 0, patch)).toBe(0)
})
